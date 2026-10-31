const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('independent settings page keeps per-level drafts, persists edits and restores defaults', async () => {
  const nodes = {};
  const node = id => nodes[id] ||= { value: '', dataset: {}, children: [], setAttribute() {}, addEventListener(type, fn) { this[type] = fn; }, append(child) { this.children.push(child); } };
  let storage = { englishLevel: 'C1', levelPrompts: { A1: { text: '已有入门提示词', revision: 'old' } } };
  const context = vm.createContext({
    crypto, window: { addEventListener() {} },
    document: { getElementById: node, createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener(type, fn) { this[type] = fn; } }) },
    chrome: { storage: { local: { get: async () => storage, set: async patch => { storage = { ...storage, ...patch }; } } } },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  vm.runInContext(read('src/settings/settings.js').replace(/^import .*;$/gm, '').replace('void initPrompts();', ''), context);
  await context.initPrompts();
  assert.equal(node('levelTabs').children.length, 6);
  assert.match(node('promptLabel').textContent, /C1 高级/);
  node('levelPrompt').value = '只讲学术语域、反讽和高级搭配'; node('levelPrompt').input();
  node('levelTabs').children[0].click();
  assert.equal(node('levelPrompt').value, '已有入门提示词');
  node('levelTabs').children[4].click();
  assert.equal(node('levelPrompt').value, '只讲学术语域、反讽和高级搭配');
  await node('savePrompts').click();
  assert.equal(storage.levelPrompts.C1.text, '只讲学术语域、反讽和高级搭配');
  assert.ok(storage.levelPrompts.C1.revision);
  assert.equal(storage.levelPrompts.A1.revision, 'old');
  node('resetPrompt').click(); await node('savePrompts').click();
  assert.equal(storage.levelPrompts.C1, undefined);
  assert.equal(storage.levelPrompts.A1.text, '已有入门提示词');
});

test('model generation uses only the selected level prompt and stamps its revision', async () => {
  let prompt;
  const context = vm.createContext({ URL, AbortSignal,
    chrome: { storage: { local: { get: async () => ({ settings: {
      apiKey: 'test', model: 'test', apiBaseUrl: 'https://example.com/v1',
    }, levelPrompts: { A1: { text: '拆成小步骤', revision: 'a1-v1' }, C1: { text: '重点分析学术语域', revision: 'c1-v3' } } }) } } },
    fetch: async (url, options) => {
      prompt = JSON.parse(options.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"0":{"translation":"你好"}}' } }] }) };
    },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  const result = await context.generateLessonsForWindow([{ start: 0, text: 'Hello' }], '', 'C1');
  assert.match(prompt, /重点分析学术语域/);
  assert.doesNotMatch(prompt, /拆成小步骤/);
  assert.equal(result[0].promptRevision, 'c1-v3');
  assert.match(prompt, /JSON/);
});

test('settings icon opens the extension options page rather than the lesson panel', async () => {
  let listener, opened = false;
  const context = vm.createContext({
    chrome: { runtime: { openOptionsPage: async () => { opened = true; }, onMessage: { addListener(fn) { listener = fn; } } } },
  });
  vm.runInContext(read('src/background/service-worker.js').replace(/^import .*;$/gm, ''), context);
  const response = await new Promise(resolve => listener({ type: 'OPEN_SETTINGS' }, {}, resolve));
  assert.equal(opened, true);
  assert.equal(response.ok, true);
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.options_page, 'src/settings/settings.html');
});

test('prompt editor follows interface language and preserves separate custom drafts', async () => {
  const nodes = {};
  const node = id => nodes[id] ||= { value: '', dataset: {}, children: [], setAttribute() {}, addEventListener(type, fn) { this[type] = fn; }, append(child) { this.children.push(child); } };
  let storage = { englishLevel: 'B1', levelPrompts: { B1: { text: '我的中文策略', revision: 'zh-old' } } };
  const context = vm.createContext({
    crypto, window: { addEventListener() {} },
    document: { getElementById: node, createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener(type, fn) { this[type] = fn; } }) },
    chrome: { storage: { local: { get: async () => storage, set: async patch => { storage = { ...storage, ...patch }; } } } },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  vm.runInContext(read('src/settings/settings.js').replace(/^import .*;$/gm, '').replace('void initPrompts();', '').replace('void initLanguages();', ''), context);
  await context.initPrompts(); await context.initLanguages();
  assert.equal(node('levelPrompt').value, '我的中文策略');
  node('uiLanguage').value = 'en'; node('uiLanguage').change();
  assert.match(node('levelPrompt').value, /^Intermediate:/);
  node('levelPrompt').value = 'My English teaching strategy'; node('levelPrompt').input();
  node('uiLanguage').value = 'fr'; node('uiLanguage').change();
  assert.match(node('levelPrompt').value, /^Intermédiaire :/);
  node('levelPrompt').value = 'Ma stratégie pédagogique'; node('levelPrompt').input();
  node('uiLanguage').value = 'en'; node('uiLanguage').change();
  assert.equal(node('levelPrompt').value, 'My English teaching strategy');
  await node('savePrompts').click();
  assert.equal(storage.levelPrompts['B1@en'].text, 'My English teaching strategy');
  assert.equal(storage.levelPrompts['B1@fr'].text, 'Ma stratégie pédagogique');
  assert.equal(storage.levelPrompts.B1.text, '我的中文策略');
  node('resetPrompt').click(); await node('savePrompts').click();
  assert.equal(storage.levelPrompts['B1@en'], undefined);
  assert.equal(storage.levelPrompts['B1@fr'].text, 'Ma stratégie pédagogique');
});

test('generation uses the custom prompt matching the interface language', async () => {
  let prompt;
  const context = vm.createContext({ URL, AbortSignal,
    chrome: { storage: { local: { get: async () => ({ settings: { apiKey: 'test', model: 'test', apiBaseUrl: 'https://example.com/v1' },
      languagePreferences: { uiLanguage: 'fr', targetLanguage: 'en' },
      levelPrompts: { C1: { text: '不应使用的中文版本', revision: 'zh-v1' }, 'C1@fr': { text: 'Analyser les nuances pragmatiques.', revision: 'fr-v2' } },
    }) } } },
    fetch: async (url, opts) => {
      prompt = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"0":{"translation":"Hello"}}' } }] }) };
    },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  const result = await context.generateLessonsForWindow([{ start: 0, text: 'Hello' }], '', 'C1');
  assert.match(prompt, /Analyser les nuances pragmatiques/);
  assert.doesNotMatch(prompt, /不应使用的中文版本/);
  assert.equal(result[0].promptRevision, 'fr-v2');
  assert.equal(result[0].targetLanguage, 'en');
  for (const language of ['en', 'fr']) for (const text of Object.values(context.getDefaultLevelPrompts(language))) assert.doesNotMatch(text, /[\u4e00-\u9fff]/);
});
