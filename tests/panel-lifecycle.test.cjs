const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../src/content/main.js'), 'utf8');

test('closing releases sentence pause, clears preload timers, and reopening uses current playback position', async () => {
  let queued;
  let plays = 0;
  let requests = 0;
  const root = { classList: { add() {}, remove() {} } };
  const state = { panelOpen: true, autoPause: true, pausedCue: { index: 0, time: 1 },
    cues: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
    video: { currentTime: 1, paused: true, play() { plays++; this.paused = false; return Promise.resolve(); } },
    components: {}, currentIndex: 0, lessons: {}, preloadBlocked: false };
  const context = vm.createContext({ state, PANEL_ID: 'panel',
    document: { getElementById: () => root },
    applyYouTubeLayout() {}, updateCueHighlight() {}, onTimeUpdate() {},
    binarySearchCueIndex: () => 1, lessonForLevel: () => null,
    setTimeout: fn => { queued = fn; return 1; }, clearTimeout: () => { queued = null; },
    send: async () => { requests++; },
  });
  vm.runInContext(source.slice(source.indexOf('let lessonPreloadTimer'), source.indexOf('function buildFab()')), context);
  vm.runInContext(source.slice(source.indexOf('function hidePanel()'), source.indexOf('function togglePanelSize()')), context);
  vm.runInContext(source.slice(source.indexOf('function showPanel()'), source.indexOf('function init()')), context);
  context.scheduleLessonPreload();
  assert.ok(queued);
  context.hidePanel();
  assert.equal(queued, null);
  assert.equal(plays, 1);
  assert.equal(state.autoPause, true);
  assert.equal(state.pausedCue, null);
  context.scheduleLessonPreload();
  await context.generateLessonBatch(0, true);
  assert.equal(queued, null);
  assert.equal(requests, 0);
  state.video.currentTime = 2.5;
  context.showPanel();
  assert.equal(state.panelOpen, true);
  assert.equal(state.currentIndex, 1);
  assert.equal(state.autoPauseIndex, 1);
  assert.ok(queued);
  state.pausedCue = null;
  state.video.paused = true;
  context.hidePanel();
  assert.equal(plays, 1, 'manual pause must not be resumed');
});

test('time updates cannot pause or preload while the panel is closed', () => {
  const context = vm.createContext({ state: { panelOpen: false, video: { pause() { throw new Error('must not pause'); } } } });
  vm.runInContext(source.slice(source.indexOf('function onTimeUpdate()'), source.indexOf('let subtitleLoadId')), context);
  context.onTimeUpdate();
});
