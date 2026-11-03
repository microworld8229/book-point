// 장병 북포인트 - 모바일 웹 클라이언트 (해시 라우팅 SPA)
(() => {
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  let me = null;
  let meta = null;
  let renderSeq = 0;

  // ── 공통 ──────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const countChars = (s) => [...String(s).replace(/\r\n?/g, '\n').trim()].length;
  const fmtDate = (ts) => (ts ? ts.slice(0, 10).replace(/-/g, '.') : '-');
  const fmtDateTime = (ts) => (ts ? `${fmtDate(ts)} ${ts.slice(11, 16)}` : '-');
  const num = (n) => Number(n || 0).toLocaleString('ko-KR');
  const STATUS = { pending: '대기', approved: '승인', rejected: '반려' };
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const homeOf = () => (me?.role === 'admin' ? '#/admin' : '#/home');

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* 비 JSON 응답 */ }
    if (!res.ok) {
      if (res.status === 401 && !['/api/login', '/api/me', '/api/me/password'].includes(url)) {
        me = null;
        if (!/^#\/(login|signup)/.test(location.hash)) go('#/login');
      }
      throw new ApiError(res.status, data.error || '요청을 처리하지 못했습니다.');
    }
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  function openModal(html, onMount) {
    $modal.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const backdrop = $modal.firstElementChild;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    onMount?.(backdrop.firstElementChild);
  }
  const closeModal = () => { $modal.innerHTML = ''; };

  function alertModal(title, message) {
    return new Promise((resolve) => {
      openModal(`<h3>${esc(title)}</h3><p>${message}</p><div class="buttons"><button class="btn" data-ok>확인</button></div>`, (m) => {
        m.querySelector('[data-ok]').onclick = () => { closeModal(); resolve(); };
      });
    });
  }

  function topbar(title, { back, right } = {}) {
    return `<header class="topbar">
      ${back ? `<button class="back" data-back="${esc(back)}" aria-label="뒤로">‹</button>` : ''}
      <h1>${esc(title)}</h1>
      ${right || ''}
    </header>`;
  }

  function bindCommon(root) {
    root.querySelectorAll('[data-back]').forEach((b) => { b.onclick = () => go(b.dataset.back); });
    root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
    root.querySelectorAll('[data-logout]').forEach((b) => {
      b.onclick = async () => {
        await api('POST', '/api/logout', {}).catch(() => {});
        me = null;
        go('#/login');
      };
    });
  }

  function render(html) {
    $app.innerHTML = `<div class="page">${html}</div>`;
    bindCommon($app);
    window.scrollTo(0, 0);
    return $app.firstElementChild;
  }

  const formData = (form) => Object.fromEntries(new FormData(form).entries());

  async function submitting(btn, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '처리 중...';
    try { await fn(); } catch (err) { toast(err.message, true); } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // ── S0. 로그인 / 가입 ─────────────────────────────────────────
  // 로그인 웹툰: 지친 일과 후 → 독서카페에서 책에 빠짐 → 복무 의지 MAX
  const INK = '#1d1d1d';
  // face: tired | wow | happy | smile, pose: none | read | salute | cheer, s: 크기 배율
  function comicSoldier(cx, cy, face, pose = 'none', s = 1) {
    return `<g transform="translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})">${soldierBody(cx, cy, face, pose)}</g>`;
  }

  function soldierBody(cx, cy, mood, pose) {
    const skin = '#f6d2b0';
    const face = {
      tired: `<path d="M${cx - 11} ${cy + 3} h7 M${cx + 4} ${cy + 3} h7" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
        <path d="M${cx - 10} ${cy + 7} q3 2 6 0 M${cx + 5} ${cy + 7} q3 2 6 0" stroke="#9aa3ad" stroke-width="1.2" fill="none"/>
        <path d="M${cx - 6} ${cy + 13} q3 -2.5 6 0 q3 2.5 6 0" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <path d="M${cx + 19} ${cy - 6} q4 6 0 9 q-4 -3 0 -9 z" fill="#8fd3ff" stroke="${INK}" stroke-width="1.2"/>`,
      wow: `<circle cx="${cx - 7}" cy="${cy + 3}" r="3.6" fill="${INK}"/><circle cx="${cx + 7}" cy="${cy + 3}" r="3.6" fill="${INK}"/>
        <circle cx="${cx - 6}" cy="${cy + 1.8}" r="1.3" fill="#fff"/><circle cx="${cx + 8}" cy="${cy + 1.8}" r="1.3" fill="#fff"/>
        <path d="M${cx - 11} ${cy - 4} q4 -3 8 -1 M${cx + 3} ${cy - 5} q4 -2 8 1" stroke="${INK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <ellipse cx="${cx}" cy="${cy + 12}" rx="3" ry="3.6" fill="#b0413e" stroke="${INK}" stroke-width="1.4"/>`,
      happy: `<path d="M${cx - 11} ${cy + 4} q3.5 -6 7 0 M${cx + 4} ${cy + 4} q3.5 -6 7 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
        <path d="M${cx - 8} ${cy + 9} q8 11 16 0 z" fill="#b0413e" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
        <ellipse cx="${cx - 13}" cy="${cy + 9}" rx="3.5" ry="2" fill="#ff9aa2" opacity=".8"/><ellipse cx="${cx + 13}" cy="${cy + 9}" rx="3.5" ry="2" fill="#ff9aa2" opacity=".8"/>`,
      smile: `<path d="M${cx - 11} ${cy + 5} q3.5 3 7 0 M${cx + 4} ${cy + 5} q3.5 3 7 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M${cx - 4} ${cy + 11} q4 4 8 0" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <ellipse cx="${cx - 13}" cy="${cy + 9}" rx="3.5" ry="2" fill="#ff9aa2" opacity=".8"/><ellipse cx="${cx + 13}" cy="${cy + 9}" rx="3.5" ry="2" fill="#ff9aa2" opacity=".8"/>`,
    }[mood];
    const book = (x, y) => `<path d="M${x - 15} ${y} L${x} ${y - 4} L${x + 15} ${y} L${x + 15} ${y + 14} L${x} ${y + 10} L${x - 15} ${y + 14} Z" fill="#c0392b" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M${x - 13} ${y + 1} L${x} ${y - 2} L${x} ${y + 9} L${x - 13} ${y + 12} Z M${x + 13} ${y + 1} L${x} ${y - 2} L${x} ${y + 9} L${x + 13} ${y + 12} Z" fill="#fffdf5" stroke="${INK}" stroke-width="1.2"/>`;
    const sleeve = (d) => `<path d="${d}" stroke="${INK}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="${d}" stroke="url(#camo2)" stroke-width="6" fill="none" stroke-linecap="round"/>`;
    const arms = {
      none: '',
      read: `${book(cx, cy + 30)}<circle cx="${cx - 15}" cy="${cy + 38}" r="4" fill="${skin}" stroke="${INK}" stroke-width="1.5"/><circle cx="${cx + 15}" cy="${cy + 38}" r="4" fill="${skin}" stroke="${INK}" stroke-width="1.5"/>`,
      cheer: `${sleeve(`M${cx - 17} ${cy + 26} Q${cx - 34} ${cy + 8} ${cx - 30} ${cy - 14}`)}
        <circle cx="${cx - 30}" cy="${cy - 18}" r="5.5" fill="${skin}" stroke="${INK}" stroke-width="1.6"/>
        <g transform="rotate(10 ${cx + 24} ${cy + 36})"><rect x="${cx + 17}" y="${cy + 24}" width="14" height="20" rx="1.5" fill="#e9a93b" stroke="${INK}" stroke-width="1.8"/><path d="M${cx + 20} ${cy + 24} v20" stroke="${INK}" stroke-width="1"/></g>`,
      salute: `<path d="M${cx + 16} ${cy + 26} Q${cx + 30} ${cy + 6} ${cx + 15} ${cy - 10}" stroke="${INK}" stroke-width="9" fill="none" stroke-linecap="round"/>
        <path d="M${cx + 16} ${cy + 26} Q${cx + 30} ${cy + 6} ${cx + 15} ${cy - 10}" stroke="url(#camo2)" stroke-width="6" fill="none" stroke-linecap="round"/>
        <path d="M${cx + 8} ${cy - 12} l10 -4 l2 5 l-10 3 z" fill="${skin}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
        <g transform="rotate(-12 ${cx - 22} ${cy + 36})"><rect x="${cx - 30}" y="${cy + 24}" width="14" height="20" rx="1.5" fill="#2a9d8f" stroke="${INK}" stroke-width="1.8"/><path d="M${cx - 27} ${cy + 24} v20" stroke="${INK}" stroke-width="1"/></g>`,
    }[pose];
    return `
      <path d="M${cx - 19} ${cy + 18} Q${cx - 24} ${cy + 40} ${cx - 23} ${cy + 60} H${cx + 23} Q${cx + 24} ${cy + 40} ${cx + 19} ${cy + 18} Z" fill="url(#camo2)" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <rect x="${cx + 3}" y="${cy + 26}" width="12" height="4" fill="#fff" stroke="${INK}" stroke-width="1"/>
      <rect x="${cx - 15}" y="${cy + 26}" width="9" height="6" fill="#111"/><path d="M${cx - 13.5} ${cy + 28} h6 M${cx - 13.5} ${cy + 30} h6" stroke="#e9c46a" stroke-width="1"/>
      <circle cx="${cx}" cy="${cy}" r="21" fill="${skin}" stroke="${INK}" stroke-width="2.2"/>
      <path d="M${cx - 21.5} ${cy - 3} Q${cx - 22} ${cy - 25} ${cx} ${cy - 25} Q${cx + 22} ${cy - 25} ${cx + 21.5} ${cy - 3} Z" fill="url(#camo2)" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <rect x="${cx - 24}" y="${cy - 6}" width="48" height="5.5" rx="2.75" fill="#3b4529" stroke="${INK}" stroke-width="1.8"/>
      ${face}${arms}`;
  }

  function loginComic() {
    // 세 컷: 위 2칸(172×136) + 아래 넓은 1칸(348×136)
    const W = 172;
    const H = 136;
    const panel = (x, y, bg, inner, w = W) => `<g><clipPath id="p${x}-${y}"><rect x="${x}" y="${y}" width="${w}" height="${H}" rx="5"/></clipPath>
      <g clip-path="url(#p${x}-${y})">${bg}${inner}</g><rect x="${x}" y="${y}" width="${w}" height="${H}" rx="5" fill="none" stroke="${INK}" stroke-width="2.6"/></g>`;
    const caption = (x, y, n, t) => `<rect x="${x + 5}" y="${y + 5}" width="${18 + t.length * 9}" height="16" fill="#ffe14d" stroke="${INK}" stroke-width="1.4"/>
      <text x="${x + 10}" y="${y + 17}" class="cm-c">${n} ${t}</text>`;
    const bubble = (x, y, w, lines, tailX) => `
      <path d="M${x + 8} ${y} H${x + w - 8} Q${x + w} ${y} ${x + w} ${y + 8} V${y + lines.length * 12 + 2} Q${x + w} ${y + lines.length * 12 + 10} ${x + w - 8} ${y + lines.length * 12 + 10}
        H${tailX + 6} L${tailX - 2} ${y + lines.length * 12 + 18} L${tailX - 2} ${y + lines.length * 12 + 10} H${x + 8} Q${x} ${y + lines.length * 12 + 10} ${x} ${y + lines.length * 12 + 2} V${y + 8} Q${x} ${y} ${x + 8} ${y} Z"
        fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
      ${lines.map((l, i) => `<text x="${x + w / 2}" y="${y + 15 + i * 12}" text-anchor="middle" class="cm-t">${l}</text>`).join('')}`;
    // 복무 의지 게이지 (칸 오른쪽 아래)
    const gauge = (x, y, pct, color, label, w = W) => `
      <rect x="${x + w - 90}" y="${y + 112}" width="84" height="17" rx="8.5" fill="#fff" stroke="${INK}" stroke-width="1.6"/>
      <rect x="${x + w - 88}" y="${y + 114}" width="${Math.max(8, 80 * pct)}" height="13" rx="6.5" fill="${color}"/>
      <text x="${x + w - 48}" y="${y + 124.5}" text-anchor="middle" class="cm-g">복무 의지 ${label}</text>`;
    const rays = (cx, cy) => Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      const b = a + Math.PI / 12;
      return `<path d="M${cx} ${cy} L${cx + 200 * Math.cos(a)} ${cy + 200 * Math.sin(a)} L${cx + 200 * Math.cos(b)} ${cy + 200 * Math.sin(b)} Z" fill="#ffe27a"/>`;
    }).join('');
    const coin = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f6c445" stroke="${INK}" stroke-width="1.6"/><text x="${x}" y="${y + r * 0.42}" text-anchor="middle" class="cm-coin" style="font-size:${r * 1.2}px">P</text>`;
    const shelfRow = (x, y, n, seed) => Array.from({ length: n }, (_, i) => `<rect x="${x + i * 7}" y="${y - 10 - ((i * 7 + seed) % 4)}" width="6" height="${10 + ((i * 7 + seed) % 4)}" fill="${SPINE_COLORS[(i + seed) % 8]}" stroke="${INK}" stroke-width=".7"/>`).join('')
      + `<rect x="${x - 2}" y="${y}" width="${n * 7 + 3}" height="3" fill="#8b5e3c"/>`;
    const spark = (x, y, s) => `<path d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z" fill="#fff" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`;
    return `
    <svg class="login-comic" viewBox="0 0 360 294" role="img" aria-label="세 컷 웹툰: 장병이 독서카페에서 책에 빠지고, 독서포인트가 지역화폐로 바뀌어, 외출 날 동네서점에서 지역화폐로 새 책을 사며 복무 의지가 최고로 높아지는 이야기">
      <defs>
        <pattern id="camo2" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#6b7a4b"/><rect width="3" height="3" fill="#4a5634"/><rect x="4" y="2" width="3" height="2" fill="#8c8a5c"/>
          <rect x="1" y="5" width="3" height="3" fill="#3b4529"/><rect x="6" y="5" width="2" height="2" fill="#a39b6e"/>
        </pattern>
        <pattern id="dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.3" fill="#f2c94c" opacity=".55"/></pattern>
      </defs>
      <!-- ① 독서카페: 책에 빠짐 -->
      ${panel(6, 8, `<rect x="6" y="8" width="${W}" height="${H}" fill="#fff6d6"/><rect x="6" y="8" width="${W}" height="${H}" fill="url(#dots)"/>
        ${shelfRow(92, 92, 11, 1)}`,
        `${caption(6, 8, '①', '독서카페')}
        ${comicSoldier(50, 86, 'wow', 'read')}
        <text x="75" y="64" class="cm-up" style="font-size:20px">!</text>
        ${bubble(84, 16, 88, ['어? 이 책', '완전 재밌는데?!'], 94)}
        ${gauge(6, 8, 0.45, '#e9a93b', '45%')}`)}

      <!-- ② 승인 → 포인트가 지역화폐로 -->
      ${panel(182, 8, `<rect x="182" y="8" width="${W}" height="${H}" fill="#e3f4ea"/><rect x="182" y="8" width="${W}" height="${H}" fill="url(#dots)" opacity=".5"/>`,
        `${caption(182, 8, '②', '포인트 적립')}
        ${comicSoldier(220, 88, 'happy', 'none', 0.95)}
        <g transform="rotate(-10 268 88)">
          <rect x="252" y="61" width="32" height="54" rx="5" fill="#2b2f36" stroke="${INK}" stroke-width="1.8"/>
          <rect x="255" y="66" width="26" height="42" rx="2" fill="#fff"/>
          <text x="268" y="81" text-anchor="middle" class="cm-g" style="font-size:9.5px;fill:#2a9d8f">+100P</text>
          <rect x="257" y="87" width="22" height="13" rx="2" fill="#3a86ff"/>
          <text x="268" y="96.5" text-anchor="middle" class="cm-g" style="font-size:6px;fill:#fff">지역화폐</text>
        </g>
        <circle cx="253" cy="110" r="5" fill="#f6d2b0" stroke="${INK}" stroke-width="1.5"/>
        ${coin(302, 72, 8)}${coin(322, 90, 6.5)}${coin(298, 104, 5.5)}
        ${bubble(256, 14, 92, ['포인트가', '지역화폐로 짠!'], 280)}
        ${gauge(182, 8, 0.75, '#8ab17d', '75%')}`)}

      <!-- ③ 외출 날: 동네서점에서 지역화폐로 새 책 구매 (넓은 칸) -->
      ${panel(6, 150, `<rect x="6" y="150" width="348" height="${H}" fill="#fff0b3"/>${rays(90, 232)}
        ${shelfRow(240, 206, 14, 4)}${shelfRow(240, 232, 14, 6)}
        <path d="M84 172 V180 M124 172 V180" stroke="${INK}" stroke-width="1.2"/>
        <rect x="74" y="180" width="60" height="16" rx="3" fill="#8b5e3c" stroke="${INK}" stroke-width="1.4"/>
        <text x="104" y="191.5" text-anchor="middle" class="cm-g" style="font-size:9.5px;fill:#fff">동네서점</text>`,
        `${caption(6, 150, '③', '외출 날')}
        ${spark(28, 206, 7)}${spark(160, 214, 6)}${spark(222, 182, 5)}
        ${comicSoldier(90, 232, 'happy', 'salute', 1)}
        <text x="146" y="264" class="cm-up" style="font-size:17px">UP!</text>
        ${bubble(138, 158, 124, ['지역화폐로 새 책 득템!', '전역까지 100권!'], 150)}
        <rect x="240" y="242" width="88" height="16" rx="8" fill="#3a86ff" stroke="${INK}" stroke-width="1.4"/>
        <text x="284" y="253.5" text-anchor="middle" class="cm-g" style="font-size:9px;fill:#fff">지역화폐 결제 완료 ✓</text>
        ${gauge(6, 150, 1, '#2a9d8f', 'MAX', 348)}`, 348)}
    </svg>`;
  }

  function viewLogin() {
    const root = render(`
      <div class="hero webtoon">
        <div class="comic-wrap">${loginComic()}</div>
        <h1 class="logo-title"><span>📖</span> 장병 북포인트</h1>
        <p>읽을수록 높아지는 <b>복무 의지</b>, 쌓일수록 늘어나는 <b>독서포인트</b></p>
      </div>
      <form class="card" id="login" autocomplete="on">
        <div class="field">
          <label for="id">휴대폰 번호</label>
          <input class="input" id="id" name="id" inputmode="tel" autocomplete="username" placeholder="010-0000-0000" required>
        </div>
        <div class="field">
          <label for="pw">비밀번호</label>
          <input class="input" id="pw" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="btn block" type="submit">로그인</button>
        <button class="btn ghost block" type="button" id="reset-req" style="margin-top:8px">🔑 비밀번호를 잊으셨나요? <u>비밀번호 초기화 요청</u></button>
      </form>
      <p class="center-link">처음이신가요? <a href="#/signup">가입하기</a></p>
      <a class="guide-link" href="#/guide">📘 처음 오셨나요? <b>이용 안내 보기</b> ›</a>
    `);
    const form = root.querySelector('#login');
    formatPhoneInput(form.id);
    root.querySelector('#reset-req').onclick = () => openResetRequest(form.id.value);
    form.onsubmit = (e) => {
      e.preventDefault();
      submitting(form.querySelector('button'), async () => {
        const data = await api('POST', '/api/login', formData(form));
        me = data.user;
        go(me.mustChangePw ? '#/password' : homeOf());
      });
    };
  }

  const termsHtml = `
    <details class="terms">
      <summary>개인정보 수집·이용 동의 전문 보기</summary>
      <ul>
        <li><b>수집 항목:</b> 이름, 계급, 생년월일, 휴대폰 번호, 지자체 앱 회원 ID, 독서일지 내용</li>
        <li><b>수집 목적:</b> 독서 실적 관리, 지자체 독서포인트(지역화폐) 적립을 위한 명단 전달, 부대 내 랭킹 표시</li>
        <li><b>제3자 제공:</b> 경기도(지자체)에 이름, 생년월일, 휴대폰 번호, 지자체 앱 회원 ID, 인정 건수 제공</li>
        <li><b>보유 기간:</b> 시범 운영 종료 후 지체 없이 파기</li>
        <li><b>동의 거부 권리:</b> 동의를 거부할 수 있으나, 거부 시 서비스 이용 및 포인트 적립이 불가합니다.</li>
      </ul>
    </details>`;

  // 숫자만 입력해도 010-1234-5678 형식으로 '-'가 자동으로 들어간다 (영문이 섞이면 관리자 ID로 보고 그대로 둔다)
  const hyphenPhone = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length > 7) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
    return d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
  };
  function formatPhoneInput(input) {
    input.addEventListener('input', () => {
      if (/[^0-9\-\s]/.test(input.value)) return;
      input.value = hyphenPhone(input.value);
    });
  }

  // 로그인 화면: 비밀번호 초기화 요청 → 관리자 화면에 표시되고, 관리자가 임시 비밀번호를 발급해 전달한다
  function openResetRequest(phone = '') {
    openModal(`
      <h3>비밀번호 초기화 요청</h3>
      <p style="margin:0 0 14px;font-size:14px;color:var(--muted)">가입할 때 입력한 정보를 넣으면 관리자에게 요청이 전달됩니다. 관리자가 확인 후 <b>임시 비밀번호</b>를 알려 드립니다.</p>
      <form id="reset-form">
        <div class="field"><label for="rp">휴대폰 번호</label>
          <input class="input" id="rp" name="phone" inputmode="tel" placeholder="010-0000-0000" value="${esc(/^[0-9\-\s]*$/.test(phone) ? hyphenPhone(phone) : '')}" required></div>
        <div class="field"><label for="rn">이름</label>
          <input class="input" id="rn" name="name" autocomplete="name" required maxlength="20"></div>
        <div class="field"><label for="rb">생년월일</label>
          <input class="input" id="rb" name="birth" type="date" required></div>
        <div class="buttons">
          <button type="button" class="btn secondary" data-cancel>취소</button>
          <button type="submit" class="btn">요청 보내기</button>
        </div>
      </form>
    `, (m) => {
      const f = m.querySelector('#reset-form');
      formatPhoneInput(f.phone);
      m.querySelector('[data-cancel]').onclick = closeModal;
      f.onsubmit = (e) => {
        e.preventDefault();
        submitting(f.querySelector('button[type=submit]'), async () => {
          await api('POST', '/api/password-reset-request', formData(f));
          await alertModal('요청 완료', '비밀번호 초기화 요청을 보냈습니다.<br>관리자가 확인 후 <b>임시 비밀번호</b>를 알려 드립니다.<br><small style="color:var(--muted)">임시 비밀번호로 로그인하면 새 비밀번호로 바꾸라는 안내가 나옵니다.</small>');
        });
      };
    });
  }

  function viewSignup() {
    const root = render(`
      ${topbar('가입하기', { back: '#/login' })}
      <form class="card" id="signup" autocomplete="on">
        <div class="field"><label for="name">이름</label>
          <input class="input" id="name" name="name" autocomplete="name" required maxlength="20"></div>
        <div class="field"><label for="rank">계급</label>
          <select class="input" id="rank" name="rank" required>
            <option value="">선택하세요</option>
            ${meta.ranks.map((r) => `<option>${esc(r)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="birth">생년월일</label>
          <input class="input" id="birth" name="birth" type="date" required max="2015-12-31" min="1950-01-01"></div>
        <div class="field"><label for="phone">휴대폰 번호 <small>(로그인 ID)</small></label>
          <input class="input" id="phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" required></div>
        <div class="field"><label for="localId">지자체 앱 회원 ID</label>
          <input class="input" id="localId" name="localId" required maxlength="50" autocapitalize="off">
          <div class="hint">경기도 "천권으로 독서포인트" 앱의 회원 ID를 입력하세요.</div></div>
        <div class="field"><label for="password">비밀번호</label>
          <input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
          <div class="hint">8자 이상</div></div>
        <div class="field"><label for="password2">비밀번호 확인</label>
          <input class="input" id="password2" name="password2" type="password" autocomplete="new-password" required></div>
        <div class="field">
          <label class="check"><input type="checkbox" name="consent" value="1" required>
            <span><b>(필수)</b> 개인정보 수집·이용 및 제3자(경기도) 제공에 동의합니다.</span></label>
          ${termsHtml}
        </div>
        <button class="btn block" type="submit">가입하기</button>
      </form>
    `);
    const form = root.querySelector('#signup');
    formatPhoneInput(form.phone);
    form.onsubmit = (e) => {
      e.preventDefault();
      const d = formData(form);
      if (d.password !== d.password2) return toast('비밀번호 확인이 일치하지 않습니다.', true);
      submitting(form.querySelector('button[type=submit]'), async () => {
        const data = await api('POST', '/api/signup', { ...d, consent: !!d.consent });
        me = data.user;
        toast('가입이 완료되었습니다.');
        go('#/home');
      });
    };
  }

  function viewPassword() {
    const root = render(`
      ${topbar('비밀번호 변경', { back: homeOf() })}
      ${me.mustChangePw ? '<div class="notice warn">임시 비밀번호로 로그인했습니다. 새 비밀번호로 변경해 주세요.</div>' : ''}
      <form class="card" id="pw">
        <div class="field"><label for="cur">현재 비밀번호</label>
          <input class="input" id="cur" name="current" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="n1">새 비밀번호</label>
          <input class="input" id="n1" name="next" type="password" autocomplete="new-password" minlength="8" required>
          <div class="hint">8자 이상</div></div>
        <div class="field"><label for="n2">새 비밀번호 확인</label>
          <input class="input" id="n2" name="next2" type="password" autocomplete="new-password" required></div>
        <button class="btn block" type="submit">변경하기</button>
      </form>
    `);
    const form = root.querySelector('#pw');
    form.onsubmit = (e) => {
      e.preventDefault();
      submitting(form.querySelector('button'), async () => {
        const data = await api('POST', '/api/me/password', formData(form));
        me = data.user;
        toast('비밀번호가 변경되었습니다.');
        go(homeOf());
      });
    };
  }

  // ── 이용 안내 (로그인 전후 모두) ──────────────────────────────
  const FAQ = [
    ['누가 참여할 수 있나요?', '시범부대 장병이면 누구나 가입할 수 있습니다. 지자체 독서포인트 적립을 위해 경기도 "천권으로 독서포인트" 앱 회원 ID가 필요합니다. 경기도 외 주소지 장병의 적립 허용 여부는 경기도와 협의 중입니다.'],
    ['포인트는 언제 지역화폐로 바뀌나요?', '관리자가 월말에 승인 명단을 지자체에 전달하고, 지자체 기준(현재 매월 15일 전월분 자동 전환)에 따라 지역화폐로 전환됩니다. 실제 적립·전환 내역은 지자체 앱에서 확인하세요.'],
    ['지역화폐는 어디서 쓰나요?', '지역화폐 가맹점으로 등록된 지역서점에서 책을 살 수 있습니다. 외출·휴가 때 부대 근처나 고향의 동네서점을 이용해 보세요.'],
    ['하루에 몇 건까지 인정되나요?', '승인일 기준으로 하루 5건, 한 달 31건(최대 3,100P)까지 인정됩니다. 한도를 넘은 일지는 반려되지 않고 대기 상태로 남았다가 다음 날·다음 달에 승인됩니다.'],
    ['같은 책으로 일지를 여러 번 낼 수 있나요?', '한 권당 일지 1건만 인정됩니다. 반려된 일지는 사유를 확인하고 고쳐서 다시 제출할 수 있습니다.'],
    ['일지가 반려되는 경우는?', '다른 일지와 내용이 같거나, 부적절한 표현이 있거나, 분량이 부족하고 내용이 불충분하면 관리자가 반려합니다.'],
    ['비밀번호를 잊어버렸어요.', '관리자에게 초기화를 요청하면 임시 비밀번호를 받을 수 있습니다. 로그인 후 새 비밀번호로 바꿔 주세요.'],
    ['구매·대출 인증, 리뷰 포인트도 받을 수 있나요?', '이 앱은 부대 독서카페 독서일지만 다룹니다. 도서 구매·대출 인증, 리뷰, 독서행사 등은 "천권으로 독서포인트" 앱에서 직접 참여할 수 있습니다.'],
  ];

  function viewGuide() {
    const back = me ? homeOf() : '#/login';
    const root = render(`
      ${topbar('이용 안내', { back })}
      <section class="hero-card guide-hero">
        <p class="greet"><b>장병 북포인트</b>는</p>
        <p class="tagline">부대 독서카페에서 읽은 책을 독서일지로 남기면, 경기도 "천권으로 독서포인트"와 연계해 지역화폐로 돌려받는 장병 독서 지원 서비스입니다.</p>
        ${heroArt()}
      </section>

      <section class="card">
        <h2>포인트 이렇게 쌓으세요</h2>
        <ol class="guide-steps">
          <li><span class="num">STEP 1</span><b>가입하기</b><p>휴대폰 번호로 가입하고, 경기도 "천권으로" 앱 회원 ID와 개인정보 동의를 입력합니다.</p></li>
          <li><span class="num">STEP 2</span><b>독서카페에서 읽고 일지 쓰기</b><p>부대 독서카페(도서관) 책을 읽고, 책의 도서 코드와 함께 독서일지를 50~200자로 씁니다.</p></li>
          <li><span class="num">STEP 3</span><b>관리자 승인 → 포인트 적립</b><p>관리자가 읽고 승인하면 1건당 100P가 적립 예정 포인트로 쌓입니다.</p></li>
          <li><span class="num">STEP 4</span><b>지역화폐로 새 책 구매</b><p>월말 명단이 지자체에 전달되면 지역화폐로 전환되어, 외출·휴가 때 지역서점에서 새 책을 살 수 있습니다.</p></li>
        </ol>
      </section>

      <section class="card">
        <h2>적립 기준</h2>
        <table class="preview">
          <thead><tr><th>항목</th><th class="num">포인트</th><th class="num">한도</th></tr></thead>
          <tbody>
            <tr><td>독서일지 (승인 1건)</td><td class="num">${meta.points}P</td><td class="num">일 ${meta.dailyLimit}건 · 월 ${meta.monthlyLimit}건</td></tr>
            <tr><td>월 최대</td><td class="num">${num(meta.points * meta.monthlyLimit)}P</td><td class="num">승인일 기준</td></tr>
          </tbody>
        </table>
        <ul class="guide-rules">
          <li>일지 분량: ${meta.minLen}자 이상 ${meta.maxLen}자 이하 (공백 포함)</li>
          <li>책 1권당 일지 1건만 인정 · 부대 도서 목록에 있는 책만 가능</li>
          <li>포인트는 <b>승인일</b>이 속한 달의 실적으로 계산 (예: 10/31 제출, 11/2 승인 → 11월)</li>
          <li>앱의 포인트는 <b>적립 예정</b> 포인트이며, 실제 적립은 지자체 앱에서 확인</li>
        </ul>
      </section>

      <section class="card" id="faq">
        <h2>자주 묻는 질문</h2>
        ${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
      </section>

      ${me ? '' : `<div class="bottom-bar"><div class="inner">
        <button class="btn secondary" data-go="#/login">로그인</button>
        <button class="btn" data-go="#/signup">가입하기</button>
      </div></div>`}
    `);
    if (location.hash === '#/guide/faq') root.querySelector('#faq').scrollIntoView();
  }

  // ── 공지사항 ──────────────────────────────────────────────────
  async function viewNotices(seq) {
    render(`${topbar('공지사항', { back: homeOf() })}<div class="loading">불러오는 중...</div>`);
    const { notices } = await api('GET', '/api/notices');
    if (seq !== renderSeq) return;
    const open = Number(sessionStorage.getItem('openNotice')) || notices[0]?.id;
    sessionStorage.removeItem('openNotice');
    render(`
      ${topbar('공지사항', { back: homeOf() })}
      ${notices.length ? notices.map((n) => `
        <details class="card notice-item" ${n.id === open ? 'open' : ''}>
          <summary>${n.important ? '<span class="badge rejected">중요</span> ' : ''}<b>${esc(n.title)}</b><div class="sub">${fmtDate(n.createdAt)}</div></summary>
          <div class="notice-body">${esc(n.body)}</div>
        </details>`).join('') : '<div class="card empty">공지사항이 없습니다.</div>'}
    `);
  }

  // 경기도 "천권으로 독서포인트" (실제 적립·전환 확인, 지역화폐 등록)
  const CHEONGWON_URL = 'https://www.library.kr/bookpoint/main/homemain';

  // 독서 배지: 누적 승인 권수 기준 (복무 중 100권 목표)
  const BADGES = [[1, '🌱', '첫 권'], [10, '📗', '10권'], [30, '🎖️', '30권'], [50, '🏅', '50권'], [100, '🏆', '100권']];
  const READING_GOAL = 100;

  // ── S1. 메인 대시보드 ─────────────────────────────────────────
  const SPINE_COLORS = ['#e76f51', '#2a9d8f', '#e9a93b', '#457b9d', '#8ab17d', '#b5838d', '#264653', '#f4a261'];

  // 병영 독서카페(생활관)에서 읽기 → 인식표 포인트 → 지역화폐 → 외출 때 동네서점에서 새 책
  function heroArt() {
    const windows = [22, 41, 60, 98, 117, 136]
      .map((x) => `<rect x="${x}" y="70" width="13" height="11" rx="1" fill="#a9c6d6" stroke="#7d6e4c" stroke-width="1.2"/>`).join('');
    const fence = [178, 190].map((x) => `<rect x="${x}" y="108" width="3" height="34" fill="#5a5a4a"/>`).join('')
      + [114, 124, 134].map((y) => `<path d="M174 ${y} H196" stroke="#8a8a78" stroke-width="1.2"/>`).join('')
      + [[176, 114], [186, 124], [194, 114], [180, 134], [192, 134]].map(([x, y]) => `<path d="M${x - 2} ${y - 2} l4 4 M${x + 2} ${y - 2} l-4 4" stroke="#8a8a78" stroke-width="1"/>`).join('');
    return `
    <svg class="hero-art" viewBox="0 0 360 150" role="img" aria-label="부대 생활관 독서카페 앞에서 장병이 책을 읽고, 인식표 모양 포인트를 지역화폐로 바꿔 외출 때 동네서점에서 새 책을 사는 그림">
      <defs>
        <pattern id="camo" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#6b7a4b"/><rect width="3" height="3" fill="#4a5634"/><rect x="4" y="2" width="3" height="2" fill="#8c8a5c"/>
          <rect x="1" y="5" width="3" height="3" fill="#3b4529"/><rect x="6" y="5" width="2" height="2" fill="#a39b6e"/>
        </pattern>
      </defs>
      <!-- 산과 부대 -->
      <path d="M0 112 L34 74 L58 96 L98 52 L138 90 L160 72 L176 86 L176 142 L0 142 Z" fill="rgba(0,0,0,.16)"/>
      <rect x="0" y="140" width="360" height="4" fill="rgba(0,0,0,.18)"/>
      <path d="M8 62 L18 48 H158 L168 62 Z" fill="#55663a"/>
      <rect x="14" y="62" width="148" height="58" fill="#ddd3b2"/>
      <rect x="14" y="62" width="148" height="4" fill="#c4b994"/>
      ${windows}
      <rect x="77" y="98" width="22" height="22" fill="#6b5a3a"/><circle cx="95" cy="110" r="1.3" fill="#e9c46a"/>
      <rect x="44" y="49.5" width="88" height="11" rx="2" fill="#2f3d22" stroke="#c4b994" stroke-width=".8"/>
      <text x="88" y="58" text-anchor="middle" font-size="7.5" font-weight="700" fill="#f6e7b0">생활관 · 병영 독서카페</text>
      <!-- 태극기 -->
      <path d="M150 48 V14" stroke="#d8d8d8" stroke-width="2"/>
      <rect x="151" y="14" width="24" height="16" fill="#fff"/>
      <path d="M158.5 22 a4.5 4.5 0 0 1 9 0 a2.25 2.25 0 0 1 -4.5 0 a2.25 2.25 0 0 0 -4.5 0 z" fill="#cd2e3a"/>
      <path d="M158.5 22 a4.5 4.5 0 0 0 9 0 a2.25 2.25 0 0 1 -4.5 0 a2.25 2.25 0 0 0 -4.5 0 z" fill="#0047a0"/>
      <path d="M153.5 16.5 l3 2 M170 16.5 l-3 2 M153.5 27.5 l3 -2 M170 27.5 l-3 -2" stroke="#000" stroke-width="1.6"/>
      <!-- 벤치에서 책 읽는 장병 (전투복·전투모) -->
      <rect x="22" y="126" width="70" height="4" rx="2" fill="#7a5a3a"/>
      <rect x="27" y="130" width="3" height="12" fill="#5c4329"/><rect x="84" y="130" width="3" height="12" fill="#5c4329"/>
      <path d="M44 127 L44 106 Q44 97 56 97 Q68 97 68 106 L68 127 Z" fill="url(#camo)"/>
      <rect x="43" y="122" width="26" height="6" rx="2" fill="url(#camo)"/>
      <rect x="45" y="127" width="9" height="12" fill="url(#camo)"/><rect x="58" y="127" width="9" height="12" fill="url(#camo)"/>
      <rect x="43" y="138" width="12" height="4" rx="1.5" fill="#1f1f1f"/><rect x="57" y="138" width="12" height="4" rx="1.5" fill="#1f1f1f"/>
      <circle cx="56" cy="89" r="8.5" fill="#f0c8a0"/>
      <path d="M47 87 V80 Q56 76 65 80 V87 Z" fill="url(#camo)"/>
      <rect x="46" y="85.5" width="21" height="2.6" rx="1.3" fill="#3b4529"/>
      <path d="M52 92 h2.5 M58 92 h2.5" stroke="#6b4a32" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M44 104 L56 100 L68 104 L68 117 L56 113 L44 117 Z" fill="#a33b2b"/>
      <path d="M45.5 104 L56 101.5 L56 113 L45.5 116 Z" fill="#fff"/><path d="M66.5 104 L56 101.5 L56 113 L66.5 116 Z" fill="#eef0ea"/>
      <circle cx="45" cy="111" r="2.6" fill="#f0c8a0"/><circle cx="67" cy="111" r="2.6" fill="#f0c8a0"/>
      <path d="M118 142 l8 -26 l8 26 z M121 132 l5 -16 l5 16 z" fill="#3e5a2c"/>
      ${fence}
      <!-- 인식표(군번줄) 모양 포인트 → 지역화폐 -->
      <path d="M160 40 H186" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 4" stroke-linecap="round"/>
      <path d="M184 35 l6 5 -6 5" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M212 34 Q206 18 196 30" stroke="#cfd5da" stroke-width="2" stroke-dasharray="1.5 2.2" fill="none" stroke-linecap="round"/>
      <g transform="rotate(8 212 56)">
        <rect x="197" y="34" width="30" height="44" rx="9" fill="#d5dade" stroke="#8f969c" stroke-width="2"/>
        <circle cx="212" cy="41" r="2.4" fill="#4b5a35"/>
        <text x="212" y="59" text-anchor="middle" font-size="10" font-weight="800" fill="#3b4529">+100</text>
        <text x="212" y="69" text-anchor="middle" font-size="6.5" font-weight="700" fill="#5a6470">POINT</text>
      </g>
      <path d="M210 84 V93" stroke="#fff" stroke-width="2.5" stroke-dasharray="3 3" stroke-linecap="round"/>
      <g transform="rotate(-8 210 112)">
        <rect x="188" y="97" width="46" height="30" rx="5" fill="#3a86ff"/>
        <rect x="193" y="103" width="9" height="6" rx="1.5" fill="#ffe08a"/>
        <text x="211" y="121" text-anchor="middle" font-size="8" font-weight="700" fill="#fff">지역화폐</text>
      </g>
      <path d="M238 112 H252" stroke="#fff" stroke-width="2.5" stroke-dasharray="4 4" stroke-linecap="round"/>
      <path d="M250 107 l6 5 -6 5" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- 외출 때 들르는 동네서점 -->
      <text x="309" y="31" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">외출 · 동네서점</text>
      <rect x="262" y="48" width="94" height="94" rx="4" fill="#fff"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${258 + i * 20.4}" y="37" width="20.4" height="16" fill="${i % 2 ? '#fff' : '#e76f51'}"/><circle cx="${268.2 + i * 20.4}" cy="53" r="10.2" fill="${i % 2 ? '#fff' : '#e76f51'}"/>`).join('')}
      <rect x="270" y="74" width="46" height="34" rx="3" fill="#dcecf7"/>
      ${[[274, 14], [281, 18], [288, 12], [295, 16], [302, 18], [309, 13]].map(([x, h], i) => `<rect x="${x}" y="${104 - h}" width="5.5" height="${h}" fill="${SPINE_COLORS[(i + 1) % SPINE_COLORS.length]}"/>`).join('')}
      <rect x="324" y="86" width="24" height="56" rx="2" fill="#8b5e3c"/>
      <circle cx="343" cy="115" r="1.8" fill="#f6c445"/>
      <path d="M274 142 v-18 h14 v18" fill="#2a9d8f"/><path d="M277 124 q4 -7 8 0" stroke="#264653" stroke-width="1.6" fill="none"/>
      <path d="M240 50 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 z" fill="#ffe08a"/>
    </svg>`;
  }

  async function viewHome(seq) {
    render(`${topbar('장병 북포인트')}<div class="loading">불러오는 중...</div>`);
    const d = await api('GET', '/api/dashboard');
    if (seq !== renderSeq) return;
    const [y, m] = d.month.split('-');
    const pct = Math.min(100, Math.round((d.me.approved / d.me.monthlyLimit) * 100));
    // 이번 달 어디까지 왔는지: 0 읽기 → 1 일지 제출 → 2 포인트 적립 → 3 지역화폐로 새 책
    const stage = d.me.approved > 0 ? 3 : d.me.submitted > 0 || d.me.pending > 0 ? 2 : 1;
    const steps = [['📖', '병영 독서카페<br>에서 읽기'], ['✍️', '독서일지<br>제출'], ['🎖️', '포인트<br>적립'], ['🛍️', '외출 때<br>새 책 구매']];
    const stageNote = [
      '',
      '책을 다 읽었다면 독서일지를 써 보세요. 승인되면 1건당 100P가 쌓입니다.',
      '일지가 관리자 확인을 기다리고 있어요. 승인되면 포인트가 쌓입니다.',
      '월말에 승인 명단이 지자체에 전달되면, 지자체 앱에서 지역화폐로 받아 외출·휴가 때 동네서점에서 새 책을 살 수 있어요.',
    ][stage];
    const root = render(`
      ${topbar('장병 북포인트', { right: `<button class="link-btn" data-go="#/password">비밀번호</button><button class="link-btn" data-logout>로그아웃</button>` })}
      ${me.mustChangePw ? '<div class="notice warn">임시 비밀번호를 사용 중입니다. <a href="#/password">비밀번호 변경하기 ›</a></div>' : ''}
      ${d.notices.length ? `<div class="notice-banner">${d.notices.map((n, i) => `
        <button class="${i === 0 ? 'show' : ''}" data-notice="${n.id}">${n.important ? '<span class="badge rejected">중요</span>' : '<span class="badge pending">공지</span>'}
          <span class="t">${esc(n.title)}</span><span class="arrow">›</span></button>`).join('')}</div>` : ''}

      <section class="hero-card">
        <p class="greet">충성! <b>${esc(me.displayName)}</b>님,<br>오늘 일과 후엔 독서카페에서 한 권 어떻습니까?</p>
        <p class="tagline">읽은 책이 지역화폐가 되고, 지역화폐가 다시 새 책이 됩니다</p>
        ${heroArt()}
        <ol class="journey">
          ${steps.map(([ic, t], i) => `<li class="step ${i < stage ? 'done' : i === stage ? 'next' : ''}"><span class="ic">${ic}</span>${t}</li>`).join('')}
        </ol>
        <p class="journey-note">${stageNote}</p>
      </section>

      <section class="money-card" aria-label="나의 적립 예정 포인트">
        <div class="mc-top"><span class="mc-brand">★ 장병 BOOK POINT</span><span class="mc-tag">지역화폐 전환 예정</span></div>
        <div class="mc-chip"></div>
        <div class="mc-label">${Number(m)}월 적립 예정</div>
        <div class="mc-amount">${num(d.me.monthPoints)}<span>P</span></div>
        <div class="mc-bottom"><span>누적 ${num(d.me.totalPoints)}P</span><span>${esc(me.displayName)}</span></div>
      </section>
      <p class="mc-note">※ 승인 기준 적립 예정 포인트입니다. 지자체 실제 적립은 지자체 앱에서 확인하세요.</p>

      <a class="ext-card" href="${CHEONGWON_URL}" target="_blank" rel="noopener noreferrer">
        <span class="ext-ic">🍁</span>
        <span class="ext-body"><b>천권으로 독서포인트 바로가기</b>
          <small>경기도 공식 사이트 · 실제 적립·지역화폐 전환 확인</small></span>
        <span class="ext-arrow">↗</span>
      </a>

      <nav class="quick-menu">
        <button data-go="#/write"><span>✍️</span>일지 쓰기</button>
        <button data-go="#/my"><span>📝</span>내 일지</button>
        <button data-go="#/notices"><span>📢</span>공지사항</button>
        <button data-go="#/guide"><span>📘</span>이용 안내</button>
      </nav>

      <section class="card">
        <h2>📚 지금까지 읽은 책 <small>복무 중 목표 ${READING_GOAL}권</small></h2>
        <div class="progress" style="margin-top:0">
          <div class="meta"><span>승인된 독서일지 기준</span><span><b style="color:var(--green);font-size:18px">${d.me.totalBooks}권</b> / ${READING_GOAL}권</span></div>
          <div class="bar"><i style="width:${Math.min(100, (d.me.totalBooks / READING_GOAL) * 100)}%"></i></div>
        </div>
        <div class="badges">
          ${BADGES.map(([n, ic, label]) => `<div class="badge-item ${d.me.totalBooks >= n ? 'on' : ''}"><span>${ic}</span>${label}</div>`).join('')}
        </div>
        ${(() => {
          const nextBadge = BADGES.find(([n]) => d.me.totalBooks < n);
          return nextBadge ? `<p class="badge-next">다음 배지 <b>${nextBadge[2]}</b>까지 <b>${nextBadge[0] - d.me.totalBooks}권</b> 남았습니다.</p>` : '<p class="badge-next">모든 배지를 모았습니다! 🎉</p>';
        })()}
      </section>

      <section class="card">
        <h2>나의 독서활동 <small>${y}년 ${Number(m)}월</small></h2>
        <div class="stat-row">
          <div><div class="num">${d.me.submitted}</div><div class="lbl">제출</div></div>
          <div><div class="num" style="color:var(--amber)">${d.me.pending}</div><div class="lbl">대기</div></div>
          <div><div class="num" style="color:var(--green)">${d.me.approved}</div><div class="lbl">승인</div></div>
          <div><div class="num" style="color:var(--red)">${d.me.rejected}</div><div class="lbl">반려</div></div>
        </div>
        <div class="progress">
          <div class="meta"><span>월 한도 진행률</span><span><b>${d.me.approved}</b> / ${d.me.monthlyLimit}건</span></div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>
      </section>

      <section class="card">
        <h2>이달의 활동 랭킹 TOP 10 <small>승인 건수</small></h2>
        ${d.ranking.length ? `<ol class="rank-list">${d.ranking.map((r) => `
          <li class="${r.isMe ? 'me' : ''}"><span class="pos">${r.rank}</span>
            <span class="who">${esc(r.displayName)}${r.isMe ? ' (나)' : ''}${r.isSample ? ' <span class="sample-tag">샘플</span>' : ''}</span>
            <span class="cnt">${r.count}건</span></li>`).join('')}</ol>`
          : '<div class="empty">아직 이번 달 승인된 일지가 없습니다.<br>첫 번째 주인공이 되어 보세요!</div>'}
        ${d.myRank && d.myRank > 10 ? `<div class="my-rank">나의 순위: <b>${d.myRank}위</b></div>` : ''}
        ${!d.myRank && d.ranking.length ? '<div class="my-rank">이번 달 승인 1건부터 순위에 오릅니다.</div>' : ''}
      </section>

      ${d.popularBooks.length ? `<section class="card">
        <h2>🔥 독서활동 인기도서 <small>승인 일지 수</small></h2>
        <ol class="popular-list">${d.popularBooks.map((b, i) => `
          <li><span class="cover" style="background:${SPINE_COLORS[i % SPINE_COLORS.length]}">${i + 1}</span>
            <span class="who">${esc(b.title)}</span><span class="cnt">${b.count}명</span></li>`).join('')}</ol>
      </section>` : ''}

      <section class="card">
        <h2>☕ 이번 달 부대 독서카페 현황</h2>
        <div class="stat-row three">
          <div><div class="num">${num(d.unit.approved)}</div><div class="lbl">승인 일지</div></div>
          <div><div class="num">${num(d.unit.participants)}</div><div class="lbl">참여 장병</div></div>
          <div><div class="num">${num(d.unit.approved * meta.points)}</div><div class="lbl">적립 예정 P</div></div>
        </div>
        ${d.unit.recentBooks.length ? `<div class="shelf-title">최근 승인된 책</div>
          <div class="shelf">${d.unit.recentBooks.map((t, i) => `<span class="spine" title="${esc(t)}" style="background:${SPINE_COLORS[i % SPINE_COLORS.length]};height:${[118, 104, 124, 98, 112][i % 5]}px">${esc(t)}</span>`).join('')}<span class="shelf-deco">🪴</span></div>` : ''}
      </section>
      ${d.sampleSoldiers ? `<p class="mc-note">※ 이해를 돕기 위해 샘플 장병 ${d.sampleSoldiers}명의 기록이 포함되어 있습니다. 정식 운영 전에 삭제됩니다.</p>` : ''}

      <div class="bottom-bar"><div class="inner">
        <button class="btn secondary" data-go="#/my">내 일지 목록</button>
        <button class="btn" data-go="#/write">독서일지 쓰기</button>
      </div></div>
    `);

    // 공지 배너: 클릭하면 해당 공지를 펼친 채로 공지사항 화면 이동, 여러 건이면 4초마다 순환
    const banners = [...root.querySelectorAll('[data-notice]')];
    banners.forEach((b) => {
      b.onclick = () => { sessionStorage.setItem('openNotice', b.dataset.notice); go('#/notices'); };
    });
    if (banners.length > 1) {
      let cur = 0;
      const timer = setInterval(() => {
        if (seq !== renderSeq || !root.isConnected) return clearInterval(timer);
        banners[cur].classList.remove('show');
        cur = (cur + 1) % banners.length;
        banners[cur].classList.add('show');
      }, 4000);
    }
  }

  // ── S2. 독서일지 작성 / 재제출 ────────────────────────────────
  async function viewWrite(seq, editId) {
    render(`${topbar(editId ? '일지 수정·재제출' : '독서일지 쓰기', { back: editId ? '#/my' : '#/home' })}<div class="loading">불러오는 중...</div>`);
    const [{ journals }, edit] = await Promise.all([
      api('GET', '/api/journals'),
      editId ? api('GET', `/api/journals/${editId}`).then((r) => r.journal) : null,
    ]);
    if (seq !== renderSeq) return;
    if (edit && edit.status !== 'rejected') {
      toast('반려된 일지만 수정할 수 있습니다.', true);
      return go('#/my');
    }
    // 같은 책(대기·승인) 중복 여부를 입력 즉시 안내하기 위한 목록
    const usedCodes = new Set(journals.filter((j) => j.status !== 'rejected' && j.id !== edit?.id).map((j) => j.bookCode.toUpperCase()));

    const root = render(`
      ${topbar(editId ? '일지 수정·재제출' : '독서일지 쓰기', { back: editId ? '#/my' : '#/home' })}
      ${edit ? `<div class="notice err"><b>반려 사유:</b> ${esc(edit.rejectReason)}</div>` : ''}
      <form class="card" id="write">
        <div class="field"><label for="code">도서 코드</label>
          <input class="input" id="code" name="bookCode" autocomplete="off" autocapitalize="characters" placeholder="책 뒷면·라벨의 도서 코드" value="${esc(edit?.bookCode)}" required>
          <div class="hint" id="code-hint">부대 도서관 책에 붙은 코드를 입력하세요.</div></div>
        <div class="field"><label for="title">책 제목</label>
          <input class="input" id="title" name="title" maxlength="100" value="${esc(edit?.title)}" required></div>
        <div class="field"><label for="content">독서일지</label>
          <textarea class="input" id="content" name="content" placeholder="책을 읽고 느낀 점, 기억에 남는 문장 등을 ${meta.minLen}~${meta.maxLen}자로 적어 주세요.">${esc(edit?.content)}</textarea>
          <div class="counter" id="counter"></div></div>
      </form>
      <div class="bottom-bar"><div class="inner">
        <button class="btn" id="submit" disabled>${edit ? '수정해서 다시 제출' : '제출하기'}</button>
      </div></div>
    `);
    const form = root.querySelector('#write');
    const hint = root.querySelector('#code-hint');
    const counter = root.querySelector('#counter');
    const submit = root.querySelector('#submit');
    const state = { book: null, dup: false, autoTitle: '' };

    function refresh() {
      const n = countChars(form.content.value);
      const okLen = n >= meta.minLen && n <= meta.maxLen;
      counter.textContent = `${n} / ${meta.maxLen}자${n < meta.minLen ? ` (최소 ${meta.minLen}자)` : ''}`;
      counter.className = `counter ${okLen ? 'good' : n ? 'bad' : ''}`;
      submit.disabled = !(state.book && !state.dup && okLen && form.title.value.trim());
    }

    let lookupTimer;
    let lookupSeq = 0;
    async function lookup() {
      const code = form.bookCode.value.trim();
      state.book = null;
      state.dup = false;
      refresh();
      if (!code) { hint.className = 'hint'; hint.textContent = '부대 도서관 책에 붙은 코드를 입력하세요.'; return; }
      const my = ++lookupSeq;
      hint.className = 'hint';
      hint.textContent = '도서 목록 확인 중...';
      try {
        const { book } = await api('GET', `/api/books/${encodeURIComponent(code)}`);
        if (my !== lookupSeq) return;
        state.book = book;
        state.dup = usedCodes.has(book.code.toUpperCase());
        if (state.dup) {
          hint.className = 'hint err';
          hint.textContent = '이미 이 책으로 제출한 일지가 있습니다.';
        } else {
          hint.className = 'hint ok';
          hint.textContent = `✓ 도서 목록 확인: ${book.title}`;
          if (!form.title.value.trim() || form.title.value === state.autoTitle) {
            form.title.value = book.title;
            state.autoTitle = book.title;
          }
        }
      } catch (err) {
        if (my !== lookupSeq) return;
        hint.className = 'hint err';
        hint.textContent = err.status === 404 ? '부대 도서 목록에 없는 코드입니다.' : err.message;
      }
      refresh();
    }

    form.bookCode.addEventListener('input', () => { clearTimeout(lookupTimer); lookupTimer = setTimeout(lookup, 300); });
    form.title.addEventListener('input', refresh);
    form.content.addEventListener('input', refresh);
    form.onsubmit = (e) => { e.preventDefault(); if (!submit.disabled) submit.click(); };
    if (form.bookCode.value) lookup(); else refresh();

    submit.onclick = () => submitting(submit, async () => {
      const body = formData(form);
      if (edit) await api('PUT', `/api/journals/${edit.id}`, body);
      else await api('POST', '/api/journals', body);
      await alertModal('제출 완료', '관리자 확인 후 승인됩니다.<br>승인되면 적립 예정 포인트에 반영됩니다.');
      go('#/home');
    });
  }

  // ── S3. 내 일지 목록 ──────────────────────────────────────────
  async function viewMy(seq) {
    render(`${topbar('내 일지 목록', { back: '#/home' })}<div class="loading">불러오는 중...</div>`);
    const { journals } = await api('GET', '/api/journals');
    if (seq !== renderSeq) return;
    let filter = sessionStorage.getItem('myFilter') || 'all';

    function draw() {
      const list = filter === 'all' ? journals : journals.filter((j) => j.status === filter);
      const count = (s) => journals.filter((j) => j.status === s).length;
      const root = render(`
        ${topbar('내 일지 목록', { back: '#/home' })}
        <div class="tabs">
          ${[['all', `전체 ${journals.length}`], ['pending', `대기 ${count('pending')}`], ['approved', `승인 ${count('approved')}`], ['rejected', `반려 ${count('rejected')}`]]
            .map(([k, l]) => `<button class="tab ${filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
        </div>
        ${list.length ? list.map((j) => `
          <article class="card journal">
            <div class="head">
              <div><div class="title">${esc(j.title)}</div>
                <div class="sub">${esc(j.bookCode)} · 제출 ${fmtDate(j.submittedAt)}${j.approvedAt ? ` · 승인 ${fmtDate(j.approvedAt)}` : ''}</div></div>
              <span class="badge ${j.status}">${STATUS[j.status]}</span>
            </div>
            <div class="content">${esc(j.content)}</div>
            ${j.status === 'rejected' ? `
              <div class="reason"><b>반려 사유:</b> ${esc(j.rejectReason)}</div>
              <div class="actions"><button class="btn small" data-go="#/write/${j.id}">수정해서 다시 제출</button></div>` : ''}
          </article>`).join('') : '<div class="card empty">해당하는 일지가 없습니다.</div>'}
        <div class="bottom-bar"><div class="inner"><button class="btn" data-go="#/write">독서일지 쓰기</button></div></div>
      `);
      root.querySelectorAll('[data-filter]').forEach((b) => {
        b.onclick = () => { filter = b.dataset.filter; sessionStorage.setItem('myFilter', filter); draw(); };
      });
    }
    draw();
  }

  // ── 관리자 공통 ───────────────────────────────────────────────
  function adminHeader(active) {
    return `
      ${topbar('관리자', { right: `<button class="link-btn" data-go="#/password">비밀번호</button><button class="link-btn" data-logout>로그아웃</button>` })}
      ${me.mustChangePw ? '<div class="notice warn">초기 비밀번호를 사용 중입니다. <a href="#/password">비밀번호 변경하기 ›</a></div>' : ''}
      <div class="tabs">
        ${[['#/admin', '승인 대기'], ['#/admin/export', '명단 내보내기'], ['#/admin/soldiers', '장병 관리'], ['#/admin/notices', '공지 관리']]
          .map(([h, l]) => `<button class="tab ${active === h ? 'active' : ''}" data-go="${h}">${l}</button>`).join('')}
      </div>`;
  }

  // ── S4. 승인 대기 목록 ────────────────────────────────────────
  async function viewAdminPending(seq) {
    render(`${adminHeader('#/admin')}<div class="loading">불러오는 중...</div>`);
    const d = await api('GET', '/api/admin/pending');
    if (seq !== renderSeq) return;
    const selected = new Set();

    const root = render(`
      ${adminHeader('#/admin')}
      ${d.resetRequests ? `<div class="notice warn">🔑 비밀번호 초기화 요청 <b>${d.resetRequests}건</b>이 있습니다. <a href="#/admin/soldiers">장병 관리에서 처리하기 ›</a></div>` : ''}
      ${d.journals.length ? `
        <div class="select-all">
          <label><input type="checkbox" id="all"> 전체 선택</label>
          <span style="color:var(--muted)">대기 ${d.journals.length}건</span>
        </div>
        ${d.journals.map((j) => {
          const dayFull = j.todayApproved >= d.dailyLimit;
          const monthFull = j.monthApproved >= d.monthlyLimit;
          return `
          <article class="card journal">
            <div class="admin-item">
              <input type="checkbox" data-id="${j.id}" aria-label="선택">
              <div class="body">
                <div class="head">
                  <div><div class="title">${esc(j.displayName)} ${j.isSample ? '<span class="sample-tag">샘플</span>' : `<small style="color:var(--muted);font-weight:400">(${esc(j.phoneTail)})</small>`}</div>
                    <div class="sub">${esc(j.title)} · ${esc(j.bookCode)} · 제출 ${fmtDateTime(j.submittedAt)}</div></div>
                </div>
                <div>
                  <span class="limit-chip ${dayFull ? 'full' : ''}">오늘 ${j.todayApproved}/${d.dailyLimit}</span>
                  <span class="limit-chip ${monthFull ? 'full' : ''}">이번 달 ${j.monthApproved}/${d.monthlyLimit}</span>
                </div>
                <div class="content">${esc(j.content)}</div>
                <div class="actions"><button class="btn danger small" data-reject="${j.id}">반려</button></div>
              </div>
            </div>
          </article>`;
        }).join('')}` : '<div class="card empty">승인 대기 중인 일지가 없습니다.</div>'}
      <div class="bottom-bar"><div class="inner">
        <button class="btn" id="approve" disabled>선택 승인 (0)</button>
      </div></div>
    `);

    const boxes = [...root.querySelectorAll('[data-id]')];
    const all = root.querySelector('#all');
    const approveBtn = root.querySelector('#approve');
    const sync = () => {
      approveBtn.textContent = `선택 승인 (${selected.size})`;
      approveBtn.disabled = selected.size === 0;
      if (all) all.checked = selected.size > 0 && selected.size === boxes.length;
    };
    boxes.forEach((b) => {
      b.onchange = () => { if (b.checked) selected.add(Number(b.dataset.id)); else selected.delete(Number(b.dataset.id)); sync(); };
    });
    if (all) {
      all.onchange = () => {
        boxes.forEach((b) => { b.checked = all.checked; if (all.checked) selected.add(Number(b.dataset.id)); else selected.delete(Number(b.dataset.id)); });
        sync();
      };
    }

    approveBtn.onclick = () => submitting(approveBtn, async () => {
      const r = await api('POST', '/api/admin/approve', { ids: [...selected] });
      let msg = `<b>${r.approved}건</b> 승인`;
      if (r.held) msg += `, 한도 초과로 <b>${r.held}건</b> 대기 유지`;
      if (r.skipped) msg += `<br><small>(이미 처리된 ${r.skipped}건 제외)</small>`;
      await alertModal('승인 결과', msg);
      route();
    });

    root.querySelectorAll('[data-reject]').forEach((b) => {
      b.onclick = () => openRejectModal(Number(b.dataset.reject));
    });
  }

  function openRejectModal(id) {
    openModal(`
      <h3>반려 사유 선택</h3>
      <form id="reject">
        ${meta.rejectReasons.map((r, i) => `<label class="radio"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${esc(r)}</label>`).join('')}
        <label class="radio"><input type="radio" name="reason" value="__etc"> 기타(직접 입력)</label>
        <textarea class="input" name="etc" placeholder="반려 사유를 입력하세요" style="min-height:80px;margin-top:10px;display:none" maxlength="200"></textarea>
        <div class="buttons">
          <button type="button" class="btn secondary" data-cancel>취소</button>
          <button type="submit" class="btn" style="background:var(--red)">반려하기</button>
        </div>
      </form>
    `, (m) => {
      const form = m.querySelector('#reject');
      form.querySelectorAll('input[name=reason]').forEach((r) => {
        r.onchange = () => { form.etc.style.display = form.reason.value === '__etc' ? 'block' : 'none'; if (form.reason.value === '__etc') form.etc.focus(); };
      });
      m.querySelector('[data-cancel]').onclick = closeModal;
      form.onsubmit = (e) => {
        e.preventDefault();
        const reason = form.reason.value === '__etc' ? form.etc.value.trim() : form.reason.value;
        if (!reason) return toast('반려 사유를 입력해 주세요.', true);
        submitting(form.querySelector('button[type=submit]'), async () => {
          await api('POST', '/api/admin/reject', { id, reason });
          closeModal();
          toast('반려 처리했습니다.');
          route();
        });
      };
    });
  }

  // ── S5. 명단 내보내기 ─────────────────────────────────────────
  async function viewAdminExport(seq, month) {
    render(`${adminHeader('#/admin/export')}<div class="loading">불러오는 중...</div>`);
    const d = await api('GET', `/api/admin/export${month ? `?month=${encodeURIComponent(month)}` : ''}`);
    if (seq !== renderSeq) return;
    const root = render(`
      ${adminHeader('#/admin/export')}
      <section class="card">
        <div class="field" style="margin-bottom:0"><label for="month">대상 월 (승인일 기준)</label>
          <select class="input" id="month">${d.months.map((m) => `<option value="${m}" ${m === d.month ? 'selected' : ''}>${m.replace('-', '년 ')}월</option>`).join('')}</select></div>
      </section>
      <section class="card">
        <h2>미리보기 <small>${d.total.soldiers}명</small></h2>
        ${d.rows.length ? `
          <table class="preview">
            <thead><tr><th>장병</th><th class="num">인정 건수</th><th class="num">적립 예정 P</th></tr></thead>
            <tbody>${d.rows.map((r) => `<tr><td>${esc(r.rank)} ${esc(r.name)}</td><td class="num">${r.count}</td><td class="num">${num(r.points)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>합계</td><td class="num">${num(d.total.count)}</td><td class="num">${num(d.total.points)}</td></tr></tfoot>
          </table>` : '<div class="empty">이 달에 승인된 일지가 없습니다.</div>'}
      </section>
      ${d.sampleExcluded ? `<div class="notice warn">샘플 데이터의 승인 일지 ${num(d.sampleExcluded)}건은 명단에서 제외했습니다.</div>` : ''}
      <div class="notice info">엑셀 컬럼: 이름, 계급, 생년월일, 휴대폰 번호, 지자체 앱 회원 ID, 인정 건수, 적립 예정 포인트, 대상 월</div>
      <div class="bottom-bar"><div class="inner">
        ${d.rows.length
          ? `<a class="btn" href="/api/admin/export.xlsx?month=${encodeURIComponent(d.month)}" download>엑셀 내려받기</a>`
          : '<button class="btn" disabled>엑셀 내려받기</button>'}
      </div></div>
    `);
    root.querySelector('#month').onchange = (e) => viewAdminExport(++renderSeq, e.target.value).catch(handleError);
  }

  // ── 장병 관리 (비밀번호 초기화) ───────────────────────────────
  async function viewAdminSoldiers(seq) {
    const root = render(`
      ${adminHeader('#/admin/soldiers')}
      <section class="card">
        <div class="field" style="margin-bottom:0"><label for="q">장병 검색</label>
          <input class="input" id="q" placeholder="이름 또는 휴대폰 번호" autocomplete="off"></div>
      </section>
      <section class="card" id="sample" hidden></section>
      <section class="card" id="list"><div class="loading" style="padding:20px 0">불러오는 중...</div></section>
    `);
    const list = root.querySelector('#list');
    const sampleBox = root.querySelector('#sample');

    // 샘플 데이터: 정식 운영 전에 한 번에 삭제
    async function loadSample() {
      const s = await api('GET', '/api/admin/sample');
      if (seq !== renderSeq) return;
      sampleBox.hidden = !(s.soldiers || s.journals);
      sampleBox.innerHTML = `
        <h2>샘플 데이터 <small>장병 ${s.soldiers}명 · 일지 ${num(s.journals)}건</small></h2>
        <p style="margin:0 0 12px;font-size:14px;color:var(--muted)">처음 방문한 장병의 이해를 돕기 위한 샘플입니다. 엑셀 명단에서는 자동으로 빠지며, 정식 운영 전에 삭제하세요. 삭제하면 다시 생성되지 않습니다.</p>
        <button class="btn danger block" id="del-sample">샘플 데이터 모두 삭제</button>`;
      sampleBox.querySelector('#del-sample').onclick = () => openModal(`
        <h3>샘플 데이터 삭제</h3>
        <p>샘플 장병 ${s.soldiers}명과 샘플 일지 ${num(s.journals)}건을 모두 삭제할까요?<br><small style="color:var(--muted)">실제 가입한 장병의 실제 일지는 지워지지 않습니다. 되돌릴 수 없습니다.</small></p>
        <div class="buttons"><button class="btn secondary" data-cancel>취소</button><button class="btn" style="background:var(--red)" data-ok>삭제</button></div>
      `, (m) => {
        m.querySelector('[data-cancel]').onclick = closeModal;
        const ok = m.querySelector('[data-ok]');
        ok.onclick = () => submitting(ok, async () => {
          const r = await api('DELETE', '/api/admin/sample', {});
          closeModal();
          toast(`샘플 장병 ${r.soldiers}명, 일지 ${r.journals}건을 삭제했습니다.`);
          route();
        });
      });
    }

    let searchSeq = 0;
    async function load(q) {
      const my = ++searchSeq;
      const { soldiers } = await api('GET', `/api/admin/soldiers?q=${encodeURIComponent(q)}`);
      if (my !== searchSeq || seq !== renderSeq) return;
      const real = soldiers.filter((s) => !s.isSample).length;
      list.innerHTML = `<h2>가입 장병 <small>${real}명${soldiers.length > real ? ` (+샘플 ${soldiers.length - real}명)` : ''}</small></h2>` + (soldiers.length ? soldiers.map((s) => `
        <div class="soldier-row">
          <div><div><b>${esc(s.rank)} ${esc(s.name)}</b>${s.isSample ? ' <span class="sample-tag">샘플</span>' : ''}${s.resetRequestedAt ? ' <span class="badge rejected">초기화 요청</span>' : ''}</div><div class="sub">${esc(s.phone)} · ${s.resetRequestedAt ? `요청 ${fmtDateTime(s.resetRequestedAt)}` : `가입 ${fmtDate(s.createdAt)}`}</div></div>
          ${s.isSample ? '' : `<div class="row-actions">
            <button class="btn secondary small" data-reset="${s.id}" data-name="${esc(s.rank)} ${esc(s.name)}">비밀번호 초기화</button>
            ${s.sampleJournals ? `<span class="sample-tag">체험 기록 ${s.sampleJournals}건</span>`
              : `<button class="btn ghost small" data-trial="${s.id}" data-name="${esc(s.rank)} ${esc(s.name)}">체험 기록 넣기</button>`}
          </div>`}
        </div>`).join('') : '<div class="empty">검색 결과가 없습니다.</div>');
      list.querySelectorAll('[data-reset]').forEach((b) => {
        b.onclick = () => confirmReset(Number(b.dataset.reset), b.dataset.name);
      });
      list.querySelectorAll('[data-trial]').forEach((b) => {
        b.onclick = () => openModal(`
          <h3>체험 기록 넣기</h3>
          <p><b>${esc(b.dataset.name)}</b> 계정에 체험용 샘플 독서 기록을 넣습니다.<br>
            <small style="color:var(--muted)">승인 10권 + 대기 1건 + 반려 1건 · 엑셀 명단에서는 빠지고, 샘플 데이터 삭제 때 함께 지워집니다.</small></p>
          <div class="buttons"><button class="btn secondary" data-cancel>취소</button><button class="btn" data-ok>넣기</button></div>
        `, (m) => {
          m.querySelector('[data-cancel]').onclick = closeModal;
          const ok = m.querySelector('[data-ok]');
          ok.onclick = () => submitting(ok, async () => {
            const r = await api('POST', `/api/admin/soldiers/${b.dataset.trial}/sample-reading`, { count: 10 });
            closeModal();
            toast(`${r.displayName}: 승인 ${r.approved}권, 대기·반려 각 1건을 넣었습니다.`);
            route();
          });
        });
      });
    }
    let t;
    root.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()).catch(handleError), 250); });
    await Promise.all([load(''), loadSample()]);
  }

  // ── 공지 관리 ─────────────────────────────────────────────────
  async function viewAdminNotices(seq) {
    render(`${adminHeader('#/admin/notices')}<div class="loading">불러오는 중...</div>`);
    const { notices } = await api('GET', '/api/notices');
    if (seq !== renderSeq) return;
    const root = render(`
      ${adminHeader('#/admin/notices')}
      <form class="card" id="notice-form">
        <h2>새 공지 쓰기</h2>
        <div class="field"><label for="nt">제목</label><input class="input" id="nt" name="title" maxlength="100" required></div>
        <div class="field"><label for="nb">내용</label><textarea class="input" id="nb" name="body" maxlength="3000" required style="min-height:120px"></textarea></div>
        <div class="field"><label class="check"><input type="checkbox" name="important" value="1"> <span>중요 공지 (메인 화면 맨 위에 표시)</span></label></div>
        <button class="btn block" type="submit">공지 등록</button>
      </form>
      <section class="card">
        <h2>등록된 공지 <small>${notices.length}건</small></h2>
        ${notices.length ? notices.map((n) => `
          <div class="soldier-row">
            <div style="min-width:0"><div>${n.important ? '<span class="badge rejected">중요</span> ' : ''}<b>${esc(n.title)}</b></div><div class="sub">${fmtDate(n.createdAt)}</div></div>
            <button class="btn danger small" data-del="${n.id}">삭제</button>
          </div>`).join('') : '<div class="empty">공지가 없습니다.</div>'}
      </section>
    `);
    const form = root.querySelector('#notice-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const d = formData(form);
      submitting(form.querySelector('button[type=submit]'), async () => {
        await api('POST', '/api/admin/notices', { ...d, important: !!d.important });
        toast('공지를 등록했습니다.');
        route();
      });
    };
    root.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => submitting(b, async () => {
        if (!confirm('이 공지를 삭제할까요?')) return;
        await api('DELETE', `/api/admin/notices/${b.dataset.del}`, {});
        toast('공지를 삭제했습니다.');
        route();
      });
    });
  }

  function confirmReset(id, name) {
    openModal(`
      <h3>비밀번호 초기화</h3>
      <p><b>${esc(name)}</b>의 비밀번호를 임시 비밀번호로 초기화할까요?<br><small style="color:var(--muted)">기존 로그인은 모두 해제됩니다.</small></p>
      <div class="buttons"><button class="btn secondary" data-cancel>취소</button><button class="btn" data-ok>초기화</button></div>
    `, (m) => {
      m.querySelector('[data-cancel]').onclick = closeModal;
      const ok = m.querySelector('[data-ok]');
      ok.onclick = () => submitting(ok, async () => {
        const r = await api('POST', `/api/admin/soldiers/${id}/reset-password`, {});
        openModal(`
          <h3>임시 비밀번호 발급</h3>
          <p>${esc(r.displayName)}에게 아래 임시 비밀번호를 전달하세요. 로그인 후 비밀번호 변경이 안내됩니다.</p>
          <div class="temp-pw">${esc(r.tempPassword)}</div>
          <div class="buttons"><button class="btn" data-ok>확인</button></div>
        `, (m2) => { m2.querySelector('[data-ok]').onclick = closeModal; });
      });
    });
  }

  // ── 라우터 ────────────────────────────────────────────────────
  function handleError(err) {
    if (err.status === 401) return;
    console.error(err);
    render(`${topbar('오류')}<div class="card"><p>${esc(err.message)}</p><button class="btn block" data-go="${homeOf()}">처음으로</button></div>`);
  }

  async function route() {
    const seq = ++renderSeq;
    closeModal();
    const hash = location.hash || '#/';
    try {
      if (!meta) meta = await api('GET', '/api/meta');
      if (me === null) {
        try { me = (await api('GET', '/api/me')).user; } catch { me = undefined; }
      }
      if (seq !== renderSeq) return;
      const loggedIn = !!me;
      const isPublic = /^#\/(login|signup)$/.test(hash);

      if (!loggedIn) {
        me = null;
        if (hash === '#/signup') return viewSignup();
        if (hash.startsWith('#/guide')) return viewGuide();
        if (hash !== '#/login') return go('#/login');
        return viewLogin();
      }
      if (isPublic || hash === '#/' || hash === '') return go(homeOf());
      if (hash === '#/password') return viewPassword();
      if (hash.startsWith('#/guide')) return viewGuide();
      if (hash === '#/notices') return await viewNotices(seq);

      if (me.role === 'admin') {
        if (hash === '#/admin') return await viewAdminPending(seq);
        if (hash === '#/admin/export') return await viewAdminExport(seq);
        if (hash === '#/admin/soldiers') return await viewAdminSoldiers(seq);
        if (hash === '#/admin/notices') return await viewAdminNotices(seq);
        return go('#/admin');
      }
      if (hash === '#/home') return await viewHome(seq);
      if (hash === '#/write') return await viewWrite(seq, null);
      const m = hash.match(/^#\/write\/(\d+)$/);
      if (m) return await viewWrite(seq, Number(m[1]));
      if (hash === '#/my') return await viewMy(seq);
      return go('#/home');
    } catch (err) {
      handleError(err);
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
