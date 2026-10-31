const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('real background module imports resolve and register the message handler', async () => {
  let listener;
  global.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  try {
    await import(pathToFileURL(path.join(root, 'src/background/service-worker.js')));
    assert.equal(typeof listener, 'function');
  } finally { delete global.chrome; }
});

test('auto pause catches contiguous and overlapping cue boundaries and resumes', () => {
  for (const end of [1, 3]) {
    const state = {
      site: 'youtube', autoPause: true, autoPauseIndex: -1, currentIndex: -1,
      cues: [{ start: 0, end, text: 'one' }, { start: 1, end: 2, text: 'two' }],
      video: { paused: false, currentTime: 0.5, pause() { this.paused = true; } },
    };
    const context = vm.createContext({ state, document: { querySelector: () => null }, setStatus() {}, updateCueHighlight() {}, updatePlayPauseBtn() {}, scheduleLessonPreload() {} });
    const source = read('src/content/main.js');
    vm.runInContext(source.slice(source.indexOf('function binarySearchCueIndex'), source.indexOf('let subtitleLoadId')), context);
    context.onTimeUpdate();
    state.video.currentTime = 1.1;
    context.onTimeUpdate();
    assert.equal(state.video.paused, true);
    assert.equal(state.video.currentTime, 0.999);
    assert.equal(state.autoPauseIndex, 1);
    assert.equal(state.currentIndex, 0);
    // Browser emits timeupdate again after pause and the boundary-restoring seek.
    context.onTimeUpdate();
    context.onTimeUpdate();
    assert.equal(state.currentIndex, 0);
    assert.equal(state.pausedCue.index, 0);
    state.video.paused = false;
    state.video.currentTime = 1.01;
    context.onTimeUpdate();
    assert.equal(state.video.paused, false);
    assert.equal(state.currentIndex, 1);
    assert.equal(state.pausedCue, null);
    state.video.currentTime = 2.1;
    context.onTimeUpdate();
    assert.equal(state.video.paused, true);
    context.onTimeUpdate();
    assert.equal(state.currentIndex, 1);
    // Seeking backward no longer latches adPlaying permanently.
    state.video.currentTime = 0;
    state.autoPauseIndex = -1;
    context.onTimeUpdate();
    assert.equal(state.adPlaying, false);
  }
});

test('popup saves and reloads settings without a running worker', async () => {
  const nodes = {};
  let stored = {};
  const node = id => nodes[id] ||= { value: '', addEventListener(type, fn) { this[type] = fn; } };
  const context = vm.createContext({
    URL, document: { getElementById: node },
    chrome: { storage: { local: {
      get: async () => ({ settings: stored }),
      set: async value => { stored = value.settings; },
    } } },
  });
  vm.runInContext(read('src/popup/popup.js').replace(/init\(\);\s*$/, ''), context);
  await context.init();
  node('apiKey').value = 'test-key';
  node('model').value = 'test-model';
  await node('btnSave').click();
  assert.equal(node('saveMsg').textContent, '已保存');
  assert.equal(stored.apiKey, 'test-key');
  for (const id of ['apiBaseUrl', 'apiKey', 'model']) node(id).value = '';
  await context.init();
  assert.equal(node('apiKey').value, 'test-key');
  assert.equal(node('model').value, 'test-model');
});

test('LLM request includes all explanation fields and accepts a full endpoint', async () => {
  let payload, endpoint;
  const context = vm.createContext({ URL, AbortSignal,
    chrome: { storage: { local: { get: async () => ({ settings: {
      apiKey: 'test-key', apiBaseUrl: 'https://example.com/v1/chat/completions', model: 'test-model',
    } }) } } },
    fetch: async (url, options) => {
      endpoint = url;
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        0: { translation: '你好', explanation: '问候', words: [{ term: 'hello', difficultyLevel: 'A1', partOfSpeech: '感叹词', usage: '问候', exampleTranslation: '你好' }], phrases: [{ term: 'hello there', difficultyLevel: 'A1', usage: '口语问候', example: 'Hello there!', exampleTranslation: '你好！' }], culture: [], grammar: [{ difficultyLevel: 'A1', text: '一般现在时' }], notes: [{ difficultyLevel: 'A1', text: '口语' }] },
      }) } }] }) };
    },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  const result = await context.generateLessonsForWindow([{ start: 0, text: 'Hello' }], 'Test', 'A1');
  assert.equal(endpoint, 'https://example.com/v1/chat/completions');
  assert.match(payload.messages[0].content, /translation/);
  assert.match(payload.messages[0].content, /notes/);
  assert.equal(result[0].translation, '你好');
  assert.equal(result[0].notes[0], '口语');
  assert.equal(result[0].phrases[0].usage, '口语问候');
  assert.equal(result[0].phrases[0].exampleTranslation, '你好！');
  assert.equal(result[0].words[0].partOfSpeech, '感叹词');
});

test('only the located cue renders details, including after refreshing lessons', () => {
  class Node {
    constructor(tag, attrs = {}, children = []) {
      this.tag = tag; this.attrs = attrs; this.children = []; this.classes = new Set((attrs.class || '').split(' '));
      this.classList = { add: c => this.classes.add(c), remove: c => this.classes.delete(c) };
      this.append(...children);
    }
    append(...children) { for (const child of children) { this.children.push(child); if (child instanceof Node) child.parent = this; } }
    set textContent(value) { this.children = []; }
    querySelector(selector) {
      for (const child of this.children) {
        if (!(child instanceof Node)) continue;
        if (child.classes.has(selector.slice(1))) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    scrollIntoView() {}
  }
  const state = {
    cues: [{ start: 0, text: 'Hello' }, { start: 1, text: 'Hello again' }],
    lessons: { 0: { translation: '你好', englishLevel: 'B1', lessonVersion: 2 }, 1: { englishLevel: 'B1', lessonVersion: 2, phrases: [{ term: 'hello again', usage: '再次问候', exampleTranslation: '又见面了' }] } },
    currentIndex: -1, showEn: true, components: { cueList: new Node('div') },
    englishLevel: 'B1',
  };
  const context = vm.createContext({ state, el: (tag, attrs, ...children) => new Node(tag, attrs, children), jumpToIndex() {} });
  const source = read('src/content/main.js');
  vm.runInContext(source.slice(source.indexOf('function lessonForLevel'), source.indexOf('function togglePlay')), context);
  context.refreshCueList();
  assert.equal(state.cueListItems.every(item => !item.querySelector('.vl-lesson')), true);
  context.updateCueHighlight(0);
  assert.ok(state.cueListItems[0].querySelector('.vl-lesson'));
  context.updateCueHighlight(1);
  assert.equal(state.cueListItems[0].querySelector('.vl-lesson'), null);
  assert.ok(state.cueListItems[1].querySelector('.vl-lesson'));
  const textOf = node => typeof node === 'string' ? node : node.children.map(textOf).join('');
  assert.match(textOf(state.cueListItems[1]), /短语 \/ 固定搭配.*再次问候.*又见面了/);
  let stopped = false;
  state.cueListItems[1].querySelector('.vl-lesson').attrs.onclick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  state.currentIndex = 1;
  state.showEn = false;
  context.refreshCueList();
  assert.equal(state.cueListItems[0].querySelector('.vl-lesson'), null);
  assert.ok(state.cueListItems[1].querySelector('.vl-lesson'));
  context.updateCueHighlight(1);
  assert.equal(state.cueListItems[1].children.filter(child => child instanceof Node && child.classes.has('vl-lesson')).length, 1);
  state.englishLevel = 'A1';
  context.refreshCueList();
  assert.match(textOf(state.cueListItems[1]), /A1 讲解将自动加载/);
  assert.doesNotMatch(textOf(state.cueListItems[1]), /再次问候/);
  state.lessons[1].englishLevel = 'A1';
  context.refreshCueList();
  assert.match(textOf(state.cueListItems[1]), /再次问候/);
  state.targetLanguage = 'fr';
  context.refreshCueList();
  assert.doesNotMatch(textOf(state.cueListItems[1]), /再次问候/);
  state.lessons[1].targetLanguage = 'fr';
  context.refreshCueList();
  assert.match(textOf(state.cueListItems[1]), /再次问候/);
  delete state.lessons[1].lessonVersion;
  context.refreshCueList();
  assert.doesNotMatch(textOf(state.cueListItems[1]), /再次问候/);
  state.lessons[1].lessonVersion = 2;
  state.promptRevisions = { A1: 'new-prompt' };
  context.refreshCueList();
  assert.doesNotMatch(textOf(state.cueListItems[1]), /再次问候/);
  state.lessons[1].promptRevision = 'new-prompt';
  context.refreshCueList();
  assert.match(textOf(state.cueListItems[1]), /再次问候/);
});

test('higher learner levels filter out mastered words and basic grammar', () => {
  const context = vm.createContext({});
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  const words = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((difficultyLevel, i) => ({
    term: ['hello', 'journey', 'reluctant', 'ambiguous', 'equivocate', 'recondite'][i], difficultyLevel,
  }));
  const input = { 0: { translation: '示例翻译', words,
    phrases: [{ term: 'go home', difficultyLevel: 'A1' }, { term: 'advanced idiom', difficultyLevel: 'C1' }],
    grammar: [{ difficultyLevel: 'A1', text: '普通主谓宾' }, { difficultyLevel: 'C1', text: '复杂句法的修辞效果' }],
    notes: [{ difficultyLevel: 'A1', text: '代词用法' }, { difficultyLevel: 'C1', text: '语域限制' }],
  } };
  let previousCount = Infinity;
  for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']) {
    const result = context.sanitizeLessons(input, level)[0];
    assert.ok(result.words.length <= previousCount);
    previousCount = result.words.length;
    assert.equal(result.translation, '示例翻译');
    if (level !== 'A1') assert.ok(result.words.every(word => word.term !== 'hello'));
    if (level === 'C1') {
      assert.deepEqual(Array.from(result.words, word => word.term), ['equivocate', 'recondite']);
      assert.deepEqual(Array.from(result.grammar), ['复杂句法的修辞效果']);
      assert.deepEqual(Array.from(result.notes), ['语域限制']);
      assert.deepEqual(Array.from(result.phrases, phrase => phrase.term), ['advanced idiom']);
    }
  }
  const simple = context.sanitizeLessons({ 0: { translation: '我想回家。', words: [words[0]], grammar: input[0].grammar.slice(0, 1) } }, 'C1')[0];
  assert.equal(simple.words.length, 0);
  assert.equal(simple.grammar.length, 0);
  const unclassified = context.sanitizeLessons({ 0: { words: [{ term: 'hello' }], grammar: ['简单时态'] } }, 'C1')[0];
  assert.equal(unclassified.words.length, 0);
  assert.equal(unclassified.grammar.length, 0);
  const mislabeled = context.sanitizeLessons({ 0: { words: [{ term: 'Hello', difficultyLevel: 'C2' }, { term: 'recondite', difficultyLevel: 'C2' }] } }, 'C1')[0];
  assert.deepEqual(Array.from(mislabeled.words, word => word.term), ['recondite']);
});

test('selected English level persists and changes the teaching prompt', async () => {
  let saved;
  const state = { englishLevel: 'B1' };
  const context = vm.createContext({
    state, refreshCueList() {}, setStatus() {}, scheduleLessonPreload() {},
    chrome: { storage: { local: { set: async value => { saved = value; } } } },
  });
  const source = read('src/content/main.js');
  vm.runInContext(source.slice(source.indexOf('async function onEnglishLevelChanged'), source.indexOf('function refreshCueList')), context);
  await context.onEnglishLevelChanged({ target: { value: 'A1' } });
  assert.equal(saved.englishLevel, 'A1');
  assert.equal(state.englishLevel, 'A1');
  const prompts = [];
  const llm = vm.createContext({ URL, AbortSignal,
    chrome: { storage: { local: { get: async () => ({ settings: { apiKey: 'test', model: 'test', apiBaseUrl: 'https://example.com/v1' } }) } } },
    fetch: async (url, options) => {
      prompts.push(JSON.parse(options.body).messages[0].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"0":{"translation":"你好"}}' } }] }) };
    },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), llm);
  const cues = [{ start: 0, text: 'Hello' }];
  const beginner = await llm.generateLessonsForWindow(cues, '', saved.englishLevel);
  const advanced = await llm.generateLessonsForWindow(cues, '', 'C1');
  assert.equal(beginner[0].englishLevel, 'A1');
  assert.equal(advanced[0].englishLevel, 'C1');
  assert.match(prompts[0], /A1.*|入门学习者/);
  assert.match(prompts[0], /不假设掌握基础时态/);
  assert.match(prompts[1], /细微语义、语用/);
  assert.notEqual(prompts[0], prompts[1]);
});

test('generated windows cache lessons at their global subtitle indexes', async () => {
  let listener, saved, response;
  const context = vm.createContext({
    console, Date,
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    generateLessonsForWindow: async () => ({ 0: { translation: '中段台词' } }),
    dbGetLesson: async () => ({ lessons: { 0: { translation: '第一句' } } }),
    dbSaveLesson: async lesson => { saved = lesson; },
  });
  vm.runInContext(read('src/background/service-worker.js').replace(/^import .*;$/gm, ''), context);
  const allCues = [{ text: 'first' }, { text: 'middle' }];
  await new Promise(resolve => listener({
    type: 'GENERATE_WINDOW', info: { site: 'youtube', videoId: 'test' },
    from: 1, cues: [allCues[1]], allCues,
  }, {}, result => { response = result; resolve(); }));
  assert.equal(saved.lessons[0].translation, '第一句');
  assert.equal(saved.lessons[1].translation, '中段台词');
  assert.equal(saved.cues.length, 2);
  assert.equal(response.generated[0].translation, '中段台词');
});

test('automatic preload generates five at a time and only advances near the boundary', async () => {
  const timers = [], requests = [];
  const state = {
    cues: Array.from({ length: 17 }, (_, i) => ({ start: i, text: `Sentence ${i}` })),
    lessons: {}, currentIndex: -1, englishLevel: 'B1', videoId: 'test', video: { currentTime: 0 },
    components: { btnGenerate: {} },
  };
  const context = vm.createContext({
    state, document: { title: 'Test' },
    VL_SENTENCE_VERSION: 1,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    binarySearchCueIndex: t => Math.floor(t),
    lessonForLevel: i => state.lessons[i]?.englishLevel === state.englishLevel ? state.lessons[i] : null,
    chrome: { storage: { local: { get: async () => ({ settings: { apiKey: 'test' } }) } } },
    getVideoInfo: () => ({ site: 'youtube', videoId: 'test' }),
    setStatus() {}, refreshCueList() {}, updateCueHighlight() {},
    send: async msg => {
      requests.push(msg);
      return { ok: true, generated: Object.fromEntries(msg.cues.map((cue, i) => [i, { translation: cue.text, englishLevel: msg.englishLevel }])) };
    },
  });
  const source = read('src/content/main.js');
  vm.runInContext(source.slice(source.indexOf('let lessonPreloadTimer'), source.indexOf('function buildFab')), context);
  async function tick() { const fn = timers.shift(); if (fn) fn(); await new Promise(resolve => setImmediate(resolve)); }
  context.scheduleLessonPreload();
  context.scheduleLessonPreload();
  assert.equal(timers.length, 1);
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].cues.length, 5);
  assert.equal(requests[0].from, 0);
  await tick();
  assert.equal(requests.length, 1);
  state.currentIndex = 2;
  context.scheduleLessonPreload(); await tick();
  assert.equal(requests[1].from, 5);
  await tick();
  assert.equal(requests.length, 2); // no eager generation of the whole video
  state.currentIndex = 15;
  context.scheduleLessonPreload(); await tick();
  assert.equal(requests[2].from, 15);
  assert.equal(requests[2].cues.length, 2);
  await tick();
  state.englishLevel = 'A1';
  context.scheduleLessonPreload(); await tick();
  assert.equal(requests[3].englishLevel, 'A1');
  await tick();
  // Failed batches stop automatic retries until settings change or manual retry.
  context.send = async () => { requests.push('failed'); return { ok: false, error: 'HTTP 401' }; };
  state.currentIndex = 10;
  context.scheduleLessonPreload(); await tick();
  assert.equal(state.preloadBlocked, true);
  const count = requests.length;
  context.scheduleLessonPreload(); await tick();
  assert.equal(requests.length, count);
});
