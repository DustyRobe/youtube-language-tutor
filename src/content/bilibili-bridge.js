// Observe the player's own signed requests in MAIN world, retaining login state.
(() => {
  if (!/(^|\.)bilibili\.com$/.test(location.hostname) || window.__VL_BILI_BRIDGE__) return;
  window.__VL_BILI_BRIDGE__ = true;
  const tracksByCid = new Map();
  const nativeFetch = window.fetch;

  function identity() {
    const bvid = location.pathname.match(/\/video\/(BV[\w]+)/i)?.[1];
    if (!bvid) return null;
    const page = Math.max(1, Number.parseInt(new URLSearchParams(location.search).get('p'), 10) || 1);
    return { bvid, page, videoId: `${bvid}:p${page}` };
  }

  function observe(value, payload) {
    try {
      const url = new URL(value, location.href);
      if (url.hostname !== 'api.bilibili.com' || !/^\/x\/player\/(?:wbi\/)?v2$/.test(url.pathname) || payload?.code !== 0) return;
      const cid = url.searchParams.get('cid');
      if (!cid || (payload.data?.cid != null && String(payload.data.cid) !== cid)) return;
      tracksByCid.set(cid, { ...payload.data?.subtitle, need_login_subtitle: payload.data?.need_login_subtitle, bvid: payload.data?.bvid });
      if (tracksByCid.size > 20) tracksByCid.delete(tracksByCid.keys().next().value);
      document.dispatchEvent(new CustomEvent('vl-bili-caption-captured'));
    } catch {}
  }

  window.fetch = function (...args) {
    const result = nativeFetch.apply(this, args);
    const value = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0]?.url;
    if (String(value).includes('/x/player/')) {
      result.then(resp => resp.clone().json().then(data => observe(value, data))).catch(() => {});
    }
    return result;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (String(url).includes('/x/player/')) this.addEventListener('load', () => {
      try { observe(url, this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
    }, { once: true });
    return nativeOpen.call(this, method, url, ...rest);
  };

  async function getJson(url) {
    const resp = await nativeFetch.call(window, url, { credentials: 'include', signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Bilibili 请求失败 HTTP ${resp.status}`);
    return resp.json();
  }

  document.addEventListener('vl-request-bili-id', () => {
    document.dispatchEvent(new CustomEvent('vl-response-bili-id', { detail: identity() }));
  });
  document.addEventListener('vl-request-bili-cues', async (event) => {
    const requestId = event.detail?.requestId;
    const current = identity();
    const reply = detail => document.dispatchEvent(new CustomEvent('vl-response-bili-cues', { detail: { requestId, videoId: current?.videoId, ...detail } }));
    try {
      if (!current) throw new Error('当前不是支持的 Bilibili BV 视频页');
      let video = window.__INITIAL_STATE__?.videoData;
      if (video?.bvid !== current.bvid || !video?.pages?.length) {
        const result = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(current.bvid)}`);
        if (result.code !== 0) throw new Error(result.message || '视频信息读取失败');
        video = result.data;
      }
      const part = video.pages?.find(page => Number(page.page) === current.page);
      if (!part?.cid) throw new Error('无法识别当前分 P 的 cid');
      const subtitle = tracksByCid.get(String(part.cid));
      if (!subtitle) throw new Error('等待播放器字幕数据，请登录 Bilibili 并开启播放器字幕；若仍未加载，请刷新视频页');
      if (subtitle.bvid && subtitle.bvid !== current.bvid) throw new Error('播放器字幕与当前视频不匹配，请刷新后重试');
      if (subtitle.need_login_subtitle) throw new Error('Bilibili 提示字幕需要登录，请登录后刷新');
      const tracks = subtitle.subtitles || [];
      const english = track => /^(?:ai-)?en(?:-|$)/i.test(track.lan || '');
      const chosen = tracks.find(track => english(track) && !String(track.lan).startsWith('ai-')) || tracks.find(english);
      if (!chosen) throw new Error(tracks.length ? '当前视频没有可用的英文字幕轨道，可导入英文 SRT/VTT；画面内嵌字幕需转写或 OCR' : '播放器未提供字幕轨道，可开启字幕后重试或导入英文 SRT/VTT');
      const url = new URL(chosen.subtitle_url, location.href);
      if (url.protocol !== 'https:' || !/(^|\.)(hdslb\.com|bilibili\.com)$/.test(url.hostname)) throw new Error('字幕资源地址无效');
      const body = await getJson(url.href);
      const cues = (body.body || []).map(item => ({ start: Number(item.from), end: Number(item.to), text: String(item.content || '').trim() }))
        .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start && cue.text)
        .sort((a, b) => a.start - b.start);
      if (!cues.length) throw new Error('Bilibili 字幕内容为空');
      if (identity()?.videoId !== current.videoId) throw new Error('视频已切换，忽略旧字幕');
      reply({ cues, lang: chosen.lan });
    } catch (error) { reply({ error: error.message || String(error) }); }
  });
})();
