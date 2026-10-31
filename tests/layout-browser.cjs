// Local browser fixture: verify the real panel code/CSS without YouTube or an API key.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-layout-'));
const source = fs.readFileSync(path.join(root, 'src/content/main.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
const css = fs.readFileSync(path.join(root, 'src/content/panel.css'), 'utf8');
const fixture = `
state.site = 'youtube';
buildPanel(); buildFab();
state.showEn = true; state.followScroll = true;
state.cues = [
  {start:0,end:3,text:"I never thought it would come to this."},
  {start:3,end:6,text:"Sometimes, you just have to take a leap of faith."},
  {start:6,end:9,text:"And trust that things will work out."}
];
state.lessons[1] = {englishLevel:'B1',lessonVersion:2,translation:'有时候，你只需要鼓起勇气迈出那一步。',explanation:'说话者鼓励对方在尚无把握时采取行动。',phrases:[{term:'a leap of faith',meaning:'凭信念做出的大胆尝试',usage:'在无法确定结果时，仍然选择相信并行动。',example:'Starting my own business was a leap of faith.',exampleTranslation:'自己创业是一次凭信念做出的尝试。'}],grammar:['have to 表示客观需要；这里表达的是面对现实必须作出的选择。']};
state.currentIndex=1; refreshCueList();
const results=[];
function check(name, condition) {results.push({name,pass:!!condition});}
function bounds() { const body=document.body.getBoundingClientRect(), panel=state.components.root.getBoundingClientRect(); return Math.abs(body.width-innerWidth)<2 && Math.abs(panel.right-innerWidth)<2 && getComputedStyle(state.components.root).position==='fixed'; }
for(const width of [380,560]) {setPanelWidth(width); check('floating without shrinking page '+width,bounds()); check('requested width '+width,Math.abs(state.components.root.getBoundingClientRect().width-state.panelWidth)<1);}
const before=state.panelWidth;
state.components.resizeHandle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
check('keyboard resize', state.panelWidth>=before);
state.components.resizeHandle.setPointerCapture=()=>{};
state.components.resizeHandle.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:7,clientX:500}));
const dragWidth=state.panelWidth;
state.components.resizeHandle.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,clientX:540}));
check('pointer drag changes width',state.panelWidth===Math.max(panelWidthBounds().min,dragWidth-40));
state.components.resizeHandle.dispatchEvent(new PointerEvent('pointerup',{pointerId:7}));
check('drag cleanup',!document.documentElement.classList.contains('vl-resizing'));
hidePanel(); check('hide restores full page',!document.documentElement.classList.contains('vl-docked') && Math.abs(document.body.getBoundingClientRect().width-innerWidth)<2);
showPanel(); setPanelWidth(460); check('reopen floats over full page',bounds());
check('play button larger',state.components.btnPlayPause.getBoundingClientRect().height>=48);
check('current dialogue prominent',parseFloat(getComputedStyle(document.querySelector('.vl-current .vl-cue-text')).fontSize)>=23);
check('no horizontal overflow', document.documentElement.scrollWidth<=innerWidth+1);
scrollTo(0,300);
setTimeout(()=>{
 check('panel stays visible while page scrolls',Math.abs(state.components.root.getBoundingClientRect().top)<1);
 scrollTo(0,0);
 const report=document.createElement('script');report.id='layout-results';report.type='application/json';report.textContent=JSON.stringify(results);document.body.append(report);
},100);
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f6f7f9;font-family:Arial,sans-serif}ytd-app{display:block;min-height:1800px}#masthead-container{position:fixed;top:0;left:0;right:0;height:56px;box-sizing:border-box;background:white;padding:18px 24px;border-bottom:1px solid #ddd}ytd-watch-flexy{display:block;padding-top:80px}#primary{box-sizing:border-box;padding:0 28px}#mock-player{aspect-ratio:16/9;background:#17212e;color:#f1f5fa;display:grid;place-items:center;font-size:24px;border-radius:10px}h1{font-size:22px}p{color:#687383}
${css}</style></head><body><ytd-app><div id="masthead-container">YouTube · 布局预览</div><ytd-watch-flexy><div id="columns"><div id="primary"><div id="mock-player">视频播放区域</div><h1>Learning English through conversation</h1><p>讲解面板浮动在页面右侧，拖动左边缘可调整宽度。</p></div><div id="secondary"></div></div></ytd-watch-flexy></ytd-app><script>
window.chrome={runtime:{},storage:{local:{set:async()=>{}},onChanged:{addListener(){}}}};
${source}
${fixture}
</script></body></html>`;
const file = path.join(output, 'preview.html');
fs.writeFileSync(file, html);
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const width of [1440, 900, 600]) {
  const screenshot = path.join(output, `layout-${width}.png`);
  let dom;
  try { dom = execFileSync(chrome, [
    '--headless', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-background-networking', '--disable-component-update',
    `--user-data-dir=${path.join(output, 'profile-' + width)}`, `--window-size=${width},1000`,
    '--virtual-time-budget=1200', '--dump-dom', `--screenshot=${screenshot}`, `file://${file}`,
  ], { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (error) {
    // Some desktop Chrome builds keep background processes alive after dumping.
    // Accept only a completed fixture report and screenshot, never a partial run.
    if (error.code !== 'ETIMEDOUT' || !error.stdout?.includes('<script id="layout-results"') || !fs.existsSync(screenshot)) throw new Error('Browser fixture did not complete');
    dom = error.stdout;
  }
  const report = dom.match(/<script id="layout-results" type="application\/json">(.*?)<\/script>/s);
  if (!report) throw new Error('Browser layout fixture failed to run');
  const checks = JSON.parse(report[1]);
  const failures = checks.filter(check => !check.pass);
  console.log(JSON.stringify({ width, checks: checks.length, failures, screenshot }));
  if (failures.length) process.exitCode = 1;
}
