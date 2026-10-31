const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function setup() {
  class CustomEvent extends Event { constructor(name, opts = {}) { super(name); this.detail = opts.detail; } }
  class XHR extends EventTarget { open() {} }
  const document = new EventTarget();
  const location = new URL('https://www.bilibili.com/video/BV16FoCBhE3h/');
  const window = { __INITIAL_STATE__: { videoData: {
    bvid: 'BV16FoCBhE3h', pages: [{ page: 1, cid: 100 }, { page: 2, cid: 200 }],
  } } };
  let playerData;
  const requests = [];
  window.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/x/player/')) return new Response(JSON.stringify(playerData));
    return new Response(JSON.stringify({ body: [{ from: 1, to: 2.5, content: 'Hello world' }, { from: 4, to: 3, content: 'invalid' }] }));
  };
  const context = vm.createContext({ window, document, location, XMLHttpRequest: XHR, URL, URLSearchParams, CustomEvent, AbortSignal });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/content/bilibili-bridge.js'), 'utf8'), context);
  function request(name) {
    return new Promise(resolve => {
      document.addEventListener(name.replace('request', 'response'), e => resolve(e.detail), { once: true });
      document.dispatchEvent(new CustomEvent(name, { detail: { requestId: 'test' } }));
    });
  }
  function metadata(cid, subtitles, extra = {}) {
    return { code: 0, data: { cid, bvid: 'BV16FoCBhE3h', subtitle: { subtitles }, ...extra } };
  }
  function xhr(data, cid = 100) {
    const req = new XHR();
    req.open('GET', `https://api.bilibili.com/x/player/wbi/v2?cid=${cid}&w_rid=native`);
    req.responseType = 'json'; req.response = data;
    req.dispatchEvent(new Event('load'));
  }
  return { window, location, requests, request, metadata, xhr, setPlayer: data => { playerData = data; } };
}

const englishTracks = [
  { lan: 'zh-CN', subtitle_url: '//aisubtitle.hdslb.com/chinese.json' },
  { lan: 'ai-en', subtitle_url: '//aisubtitle.hdslb.com/auto.json' },
  { lan: 'en-US', subtitle_url: '//aisubtitle.hdslb.com/english.json' },
];

test('Bilibili native XHR tracks choose English and normalize timestamp cues', async () => {
  const s = setup();
  s.xhr(s.metadata(100, englishTracks));
  const result = await s.request('vl-request-bili-cues');
  assert.equal(result.cues.length, 1);
  assert.equal(result.cues[0].text, 'Hello world');
  assert.equal(result.cues[0].end, 2.5);
  assert.equal(result.lang, 'en-US');
  assert.match(s.requests[0].url, /english.json$/);
  assert.equal(s.requests[0].options.credentials, 'include');
});

test('Bilibili native fetch tracks and part changes use separate cid data', async () => {
  const s = setup();
  s.setPlayer(s.metadata(100, englishTracks));
  await s.window.fetch('https://api.bilibili.com/x/player/wbi/v2?cid=100');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok((await s.request('vl-request-bili-cues')).cues);
  s.location.search = '?p=2';
  assert.equal((await s.request('vl-request-bili-id')).videoId, 'BV16FoCBhE3h:p2');
  assert.match((await s.request('vl-request-bili-cues')).error, /等待播放器/);
  s.xhr(s.metadata(200, englishTracks), 200);
  assert.ok((await s.request('vl-request-bili-cues')).cues);
});

test('Bilibili login and missing English produce actionable messages', async () => {
  const s = setup();
  s.xhr(s.metadata(100, [], { need_login_subtitle: true }));
  assert.match((await s.request('vl-request-bili-cues')).error, /登录/);
  s.xhr(s.metadata(100, [englishTracks[0]]));
  assert.match((await s.request('vl-request-bili-cues')).error, /没有可用的英文/);
  assert.equal(s.requests.length, 0);
});
