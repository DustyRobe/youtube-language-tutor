// Service Worker：消息路由 + 字幕拉取 + 课程数据管理
import '../utils/locales.js';
import { dbGetLesson, dbSaveLesson, dbListLessons, dbDeleteLesson } from './idb.js';
import { generateLessonsForWindow, getSettings, saveSettings, testModelConnection } from './llm.js';

function swlog(...args) {
  try { console.log('[VL-SW]', ...args); } catch {}
}

// ---- 视频键（缓存 key）----
// YouTube: yt:<videoId>；通用站点: gen:<origin+pathname 的哈希>
function normalizeKey(info) {
  if (info.site === 'youtube') return `yt:${info.videoId}:${info.sourceLanguage || 'en'}`;
  if (info.site === 'bilibili') return `bili:${info.videoId}:${info.sourceLanguage || 'en'}`;
  const str = `${info.origin}|${info.pathname}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return `gen:${(h >>> 0).toString(36)}`;
}

// ---- YouTube timedtext 字幕拉取 ----
// content script 通过 page-bridge 从页面拿到 captionTracks 列表，
// 其中 baseUrl 指向 timedtext 接口。这里在后台发起请求（避免 content 跨域限制）。
// Some requests need a session token. Always try the supplied signed URL first;
// the alternate client is best effort and may also be rejected by YouTube.
async function fetchYouTubeCaption(baseUrl, lang, videoId) {
  swlog('FETCH_CAPTION 开始', `videoId=${videoId || '(无)'} lang=${lang || '(无)'} baseUrl=${String(baseUrl || '').slice(0, 80)}…`);
  let body = '';

  const url = String(baseUrl || '');
  if (url) {
    body = await tryFetchTimedtext(url, 'web');
    swlog('timedtext 直接请求', `bodyLen=${body.length}`);
  }

  // 未获得有效字幕（空 / 非 JSON / XML 解析 0 句）→ InnerTube ANDROID 兜底
  let cues = parseCuesBody(body);
  if (!cues?.length && videoId) {
    swlog('直接请求未获得字幕，走 InnerTube ANDROID 兜底…');
    const fallbackUrl = await getInnertubeAndroidCaptionUrl(videoId, lang);
    swlog('ANDROID 兜底轨道', fallbackUrl ? `获得: ${fallbackUrl.slice(0, 80)}…` : '未获得（接口失败或无轨道）');
    if (fallbackUrl) {
      const fbBody = await tryFetchTimedtext(fallbackUrl, 'android');
      swlog('ANDROID timedtext 请求', `bodyLen=${fbBody.length}`);
      const fbCues = parseCuesBody(fbBody);
      if (fbCues?.length) cues = fbCues;
    }
  }

  if (!cues?.length) throw new Error('所有字幕拉取路径均未获得内容（可能需要 PoToken 或视频无字幕）');
  swlog('解析完成', `${cues.length} 句`);
  return cues;
}

// 按客户端类型请求 timedtext，返回文本（失败返回空字符串）
async function tryFetchTimedtext(url, client) {
  const headers = client === 'android'
    ? { 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip' }
    : { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
  try {
    const finalUrl = new URL(url);
    finalUrl.searchParams.set('fmt', 'json3');
    const resp = await fetch(finalUrl.href, { headers, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      swlog('timedtext HTTP 失败', `client=${client} status=${resp.status}`);
      return '';
    }
    return await resp.text();
  } catch (e) {
    swlog('timedtext 请求异常', `client=${client} ${e?.message || String(e)}`);
    return '';
  }
}

// 解析 timedtext 响应体（json3 / srv3 XML），无效或空返回 null
function parseCuesBody(body) {
  body = String(body || '').trim();
  if (!body) return null;
  // HTML 错误页直接判无效
  if (/^<!DOCTYPE html|^<html/i.test(body)) {
    swlog('timedtext 返回 HTML 而非字幕数据，长度', body.length);
    return null;
  }
  let cues = [];
  try {
    if (body.startsWith('{')) {
      cues = parseJson3(body);
    } else {
      cues = parseTimedTextXml(body);
    }
  } catch (e) {
    swlog('timedtext 解析异常', e?.message || String(e));
    return null;
  }
  return cues.length ? cues : null;
}

// Alternate client fallback; availability depends on YouTube's current policy.
async function getInnertubeAndroidCaptionUrl(videoId, lang) {
  try {
    swlog('InnerTube ANDROID player 请求中…', `videoId=${videoId}`);
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
      signal: AbortSignal.timeout(8000),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 34,
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
    });
    if (!resp.ok) {
      swlog('InnerTube 请求失败', `status=${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    swlog('InnerTube 响应', `status字段=${data?.playabilityStatus?.status || '?'} tracks=${Array.isArray(tracks) ? tracks.length : '无'}`);
    if (!Array.isArray(tracks) || !tracks.length) return null;
    // 与调用方同语言优先（排除 asr 的优先）
    const wanted = lang || 'en';
    const manual = tracks.find((t) => t.languageCode === wanted && t.kind !== 'asr');
    const asr = tracks.find((t) => t.languageCode === wanted);
    const enManual = tracks.find((t) => String(t.languageCode || '').startsWith('en') && t.kind !== 'asr');
    const chosen = manual || asr || tracks.find(t => String(t.languageCode || '').split('-')[0] === wanted.split('-')[0]);
    return chosen?.baseUrl || null;
  } catch (e) {
    swlog('InnerTube 请求异常', e?.message || String(e));
    return null;
  }
}

// json3 格式解析
function parseJson3(json) {
  const data = JSON.parse(json);
  const cues = [];
  for (const ev of data.events || []) {
    if (ev.segs == null) continue;
    if (ev.tStartMs == null) continue;
    // 换行事件（tStartMs 有 segs 但无实际文本时跳过）
    const text = ev.segs.map((s) => s.utf8 || '').join('');
    if (!text.trim()) continue;
    const start = ev.tStartMs / 1000;
    const dur = (ev.dDurationMs || 2000) / 1000;
    cues.push({ start, end: start + dur, text: text.replace(/\n+$/, '') });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// 旧 timedtext XML 格式解析
function parseTimedTextXml(xml) {
  // DOMParser is unavailable in an MV3 service worker. Request JSON3 here;
  // the content script handles XML responses with its DOMParser fallback.
  return [];
}

// ---- 消息路由 ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'TEST_MODEL':
          return sendResponse({ ok: true, ...await testModelConnection(msg.settings) });
        case 'OPEN_SETTINGS':
          await chrome.runtime.openOptionsPage();
          return sendResponse({ ok: true });
        case 'GET_SETTINGS':
          return sendResponse({ ok: true, settings: await getSettings() });

        case 'SAVE_SETTINGS':
          return sendResponse({ ok: true, settings: await saveSettings(msg.patch) });

        case 'FETCH_CAPTION': {
          const cues = await fetchYouTubeCaption(msg.baseUrl, msg.lang, msg.videoId);
          return sendResponse({ ok: true, cues });
        }

        case 'GET_LESSON': {
          const videoKey = normalizeKey(msg.info);
          const lesson = await dbGetLesson(videoKey);
          return sendResponse({ ok: true, videoKey, lesson });
        }

        case 'SAVE_LESSON': {
          const videoKey = normalizeKey(msg.info);
          await dbSaveLesson({ videoKey, ...msg.lesson });
          return sendResponse({ ok: true, videoKey });
        }

        case 'LIST_LESSONS':
          return sendResponse({ ok: true, list: await dbListLessons() });

        case 'DELETE_LESSON':
          await dbDeleteLesson(msg.videoKey);
          return sendResponse({ ok: true });

        case 'GENERATE_WINDOW': {
          // 为一段 cue 窗口生成讲解并合并入库
          const videoKey = normalizeKey(msg.info);
          const generated = await generateLessonsForWindow(msg.cues, msg.context || '', msg.englishLevel || 'B1', msg.sourceLanguage || msg.info?.sourceLanguage || 'en');
          let cacheError;
          let existing;
          try { existing = await dbGetLesson(videoKey); }
          catch (error) { cacheError = error.message || String(error); }
          const from = Number.isInteger(msg.from) && msg.from >= 0 ? msg.from : 0;
          const globalGenerated = Object.fromEntries(Object.entries(generated).map(([index, lesson]) => [from + Number(index), lesson]));
          const merged = {
            videoKey,
            cues: msg.allCues || existing?.cues || msg.cues,
            rawCues: msg.rawCues || existing?.rawCues,
            lessons: { ...(existing?.lessons || {}), ...globalGenerated },
            meta: {
              ...(existing?.meta || {}),
              title: existing?.meta?.title || msg.title || videoKey,
              updatedAt: Date.now(),
              createdAt: existing?.meta?.createdAt || Date.now(),
              source: existing?.meta?.source || 'llm',
              sentenceVersion: msg.sentenceVersion || existing?.meta?.sentenceVersion,
            },
          };
          try { await dbSaveLesson(merged); cacheError = undefined; }
          catch (error) { cacheError = error.message || String(error); }
          return sendResponse({ ok: true, videoKey, generated, cacheError });
        }

        default:
          return sendResponse({ ok: false, error: `未知消息类型: ${msg.type}` });
      }
    } catch (e) {
      console.error('[VL-SW] error:', e);
      return sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // 异步 sendResponse
});
