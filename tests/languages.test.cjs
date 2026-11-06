const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('system locale defaults apply to UI and lessons without overriding saved choices', async () => {
  let preferences;
  let systemLocale = 'de-DE';
  const context = vm.createContext({
    navigator: { languages: ['fr-CA'], language: 'fr-CA' },
    chrome: { i18n: { getUILanguage: () => systemLocale }, storage: { local: { get: async () => ({ languagePreferences: preferences }) } } },
  });
  vm.runInContext(read('src/utils/locales.js'), context);
  vm.runInContext(read('src/utils/i18n.js'), context);
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  assert.equal(context.VL_SYSTEM_LANGUAGE(), 'de');
  assert.equal(context.VL_I18N.t('语言精讲'), 'Sprachen lernen');
  let settings = await context.getSettings();
  assert.equal(settings.targetLanguage, 'de');
  assert.equal(settings.promptLanguage, 'de');
  preferences = { targetLanguage: 'ja', uiLanguage: 'ar' };
  settings = await context.getSettings();
  assert.equal(settings.targetLanguage, 'ja');
  assert.equal(settings.promptLanguage, 'ar');
  preferences = { targetLanguage: 'auto', uiLanguage: 'auto' };
  settings = await context.getSettings();
  assert.equal(settings.targetLanguage, 'de');
  assert.equal(settings.promptLanguage, 'de');
  systemLocale = 'ja-JP';
  settings = await context.getSettings();
  assert.equal(settings.targetLanguage, 'ja');
  assert.equal(settings.promptLanguage, 'ja');
  systemLocale = 'zh-TW';
  assert.equal(context.VL_SYSTEM_LANGUAGE(), 'zh-CN');
  systemLocale = 'pt-BR';
  assert.equal(context.VL_SYSTEM_LANGUAGE(), 'pt');
  systemLocale = 'it-IT';
  assert.equal(context.VL_SYSTEM_LANGUAGE(), 'fr');
});

test('German source lessons teach German and retain the independent target language', async () => {
  let prompt;
  const context = vm.createContext({ URL, AbortSignal,
    chrome: { storage: { local: { get: async () => ({ settings: { apiKey: 'test', model: 'test', apiBaseUrl: 'https://example.com/v1' }, languagePreferences: { targetLanguage: 'zh-CN', uiLanguage: 'en' } }) } } },
    fetch: async (url, opts) => {
      prompt = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"0":{"translation":"你好"}}' } }] }) };
    },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  const lessons = await context.generateLessonsForWindow([{ start: 0, text: 'Guten Tag.' }], '', 'B1', 'de');
  assert.equal(lessons[0].sourceLanguage, 'de');
  assert.equal(lessons[0].targetLanguage, 'zh-CN');
  assert.match(prompt, /原视频台词语言为 Deutsch \(German\)/);
  assert.match(prompt, /绝不转换成英语教学/);
});

test('UI translations cover controls, settings, level labels and dynamic statuses', () => {
  const context = vm.createContext({});
  vm.runInContext(read('src/utils/i18n.js'), context);
  const t = context.VL_I18N.t;
  assert.equal(t('逐句暂停', 'en'), 'Pause per sentence');
  assert.equal(t('逐句暂停', 'fr'), 'Pause par phrase');
  assert.equal(t('讲解目标语言', 'fr'), 'Langue des explications');
  assert.equal(t('C1 高级', 'en'), 'C1 Advanced');
  assert.match(t('已加载 YouTube 字幕（12 句），正在准备自动精讲…', 'fr'), /12 phrases/);
  assert.equal(t('文化背景', 'zh-CN'), '文化背景');
  assert.equal(t('Hello, this is source dialogue.', 'fr'), 'Hello, this is source dialogue.');
});

test('language switches translate interface text reversibly without translating user lessons', () => {
  const context = vm.createContext({});
  vm.runInContext(read('src/utils/i18n.js'), context);
  const ui = { nodeType: 3, nodeValue: '生词', parentElement: { closest: () => null } };
  const lesson = { nodeType: 3, nodeValue: '生词', parentElement: { closest: () => true } };
  context.VL_I18N.setLanguage('fr');
  context.VL_I18N.applyTo(ui); context.VL_I18N.applyTo(lesson);
  assert.equal(ui.nodeValue, 'Vocabulaire'); assert.equal(lesson.nodeValue, '生词');
  context.VL_I18N.setLanguage('en'); context.VL_I18N.applyTo(ui);
  assert.equal(ui.nodeValue, 'Vocabulary');
  context.VL_I18N.setLanguage('zh-CN'); context.VL_I18N.applyTo(ui);
  assert.equal(ui.nodeValue, '生词');
});

test('English and French lesson generation use explicit language instructions and cache tags', async () => {
  let preferences = { targetLanguage: 'en', uiLanguage: 'fr' };
  const prompts = [];
  const context = vm.createContext({ URL, AbortSignal,
    chrome: { storage: { local: { get: async () => ({ settings: { apiKey: 'test', model: 'test', apiBaseUrl: 'https://example.com/v1' }, languagePreferences: preferences }) } } },
    fetch: async (url, opts) => {
      prompts.push(JSON.parse(opts.body).messages[0].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"0":{"translation":"Hello"}}' } }] }) };
    },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  const english = await context.generateLessonsForWindow([{ start: 0, text: 'Hi' }], '', 'A1');
  assert.equal(english[0].targetLanguage, 'en');
  assert.match(prompts[0], /English-to-English/);
  assert.match(prompts[0], /不要输出中文或其他语言/);
  preferences = { targetLanguage: 'fr', uiLanguage: 'en' };
  const french = await context.generateLessonsForWindow([{ start: 0, text: 'Hi' }], '', 'A1');
  assert.equal(french[0].targetLanguage, 'fr');
  assert.match(prompts[1], /讲解目标语言：Français \(French\)/);
  assert.match(prompts[1], /英文原句和例句保留英文/);
});

test('independent language preferences are saved and restored', async () => {
  const nodes = {};
  const node = id => nodes[id] ||= { value: '', addEventListener(type, fn) { this[type] = fn; } };
  let storage = {};
  let applied;
  const context = vm.createContext({
    document: { getElementById: node }, window: { addEventListener() {} },
    VL_I18N: { setLanguage(value) { applied = value; } },
    chrome: { storage: { local: { get: async () => storage, set: async patch => { storage = { ...storage, ...patch }; } } } },
    getDefaultLevelPrompts: () => ({}),
  });
  vm.runInContext(read('src/settings/settings.js').replace(/^import .*;$/gm, '').replace('void initPrompts();', '').replace('void initLanguages();', ''), context);
  await context.initLanguages();
  assert.equal(node('targetLanguage').value, 'auto');
  assert.equal(node('uiLanguage').value, 'auto');
  node('targetLanguage').value = 'fr'; node('uiLanguage').value = 'en';
  await node('saveLanguages').click();
  assert.equal(storage.languagePreferences.targetLanguage, 'fr');
  assert.equal(storage.languagePreferences.uiLanguage, 'en');
  assert.equal(applied, 'en');
  await context.initLanguages();
  assert.equal(node('targetLanguage').value, 'fr');
});

test('ten locales provide translated controls, settings and level prompts', () => {
  const context = vm.createContext({});
  vm.runInContext(read('src/utils/locales.js'), context);
  vm.runInContext(read('src/utils/i18n.js'), context);
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  assert.equal(Object.keys(context.VL_LOCALES).length, 10);
  for (const code of Object.keys(context.VL_LOCALES)) {
    const prompts = context.getDefaultLevelPrompts(code);
    assert.equal(Object.keys(prompts).length, 6);
    assert.ok(Object.values(prompts).every(text => typeof text === 'string' && text.length > 40), code);
    for (const label of ['语言设置', '讲解目标语言', '界面语言', '保存模型配置', '分级讲解 Prompt', '逐句暂停', '文化背景', '已保存']) {
      if (code !== 'zh-CN') assert.notEqual(context.VL_I18N.t(label, code), label, `${code}: ${label}`);
    }
    const html = read('src/settings/settings.html');
    assert.equal((html.match(new RegExp(`value="${code}"`, 'g')) || []).length, 2, `${code}: both selectors`);
  }
  assert.match(context.getDefaultLevelPrompts('ja').A1, /入門/);
  assert.match(context.getDefaultLevelPrompts('ko').A1, /입문/);
  assert.match(context.getDefaultLevelPrompts('ru').A1, /Начальный/);
  assert.match(context.getDefaultLevelPrompts('ar').A1, /مبتدئ/);
});

test('all ten target languages survive settings reads and stamp generated cache entries', async () => {
  let code = 'zh-CN', prompt;
  const context = vm.createContext({ URL, AbortSignal,
    chrome: { storage: { local: { get: async () => ({ settings: { apiKey: 'test', model: 'test', apiBaseUrl: 'https://example.com/v1' }, languagePreferences: { uiLanguage: code, targetLanguage: code } }) } } },
    fetch: async (url, opts) => {
      prompt = JSON.parse(opts.body).messages[0].content;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"0":{"translation":"test"}}' } }] }) };
    },
  });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  for (code of ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar']) {
    const settings = await context.getSettings();
    assert.equal(settings.promptLanguage, code);
    assert.equal(settings.targetLanguage, code);
    const result = await context.generateLessonsForWindow([{ start: 0, text: 'Hello' }], '', 'B1');
    assert.equal(result[0].targetLanguage, code);
    assert.doesNotMatch(prompt, /讲解目标语言：undefined/);
  }
});

test('Arabic interface is RTL and switching away restores LTR', () => {
  const root = { nodeType: 1, childNodes: [], matches: () => false, getAttribute: () => null };
  const context = vm.createContext({ document: { documentElement: root }, location: { protocol: 'chrome-extension:' } });
  vm.runInContext(read('src/utils/locales.js'), context);
  vm.runInContext(read('src/utils/i18n.js'), context);
  context.VL_I18N.setLanguage('ar');
  assert.equal(root.lang, 'ar'); assert.equal(root.dir, 'rtl');
  context.VL_I18N.setLanguage('ja');
  assert.equal(root.lang, 'ja'); assert.equal(root.dir, 'ltr');
  assert.match(read('src/content/panel.css'), /\.vl-cue-head\s*\{\s*direction: ltr/);
});
