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
  const context = vm.createContext({ window, document, location, URL, URLSearchParams, XMLHttpRequest: XHR, CustomEvent, console });
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
  const cues = await context.fetchYouTubeCaption('https://www.youtube.com/api/timedtext?v=test&exp=xpe&pot=token&fmt=srv3', 'en', 'test');
  assert.equal(cues[0].text, 'Hello');
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 2.5);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].searchParams.get('pot'), 'token');
  assert.equal(urls[0].searchParams.get('fmt'), 'json3');
});
