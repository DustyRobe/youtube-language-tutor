const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../src/background/llm.js'), 'utf8').replace(/^export .*;$/gm, '');

function setup(response) {
  const requests = [];
  const context = vm.createContext({ URL, AbortSignal,
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => response };
    },
  });
  vm.runInContext(source, context);
  return { context, requests };
}
const profile = { apiKey: 'secret-test-key', model: 'draft-model', apiBaseUrl: 'https://example.com/v1', jsonMode: true };

test('connection test uses the unsaved model and validates native protocol responses without storage', async () => {
  const responses = {
    chat: { choices: [{ message: { content: '{"ok":true}' } }] },
    responses: { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }] },
    anthropic: { content: [{ type: 'text', text: '{"ok":true}' }] },
    gemini: { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }] },
  };
  for (const [apiFormat, response] of Object.entries(responses)) {
    const { context, requests } = setup(response);
    const result = await context.testModelConnection({ ...profile, apiFormat });
    assert.ok(result.elapsedMs >= 0);
    assert.equal(requests.length, 1);
    assert.match(JSON.stringify(requests[0]), /draft-model/);
    assert.match(JSON.stringify(requests[0]), /connection test/);
  }
});

test('connection test rejects empty responses and invalid JSON, but supports text-only mode', async () => {
  let run = setup({ choices: [{ message: { content: '' } }] });
  await assert.rejects(run.context.testModelConnection(profile), /未返回/);
  run = setup({ choices: [{ message: { content: 'Hello' } }] });
  await assert.rejects(run.context.testModelConnection(profile), /不是有效 JSON/);
  await run.context.testModelConnection({ ...profile, jsonMode: false });
});

test('connection errors redact credentials and missing keys fail before any request', async () => {
  const { context, requests } = setup({});
  await assert.rejects(context.testModelConnection({ ...profile, apiKey: '' }), /未配置 API Key/);
  assert.equal(requests.length, 0);
  context.fetch = async () => { throw new Error(`Network failure ${profile.apiKey}`); };
  await assert.rejects(context.testModelConnection(profile), error => !error.message.includes(profile.apiKey) && error.message.includes('[已隐藏]'));
});
