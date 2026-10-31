// SRT / VTT 字幕解析 —— 纯函数模块，无 DOM 依赖
// 统一输出内部 cue 格式: { start, end, text }
// start/end 单位为秒。

/** "00:01:02,500" / "00:01:02.500" / "01:02.500" -> 秒 */
function parseTimestamp(str) {
  const m = String(str).trim().match(/^(\d{1,2}:)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, '0'), 10);
  return h * 3600 + min * 60 + s + ms / 1000;
}

/**
 * 解析 SRT 或 VTT 文本为 cue 数组（按 start 排序）。
 * 同时容忍常见脏数据：BOM、WEBVTT 头、cue 标识行、<v Speaker> 标签。
 */
function parseSubtitle(text) {
  const raw = String(text).replace(/^\uFEFF/, '');
  const blocks = raw.split(/\r?\n\r?\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    // 跳过 WEBVTT 头块
    if (lines[0].startsWith('WEBVTT') && lines.length < 2) continue;
    if (lines[0].startsWith('WEBVTT') && !/-->/.test(lines[1] || '')) continue;

    // 找到含 --> 的行（可能首行是 cue 标识）
    let arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;

    const parts = lines[arrowIdx].split('-->');
    const start = parseTimestamp(parts[0]);
    // VTT 末尾可能带设置（如 align:start position:0%）
    const endStr = parts[1].trim().split(/\s+/)[0];
    const end = parseTimestamp(endStr);
    if (start == null || end == null) continue;

    const textLines = lines.slice(arrowIdx + 1).map((l) =>
      l.replace(/<[^>]+>/g, '').replace(/^[-–—]\s*/, '').trim()
    );
    const cueText = textLines.join('\n').trim();
    if (!cueText) continue;

    cues.push({ start, end, text: cueText });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** 把 cue 数组序列化为字符串（供导入导出与传输） */
function serializeCues(cues) {
  return JSON.stringify(cues);
}

/** 从 JSON 文本解析 cue 数组（宽松容错） */
function parseCuesJson(text) {
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return null;
    const cues = arr
      .filter((c) => c && typeof c.start === 'number' && typeof c.end === 'number' && typeof c.text === 'string')
      .map((c) => ({ start: c.start, end: c.end, text: c.text }));
    cues.sort((a, b) => a.start - b.start);
    return cues.length ? cues : null;
  } catch {
    return null;
  }
}
