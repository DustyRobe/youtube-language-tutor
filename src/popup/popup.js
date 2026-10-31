// popup.js —— 弹窗逻辑：设置读写 + SRT 导入到当前标签页

const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { ok: false, error: 'no response' });
      }
    });
  });
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// 页面当前 videoKey —— content script 已加载时它写入了 storage（若未写则无法精确匹配，
// 兜底：按 URL 规则在前端同样计算 key 并写入 payload.target）
function computeTargetKey(tab) {
  if (!tab?.url) return null;
  try {
    const u = new URL(tab.url);
    if (/(^|\.)bilibili\.com$/.test(u.hostname)) {
      const bvid = u.pathname.match(/\/video\/(BV[\w]+)/i)?.[1];
      const page = Math.max(1, Number.parseInt(u.searchParams.get('p'), 10) || 1);
      return bvid ? `bili:${bvid}:p${page}` : null;
    }
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `yt:${v}`;
      const m = u.pathname.match(/\/(?:watch|embed)\/?([^/?]+)/);
      if (m) return `yt:${m[1]}`;
      return null;
    }
    const str = `${u.origin}|${u.pathname}`;
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return `gen:${(h >>> 0).toString(36)}`;
  } catch {
    return null;
  }
}

let srtText = '';
const PROVIDERS = {
  deepseek: { apiBaseUrl: 'https://api.deepseek.com/v1', apiFormat: 'chat', model: 'deepseek-chat', jsonMode: true },
  openai: { apiBaseUrl: 'https://api.openai.com/v1', apiFormat: 'responses', model: 'gpt-6-lula', jsonMode: true },
  codex: { apiBaseUrl: 'https://api.openai.com/v1', apiFormat: 'responses', model: 'gpt-6-lula', jsonMode: true },
  gemini: { apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiFormat: 'gemini', model: '', jsonMode: true },
  claude: { apiBaseUrl: 'https://api.anthropic.com/v1', apiFormat: 'anthropic', model: '', jsonMode: false },
  qwen: { apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiFormat: 'chat', model: 'qwen-plus', jsonMode: true },
  kimi: { apiBaseUrl: 'https://api.moonshot.ai/v1', apiFormat: 'chat', model: '', jsonMode: false },
  glm: { apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiFormat: 'chat', model: '', jsonMode: false },
  doubao: { apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiFormat: 'chat', model: '', jsonMode: false },
  mistral: { apiBaseUrl: 'https://api.mistral.ai/v1', apiFormat: 'chat', model: '', jsonMode: true },
  groq: { apiBaseUrl: 'https://api.groq.com/openai/v1', apiFormat: 'chat', model: '', jsonMode: false },
  xai: { apiBaseUrl: 'https://api.x.ai/v1', apiFormat: 'chat', model: '', jsonMode: false },
  openrouter: { apiBaseUrl: 'https://openrouter.ai/api/v1', apiFormat: 'chat', model: '', jsonMode: false },
  siliconflow: { apiBaseUrl: 'https://api.siliconflow.cn/v1', apiFormat: 'chat', model: '', jsonMode: false },
  custom: { apiBaseUrl: '', apiFormat: 'chat', model: '', jsonMode: true },
};
let profiles = {};
let activeProvider = 'deepseek';

function readProfile() {
  return {
    provider: activeProvider,
    apiBaseUrl: $('apiBaseUrl').value.trim(), apiKey: $('apiKey').value.trim(), model: $('model').value.trim(),
    apiFormat: $('apiFormat').value || PROVIDERS[activeProvider].apiFormat,
    jsonMode: $('jsonMode').checked !== false,
    workspaceId: $('workspaceId')?.value?.trim() || '',
  };
}

function showProfile(provider, profile = {}) {
  activeProvider = provider;
  const config = { ...PROVIDERS[provider], apiKey: '', ...profile };
  if (['openai', 'codex'].includes(provider) && !String(config.model || '').trim()) config.model = PROVIDERS[provider].model;
  $('provider').value = provider;
  for (const field of ['apiBaseUrl', 'apiKey', 'model', 'apiFormat']) $(field).value = config[field];
  $('jsonMode').checked = config.jsonMode !== false;
  $('model').placeholder = PROVIDERS[provider].model || '填写此账号或服务可用的模型 ID';
  if ($('workspaceId')) $('workspaceId').value = config.workspaceId || '';
  if ($('workspaceField')) $('workspaceField').hidden = config.apiFormat !== 'anthropic';
  $('providerHint').textContent = provider === 'codex'
    ? '使用 API Key 和账号支持的 Codex 模型 ID，通过 Responses 调用；此处不读取 Codex 应用登录态。'
    : provider === 'custom' ? '填写服务地址、模型 ID 与该服务要求的接口类型。支持填写 Base URL 或完整接口地址。'
    : provider === 'openai' ? '填写 OpenAI API Key 和可用模型 ID。默认使用 Responses，也可选择 Chat Completions。'
    : provider === 'deepseek' ? 'DeepSeek 默认使用 Chat Completions，其他兼容服务可选择自定义。'
    : provider === 'claude' ? 'Claude 使用 Messages 原生接口。填写账号可用的模型 ID；非工作区专属 Key 可补充 Workspace ID。JSON 由教学提示词约束。'
    : provider === 'gemini' ? 'Gemini 使用 generateContent 原生接口和 Google AI Studio API Key，模型 ID 可手动填写。'
    : provider === 'qwen' ? '默认使用阿里云北京地域。国际地域需填写对应 Base URL 和该地域的 API Key。'
    : provider === 'doubao' ? '填写火山方舟支持的模型 ID 或推理接入点 ID；地址可按所在地域修改。'
    : '已预填服务地址和接口类型；请填写该平台的 API Key 及账号可用的模型 ID，地址也可修改。';
}

async function init() {
  $('apiFormat')?.addEventListener('change', () => {
    if ($('workspaceField')) $('workspaceField').hidden = $('apiFormat').value !== 'anthropic';
  });
  $('btnOpenSettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('provider').addEventListener('change', event => {
    profiles[activeProvider] = readProfile();
    const provider = event.target.value;
    if (!PROVIDERS[provider]) return;
    showProfile(provider, profiles[provider]);
    $('saveMsg').textContent = '切换后请保存设置，视频页将使用保存的配置。';
    $('saveMsg').className = 'msg';
  });
  // 保存设置
  $('btnSave').addEventListener('click', async () => {
    const msg = $('saveMsg');
    msg.textContent = '保存中…';
    msg.className = 'msg';
    $('btnSave').disabled = true;
    try {
      const settings = readProfile();
      const url = new URL(settings.apiBaseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址须以 http:// 或 https:// 开头');
      if (!settings.apiKey || !settings.model) throw new Error('请填写 API Key 和模型名称');
      const stored = await chrome.storage.local.get('settings');
      profiles[activeProvider] = settings;
      await chrome.storage.local.set({ settings: { ...stored.settings, ...settings }, modelProfiles: profiles });
      msg.textContent = '已保存';
      msg.className = 'msg ok';
    } catch (error) {
      msg.textContent = `保存失败：${error.message || error}`;
      msg.className = 'msg err';
    } finally {
      $('btnSave').disabled = false;
    }
  });

  // 字幕文件选择
  $('srtFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      srtText = '';
      $('btnImport').disabled = true;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      srtText = String(reader.result || '');
      $('btnImport').disabled = !srtText;
    };
    reader.readAsText(file);
  });

  // 导入
  $('btnImport')?.addEventListener('click', async () => {
    const msg = $('importMsg');
    if (!srtText) return;
    const tab = await getCurrentTab();
    const target = computeTargetKey(tab);
    if (!target) {
      msg.textContent = '无法识别当前页面（请在视频播放页操作）';
      msg.className = 'msg err';
      return;
    }
    // 通过 storage 变更广播给 content script（刷新与否都能收到）
    await chrome.storage.local.set({
      __vl_import_subtitle: { target, text: srtText, at: Date.now() },
    });
    msg.textContent = '已发送导入请求（若面板未更新请刷新页面后重试）';
    msg.className = 'msg ok';
  });

  // Register controls before loading; settings do not depend on worker startup.
  try {
    const { settings = {}, modelProfiles = {} } = await chrome.storage.local.get(['settings', 'modelProfiles']);
    profiles = { ...modelProfiles };
    let provider = settings.provider;
    if (!PROVIDERS[provider]) {
      provider = !settings.apiBaseUrl || /api\.deepseek\.com/.test(settings.apiBaseUrl) ? 'deepseek'
        : /api\.openai\.com/.test(settings.apiBaseUrl) ? (/codex/i.test(settings.model || '') ? 'codex' : 'openai') : 'custom';
    }
    showProfile(provider, { ...profiles[provider], ...settings });
    if (!settings.apiFormat && /\/responses\/?(?:\?|$)/.test(settings.apiBaseUrl || '')) $('apiFormat').value = 'responses';
  } catch (error) {
    $('saveMsg').textContent = `读取配置失败：${error.message || error}`;
    $('saveMsg').className = 'msg err';
  }
}

init();
