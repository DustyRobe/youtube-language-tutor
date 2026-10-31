const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function llm(fetch) {
  const context = vm.createContext({ URL, AbortSignal, fetch });
  vm.runInContext(read('src/background/llm.js').replace(/^export .*;$/gm, ''), context);
  return context;
}
const config = { apiKey: 'test-key', model: 'test-model', apiBaseUrl: 'https://example.com/v1' };

test('Responses request and raw REST output support Codex-style reasoning messages', async () => {
  let request;
  const context = llm(async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ status: 'completed', output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '{"0":' }, { type: 'output_text', text: '{"translation":"你好"}}' }] },
    ] }) };
  });
  const result = await context.requestModel({ ...config, apiFormat: 'responses' }, 'Return JSON', 'Hello');
  assert.equal(request.url, 'https://example.com/v1/responses');
  assert.equal(request.body.instructions, 'Return JSON');
  assert.equal(request.body.input, 'Hello');
  assert.equal(request.body.text.format.type, 'json_object');
  assert.equal(request.body.store, false);
  assert.equal(request.body.temperature, undefined);
  assert.equal(request.body.messages, undefined);
  assert.equal(JSON.parse(result)[0].translation, '你好');
});

test('custom chat services can disable JSON mode and switch full endpoint paths', async () => {
  let body, endpoint;
  const context = llm(async (url, options) => {
    endpoint = url; body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"0":{}}' } }] }) };
  });
  await context.requestModel({ ...config, apiBaseUrl: 'https://example.com/proxy/v1/responses?tenant=test', apiFormat: 'chat', jsonMode: false }, 'JSON', 'Hello');
  assert.equal(endpoint, 'https://example.com/proxy/v1/chat/completions?tenant=test');
  assert.equal(body.response_format, undefined);
  assert.equal(body.temperature, undefined);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].content, 'Hello');
});

test('provider errors, truncated output and refusals produce useful errors', async () => {
  let response = { ok: false, status: 401, json: async () => ({ error: { message: 'Invalid test-key' } }) };
  const context = llm(async () => response);
  await assert.rejects(context.requestModel(config, '', ''), error => /401/.test(error.message) && !error.message.includes('test-key'));
  response = { ok: true, json: async () => ({ status: 'incomplete' }) };
  await assert.rejects(context.requestModel({ ...config, apiFormat: 'responses' }, '', ''), /截断/);
  response = { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'refusal' }] }] }) };
  await assert.rejects(context.requestModel({ ...config, apiFormat: 'responses' }, '', ''), /拒绝/);
});

test('provider profiles retain separate keys and persist the active protocol', async () => {
  const nodes = {};
  let storage = { settings: { ...config, apiBaseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } };
  const node = id => nodes[id] ||= { value: '', addEventListener(type, fn) { this[type] = fn; } };
  const context = vm.createContext({ URL, document: { getElementById: node }, chrome: { storage: { local: {
    get: async () => storage,
    set: async patch => { storage = { ...storage, ...patch }; },
  } } } });
  vm.runInContext(read('src/popup/popup.js').replace(/init\(\);\s*$/, ''), context);
  await context.init();
  assert.equal(node('provider').value, 'deepseek');
  assert.equal(node('apiFormat').value, 'chat');
  node('provider').change({ target: { value: 'codex' } });
  assert.equal(node('apiKey').value, '');
  assert.equal(node('apiFormat').value, 'responses');
  assert.equal(node('apiBaseUrl').value, 'https://api.openai.com/v1');
  assert.equal(node('model').value, 'gpt-6-lula');
  context.showProfile('openai', { model: '' });
  assert.equal(node('model').value, 'gpt-6-lula');
  context.showProfile('codex');
  node('apiKey').value = 'different-key'; node('model').value = 'account-codex-model';
  await node('btnSave').click();
  assert.equal(storage.settings.provider, 'codex');
  assert.equal(storage.settings.apiFormat, 'responses');
  assert.equal(storage.modelProfiles.deepseek.apiKey, 'test-key');
  node('provider').change({ target: { value: 'deepseek' } });
  assert.equal(node('apiKey').value, 'test-key');
  node('provider').change({ target: { value: 'codex' } });
  assert.equal(node('apiKey').value, 'different-key');
  await context.init();
  assert.equal(node('apiFormat').value, 'responses');
  assert.equal(node('model').value, 'account-codex-model');
});

test('at least ten distinct provider presets are available in both configuration pages', async () => {
  const context = vm.createContext({ document: { getElementById() {} } });
  vm.runInContext(read('src/popup/popup.js').replace(/init\(\);\s*$/, ''), context);
  const presets = vm.runInContext('({...PROVIDERS})', context);
  assert.equal(Object.keys(presets).filter(key => !['codex', 'custom'].includes(key)).length, 13);
  for (const [name, preset] of Object.entries(presets)) {
    for (const page of ['src/settings/settings.html', 'src/popup/popup.html']) assert.ok(read(page).includes(`value="${name}"`), `${page}: ${name}`);
    if (name === 'custom') continue;
    let request;
    const api = llm(async (url, opts) => {
      request = { url, headers: opts.headers, body: JSON.parse(opts.body) };
      const payload = preset.apiFormat === 'gemini' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }
        : preset.apiFormat === 'anthropic' ? { content: [{ type: 'text', text: '{}' }] }
        : preset.apiFormat === 'responses' ? { output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }
        : { choices: [{ message: { content: '{}' } }] };
      return { ok: true, json: async () => payload };
    });
    assert.equal(await api.requestModel({ ...preset, model: preset.model || 'test-model', apiKey: 'provider-key' }, 'Return JSON', 'Hello'), '{}', name);
    assert.equal(new URL(request.url).origin, new URL(preset.apiBaseUrl).origin, name);
    if (preset.apiFormat === 'chat') assert.equal(request.url, preset.apiBaseUrl + '/chat/completions');
    if (preset.apiFormat === 'gemini') {
      assert.equal(request.headers['x-goog-api-key'], 'provider-key');
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
    } else assert.equal(request.headers.Authorization, 'Bearer provider-key');
  }
});

test('Claude uses native Messages with optional workspace and ignores thinking blocks', async () => {
  let request;
  const context = llm(async (url, opts) => {
    request = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '{"ok":true}' }] }) };
  });
  const result = await context.requestModel({ ...config, apiFormat: 'anthropic', apiBaseUrl: 'https://api.anthropic.com/v1/messages', workspaceId: 'wrkspc_test' }, 'System JSON', 'Hello');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.headers['anthropic-version'], '2026-10-21');
  assert.equal(request.headers['anthropic-workspace-id'], 'wrkspc_test');
  assert.equal(request.body.system[0].text, 'System JSON');
  assert.equal(request.body.messages[0].role, 'user');
  assert.equal(request.body.max_tokens, 8192);
  assert.equal(request.body.response_format, undefined);
  assert.equal(result, '{"ok":true}');
});

test('Gemini replaces full endpoint model IDs and handles native safety/truncation outcomes', async () => {
  let response = { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'internal' }, { text: '{}' }] } }] };
  let endpoint, body;
  const context = llm(async (url, opts) => {
    endpoint = url; body = JSON.parse(opts.body);
    return { ok: true, json: async () => response };
  });
  const settings = { ...config, apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/old:generateContent', apiFormat: 'gemini', model: 'models/new-model', jsonMode: false };
  assert.equal(await context.requestModel(settings, 'JSON', 'Hello'), '{}');
  assert.equal(endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/new-model:generateContent');
  assert.equal(body.generationConfig, undefined);
  assert.equal(body.systemInstruction.parts[0].text, 'JSON');
  response = { promptFeedback: { blockReason: 'SAFETY' } };
  await assert.rejects(context.requestModel(settings, '', ''), /拒绝/);
  response = { candidates: [{ finishReason: 'MAX_TOKENS' }] };
  await assert.rejects(context.requestModel(settings, '', ''), /截断/);
});
