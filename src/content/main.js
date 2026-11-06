// main.js —— content script 主体（ISOLATED world, document_idle 注入）
// 站点适配 + 时间联动引擎 + 右侧讲解面板

/* global parseSubtitle, parseCuesJson */

// ============================================================
// 调试日志（阶段编号 + 时间戳，输出到页面 Console，前缀 [VL]）
// 排查方法：YouTube 页面 F12 → Console → 过滤 "VL"
// ============================================================
const VL_LOGS = [];
function vlog(stage, ...args) {
  const t = new Date();
  const ts = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}.${String(t.getMilliseconds()).padStart(3, '0')}`;
  const line = [`[VL ${ts}]`, stage, ...args];
  VL_LOGS.push(line.join(' '));
  if (VL_LOGS.length > 500) VL_LOGS.shift();
  try {
    console.log(...line);
  } catch {}
}
// Console 里输入 vlDumpLogs() 可复制完整日志
window.vlDumpLogs = () => VL_LOGS.join('\n');


// ============================================================
// 工具
// ============================================================
function send(msg, timeoutMs = msg.type === 'GENERATE_WINDOW' ? 120000 : msg.type === 'FETCH_CAPTION' ? 28000 : 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      vlog('[后台消息超时]', msg.type, `${timeoutMs}ms`);
      finish({ ok: false, error: `${msg.type} 后台响应超时` });
    }, timeoutMs);
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        const error = chrome.runtime.lastError;
        finish(error ? { ok: false, error: error.message } : resp || { ok: false, error: 'no response' });
      });
    } catch (error) {
      finish({ ok: false, error: error.message || String(error) });
    }
  });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.style.cssText = v;
    else if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// 从 MAIN world 桥接获取数据
function requestFromBridge(reqEvent, respEvent, timeoutMs = 800, detail) {
  return new Promise((resolve) => {
    let done = false;
    const handler = (e) => {
      if (done) return;
      done = true;
      document.removeEventListener(respEvent, handler);
      resolve(e.detail);
    };
    document.addEventListener(respEvent, handler);
    document.dispatchEvent(new CustomEvent(reqEvent, { detail }));
    setTimeout(() => {
      if (done) return;
      done = true;
      document.removeEventListener(respEvent, handler);
      resolve(null);
    }, timeoutMs);
  });
}

// ============================================================
// 站点适配器
// ============================================================
function detectSite() {
  if (/(^|\.)bilibili\.com$/.test(location.hostname)) return 'bilibili';
  if (location.hostname.endsWith('youtube.com') || location.hostname.endsWith('youtube-nocookie.com')) {
    return 'youtube';
  }
  return 'generic';
}

// 稳定捕捉 <video> 元素（SPA 中 video 可能被重建）
function watchVideoElement(onVideo) {
  let bound = null;
  let loggedOnce = false;
  const tryBind = () => {
    if (bound && !document.contains(bound)) bound = null;
    const v = document.querySelector('video, bwp-video');
    if (v && v !== bound) {
      bound = v;
      if (!loggedOnce) {
        vlog('[1] video元素已找到', `src=${(v.currentSrc || '').slice(0, 60) || '(无)'}`);
        loggedOnce = true;
      }
      onVideo(v);
    }
  };
  tryBind();
  const mo = new MutationObserver(() => tryBind());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  // 兜底轮询（MutationObserver 在某些重排场景下可能漏）
  setInterval(tryBind, 3000);
}

// ============================================================
// 状态
// ============================================================
const state = {
  sourceLanguage: 'en',
  englishLevel: 'B1',
  promptRevisions: {},
  promptLanguage: 'zh-CN',
  levelPromptRecords: {},
  targetLanguage: 'zh-CN',
  preloadBlocked: false,
  site: detectSite(),
  video: null,
  videoId: null,
  videoKey: null,
  cues: [],          // [{start, end, text}]
  lessons: {},       // { [cueIndex]: {words, culture, grammar} }
  currentIndex: -1,
  autoPause: true,  // 默认开启逐句暂停
  panelOpen: true,
  panelWidth: 460,
  adPlaying: false,  // 广告播放中，暂停联动
  lastTime: 0,
  components: null,  // 面板 DOM 引用集合
  generationBusy: false,
};

// ============================================================
// 面板 UI
// ============================================================
const PANEL_ID = 'vl-lesson-panel';

function buildPanel() {
  if (document.getElementById(PANEL_ID)) return;

  const root = el('div', { id: PANEL_ID, class: 'vl-root vl-open' });
  const resizeHandle = el('div', { class: 'vl-resize-handle', role: 'separator', tabindex: '0', 'aria-label': '调整讲解面板宽度', 'aria-orientation': 'vertical', title: '左右拖动调整宽度；方向键微调；双击恢复默认' });

  // ---- 顶部栏 ----
  const title = el('div', { class: 'vl-title' }, '语言精讲');
  const btnSettings = el('button', { class: 'vl-icon-btn', title: 'AI 与讲解提示词设置（新页面）', 'aria-label': '打开 AI 设置', onclick: async () => {
    const result = await send({ type: 'OPEN_SETTINGS' });
    if (!result?.ok) setStatus(`无法打开设置：${result?.error || '请从扩展管理页打开设置'}`, true);
  } }, '⚙');
  const btnToggleSize = el('button', { class: 'vl-icon-btn', title: '切换面板宽度', onclick: togglePanelSize }, '↔');
  const btnHide = el('button', { class: 'vl-icon-btn', title: '隐藏面板', onclick: hidePanel }, '✕');
  const topBar = el('div', { class: 'vl-topbar' }, title, el('div', { class: 'vl-topbar-actions' }, btnSettings, btnToggleSize, btnHide));

  // ---- 控制面板 ----
  const btnPrev = el('button', { class: 'vl-btn', title: '上一句', onclick: () => jumpRelative(-1) }, '⏮');
  const btnPlayPause = el('button', { class: 'vl-btn vl-btn-primary vl-play-btn', title: '暂停/继续', 'aria-label': '暂停/继续', onclick: togglePlay }, '⏸');
  const btnNext = el('button', { class: 'vl-btn', title: '下一句', onclick: () => jumpRelative(1) }, '⏭');
  const speedSel = el('select', {
    class: 'vl-speed',
    title: '倍速',
    onchange: (e) => setSpeed(parseFloat(e.target.value)),
  });
  for (const s of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    speedSel.append(el('option', { value: String(s) }, `${s}x`));
  }
  speedSel.value = '1';

  const chkAutoPause = el('input', { type: 'checkbox', id: 'vl-auto-pause', checked: 'checked', onchange: (e) => {
    state.autoPause = e.target.checked;
    state.autoPauseIndex = -1;
    state.pausedCue = null;
  } });
  const lblAutoPause = el('label', { class: 'vl-check-label', for: 'vl-auto-pause' }, chkAutoPause, '逐句暂停');
  const chkFollow = el('input', { type: 'checkbox', id: 'vl-follow', checked: 'checked', onchange: (e) => { state.followScroll = e.target.checked; } });
  state.followScroll = true;
  const lblFollow = el('label', { class: 'vl-check-label', for: 'vl-follow' }, chkFollow, '自动跟随');
  const chkShowEn = el('input', { type: 'checkbox', id: 'vl-show-en', checked: 'checked', onchange: (e) => { state.showEn = e.target.checked; refreshCueList(); } });
  state.showEn = true;
  const lblShowEn = el('label', { class: 'vl-check-label', for: 'vl-show-en' }, chkShowEn, '原文');

  const controls = el(
    'div',
    { class: 'vl-controls' },
    el('div', { class: 'vl-controls-row vl-transport' }, btnPrev, btnPlayPause, btnNext, speedSel),
    el('div', { class: 'vl-controls-row vl-checks' }, lblAutoPause, lblFollow, lblShowEn)
  );
  const levelSelect = el('select', { id: 'vl-english-level', class: 'vl-speed vl-level', onchange: onEnglishLevelChanged });
  for (const [value, label] of Object.entries({ A1: 'A1 入门', A2: 'A2 基础', B1: 'B1 中级', B2: 'B2 中高级', C1: 'C1 高级', C2: 'C2 熟练' })) {
    levelSelect.append(el('option', { value }, label));
  }
  levelSelect.value = state.englishLevel;
  controls.firstElementChild.append(levelSelect);
  levelSelect.setAttribute('aria-label', 'CEFR');
  levelSelect.title = 'CEFR';
  const sourceSelect = el('select', { class: 'vl-speed vl-level', 'aria-label': '视频原声语言', title: '视频原声语言', onchange: async (event) => {
    state.sourceLanguageOverride = event.target.value;
    await loadCuesForCurrentVideo();
  } });
  for (const [value, label] of Object.entries({ auto: '自动识别语言', en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', pt: 'Português', 'zh-CN': '中文', ja: '日本語', ko: '한국어', ru: 'Русский', ar: 'العربية' })) {
    sourceSelect.append(el('option', { value: value === 'auto' ? '' : value }, label));
  }
  if (['youtube', 'bilibili'].includes(state.site)) controls.lastElementChild.append(sourceSelect);

  // ---- 状态条 ----
  const status = el('div', { class: 'vl-status' }, '初始化…');

  // ---- 台词列表 ----
  const cueList = el('div', { class: 'vl-cue-list' });

  // ---- 生成讲解按钮 ----
  const btnGenerate = el('button', { class: 'vl-btn vl-btn-generate', onclick: onGenerateClicked }, '重新生成 / 重试当前 5 句');
  const genBar = el('div', { class: 'vl-genbar' }, btnGenerate);

  root.append(resizeHandle, topBar, controls, status, cueList, genBar);
  document.documentElement.append(root);

  state.components = { root, title, status, cueList, btnPlayPause, btnGenerate, chkAutoPause, levelSelect, resizeHandle };
  bindPanelResize(resizeHandle);
  setPanelWidth(state.panelWidth);
  applyYouTubeLayout(true);
}

function hidePanel() {
  state.panelOpen = false;
  applyYouTubeLayout(false);
  const root = document.getElementById(PANEL_ID);
  if (root) root.classList.remove('vl-open');
}

function togglePanelSize() {
  setPanelWidth(state.panelWidth < 480 ? 560 : 380, true);
}

function panelWidthBounds() {
  const max = Math.max(180, Math.min(760, window.innerWidth - Math.min(480, window.innerWidth / 2)));
  return { min: Math.min(280, max), max };
}

function setPanelWidth(width, persist = false) {
  const { min, max } = panelWidthBounds();
  state.panelWidth = Math.round(Math.max(min, Math.min(max, Number(width) || 460)));
  document.documentElement.style.setProperty('--vl-panel-width', `${state.panelWidth}px`);
  const handle = state.components?.resizeHandle;
  if (handle) {
    handle.setAttribute('aria-valuemin', min);
    handle.setAttribute('aria-valuemax', max);
    handle.setAttribute('aria-valuenow', state.panelWidth);
  }
  if (persist) void chrome.storage.local.set({ panelWidth: state.panelWidth }).catch(error => vlog('[面板宽度保存失败]', error.message));
}

function bindPanelResize(handle) {
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { x: event.clientX, width: state.panelWidth, id: event.pointerId };
    handle.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('vl-resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (drag && event.pointerId === drag.id) setPanelWidth(drag.width + drag.x - event.clientX);
  });
  const finish = event => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    document.documentElement.classList.remove('vl-resizing');
    setPanelWidth(state.panelWidth, true);
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('dblclick', () => setPanelWidth(460, true));
  handle.addEventListener('keydown', event => {
    const { min, max } = panelWidthBounds();
    const width = { ArrowLeft: state.panelWidth + 24, ArrowRight: state.panelWidth - 24, Home: min, End: max }[event.key];
    if (width == null) return;
    event.preventDefault();
    setPanelWidth(width, true);
  });
  window.addEventListener('resize', () => {
    const { min, max } = panelWidthBounds();
    if (state.panelWidth < min || state.panelWidth > max) setPanelWidth(state.panelWidth);
  });
}

// Floating mode leaves YouTube's page layout and player width unchanged.
function applyYouTubeLayout() {
  if (state.site !== 'youtube') return;
  document.documentElement.classList.remove('vl-docked');
  document.getElementById('vl-yt-layout-style')?.remove();
}

function setStatus(text, isError = false) {
  if (!state.components) return;
  state.components.status.textContent = text;
  state.components.status.classList.toggle('vl-status-error', isError);
}

// ============================================================
// 台词列表渲染
// ============================================================
function lessonForLevel(index) {
  const lesson = state.lessons[index];
  // Old teaching policy over-explained basic vocabulary; regenerate it automatically.
  return lesson && lesson.lessonVersion === 2 && lesson.englishLevel === state.englishLevel &&
    (lesson.targetLanguage || 'zh-CN') === (state.targetLanguage || 'zh-CN') &&
    (lesson.promptRevision || '') === (state.promptRevisions?.[state.englishLevel] || '') ? lesson : null;
}

function refreshPromptRevisions() {
  state.promptRevisions = Object.fromEntries(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(level => {
    const key = state.promptLanguage === 'zh-CN' ? level : `${level}@${state.promptLanguage}`;
    return [level, state.levelPromptRecords?.[key]?.revision || ''];
  }));
}

async function onEnglishLevelChanged(event) {
  const previous = state.englishLevel;
  state.englishLevel = event.target.value;
  state.preloadBlocked = false;
  refreshCueList();
  setStatus(`已切换至 ${state.englishLevel}，将自动按此水平加载讲解。`);
  try {
    await chrome.storage.local.set({ englishLevel: state.englishLevel });
    scheduleLessonPreload();
  } catch (error) {
    state.englishLevel = previous;
    event.target.value = previous;
    refreshCueList();
    setStatus(`学习水平保存失败：${error.message || error}`, true);
  }
}

function refreshCueList() {
  const { cueList } = state.components;
  cueList.textContent = '';
  state.cueListItems = [];
  state.lastHighlighted = -1;
  if (!state.cues.length) {
    cueList.append(el('div', { class: 'vl-empty' }, '暂无字幕数据'));
    return;
  }
  state.cues.forEach((cue, i) => {
    const lesson = lessonForLevel(i);
    const item = el('div', {
      class: 'vl-cue-item' + (lesson ? ' vl-has-lesson' : ''),
      'data-index': String(i),
      onclick: () => jumpToIndex(i),
    });
    item.append(renderCue(cue, lesson, i));
    cueList.append(item);
    state.cueListItems[i] = item;
  });
  updateCueHighlight(state.currentIndex, true);
}

function renderCue(cue, lesson, index) {
  const wrap = el('div', {});

  // 时间戳 + 台词原文
  const head = el('div', {
    class: 'vl-cue-head',
    onclick: (e) => { e.stopPropagation(); jumpToIndex(index); },
  });
  head.append(
    el('span', { class: 'vl-cue-time' }, fmtTime(cue.start)),
    el('span', { class: 'vl-cue-text' }, state.showEn ? cue.text : '（原文已隐藏）')
  );
  wrap.append(head);

  // Details are created only for the located cue by updateCueHighlight().
  return wrap;
}

function renderLesson(lesson) {
  const box = el('div', { class: 'vl-lesson', lang: state.targetLanguage || 'zh-CN', dir: state.targetLanguage === 'ar' ? 'rtl' : 'ltr', onclick: (event) => event.stopPropagation() });
  if (lesson.translation || lesson.explanation) {
    const sec = el('div', { class: 'vl-lesson-sec' });
    sec.append(el('div', { class: 'vl-lesson-sec-title' }, '台词释义'));
    if (lesson.translation) sec.append(el('div', { class: 'vl-lesson-text' }, lesson.translation));
    if (lesson.explanation) sec.append(el('div', { class: 'vl-lesson-text' }, lesson.explanation));
    box.append(sec);
  }
  if (lesson.words?.length) {
    const sec = el('div', { class: 'vl-lesson-sec' });
    sec.append(el('div', { class: 'vl-lesson-sec-title' }, '生词'));
    for (const w of lesson.words) {
      const row = el('div', { class: 'vl-word' });
      const term = el('span', { class: 'vl-word-term' }, w.term);
      if (w.phonetic) term.append(el('span', { class: 'vl-word-ph' }, ` ${w.phonetic}`));
      row.append(term, w.meaning ? el('span', { class: 'vl-word-meaning' }, w.meaning) : null);
      if (w.partOfSpeech) row.append(el('div', { class: 'vl-lesson-text' }, (globalThis.VL_I18N?.t('词性：') || '词性：') + w.partOfSpeech));
      if (w.usage) row.append(el('div', { class: 'vl-lesson-text' }, (globalThis.VL_I18N?.t('用法：') || '用法：') + w.usage));
      if (w.example) row.append(el('div', { class: 'vl-word-example' }, w.example));
      if (w.exampleTranslation) row.append(el('div', { class: 'vl-lesson-text' }, w.exampleTranslation));
      sec.append(row);
    }
    box.append(sec);
  }
  if (lesson.phrases?.length) {
    const sec = el('div', { class: 'vl-lesson-sec' });
    sec.append(el('div', { class: 'vl-lesson-sec-title' }, '短语 / 固定搭配'));
    for (const phrase of lesson.phrases) {
      const row = el('div', { class: 'vl-word' });
      row.append(el('span', { class: 'vl-word-term' }, phrase.term));
      if (phrase.meaning) row.append(el('span', { class: 'vl-word-meaning' }, phrase.meaning));
      if (phrase.usage) row.append(el('div', { class: 'vl-lesson-text' }, phrase.usage));
      if (phrase.example) row.append(el('div', { class: 'vl-word-example' }, phrase.example));
      if (phrase.exampleTranslation) row.append(el('div', { class: 'vl-lesson-text' }, phrase.exampleTranslation));
      sec.append(row);
    }
    box.append(sec);
  }
  if (lesson.culture?.length) {
    const sec = el('div', { class: 'vl-lesson-sec' });
    sec.append(el('div', { class: 'vl-lesson-sec-title' }, '文化背景'));
    for (const c of lesson.culture) sec.append(el('div', { class: 'vl-lesson-text' }, c));
    box.append(sec);
  }
  if (lesson.grammar?.length) {
    const sec = el('div', { class: 'vl-lesson-sec' });
    sec.append(el('div', { class: 'vl-lesson-sec-title' }, '语法 / 时态'));
    for (const g of lesson.grammar) sec.append(el('div', { class: 'vl-lesson-text' }, g));
    box.append(sec);
  }
  if (lesson.notes?.length) {
    const sec = el('div', { class: 'vl-lesson-sec' });
    sec.append(el('div', { class: 'vl-lesson-sec-title' }, '注意事项'));
    for (const note of lesson.notes) sec.append(el('div', { class: 'vl-lesson-text' }, note));
    box.append(sec);
  }
  if (!box.children.length) {
    // 有 lesson 对象但全空：显示占位，提示可生成
    box.append(el('div', { class: 'vl-lesson-empty' }, '（此句暂无讲解，可点击下方按钮生成）'));
  }
  return box;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 高亮当前句 + 平滑滚动跟随
function updateCueHighlight(index, jumpScroll = false) {
  if (!state.components?.cueList) return;
  if (state.cueListItems?.[state.lastHighlighted]) {
    const previous = state.cueListItems[state.lastHighlighted];
    previous.classList.remove('vl-current');
    previous.querySelector('.vl-lesson')?.remove();
  }
  const item = state.cueListItems?.[index];
  if (item) {
    item.classList.add('vl-current');
    const lesson = lessonForLevel(index);
    item.append(lesson ? renderLesson(lesson) : el('div', { class: 'vl-lesson vl-lesson-empty', onclick: (event) => event.stopPropagation() }, `此句的 ${state.englishLevel} 讲解将自动加载；请先在插件弹窗配置 API。`));
    if (state.followScroll || jumpScroll) {
      item.scrollIntoView({ behavior: jumpScroll ? 'auto' : 'smooth', block: 'start' });
    }
    state.lastHighlighted = index;
  }
}

// ============================================================
// 播放控制
// ============================================================
function togglePlay() {
  if (!state.video) return;
  if (state.video.paused) {
    // 逐句暂停模式下继续播放
    state.resumeFromAutoPause = false;
    state.video.play();
  } else {
    state.video.pause();
  }
}

function jumpRelative(dir) {
  const target = Math.max(0, Math.min(state.cues.length - 1, state.currentIndex + dir));
  jumpToIndex(target);
}

function jumpToIndex(i) {
  const cue = state.cues[i];
  if (!cue || !state.video) return;
  state.video.currentTime = cue.start + 0.01;
  state.pausedCue = null;
  state.autoPauseIndex = i;
  state.currentIndex = i;
  updateCueHighlight(i, true);
  scheduleLessonPreload();
  if (state.autoPause) {
    state.pendingAutoPause = true; // 跳转后先播到本句结束再停
  }
}

function setSpeed(rate) {
  if (state.video) state.video.playbackRate = rate;
}

function updatePlayPauseBtn() {
  if (!state.components?.btnPlayPause) return;
  state.components.btnPlayPause.textContent = state.video?.paused ? '▶' : '⏸';
}

// ============================================================
// 时间联动引擎
// ============================================================
function binarySearchCueIndex(t) {
  const { cues } = state;
  let lo = 0, hi = cues.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  // 只有时间已进入该句区间（或差距小于 0.5s）才算命中
  if (ans >= 0 && t <= cues[ans].end + 0.5) return ans;
  return ans; // 间隙期：仍指向上一句，但不更新高亮切换由 end 判断
}

function onTimeUpdate() {
  const v = state.video;
  if (!v || !state.cues.length) return;
  const adPlaying = state.site === 'youtube' && !!document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
  if (adPlaying !== state.adPlaying) {
    state.adPlaying = adPlaying;
    state.autoPauseIndex = -1;
    state.pausedCue = null;
    setStatus(adPlaying ? '检测到广告播放，联动已暂停…' : '联动已恢复');
  }
  if (adPlaying || state.userSeeking || v.seeking) return;
  const t = v.currentTime;
  scheduleLessonPreload();
  state.lastTime = t;
  // pause()/seeked can emit more timeupdate events at the sentence boundary.
  // Keep the completed sentence selected until playback resumes or the user seeks.
  if (state.pausedCue) {
    if (state.autoPause && v.paused && Math.abs(t - state.pausedCue.time) < 0.05) {
      updatePlayPauseBtn();
      return;
    }
    state.pausedCue = null;
  }
  const idx = binarySearchCueIndex(t);
  // Check the armed cue BEFORE switching highlight. ASR cues may overlap;
  // stop at the next cue's start when it precedes the current cue's end.
  if (state.autoPause && !v.paused) {
    if (!(state.autoPauseIndex >= 0)) state.autoPauseIndex = Math.max(0, idx);
    const target = state.autoPauseIndex;
    const cue = state.cues[target];
    if (cue) {
      const next = state.cues[target + 1];
      const boundary = next && next.start > cue.start ? Math.min(cue.end, next.start) : cue.end;
      if (boundary > cue.start && t >= boundary) {
        // Stay just inside the completed cue so the player's subtitles also
        // remain on this sentence when the next cue starts at the same instant.
        const stopTime = Math.max(cue.start, boundary - 0.001);
        state.pausedCue = { index: target, time: stopTime };
        state.autoPauseIndex = target + 1;
        state.currentIndex = target;
        v.pause();
        if (t !== stopTime) {
          state.pauseBoundarySeeking = true;
          v.currentTime = stopTime;
        }
        updateCueHighlight(target);
        updatePlayPauseBtn();
        return;
      }
    }
  }
  if (idx >= 0 && idx !== state.currentIndex && t >= state.cues[idx].start) {
    state.currentIndex = idx;
    updateCueHighlight(idx);
  }
  updatePlayPauseBtn();
}

// ============================================================
// 字幕与课程数据加载
// ============================================================
let subtitleLoadId = 0;
async function loadCuesForCurrentVideo() {
  const loadId = ++subtitleLoadId;
  vlog('[2] 开始加载字幕流程', `site=${state.site} videoId=${state.videoId || '(未知)'}`);
  setStatus('加载字幕…');
  state.cues = [];
  state.rawCues = [];
  state.lessons = {};
  state.currentIndex = -1;
  state.autoPauseIndex = -1;
  state.pausedCue = null;
  state.preloadBlocked = false;
  refreshCueList();

  if (state.sourceLanguageOverride) state.sourceLanguage = state.sourceLanguageOverride;
  if (state.site === 'youtube' && !state.sourceLanguageOverride && typeof requestFromBridge === 'function') {
    const audio = await requestFromBridge('vl-request-audio-language', 'vl-response-audio-language', 1200);
    if (loadId !== subtitleLoadId) return;
    if (!audio?.lang || /^(?:und|unknown|auto|mul|zxx)(?:-|$)/i.test(audio.lang)) {
      setStatus('无法自动识别语言，请手动选择视频原声语言。', true);
      return;
    }
    state.sourceLanguage = audio.lang;
    const levelControl = document.getElementById('vl-english-level');
    if (levelControl) {
      levelControl.title = `CEFR (${audio.lang})`;
      levelControl.setAttribute('aria-label', levelControl.title);
    }
  }
  let biliFragments;
  if (state.site === 'bilibili') {
    try { biliFragments = await loadBilibiliCues(); }
    catch (error) {
      if (loadId === subtitleLoadId) setStatus(`字幕加载失败：${error.message || error}`, true);
      return;
    }
    if (loadId !== subtitleLoadId) return;
  }
  const info = getVideoInfo();
  vlog('[2.1] 请求本地缓存', JSON.stringify(info));

  // 1) 尝试命中本地缓存（ cues + 讲解）
  const cached = await send({ type: 'GET_LESSON', info });
  if (loadId !== subtitleLoadId) return;
  state.videoKey = cached?.videoKey || (info.videoId && ['youtube', 'bilibili'].includes(info.site) ? `${info.site === 'youtube' ? 'yt' : 'bili'}:${info.videoId}` : null);
  vlog('[2.2] 缓存响应', cached?.ok ? `命中: ${cached.lesson ? `${cached.lesson.cues?.length || 0}句` : '无数据'}` : `失败: ${cached?.error}`);
  const needsRawRefresh = cached?.lesson?.meta?.sentenceVersion !== VL_SENTENCE_VERSION && !cached?.lesson?.rawCues?.length &&
    ['youtube', 'bilibili'].includes(state.site) && cached?.lesson?.meta?.source !== 'imported-srt';
  const needsLanguageRefresh = state.site === 'youtube' && cached?.lesson?.meta?.source !== 'imported-srt' &&
    (cached?.lesson?.meta?.captionLanguageVersion !== 2 || cached?.lesson?.meta?.sourceLanguage !== state.sourceLanguage);
  if (cached?.ok && cached.lesson?.cues?.length && !needsRawRefresh && !needsLanguageRefresh) {
    if (state.site === 'youtube' && typeof requestFromBridge === 'function') {
      void requestFromBridge('vl-enable-english-captions', 'vl-english-captions-enabled', 3000, { lang: state.sourceLanguage });
    }
    const migrated = cached.lesson.meta?.sentenceVersion !== VL_SENTENCE_VERSION;
    state.rawCues = cached.lesson.rawCues || cached.lesson.cues;
    state.cues = migrated ? combineSubtitleSentences(state.rawCues) : cached.lesson.cues;
    // Caption indexes change after grouping; old explanations must not be reused.
    state.lessons = migrated ? {} : cached.lesson.lessons || {};
    state.videoKey = cached.videoKey;
    vlog('[2.3] 使用本地缓存数据');
    setStatus(`已加载本地数据（${state.cues.length} 句，${Object.keys(state.lessons).length} 句有讲解）`);
    refreshCueList();
    if (migrated) void send({ type: 'SAVE_LESSON', info, lesson: {
      cues: state.cues, rawCues: state.rawCues, lessons: {}, meta: { ...cached.lesson.meta, sentenceVersion: VL_SENTENCE_VERSION },
    } }).then(scheduleLessonPreload);
    scheduleLessonPreload();
    return;
  }

  // 2) 站点适配拉取字幕
  if (state.site === 'youtube' || state.site === 'bilibili') {
    try {
      vlog('[3] 开始站点字幕拉取', state.site);
      const fragments = state.site === 'bilibili' ? biliFragments : await loadYouTubeCues();
      const cues = combineSubtitleSentences(fragments);
      if (loadId !== subtitleLoadId) return;
      vlog('[3.4] YouTube 字幕结果', cues ? `${cues.length} 句, 首句: "${cues[0]?.text?.slice(0, 40) || ''}"` : 'null');
      if (cues?.length) {
        state.cues = cues;
        state.rawCues = fragments;
        state.lessons = {};
        vlog('[3.5] 保存字幕到本地缓存', `videoKey=${state.videoKey}`);
        setStatus(`已加载 ${state.site === 'bilibili' ? 'Bilibili' : 'YouTube'} 字幕（${cues.length} 句），正在准备自动精讲…`);
        refreshCueList();
        // 保存 cues 供后续生成讲解合并入库
        void send({
          type: 'SAVE_LESSON',
          info,
          lesson: { cues, rawCues: fragments, lessons: state.lessons, meta: { title: document.title, createdAt: Date.now(), source: `${state.site}-caption`, sentenceVersion: VL_SENTENCE_VERSION, captionLanguageVersion: state.site === 'youtube' ? 2 : undefined, sourceLanguage: state.sourceLanguage || 'en' } },
        }).then((result) => {
          if (!result?.ok) vlog('[缓存保存失败]', result?.error);
          if (loadId === subtitleLoadId) scheduleLessonPreload();
        });
        scheduleLessonPreload();
        return;
      }
    } catch (e) {
      if (loadId !== subtitleLoadId) return;
      vlog('[3.6] 字幕加载异常', e?.message || String(e));
      setStatus(`字幕加载失败：${e.message || e}（可尝试刷新页面；仍不行可导入 SRT 字幕）`, true);
      refreshCueList();
      return;
    }
  }

  vlog('[4] 未能获取字幕，流程结束');
  setStatus('未获取到字幕。请确认视频提供同语言字幕，或在弹窗导入 SRT/VTT。');
  refreshCueList();
}

function getVideoInfo() {
  return {
    sourceLanguage: state.sourceLanguage || 'en',
    site: state.site,
    videoId: state.videoId,
    origin: location.origin,
    pathname: location.pathname,
  };
}

function loadBilibiliCues() {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(null, 'Bilibili 字幕读取超时，请检查登录状态并开启字幕'), 18000);
    function finish(cues, error) {
      clearTimeout(timer);
      document.removeEventListener('vl-response-bili-cues', handler);
      if (error) reject(new Error(error));
      else resolve(cues);
    }
    function handler(event) {
      if (event.detail?.requestId !== requestId) return;
      if (event.detail.videoId !== state.videoId) return finish(null, '视频已切换');
      if (!event.detail.error && event.detail.lang) state.sourceLanguage = event.detail.lang;
      finish(event.detail.cues, event.detail.error);
    }
    document.addEventListener('vl-response-bili-cues', handler);
    document.dispatchEvent(new CustomEvent('vl-request-bili-cues', { detail: { requestId, lang: state.sourceLanguageOverride || null } }));
  });
}

function isEnglishCaptionText(cues) {
  const text = (cues || []).slice(0, 100).map(cue => cue.text || '').join('');
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  return latin > 0 && cjk / (latin + cjk) < 0.15;
}

async function loadYouTubeCues() {
  const cues = await loadYouTubeCaptionCues();
  if (/^en(?:-|$)/i.test(state.sourceLanguage || 'en') && cues?.length && !isEnglishCaptionText(cues)) {
    throw new Error('字幕内容不是英文，已停止加载。请在 YouTube 选择英文原始字幕后刷新页面，或导入英文 SRT/VTT');
  }
  return cues;
}

async function loadYouTubeCaptionCues() {
  const language = state.sourceLanguage || 'en';
  const matchesLanguage = lang => String(lang || '').split('-')[0].toLowerCase() === language.split('-')[0].toLowerCase();
  const validText = cues => !/^en(?:-|$)/i.test(language) || isEnglishCaptionText(cues);
  const enabled = await requestFromBridge('vl-enable-english-captions', 'vl-english-captions-enabled', 3000, { lang: language });
  vlog('[3.0] 自动开启英文字幕', enabled?.ok ? enabled.lang : enabled?.error || '播放器未响应，继续尝试直接采集');
  const observed = await requestFromBridge('vl-request-caption-body', 'vl-response-caption-body', 800, { lang: language });
  if (observed?.videoId === state.videoId && matchesLanguage(observed.lang)) {
    const cues = parseCaptionTextInContent(observed.text);
    if (cues?.length && validText(cues)) return cues;
  }
  // 通过桥接拿到 captionTracks
  vlog('[3.1] 请求桥接获取字幕轨道…');
  const resp = await requestFromBridge('vl-request-captions', 'vl-response-captions', 1500);
  vlog('[3.1a] 桥接响应', resp ? `tracks=${resp.tracks?.length || 0}条${resp.hasEmpty ? ' (轨道列表为空)' : ''}` : 'null/超时');
  let tracks = resp?.tracks;
  if (!tracks?.length) {
    // 等 SPA 数据就绪后重试一次
    vlog('[3.1b] 轨道为空，1.5s 后重试…');
    await sleep(1500);
    const retry = await requestFromBridge('vl-request-captions', 'vl-response-captions', 1500);
    vlog('[3.1c] 重试响应', retry ? `tracks=${retry.tracks?.length || 0}条` : 'null/超时');
    tracks = retry?.tracks;
    if (!tracks?.length) {
      // <track> 元素兜底
      vlog('[3.1d] 尝试 <track> 元素兜底…');
      const viaTrack = await requestFromBridge('vl-request-captions-track', 'vl-response-captions-track', 800);
      if (viaTrack?.tracks?.length) {
        tracks = viaTrack.tracks;
        vlog('[3.1e] <track> 兜底命中', `${tracks.length}条`);
      }
    }
  }
  if (!tracks?.length) {
    vlog('[3.1f] 所有轨道来源都为空，放弃');
    return null;
  }

  // 优先英文字幕（排除自动生成的 ASR 优先级放低：先人工 en 再 ASR en）
  const englishTracks = tracks.filter(t => {
    try {
      const url = new URL(t.baseUrl);
      return matchesLanguage(t.lang) && matchesLanguage(url.searchParams.get('tlang') || url.searchParams.get('lang') || t.lang);
    } catch { return false; }
  });
  const enManual = englishTracks.find(t => t.kind !== 'asr');
  const chosen = enManual || englishTracks[0];
  if (!chosen) throw new Error(`未找到${language === 'en' ? '英文' : language}字幕轨道，已跳过其他语言字幕。请导入同语言 SRT/VTT`);
  vlog('[3.2] 选定字幕轨道', `lang=${chosen.lang} kind=${chosen.kind || 'manual'} name="${chosen.name}" baseUrl=${(chosen.baseUrl || '(空)').slice(0, 80)}…`);
  if (!chosen?.baseUrl) {
    vlog('[3.2a] baseUrl 为空，放弃');
    return null;
  }

  // Prefer the authenticated page session; background clients are only a fallback.
  let cues = null;
  let lastErr = null;
  try {
    const url = new URL(chosen.baseUrl);
    url.searchParams.set('fmt', 'json3');
    cues = parseCaptionTextInContent(await fetchCaptionViaPage(url.href));
    if (cues?.length) return cues;
  } catch (error) { lastErr = error; }
  vlog('[3.3a] 请求后台 SW 拉取字幕内容…');
  try {
    const result = await send({ type: 'FETCH_CAPTION', baseUrl: chosen.baseUrl, lang: chosen.lang, videoId: state.videoId });
    if (result?.ok) {
      cues = result.cues;
      vlog('[3.3b] SW 返回成功', `${cues?.length || 0} 句`);
    } else {
      lastErr = new Error(result?.error || '字幕拉取失败');
      vlog('[3.3c] SW 返回失败', lastErr.message);
    }
  } catch (e) {
    lastErr = e;
    vlog('[3.3d] SW 调用异常', e?.message || String(e));
  }
  if (!cues?.length) {
    vlog('[3.3e] 走页面上下文兜底拉取…');
    try {
      const text = await fetchCaptionViaPage(chosen.baseUrl);
      vlog('[3.3f] 页面兜底返回', `${text.length} 字节`);
      cues = parseCaptionTextInContent(text);
      vlog('[3.3g] 页面兜底解析', cues ? `${cues.length} 句` : '解析为空');
    } catch (e2) {
      lastErr = e2;
      vlog('[3.3h] 页面兜底失败', e2?.message || String(e2));
    }
  }
  if (!cues?.length) {
    // Give the player's native, authenticated request time to arrive after
    // enabling captions. Direct timedtext fetches can be empty without tokens.
    for (let attempt = 0; attempt < 8; attempt++) {
      const body = await requestFromBridge('vl-request-caption-body', 'vl-response-caption-body', 800, { lang: language });
      if (body?.videoId === state.videoId && matchesLanguage(body.lang)) {
        const nativeCues = parseCaptionTextInContent(body.text);
        if (nativeCues?.length && validText(nativeCues)) return nativeCues;
      }
      if (attempt < 7) await sleep(400);
    }
    vlog('[3.3i] 最终未获得字幕内容', lastErr ? `最后错误: ${lastErr.message}` : '');
    throw new Error(`${lastErr?.message || '字幕内容为空'}。已尝试开启 ${language} 字幕，可稍后刷新或导入同语言 SRT/VTT`);
  }
  return cues;
}

// 让页面上下文（同源、带凭据）代为 fetch timedtext
function fetchCaptionViaPage(url) {
  const requestId = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  return new Promise((resolve, reject) => {
    let done = false;
    const handler = (e) => {
      if (done || e.detail?.requestId !== requestId) return;
      done = true;
      document.removeEventListener('vl-fetch-caption-result', handler);
      if (e.detail?.text) resolve(e.detail.text);
      else reject(new Error(e.detail?.error || '页面上下文拉取失败'));
    };
    document.addEventListener('vl-fetch-caption-result', handler);
    document.dispatchEvent(new CustomEvent('vl-fetch-caption', { detail: { requestId, url } }));
    setTimeout(() => {
      if (done) return;
      done = true;
      document.removeEventListener('vl-fetch-caption-result', handler);
      reject(new Error('页面上下文拉取超时'));
    }, 8000);
  });
}

// content script 侧解析 timedtext 文本（json3 / XML 两种格式）
function parseCaptionTextInContent(text) {
  text = String(text || '').trim();
  if (!text) return null;
  let cues = [];
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      for (const ev of data.events || []) {
        if (ev.segs == null || ev.tStartMs == null) continue;
        const cueText = ev.segs.map((s) => s.utf8 || '').join('');
        if (!cueText.trim()) continue;
        const start = ev.tStartMs / 1000;
        const dur = (ev.dDurationMs || 2000) / 1000;
        cues.push({ start, end: start + dur, text: cueText.replace(/\n+$/, '') });
      }
    } catch {}
  } else {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    for (const t of Array.from(doc.getElementsByTagName('text'))) {
      const start = parseFloat(t.getAttribute('start'));
      const dur = parseFloat(t.getAttribute('dur') || '2');
      if (Number.isNaN(start)) continue;
      const cueText = (t.textContent || '').replace(/\s+/g, ' ').trim();
      if (!cueText) continue;
      cues.push({ start, end: start + (Number.isNaN(dur) ? 2 : dur), text: cueText });
    }
    // srv3 uses milliseconds and <p><s>…</s></p>, unlike legacy <text> XML.
    for (const p of Array.from(doc.getElementsByTagName('p'))) {
      if (!p.hasAttribute('t')) continue;
      const start = Number(p.getAttribute('t')) / 1000;
      const dur = Number(p.getAttribute('d') ?? 2000) / 1000;
      const cueText = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (Number.isFinite(start) && Number.isFinite(dur) && cueText) cues.push({ start, end: start + dur, text: cueText });
    }
  }
  cues.sort((a, b) => a.start - b.start);
  return cues.length ? cues : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// LLM 讲解生成
// ============================================================
let lessonPreloadTimer = null;
function preloadBatchStart() {
  if (!state.cues.length || state.preloadBlocked) return null;
  const located = state.currentIndex >= 0 ? state.currentIndex : binarySearchCueIndex(state.video?.currentTime || 0);
  const current = Math.max(0, located);
  const start = Math.floor(current / 5) * 5;
  const missing = (from) => {
    for (let i = from; i < Math.min(from + 5, state.cues.length); i++) if (!lessonForLevel(i)) return true;
    return false;
  };
  if (missing(start)) return start;
  // At the third sentence of a batch, prepare the next five. Never walk
  // through the entire video while the viewer remains at the same position.
  if (current >= start + 2 && missing(start + 5)) return start + 5;
  return null;
}

function scheduleLessonPreload() {
  if (lessonPreloadTimer || state.generationBusy || state.preloadBlocked || !state.cues.length) return;
  lessonPreloadTimer = setTimeout(() => {
    lessonPreloadTimer = null;
    const from = preloadBatchStart();
    if (from !== null) void generateLessonBatch(from, true);
  }, 150);
}

async function onGenerateClicked() {
  state.preloadBlocked = false;
  const current = Math.max(0, state.currentIndex >= 0 ? state.currentIndex : binarySearchCueIndex(state.video?.currentTime || 0));
  await generateLessonBatch(Math.floor(current / 5) * 5, false);
}

async function generateLessonBatch(from, automatic = false) {
  if (state.generationBusy || !state.cues.length) return;
  const generationVideoId = state.videoId;
  const generationCues = state.cues;
  const generationLevel = state.englishLevel;
  const generationPromptRevision = state.promptRevisions?.[generationLevel] || '';
  const generationTargetLanguage = state.targetLanguage || 'zh-CN';
  // Smaller windows leave room for detailed explanations of each sentence.
  const to = Math.min(state.cues.length, from + 5);
  const windowCues = state.cues.slice(from, to);

  state.generationBusy = true;
  state.components.btnGenerate.disabled = true;
  state.components.btnGenerate.textContent = '生成中…（约 5~20 秒）';
  try {
    if (automatic) {
      const { settings } = await chrome.storage.local.get('settings');
      if (!settings?.apiKey?.trim()) throw new Error('请点击顶部 ⚙ 在设置页保存 API 配置，保存后将自动加载讲解');
      if (state.cues !== generationCues || state.englishLevel !== generationLevel) return;
    }
    const resp = await send({
      type: 'GENERATE_WINDOW',
      info: getVideoInfo(),
      cues: windowCues,
      allCues: state.cues,
      rawCues: state.rawCues,
      from,
      englishLevel: generationLevel,
      sourceLanguage: state.sourceLanguage || 'en',
      sentenceVersion: VL_SENTENCE_VERSION,
      context: `${document.title}\n相邻台词（仅作语境，不需要生成讲解）：\n${state.cues.slice(Math.max(0, from - 3), from).map(cue => cue.text).join('\n')}`,
      title: document.title,
    });
    if (!resp?.ok) throw new Error(resp?.error || '生成失败');
    if (state.videoId !== generationVideoId || state.cues !== generationCues || state.englishLevel !== generationLevel || (state.promptRevisions?.[generationLevel] || '') !== generationPromptRevision || (state.targetLanguage || 'zh-CN') !== generationTargetLanguage) return;
    // 合并生成的讲解（索引为窗口内相对序号，需要换算回全局索引）
    for (const [relIdx, lesson] of Object.entries(resp.generated || {})) {
      const globalIdx = from + Number(relIdx);
      state.lessons[globalIdx] = lesson;
    }
    if (windowCues.some((cue, offset) => !lessonForLevel(from + offset))) {
      state.preloadBlocked = true;
      setStatus('本批讲解返回不完整，点击下方重试。', true);
    } else {
    setStatus(`已生成 ${Object.keys(resp.generated || {}).length} 句 ${generationLevel} 讲解${resp.cacheError ? '（本地缓存保存失败）' : '（已缓存）'}`);
    }
    refreshCueList();
    updateCueHighlight(state.currentIndex, true);
  } catch (e) {
    if (state.videoId !== generationVideoId || state.cues !== generationCues || state.englishLevel !== generationLevel || (state.promptRevisions?.[generationLevel] || '') !== generationPromptRevision || (state.targetLanguage || 'zh-CN') !== generationTargetLanguage) return;
    state.preloadBlocked = true;
    setStatus(`生成失败：${e.message || e}`, true);
  } finally {
    state.generationBusy = false;
    state.components.btnGenerate.disabled = false;
    state.components.btnGenerate.textContent = '重新生成 / 重试当前 5 句';
    scheduleLessonPreload();
  }
}

// ============================================================
// 悬浮球（面板隐藏后可重新唤出）
// ============================================================
function buildFab() {
  if (document.getElementById('vl-fab')) return;
  const fab = el('div', { id: 'vl-fab', title: '打开语言精讲面板', onclick: showPanel }, '文');
  document.documentElement.append(fab);
}

function showPanel() {
  const root = document.getElementById(PANEL_ID);
  if (!root) return;
  state.panelOpen = true;
  root.classList.add('vl-open');
  applyYouTubeLayout(true);
}

// ============================================================
// 启动
// ============================================================
function init() {
  if (!document.querySelector('video') && state.site === 'generic') {
    // 通用站点：无 video 不初始化（后续 MutationObserver 也不必引入面板）
    // 但保留轮询以防动态加载
    watchVideoElement((v) => {
      if (!state.video) {
        state.video = v;
        bootPanel();
      }
    });
    return;
  }

  watchVideoElement((v) => {
    state.video = v;
    attachVideoListeners(v);
    if (!state.components) bootPanel();
  });
}

async function bootPanel() {
  buildPanel();
  buildFab();
  state.components.levelSelect.disabled = true;
  state.components.btnGenerate.disabled = true;
  try {
    const stored = await chrome.storage.local.get(['englishLevel', 'panelWidth', 'levelPrompts', 'languagePreferences']);
    state.targetLanguage = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(stored.languagePreferences?.targetLanguage) ? stored.languagePreferences.targetLanguage : (globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN');
    state.promptLanguage = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(stored.languagePreferences?.uiLanguage) ? stored.languagePreferences.uiLanguage : (globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN');
    state.levelPromptRecords = stored.levelPrompts || {};
    refreshPromptRevisions();
    if (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(stored.englishLevel)) state.englishLevel = stored.englishLevel;
    state.components.levelSelect.value = state.englishLevel;
    if (Number.isFinite(stored.panelWidth)) setPanelWidth(stored.panelWidth);
  } catch (error) {
    vlog('[英文水平读取失败]', error.message || error);
  } finally {
    state.components.levelSelect.disabled = false;
    state.components.btnGenerate.disabled = false;
  }
  bindVideoIdAndLoad();
}

function attachVideoListeners(v) {
  v.addEventListener('timeupdate', onTimeUpdate);
  v.addEventListener('play', updatePlayPauseBtn);
  v.addEventListener('pause', updatePlayPauseBtn);
  v.addEventListener('seeking', () => {
    state.userSeeking = true;
    if (!state.pauseBoundarySeeking) state.pausedCue = null;
  });
  v.addEventListener('seeked', () => {
    state.userSeeking = false;
    if (!state.pauseBoundarySeeking) state.autoPauseIndex = -1;
    state.pauseBoundarySeeking = false;
    onTimeUpdate();
  });
  // timeupdate alone is sparse and can miss short cues at high playback speeds.
  if (!state.pausePoll) state.pausePoll = setInterval(() => {
    if (state.autoPause && state.video && !state.video.paused) onTimeUpdate();
  }, 50);
}

async function bindVideoIdAndLoad() {
  if (state.site === 'bilibili') {
    let loading = false;
    let pending = false;
    const check = async (retry = false) => {
      const resp = await requestFromBridge('vl-request-bili-id', 'vl-response-bili-id', 1000);
      if (!resp?.videoId) return;
      if (loading) { if (retry) pending = true; return; }
      if (resp.videoId !== state.videoId || (retry && !state.cues.length)) {
        state.videoId = resp.videoId;
        loading = true;
        try { await loadCuesForCurrentVideo(); }
        finally {
          loading = false;
          if (pending) { pending = false; void check(true); }
        }
      }
    };
    document.addEventListener('vl-bili-caption-captured', debounce(() => check(true), 300));
    setInterval(() => check(), 1500);
    await check(true);
    return;
  }
  if (state.site === 'youtube') {
    // Install listeners before asynchronous loading so early player responses are not lost.
    document.addEventListener('vl-yt-navigated', debounce(onVideoChanged, 500));
    document.addEventListener('vl-caption-captured', debounce(() => {
      if (!state.cues.length) onVideoChanged();
    }, 500));
    const resp = await requestFromBridge('vl-request-video-id', 'vl-response-video-id', 1000);
    state.videoId = resp?.videoId || null;
    await loadCuesForCurrentVideo();

    // SPA 导航：换视频时重新加载
    let checkingAudio = false;
    setInterval(async () => {
      if (checkingAudio || state.sourceLanguageOverride) return;
      checkingAudio = true;
      try {
        const audio = await requestFromBridge('vl-request-audio-language', 'vl-response-audio-language', 1000);
        if (audio?.videoId === state.videoId && audio.lang && audio.lang !== state.sourceLanguage) {
          await loadCuesForCurrentVideo();
        }
      } catch (error) { vlog('[音轨语言检测]', error?.message || String(error)); }
      finally { checkingAudio = false; }
    }, 2500);
  } else {
    await loadCuesForCurrentVideo();
  }
}

async function onVideoChanged() {
  const resp = await requestFromBridge('vl-request-video-id', 'vl-response-video-id', 1000);
  if (resp?.videoId && resp.videoId !== state.videoId) {
    ++subtitleLoadId;
    state.videoId = resp.videoId;
    await loadCuesForCurrentVideo();
  } else if (resp?.videoId === state.videoId && !state.cues.length) {
    await loadCuesForCurrentVideo();
  }
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// SRT 导入：由 popup 通过 storage 变更通知（见 popup.js）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.languagePreferences) {
    const oldRevision = state.promptRevisions[state.englishLevel] || '';
    const locale = changes.languagePreferences.newValue?.uiLanguage;
    state.promptLanguage = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(locale) ? locale : (globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN');
    refreshPromptRevisions();
    const language = changes.languagePreferences.newValue?.targetLanguage;
    const target = ['zh-CN', 'en', 'fr', 'ja', 'ko', 'ru', 'es', 'de', 'pt', 'ar'].includes(language) ? language : (globalThis.VL_SYSTEM_LANGUAGE?.() || 'zh-CN');
    if (state.targetLanguage !== target || oldRevision !== (state.promptRevisions[state.englishLevel] || '')) {
      state.targetLanguage = target;
      state.preloadBlocked = false;
      if (state.components) refreshCueList();
      scheduleLessonPreload();
    }
  }
  if (changes.settings) {
    state.preloadBlocked = false;
    scheduleLessonPreload();
  }
  if (changes.levelPrompts) {
    state.levelPromptRecords = changes.levelPrompts.newValue || {};
    refreshPromptRevisions();
    state.preloadBlocked = false;
    if (state.components) refreshCueList();
    scheduleLessonPreload();
  }
  if (changes.__vl_import_subtitle) {
    const payload = changes.__vl_import_subtitle.newValue;
    if (payload && payload.target === state.videoKey) {
      const rawCues = parseSubtitle(payload.text);
      const cues = combineSubtitleSentences(rawCues);
      if (cues?.length) {
        state.cues = cues;
        state.rawCues = rawCues;
        state.lessons = {};
        state.currentIndex = -1;
        state.preloadBlocked = false;
        refreshCueList();
        setStatus(`已导入字幕（${cues.length} 句）`);
        void send({
          type: 'SAVE_LESSON',
          info: getVideoInfo(),
          lesson: { cues, rawCues, lessons: state.lessons, meta: { title: document.title, createdAt: Date.now(), source: 'imported-srt', sentenceVersion: VL_SENTENCE_VERSION } },
        }).then(scheduleLessonPreload);
      }
    }
  }
});

init();
