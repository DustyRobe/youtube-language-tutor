const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/utils/sentences.js'), 'utf8'), context);
const group = cues => JSON.parse(JSON.stringify(context.combineSubtitleSentences(cues)));

test('caption fragments combine until the sentence ends, retaining exact cue boundaries', () => {
  const result = group([
    { start: 0, end: 2, text: 'I never thought' },
    { start: 2, end: 4, text: 'it would come to this.' },
    { start: 4, end: 6, text: 'What should' },
    { start: 6, end: 7, text: 'we do now?' },
  ]);
  assert.deepEqual(result, [
    { start: 0, end: 4, text: 'I never thought it would come to this.' },
    { start: 4, end: 7, text: 'What should we do now?' },
  ]);
});

test('abbreviations, initials, decimal numbers and ellipses do not cut off speech', () => {
  for (const prefix of ['Dr.', 'Mr.', 'We live in the U.S.', 'The price is 3.14', 'I thought...']) {
    const result = group([{ start: 0, end: 1, text: prefix }, { start: 1, end: 3, text: 'and the sentence continues.' }]);
    assert.equal(result.length, 1, prefix);
  }
  assert.equal(context.captionEndsSentence('Are you sure?”'), true);
});

test('rolling captions are deduplicated only when timestamps overlap', () => {
  assert.equal(group([
    { start: 0, end: 3, text: 'I think we should' },
    { start: 2, end: 5, text: 'we should go home.' },
  ])[0].text, 'I think we should go home.');
  assert.equal(group([
    { start: 0, end: 2, text: 'very' },
    { start: 1, end: 3, text: 'very good.' },
  ])[0].text, 'very very good.');
  assert.equal(group([
    { start: 0, end: 1, text: 'I know' },
    { start: 1, end: 2, text: 'I know that.' },
  ])[0].text, 'I know I know that.');
});

test('long silence, speaker changes and non-speech break groups', () => {
  assert.equal(group([{ start: 0, end: 1, text: 'Hello' }, { start: 3, end: 4, text: 'there' }]).length, 2);
  assert.equal(group([{ start: 0, end: 1, text: 'Hello' }, { start: 1, end: 2, text: '>> Another speaker.' }]).length, 2);
  assert.equal(group([{ start: 0, end: 1, text: 'Hello' }, { start: 1, end: 2, text: '[Music]' }]).length, 2);
});

test('unpunctuated subtitles remain bounded and multi-sentence cues are not assigned invented timings', () => {
  const result = group(Array.from({ length: 40 }, (_, i) => ({ start: i, end: i + 1, text: 'a fragment' })));
  assert.equal(result.length, 3);
  assert.equal(result[0].end, 14);
  assert.ok(result.every(cue => cue.end - cue.start <= 14));
  const cue = { start: 0, end: 5, text: 'Hello. How are you?' };
  assert.deepEqual(group([cue]), [cue]);
});

test('long sentences use clause punctuation before reaching the hard limit', () => {
  const result = group([
    { start: 0, end: 4, text: 'We tried to explain what had happened' },
    { start: 4, end: 8, text: 'when we arrived at the station,' },
    { start: 8, end: 12, text: 'but nobody seemed to understand' },
    { start: 12, end: 16, text: 'why we were so worried.' },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].end, 8);
  assert.match(result[1].text, /^but nobody/);
});

test('hard limits are checked before appending and prefer earlier clause boundaries', () => {
  const result = group([
    { start: 0, end: 5, text: 'We waited for a long time,' },
    { start: 5, end: 10, text: 'trying to find out' },
    { start: 10, end: 15, text: 'what would happen next' },
  ]);
  assert.equal(result[0].end, 5);
  assert.equal(result[1].start, 5);
  assert.ok(result.every(cue => cue.end - cue.start <= 14));
  assert.equal(result.map(cue => cue.text).join(' '), 'We waited for a long time, trying to find out what would happen next');
});
