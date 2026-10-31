// page-bridge.js —— 注入页面 MAIN world（document_start）
// 职责：从 YouTube 页面上下文提取 captionTracks / videoId，
// 通过 CustomEvent 与 content script（ISOLATED world）通信。
// 动态加载时作为普通 <script> 标签兜底执行。

(() => {
  if (window.__VL_BRIDGE_INSTALLED__) return;
  window.__VL_BRIDGE_INSTALLED__ = true;

  function blog(...args) {
    try { console.log('[VL-BRIDGE]', ...args); } catch {}
  }
  blog('桥接脚本已注入', location.href);
  let capturedPlayer = null;
  const captionBodies = new Map();

  function capturePlayer(data) {
    if (!data?.videoDetails?.videoId) return;
    capturedPlayer = data;
    document.dispatchEvent(new CustomEvent('vl-caption-captured'));
  }

  function captionUrl(value) {
    try {
      const url = new URL(value, location.href);
      return /(^|\.)youtube\.com$/.test(url.hostname) && url.pathname === '/api/timedtext' ? url : null;
    } catch { return null; }
  }

  function captureCaption(value, text) {
    const url = captionUrl(value);
    const videoId = url?.searchParams.get('v');
    if (!videoId || !text?.trim() || !/^[{<]/.test(text.trim())) return;
    const key = `${videoId}:${url.searchParams.get('lang') || ''}`;
    if (captionBodies.get(key)?.text === text) return;
    captionBodies.set(key, { videoId, lang: url.searchParams.get('lang') || '', text });
    if (captionBodies.size > 12) captionBodies.delete(captionBodies.keys().next().value);
    document.dispatchEvent(new CustomEvent('vl-caption-captured'));
  }

  // ---- 从页面数据中提取 captionTracks ----
  // 优先级：拦截 player 响应 > ytInitialPlayerResponse > DOM（隐藏的 caption 配置）
  function extractCaptionData() {
    const videoId = getCurrentVideoId();
    const player = document.getElementById('movie_player');
    let playerResponse;
    try { playerResponse = player?.getPlayerResponse?.(); } catch {}
    const candidates = [playerResponse, capturedPlayer, window.ytInitialPlayerResponse];
    for (const pr of candidates) {
      if (pr?.videoDetails?.videoId === videoId && pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
        return pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      }
    }
    // 1) ytInitialPlayerResponse（初始页面）
    try {
      const pr = window.ytInitialPlayerResponse;
      if (pr?.videoDetails?.videoId === videoId && pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
        return pr.captions.playerCaptionsTracklistRenderer.captionTracks;
      }
    } catch {}

    // 2) 从页面上嵌入的 ytplayer.config / ytInitialData 兜底
    try {
      const cfg = window.ytplayer?.config?.args;
      if (cfg?.player_response) {
        const pr = JSON.parse(cfg.player_response);
        if (pr?.videoDetails?.videoId === videoId && pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
          return pr.captions.playerCaptionsTracklistRenderer.captionTracks;
        }
      }
    } catch {}

    // 3) player 应答拦截数据（SPA 导航后由拦截器缓存到 window）
    return null;
  }

  function getCurrentVideoId() {
    const v = new URLSearchParams(location.search).get('v');
    if (v) return v;
    const pathId = location.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
    if (pathId) return pathId[1];
    try {
      if (window.ytInitialPlayerResponse?.videoDetails?.videoId) {
        return window.ytInitialPlayerResponse.videoDetails.videoId;
      }
    } catch {}
    try {
      const m = location.pathname.match(/\/(?:watch|embed)\/?([^/?]+)/);
      if (m) return m[1];
      const v = new URLSearchParams(location.search).get('v');
      if (v) return v;
    } catch {}
    return null;
  }

  // ---- 拦截 /youtubei/v1/player 应答，捕获 SPA 导航后的 captionTracks ----
  try {
    const origFetch = window.fetch;
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0]?.url;
        if (captionUrl(url)) {
          p.then((resp) => resp.clone().text().then((text) => captureCaption(url, text))).catch(() => {});
        }
        if (url && url.includes('/youtubei/v1/player')) {
          p.then((resp) => {
            const clone = resp.clone();
            clone.json().then((data) => {
              capturePlayer(data);
            }).catch(() => {});
          }).catch(() => {});
        }
      } catch {}
      return p;
    };
  } catch {}

  // YouTube also uses XMLHttpRequest, so observing fetch alone misses captions.
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.addEventListener('load', () => {
      try {
        if (captionUrl(url) && (!this.responseType || this.responseType === 'text')) {
          captureCaption(url, this.responseText);
        } else if (String(url).includes('/youtubei/v1/player')) {
          capturePlayer(this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
        }
      } catch {}
    }, { once: true });
    return originalOpen.call(this, method, url, ...rest);
  };

  document.addEventListener('vl-request-caption-body', () => {
    const entries = [...captionBodies.values()].filter((entry) => entry.videoId === getCurrentVideoId());
    const chosen = entries.find((entry) => /^en(?:-|$)/i.test(entry.lang)) || entries[0];
    document.dispatchEvent(new CustomEvent('vl-response-caption-body', { detail: chosen || null }));
  });

  // ---- 响应 content script 的请求事件 ----
  document.addEventListener('vl-request-captions', () => {
    const tracks = extractCaptionData();
    blog('收到字幕轨道请求', tracks ? `获取到 ${tracks.length} 条轨道` : '未获取到轨道数据');
    if (tracks) {
      for (const t of tracks) {
        blog('  轨道:', t.languageCode, t.kind || 'manual', `baseUrl=${String(t.baseUrl || '(空)').slice(0, 60)}…`);
      }
    } else {
      blog('  ytInitialPlayerResponse 存在?', typeof window.ytInitialPlayerResponse !== 'undefined');
      blog('  captions 字段存在?', !!window.ytInitialPlayerResponse?.captions);
      blog('  拦截缓存轨道?', (window.__VL_CAPTURED_CAPTION_TRACKS__ || []).length);
    }
    // 精简字段，避免结构化克隆异常（函数等无法跨 world 传输）
    const clean = tracks
      ? tracks
          .filter((t) => t && t.baseUrl)
          .map((t) => ({
            baseUrl: t.baseUrl,
            lang: t.languageCode,
            name: (t.name?.runs?.[0]?.text) || t.name?.simpleText || t.languageCode,
            kind: t.kind || '',
          }))
      : null;
    document.dispatchEvent(
      new CustomEvent('vl-response-captions', { detail: { tracks: clean, hasEmpty: clean?.length === 0 && !!tracks } } )
    );
  });

  // 轨道列表为空时，尝试从 <track> 元素兜底（部分页面/嵌入场景）
  document.addEventListener('vl-request-captions-track', () => {
    const trackEls = Array.from(document.querySelectorAll('video track'));
    const viaTrack = trackEls
      .filter((t) => t.src)
      .map((t) => ({ baseUrl: t.src, lang: t.srclang || '', name: t.label || t.srclang || '', kind: t.kind || '' }));
    document.dispatchEvent(
      new CustomEvent('vl-response-captions-track', { detail: { tracks: viaTrack } })
    );
  });

  document.addEventListener('vl-request-video-id', () => {
    document.dispatchEvent(
      new CustomEvent('vl-response-video-id', { detail: { videoId: getCurrentVideoId() } })
    );
  });

  // ---- 页面上下文兜底拉取字幕内容 ----
  // 后台 SW 直接 fetch timedtext 有时被拒；此处由页面自身发起（同源、带凭据），
  // 把原始文本回传给 content script。detail: { requestId, url }
  document.addEventListener('vl-fetch-caption', (e) => {
    const { requestId, url } = e.detail || {};
    if (!captionUrl(url)) {
      document.dispatchEvent(new CustomEvent('vl-fetch-caption-result', {
        detail: { requestId, error: 'empty url' },
      }));
      return;
    }
    fetch(url, { credentials: 'include' })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        document.dispatchEvent(new CustomEvent('vl-fetch-caption-result', {
          detail: { requestId, text },
        }));
      })
      .catch((err) => {
        document.dispatchEvent(new CustomEvent('vl-fetch-caption-result', {
          detail: { requestId, error: String(err && err.message || err) },
        }));
      });
  });

  // SPA 导航通知
  window.addEventListener('yt-navigate-finish', () => {
    document.dispatchEvent(new CustomEvent('vl-yt-navigated'));
  });
})();
