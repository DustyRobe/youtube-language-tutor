import { getDefaultLevelPrompts } from '../background/llm.js';

let promptLanguage = 'zh-CN';
let defaults = getDefaultLevelPrompts();
let promptsReady = false;
const levelNames = { A1: '入门', A2: '基础', B1: '中级', B2: '中高级', C1: '高级', C2: '熟练' };
const byId = id => document.getElementById(id);
let selected = 'B1';
const drafts = { ...defaults };
const dirty = new Set();
const promptKey = (level = selected, language = promptLanguage) => language === 'zh-CN' ? level : `${level}@${language}`;
function switchPromptLanguage(language) {
  promptLanguage = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(language) ? language : 'zh-CN';
  defaults = getDefaultLevelPrompts(promptLanguage);
  for (const [level, text] of Object.entries(defaults)) if (!Object.hasOwn(drafts, promptKey(level))) drafts[promptKey(level)] = text;
  if (promptsReady) renderPrompt();
}

function renderPrompt() {
  const key = promptKey();
  byId('levelPrompt').value = drafts[key];
  byId('levelPrompt').lang = promptLanguage;
  byId('levelPrompt').dir = promptLanguage === 'ar' ? 'rtl' : 'ltr';
  byId('promptLabel').textContent = `${selected} ${levelNames[selected]} · 教学提示词`;
  byId('promptBadge').textContent = dirty.has(key) ? '未保存' : drafts[key] === defaults[selected] ? '默认策略' : '自定义策略';
  byId('promptCount').textContent = `${drafts[key].length} / 16000 字符`;
  for (const button of byId('levelTabs').children) button.setAttribute('aria-pressed', String(button.dataset.level === selected));
}

function showPromptMessage(text, error = false) {
  byId('promptMsg').textContent = text;
  byId('promptMsg').className = `msg ${error ? 'err' : 'ok'}`;
}

async function initPrompts() {
  byId('savePrompts').disabled = true;
  byId('levelPrompt').disabled = true;
  try {
    const stored = await chrome.storage.local.get(['levelPrompts', 'englishLevel', 'languagePreferences']);
    for (const [key, value] of Object.entries(stored.levelPrompts || {})) if (typeof value?.text === 'string' && value.text.trim()) drafts[key] = value.text;
    switchPromptLanguage(stored.languagePreferences?.uiLanguage);
    if (Object.hasOwn(defaults, stored.englishLevel)) selected = stored.englishLevel;
    for (const [level, name] of Object.entries(levelNames)) {
      const button = document.createElement('button');
      button.textContent = level;
      button.title = `${level} ${name}`;
      button.dataset.level = level;
      button.addEventListener('click', () => { selected = level; renderPrompt(); });
      byId('levelTabs').append(button);
    }
    promptsReady = true;
    renderPrompt();
    byId('levelPrompt').addEventListener('input', () => {
      drafts[promptKey()] = byId('levelPrompt').value;
      dirty.add(promptKey());
      byId('promptCount').textContent = `${drafts[promptKey()].length} / 16000 字符`;
      byId('promptBadge').textContent = '未保存';
      showPromptMessage('有未保存的修改。');
    });
    byId('resetPrompt').addEventListener('click', () => {
      drafts[promptKey()] = defaults[selected]; dirty.add(promptKey()); renderPrompt();
      showPromptMessage('已恢复当前水平默认策略，点击保存后生效。');
    });
    byId('savePrompts').addEventListener('click', async () => {
      byId('savePrompts').disabled = true;
      try {
        const edits = [...dirty].map(level => [level, drafts[level].trim()]);
        if (edits.some(([, text]) => !text)) throw new Error('提示词不能为空；需要默认策略时请点击恢复默认。');
        const { levelPrompts = {} } = await chrome.storage.local.get('levelPrompts');
        for (const [key, text] of edits) {
          const [level, language = 'zh-CN'] = key.split('@');
          if (text === getDefaultLevelPrompts(language)[level]) delete levelPrompts[key];
          else levelPrompts[key] = { text, revision: crypto.randomUUID() };
        }
        await chrome.storage.local.set({ levelPrompts });
        // Retain edits made while the storage write was in flight.
        for (const [level, text] of edits) if (drafts[level].trim() === text) dirty.delete(level);
        renderPrompt();
        showPromptMessage(dirty.size ? '已保存；仍有新修改未保存。' : '已保存，视频面板会自动按新提示词加载讲解。');
      } catch (error) { showPromptMessage(`保存失败：${error.message || error}`, true); }
      finally { byId('savePrompts').disabled = false; }
    });
  } catch (error) { showPromptMessage(`读取提示词失败：${error.message || error}`, true); }
  finally { byId('savePrompts').disabled = false; byId('levelPrompt').disabled = false; }
}

window.addEventListener('beforeunload', event => {
  if (dirty.size) { event.preventDefault(); event.returnValue = ''; }
});
async function initLanguages() {
  const supported = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'];
  byId('saveLanguages').disabled = true;
  try {
    const { languagePreferences = {} } = await chrome.storage.local.get('languagePreferences');
    byId('targetLanguage').value = supported.includes(languagePreferences.targetLanguage) ? languagePreferences.targetLanguage : 'zh-CN';
    byId('uiLanguage').value = supported.includes(languagePreferences.uiLanguage) ? languagePreferences.uiLanguage : 'zh-CN';
    byId('uiLanguage').addEventListener('change', () => {
      switchPromptLanguage(byId('uiLanguage').value);
      globalThis.VL_I18N?.setLanguage(byId('uiLanguage').value);
    });
    byId('saveLanguages').addEventListener('click', async () => {
      byId('saveLanguages').disabled = true;
      try {
        const languagePreferences = { targetLanguage: byId('targetLanguage').value, uiLanguage: byId('uiLanguage').value };
        await chrome.storage.local.set({ languagePreferences });
        globalThis.VL_I18N?.setLanguage(languagePreferences.uiLanguage);
        switchPromptLanguage(languagePreferences.uiLanguage);
        byId('languageMsg').textContent = '已保存'; byId('languageMsg').className = 'msg ok';
      } catch (error) { byId('languageMsg').textContent = `保存失败：${error.message || error}`; byId('languageMsg').className = 'msg err'; }
      finally { byId('saveLanguages').disabled = false; }
    });
  } catch (error) { byId('languageMsg').textContent = `读取配置失败：${error.message || error}`; }
  finally { byId('saveLanguages').disabled = false; }
}
void initPrompts();
void initLanguages();
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && changes.languagePreferences) switchPromptLanguage(changes.languagePreferences.newValue?.uiLanguage);
});
