const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('unresponsive background messages time out instead of blocking captions', async () => {
  const source = fs.readFileSync(path.join(root, 'src/content/main.js'), 'utf8');
  const context = vm.createContext({
    chrome: { runtime: { sendMessage() {} } },
    vlog() {}, setTimeout, clearTimeout,
  });
  vm.runInContext(source.slice(source.indexOf('function send('), source.indexOf('function el(')), context);
  const result = await context.send({ type: 'GET_LESSON' }, 10);
  assert.equal(result.ok, false);
  assert.match(result.error, /GET_LESSON.*超时/);
});

test('captions render even when cache reads fail and cache writes never finish', async () => {
  const source = fs.readFileSync(path.join(root, 'src/content/main.js'), 'utf8');
  const state = { site: 'youtube', videoId: 'test', lessons: {}, cues: [] };
  const requests = [];
  let rendered = false;
  const context = vm.createContext({
    state, document: { title: 'Test' }, Date,
    VL_SENTENCE_VERSION: 1, combineSubtitleSentences: cues => cues,
    vlog() {}, setStatus() {}, scheduleLessonPreload() {},
    getVideoInfo: () => ({ site: 'youtube', videoId: 'test' }),
    refreshCueList: () => { if (state.cues.length) rendered = true; },
    loadYouTubeCues: async () => [{ start: 0, end: 1, text: 'Hello' }],
    send: msg => {
      requests.push(msg.type);
      return msg.type === 'GET_LESSON' ? Promise.resolve({ ok: false, error: 'timeout' }) : new Promise(() => {});
    },
  });
  vm.runInContext(source.slice(source.indexOf('let subtitleLoadId'), source.indexOf('function getVideoInfo()')), context);
  await context.loadCuesForCurrentVideo();
  assert.equal(rendered, true);
  assert.equal(state.videoKey, 'yt:test');
  assert.deepEqual(requests, ['GET_LESSON', 'SAVE_LESSON']);
});

test('blocked IndexedDB opening rejects immediately', async () => {
  let request;
  const source = fs.readFileSync(path.join(root, 'src/background/idb.js'), 'utf8').replace(/^export .*;$/gm, '');
  const context = vm.createContext({
    indexedDB: { open: () => (request = {}) }, setTimeout, clearTimeout,
  });
  vm.runInContext(source, context);
  const result = context.openDB();
  request.onblocked();
  await assert.rejects(result, /阻塞/);
});

test('legacy Chinese YouTube cache is replaced instead of rendered', async () => {
  const source = fs.readFileSync(path.join(root, 'src/content/main.js'), 'utf8');
  const state = { site: 'youtube', videoId: 'test', cues: [], lessons: {} };
  let saved;
  let loads = 0;
  const context = vm.createContext({ state, document: { title: 'Test' }, Date,
    VL_SENTENCE_VERSION: 2, combineSubtitleSentences: cues => cues,
    vlog() {}, setStatus() {}, refreshCueList() {}, scheduleLessonPreload() {},
    getVideoInfo: () => ({ site: 'youtube', videoId: 'test' }),
    loadYouTubeCues: async () => { loads++; return [{ start: 0, end: 1, text: 'Hello' }]; },
    send: async msg => {
      if (msg.type === 'GET_LESSON') return { ok: true, videoKey: 'yt:test', lesson: {
        cues: [{ text: '你好' }], lessons: { 0: { translation: 'stale' } }, meta: { sentenceVersion: 2, source: 'youtube-caption' },
      } };
      saved = msg.lesson;
      return { ok: true };
    },
  });
  vm.runInContext(source.slice(source.indexOf('let subtitleLoadId'), source.indexOf('function getVideoInfo()')), context);
  await context.loadCuesForCurrentVideo();
  assert.equal(loads, 1);
  assert.equal(state.cues[0].text, 'Hello');
  assert.equal(Object.keys(state.lessons).length, 0);
  assert.equal(saved.meta.captionLanguageVersion, 2);
});

function bridge() {
  class CustomEvent extends Event {
    constructor(type, options = {}) { super(type); this.detail = options.detail; }
  }
  class XHR extends EventTarget {
    open() {}
  }
  const document = new EventTarget();
  document.getElementById = () => null;
  document.querySelectorAll = () => [];
  const location = new URL('https://www.youtube.com/watch?v=new-video');
  const window = new EventTarget();
  window.ytInitialPlayerResponse = {
    videoDetails: { videoId: 'old-video' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'old' }] } },
  };
  window.fetch = async () => new Response(JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'Hello' }] }] }));
  const context = vm.createContext({ window, document, location, URL, URLSearchParams, XMLHttpRequest: XHR, CustomEvent, console, setTimeout });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/content/page-bridge.js'), 'utf8'), context);
  function request(name) {
    let result;
    const response = name.replace('request', 'response');
    document.addEventListener(response, e => { result = e.detail; }, { once: true });
    document.dispatchEvent(new CustomEvent(name));
    return result;
  }
  return { window, document, location, XHR, request };
}

test('SPA video ID uses the current URL and rejects stale initial tracks', () => {
  const { request } = bridge();
  assert.equal(request('vl-request-video-id').videoId, 'new-video');
  assert.equal(request('vl-request-captions').tracks, null);
});

test('enables native English captions with no Chinese translation retained', async () => {
  const { document } = bridge();
  const calls = [];
  document.getElementById = () => ({
    loadModule: name => calls.push(name),
    getOption: () => [
      { languageCode: 'zh-Hans' },
      { languageCode: 'en', kind: 'asr', vssId: 'a.en' },
      { languageCode: 'en-US', vssId: '.en-US' },
    ],
    setOption: (...args) => calls.push(args),
  });
  const result = new Promise(resolve => document.addEventListener('vl-english-captions-enabled', e => resolve(e.detail), { once: true }));
  document.dispatchEvent(new Event('vl-enable-english-captions'));
  assert.equal((await result).ok, true);
  assert.equal(calls[0], 'captions');
  assert.equal(calls[1][2].languageCode, 'en-US');
  assert.equal(calls[1][2].translationLanguage, null);
});

test('missing player API reports failure without toggling an arbitrary subtitle', async () => {
  const { document } = bridge();
  const result = new Promise(resolve => document.addEventListener('vl-english-captions-enabled', e => resolve(e.detail), { once: true }));
  document.dispatchEvent(new Event('vl-enable-english-captions'));
  assert.equal((await result).ok, false);
});

test('current German audio selects German subtitles and tracks audio language changes', async () => {
  const { document, request, XHR } = bridge();
  let language = 'de';
  let selected;
  document.getElementById = () => ({
    getAudioTrack: () => ({ id: `${language}.4` }),
    loadModule() {},
    getOption: () => [{ languageCode: 'en' }, { languageCode: 'de' }],
    setOption: (module, option, track) => { selected = track; },
  });
  assert.equal(request('vl-request-audio-language').lang, 'de');
  const result = new Promise(resolve => document.addEventListener('vl-english-captions-enabled', e => resolve(e.detail), { once: true }));
  document.dispatchEvent(new Event('vl-enable-english-captions'));
  assert.equal((await result).lang, 'de');
  assert.equal(selected.languageCode, 'de');
  const xhr = new XHR();
  xhr.open('GET', 'https://www.youtube.com/api/timedtext?v=new-video&lang=de');
  xhr.responseText = '{"events":[]}';
  xhr.dispatchEvent(new Event('load'));
  const body = new Promise(resolve => document.addEventListener('vl-response-caption-body', e => resolve(e.detail), { once: true }));
  const event = new Event('vl-request-caption-body');
  event.detail = { lang: 'de' };
  document.dispatchEvent(event);
  assert.equal((await body).lang, 'de');
  language = 'fr';
  assert.equal(request('vl-request-audio-language').lang, 'fr');
});

test('unknown audio language is not guessed from a Chinese default subtitle', () => {
  const { document, request } = bridge();
  document.getElementById = () => ({ getPlayerResponse: () => ({
    videoDetails: { videoId: 'new-video' }, captions: { playerCaptionsTracklistRenderer: {
      defaultAudioTrackIndex: 0, audioTracks: [{ defaultCaptionTrackIndex: 0 }],
      captionTracks: [{ languageCode: 'zh-Hans' }, { languageCode: 'en' }],
    } },
  }) });
  assert.equal(request('vl-request-audio-language').lang, null);
});

test('und audio identifiers fall back to original English ASR instead of requesting und captions', () => {
  const { document, request } = bridge();
  document.getElementById = () => ({
    getAudioTrack: () => ({ id: 'und.4', languageCode: 'und', language: 'unknown' }),
    getPlayerResponse: () => ({ videoDetails: { videoId: 'new-video' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [
        { languageCode: 'zh-Hans' }, { languageCode: 'en', kind: 'asr' },
      ] } },
    }),
  });
  assert.equal(request('vl-request-audio-language').lang, 'en');
});

test('explicit German audio takes priority over English ASR and unknown metadata stays unknown', () => {
  const { document, request } = bridge();
  let current = { languageCode: 'de', id: 'und.4' };
  document.getElementById = () => ({
    getAudioTrack: () => current,
    getOption: () => [{ languageCode: 'en', kind: 'asr' }],
  });
  assert.equal(request('vl-request-audio-language').lang, 'de');
  current = { languageCode: 'und', id: 'und.4' };
  document.getElementById = () => ({ getAudioTrack: () => current });
  assert.equal(request('vl-request-audio-language').lang, null);
});

test('captures native fetch caption responses and isolates videos', async () => {
  const { window, request, location } = bridge();
  await window.fetch(new URL('https://www.youtube.com/api/timedtext?v=new-video&lang=en&pot=session'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(request('vl-request-caption-body').lang, 'en');
  location.search = '?v=another-video';
  assert.equal(request('vl-request-caption-body'), null);
});

test('captures native XHR captions and ignores empty responses', () => {
  const { XHR, request } = bridge();
  const xhr = new XHR();
  xhr.open('GET', 'https://www.youtube.com/api/timedtext?v=new-video&lang=en');
  xhr.responseText = '{"events":[]}';
  xhr.dispatchEvent(new Event('load'));
  assert.equal(request('vl-request-caption-body').text, '{"events":[]}');
  const empty = new XHR();
  empty.open('GET', 'https://www.youtube.com/api/timedtext?v=new-video&lang=en');
  empty.responseText = '';
  empty.dispatchEvent(new Event('load'));
  assert.equal(request('vl-request-caption-body').text, '{"events":[]}');
});

test('Chinese translations cannot overwrite or masquerade as English captions', () => {
  const { XHR, request } = bridge();
  function capture(query, text) {
    const xhr = new XHR();
    xhr.open('GET', `https://www.youtube.com/api/timedtext?v=new-video&${query}`);
    xhr.responseText = JSON.stringify({ text });
    xhr.dispatchEvent(new Event('load'));
  }
  capture('lang=en&tlang=zh-Hans', '你好');
  assert.equal(request('vl-request-caption-body'), null);
  capture('lang=en', 'Hello');
  capture('lang=en&tlang=zh-Hans', '新的中文');
  assert.equal(JSON.parse(request('vl-request-caption-body').text).text, 'Hello');
});

test('YouTube rejects Chinese-only tracks and translated tracks labelled English', async () => {
  const source = fs.readFileSync(path.join(root, 'src/content/main.js'), 'utf8');
  const start = source.indexOf('function isEnglishCaptionText(');
  const end = source.indexOf('\nfunction ', source.indexOf('async function loadYouTubeCaptionCues(') + 1);
  const tracks = [
    { lang: 'zh-Hans', baseUrl: 'https://www.youtube.com/api/timedtext?lang=zh-Hans' },
    { lang: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=en&tlang=zh-Hans' },
  ];
  const context = vm.createContext({ URL, state: { videoId: 'test' }, vlog() {},
    requestFromBridge: async name => name === 'vl-request-caption-body' ? null : { tracks },
  });
  vm.runInContext(source.slice(start, end < 0 ? undefined : end), context);
  await assert.rejects(context.loadYouTubeCues(), /未找到英文字幕轨道/);
  assert.equal(context.isEnglishCaptionText([{ text: '这是中文字幕，Hello' }]), false);
  assert.equal(context.isEnglishCaptionText([{ text: 'This is the original English dialogue.' }]), true);
});

test('background requests gated URLs and forces JSON3 without DOMParser', async () => {
  const source = fs.readFileSync(path.join(root, 'src/background/service-worker.js'), 'utf8').replace(/^import .*;$/gm, '');
  const urls = [];
  const context = vm.createContext({
    URL, AbortSignal, console,
    chrome: { runtime: { onMessage: { addListener() {} } } },
    fetch: async url => {
      urls.push(new URL(url));
      return new Response('{"events":[{"tStartMs":1000,"dDurationMs":1500,"segs":[{"utf8":"Hello"}]}]}');
    },
  });
  vm.runInContext(source, context);
  assert.notEqual(context.normalizeKey({ site: 'youtube', videoId: 'test', sourceLanguage: 'en' }),
    context.normalizeKey({ site: 'youtube', videoId: 'test', sourceLanguage: 'de' }));
  const cues = await context.fetchYouTubeCaption('https://www.youtube.com/api/timedtext?v=test&exp=xpe&pot=token&fmt=srv3', 'en', 'test');
  assert.equal(cues[0].text, 'Hello');
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 2.5);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get('pot'), 'token');
  assert.equal(urls[0].searchParams.get('fmt'), 'json3');
});
