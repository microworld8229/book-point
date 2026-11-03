// 대표 썸네일(1280×720)을 만든다: 가을 독서 분위기 + 로그인 화면의 웹툰 3컷 + 떨어지는 낙엽
// 사용법: npm run thumbnail  →  docs/thumbnail.png (정지 이미지), docs/thumbnail.gif (낙엽 움직임)
// Microsoft Edge 헤드리스로 프레임을 찍고, gifenc 로 GIF를 만든다.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PNG } = require('pngjs');

const W = 1280;
const H = 720;
const FRAMES = 40;   // 4초 반복 (10fps)
const FPS = 10;

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs');
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
  body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: 'Jua', 'Malgun Gothic', sans-serif; color: #fff;
    background:
      radial-gradient(circle at 16% 18%, rgba(255,226,150,.95) 0%, rgba(255,190,100,.55) 22%, transparent 48%),
      radial-gradient(ellipse 700px 380px at 78% 100%, rgba(110,40,12,.55), transparent 70%),
      linear-gradient(165deg, #f2a24a 0%, #d96d2a 42%, #a8431b 74%, #6f2711 100%); }
  .layer { position: absolute; inset: 0; pointer-events: none; }
  .wrap { position: absolute; inset: 0; display: flex; align-items: center; padding: 0 44px 0 60px; gap: 26px; z-index: 2; }
  .left { flex: 0 0 560px; }
  .badge { display: inline-block; padding: 8px 18px; border-radius: 999px; background: rgba(70,25,8,.35); border: 2px solid rgba(255,240,210,.6); font-size: 22px; }
  h1 { margin-top: 22px; font-size: 96px; font-weight: 400; line-height: 1; letter-spacing: -2px; white-space: nowrap; text-shadow: 5px 5px 0 #4a1c08; }
  .tag { margin-top: 20px; font-size: 40px; color: #fff3c4; text-shadow: 2px 2px 0 rgba(74,28,8,.6); }
  .steps { display: flex; flex-direction: column; gap: 12px; margin-top: 34px; font-size: 25px; }
  .step { display: flex; align-items: center; gap: 14px; }
  .num { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: #fff3c4; color: #8a3410; font-size: 22px; box-shadow: 2px 2px 0 #4a1c08; }
  .url { margin-top: 30px; font-size: 21px; opacity: .85; font-family: 'Malgun Gothic', sans-serif; }
  .right { flex: 1; display: flex; justify-content: center; }
  .frame { width: 608px; padding: 12px 10px 8px; background: #fffaf0; border: 4px solid #2a1206; border-radius: 22px; box-shadow: 12px 12px 0 #3a1608; transform: rotate(-2deg); }
  .comic { display: block; width: 100%; height: auto; }
  .comic .cm-t, .comic .cm-c { font-family: 'Jua', sans-serif; font-size: 10px; fill: #1d1d1d; }
  .comic .cm-g { font-family: 'Jua', sans-serif; font-size: 9px; fill: #1d1d1d; }
  .comic .cm-coin { font-family: 'Jua', sans-serif; fill: #8a6400; }
  .comic .cm-up { font-family: 'Jua', sans-serif; font-size: 15px; fill: #e63946; stroke: #1d1d1d; stroke-width: .8; text-anchor: middle; }
</style></head>
<body>
  <svg class="layer" id="back" viewBox="0 0 ${W} ${H}" style="z-index:1"></svg>
  <div class="wrap">
    <div class="left">
      <div class="badge">🍁 독서의 계절 · 지상작전사령부 시범 운영</div>
      <h1>장병 북포인트</h1>
      <p class="tag">읽은 책이 지역화폐가 됩니다</p>
      <div class="steps">
        <div class="step"><span class="num">1</span>병영 독서카페에서 읽고</div>
        <div class="step"><span class="num">2</span>휴대폰으로 독서일지 제출</div>
        <div class="step"><span class="num">3</span>지역화폐로 새 책 구매</div>
      </div>
      <p class="url">book-point-beta.vercel.app</p>
    </div>
    <div class="right"><div class="frame">${comic}</div></div>
  </div>
  <svg class="layer" id="front" viewBox="0 0 ${W} ${H}" style="z-index:3"></svg>
<script>
  // 프레임 번호(?f=N)에 따라 낙엽 위치를 계산한다. 모든 움직임이 정수 주기라 마지막 프레임이 첫 프레임으로 자연스럽게 이어진다.
  const N = ${FRAMES}, f = Number(new URLSearchParams(location.search).get('f') || 7), p = f / N;
  let s = 20261103;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const maple = 'M0,-20 L4,-9 L12,-14 L10,-4 L20,-4 L13,3 L16,10 L6,8 L2,18 L0,10 L-2,18 L-6,8 L-16,10 L-13,3 L-20,-4 L-10,-4 L-12,-14 L-4,-9 Z';
  const ginkgo = 'M0,14 C-4,6 -18,-2 -16,-12 C-8,-18 8,-18 16,-12 C18,-2 4,6 0,14 Z M0,-12 L0,-4';
  const colors = ['#c92a2a', '#e8590c', '#f08c00', '#d9480f', '#f59f00', '#a0522d', '#ffd43b'];
  const span = ${H} + 120;
  const leaf = (i, front) => {
    const x0 = rnd() * ${W}, y0 = rnd() * span, sway = 18 + rnd() * 40, ph = rnd(), size = (front ? 1.3 : 0.7) + rnd() * 0.7;
    const fall = 1 + Math.floor(rnd() * 2), wob = 1 + Math.floor(rnd() * 2), spin = (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2));
    const y = ((y0 + fall * p * span) % span) - 60;
    const x = x0 + sway * Math.sin(2 * Math.PI * (wob * p + ph));
    const r = rnd() * 360 + spin * 360 * p;
    const shape = rnd() < 0.72 ? maple : ginkgo, c = colors[Math.floor(rnd() * colors.length)];
    const stem = shape === maple ? '<path d="M0,10 L0,24" stroke="' + c + '" stroke-width="2" stroke-linecap="round"/>' : '';
    return '<g transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + r.toFixed(1) + ') scale(' + size.toFixed(2) + ')" opacity="' + (front ? 0.95 : 0.85) + '">'
      + '<path d="' + shape + '" fill="' + c + '" stroke="rgba(60,20,5,.35)" stroke-width="1"/>' + stem + '</g>';
  };
  // 땅에 쌓인 낙엽 (움직이지 않음)
  const pile = Array.from({ length: 46 }, () => {
    const x = rnd() * ${W}, y = ${H} - 6 - rnd() * 40, r = rnd() * 360, c = colors[Math.floor(rnd() * colors.length)], sc = 0.8 + rnd() * 0.6;
    return '<g transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + r.toFixed(1) + ') scale(' + sc.toFixed(2) + ')"><path d="' + maple + '" fill="' + c + '" opacity=".9"/></g>';
  }).join('');
  document.getElementById('back').innerHTML = pile + Array.from({ length: 26 }, (_, i) => leaf(i, false)).join('');
  document.getElementById('front').innerHTML = Array.from({ length: 6 }, (_, i) => leaf(i, true)).join('');
</script>
</body></html>`;

fs.mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, 'thumbnail.html');
fs.writeFileSync(htmlPath, html);
const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;

const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
  .find((p) => fs.existsSync(p));
if (!edge) {
  console.log(`Edge를 찾지 못했습니다. ${htmlPath} 를 브라우저로 열어 캡처하세요.`);
  process.exit(0);
}

const shot = (frame, out) => execFileSync(edge, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--log-level=3',
  '--virtual-time-budget=4000', `--window-size=${W},${H}`, `--screenshot=${out}`, `${fileUrl}?f=${frame}`,
], { stdio: 'ignore' });

(async () => {
  // 1) 정지 이미지
  const pngPath = path.join(outDir, 'thumbnail.png');
  shot(7, pngPath);
  console.log(`정지 썸네일: ${pngPath}`);

  // 2) 움직이는 GIF (프레임마다 캡처 → 256색 양자화)
  const mod = await import('gifenc');
  const { GIFEncoder, quantize, applyPalette } = mod.GIFEncoder ? mod : mod.default;
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'thumb-'));
  const gif = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    const framePath = path.join(tmp, `f${i}.png`);
    shot(i, framePath);
    const { data, width, height } = PNG.sync.read(fs.readFileSync(framePath));
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: Math.round(1000 / FPS), repeat: 0 });
    process.stdout.write(`\r프레임 ${i + 1}/${FRAMES}`);
  }
  gif.finish();
  const gifPath = path.join(outDir, 'thumbnail.gif');
  fs.writeFileSync(gifPath, gif.bytes());
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n움직이는 썸네일: ${gifPath} (${(fs.statSync(gifPath).size / 1048576).toFixed(1)}MB)`);
})();
