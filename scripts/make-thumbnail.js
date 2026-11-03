// 대표 썸네일(1280×720 PNG)을 만든다: 로그인 화면의 웹툰 3컷을 앱 코드에서 그대로 가져와 배치
// 사용법: npm run thumbnail  →  docs/thumbnail.png (Microsoft Edge 헤드리스로 캡처)
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

// app.js 에서 웹툰을 그리는 부분만 잘라 실행한다 (SPINE_COLORS + "로그인 웹툰" ~ viewLogin 직전)
const spine = app.match(/const SPINE_COLORS = \[[^\]]*\];/)[0];
const start = app.indexOf('// 로그인 웹툰');
const end = app.indexOf('function viewLogin');
const loginComic = new Function(`${spine}\n${app.slice(start, end)}\nreturn loginComic;`)();
const comic = loginComic().replace('class="login-comic"', 'class="comic"');

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 720px; overflow: hidden; font-family: 'Jua', 'Malgun Gothic', sans-serif; color: #fff;
    background:
      radial-gradient(ellipse 260px 140px at 8% 14%, rgba(0,0,0,.18), transparent 70%),
      radial-gradient(ellipse 320px 160px at 46% 6%, rgba(160,150,100,.20), transparent 70%),
      radial-gradient(ellipse 300px 150px at 30% 92%, rgba(0,0,0,.18), transparent 70%),
      radial-gradient(ellipse 360px 150px at 88% 96%, rgba(160,150,100,.16), transparent 70%),
      radial-gradient(ellipse 220px 120px at 60% 50%, rgba(0,0,0,.10), transparent 70%),
      linear-gradient(150deg, #34401f 0%, #56663a 100%); }
  .wrap { display: flex; align-items: center; height: 100%; padding: 0 44px 0 72px; gap: 40px; }
  .left { flex: 0 0 620px; }
  .badge { display: inline-block; padding: 8px 18px; border: 2px solid rgba(255,255,255,.55); border-radius: 999px; font-size: 22px; letter-spacing: .5px; }
  h1 { margin-top: 26px; font-size: 92px; font-weight: 400; line-height: 1; letter-spacing: -2px; white-space: nowrap; text-shadow: 4px 4px 0 #1d1d1d; }
  .tag { margin-top: 22px; font-size: 40px; color: #ffe08a; }
  .steps { display: flex; align-items: center; gap: 8px; margin-top: 44px; font-size: 19px; }
  .step { padding: 11px 15px; border-radius: 14px; background: rgba(255,255,255,.14); border: 2px solid rgba(255,255,255,.28); white-space: nowrap; }
  .arrow { font-size: 22px; opacity: .8; }
  .url { margin-top: 38px; font-size: 22px; opacity: .78; font-family: 'Malgun Gothic', sans-serif; }
  .right { flex: 0 0 520px; }
  .frame { padding: 12px 10px 8px; background: #fff; border: 4px solid #1d1d1d; border-radius: 22px; box-shadow: 10px 10px 0 #1d1d1d; transform: rotate(-2deg); }
  .comic { display: block; width: 100%; height: auto; }
  .comic .cm-t { font-family: 'Jua', sans-serif; font-size: 10px; fill: #1d1d1d; }
  .comic .cm-g { font-family: 'Jua', sans-serif; font-size: 9px; fill: #1d1d1d; }
  .comic .cm-c { font-family: 'Jua', sans-serif; font-size: 10px; fill: #1d1d1d; }
  .comic .cm-coin { font-family: 'Jua', sans-serif; fill: #8a6400; }
  .comic .cm-up { font-family: 'Jua', sans-serif; font-size: 15px; fill: #e63946; stroke: #1d1d1d; stroke-width: .8; text-anchor: middle; }
</style></head>
<body><div class="wrap">
  <div class="left">
    <div class="badge">📖 지상작전사령부 시범 운영</div>
    <h1>장병 북포인트</h1>
    <p class="tag">읽은 책이 지역화폐가 됩니다</p>
    <div class="steps">
      <span class="step">독서카페에서 읽고</span><span class="arrow">→</span>
      <span class="step">일지 제출</span><span class="arrow">→</span>
      <span class="step">지역화폐로 새 책</span>
    </div>
    <p class="url">book-point-beta.vercel.app</p>
  </div>
  <div class="right"><div class="frame">${comic}</div></div>
</div></body></html>`;

const outDir = path.join(root, 'docs');
fs.mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, 'thumbnail.html');
const pngPath = path.join(outDir, 'thumbnail.png');
fs.writeFileSync(htmlPath, html);

const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  .find((p) => fs.existsSync(p));
if (!edge) {
  console.log(`Edge를 찾지 못했습니다. ${htmlPath} 를 브라우저로 열어 캡처하세요.`);
  process.exit(0);
}
execFileSync(edge, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--virtual-time-budget=5000', '--window-size=1280,720', `--screenshot=${pngPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'inherit' });
console.log(`썸네일 저장: ${pngPath}`);
