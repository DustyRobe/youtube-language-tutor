// Group caption display fragments into speech units without inventing word timings.
// A cue containing multiple sentences stays intact: its internal timing is unknown.
const VL_SENTENCE_VERSION = 2;

function captionEndsSentence(text) {
  const clean = text.trim().replace(/["'”’）)\]]+$/u, '').trim();
  if (/[!?。！？]$/u.test(clean)) return true;
  if (!clean.endsWith('.') || /(?:\.{2,}|…)$/u.test(clean)) return false;
  // Titles, initials, decimals, and common abbreviations are not sentence ends.
  if (/\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|fig|approx)\.$/i.test(clean)) return false;
  if (/(?:\b[a-z]\.){2,}$/i.test(clean) || /\b[A-Z]\.$/.test(clean)) return false;
  return true;
}

function combineSubtitleSentences(input, options = {}) {
  const { pauseGap = 1.5, targetDuration = 8, targetWords = 24, maxDuration = 14, maxWords = 40 } = options;
  const cues = (Array.isArray(input) ? input : []).filter(cue =>
    cue && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && typeof cue.text === 'string'
  ).map(cue => ({ start: cue.start, end: cue.end, text: cue.text.replace(/\s+/g, ' ').trim() }))
    .filter(cue => cue.text).sort((a, b) => a.start - b.start);
  const deduped = [];
  for (const cue of cues) {
    const last = deduped[deduped.length - 1];
    if (last && cue.start < last.end) {
      const before = last.text.split(' '), after = cue.text.split(' ');
      let overlap = Math.min(before.length, after.length);
      while (overlap > 0 && before.slice(-overlap).join(' ') !== after.slice(0, overlap).join(' ')) overlap--;
      // Remove rolling-caption repetition only with overlapping timestamps.
      // Preserve ordinary repeated single words (e.g. "very very good").
      if (overlap >= 2 || last.text === cue.text) {
        if (overlap === after.length) { last.end = Math.max(last.end, cue.end); continue; }
        cue.text = after.slice(overlap).join(' ');
      }
    }
    deduped.push(cue);
  }

  const result = [];
  let pending = [];
  const summarize = parts => ({ start: parts[0].start, end: Math.max(...parts.map(c => c.end)), text: parts.map(c => c.text).join(' ') });
  const flush = (count = pending.length) => {
    if (count) result.push(summarize(pending.splice(0, count)));
  };
  const words = text => text.split(/\s+/).length;
  // Only split at known caption boundaries; don't estimate timings inside a cue.
  const naturalBreak = (left, right) => {
    if (/[;:；：]["'”’)]?$/.test(left.text)) return 3;
    if (/[,，—]["'”’)]?$/.test(left.text)) return 2;
    if (right.start - left.end >= 0.35) return 2;
    if (/^(?:and|but|so|yet|because|although|while|whereas|however)\b/i.test(right.text)) return 1;
    return 0;
  };
  const nonSpeech = text => /^(?:\[[^\]]+\]|\([^)]*\)|[♪♫\s]+)$/u.test(text);
  for (const cue of deduped) {
    const speakerChange = /^(?:>>\s*|[-–—]\s+|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?:\s)/u.test(cue.text);
    if (pending.length) {
      let summary = summarize(pending);
      if (cue.start - summary.end >= pauseGap || speakerChange || nonSpeech(cue.text)) flush();
      else {
        // Prefer a clause break once the sentence has grown long enough.
        if ((summary.end - summary.start >= targetDuration || words(summary.text) >= targetWords) && naturalBreak(pending[pending.length - 1], cue)) flush();
        else if (Math.max(summary.end, cue.end) - summary.start > maxDuration || words(summary.text) + words(cue.text) > maxWords) {
          // Look back for a natural break rather than cutting at the last fragment.
          let best = 0, bestScore = -Infinity;
          for (let i = 1; i < pending.length; i++) {
            const prefix = summarize(pending.slice(0, i));
            const strength = naturalBreak(pending[i - 1], pending[i]);
            if (!strength || (prefix.end - prefix.start < 3 && words(prefix.text) < 8)) continue;
            const score = strength * 3 - Math.abs(prefix.end - prefix.start - targetDuration);
            if (score > bestScore) { best = i; bestScore = score; }
          }
          flush(best || pending.length);
          // A large new fragment may still exceed the limit after the lookback.
          if (pending.length) {
            summary = summarize(pending);
            if (Math.max(summary.end, cue.end) - summary.start > maxDuration || words(summary.text) + words(cue.text) > maxWords) flush();
          }
        }
      }
    }
    pending.push(cue);
    if (captionEndsSentence(cue.text) || nonSpeech(cue.text)) flush();
  }
  flush();
  return result;
}
