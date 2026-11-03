// 책읽는 장병 - 모바일 웹 클라이언트 (해시 라우팅 SPA)
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
  function viewLogin() {
    const root = render(`
      <div class="hero">
        <div class="logo">📖</div>
        <h1>책읽는 장병</h1>
        <p>읽은 책이 지역화폐가 됩니다</p>
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
        <p class="center-link" style="margin-bottom:0">비밀번호를 잊으셨나요?<br>관리자에게 초기화를 요청하세요.</p>
      </form>
      <p class="center-link">처음이신가요? <a href="#/signup">가입하기</a></p>
    `);
    const form = root.querySelector('#login');
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

  function formatPhoneInput(input) {
    input.addEventListener('input', () => {
      const d = input.value.replace(/\D/g, '').slice(0, 11);
      input.value = d.length > 7 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
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

  // ── S1. 메인 대시보드 ─────────────────────────────────────────
  async function viewHome(seq) {
    render(`${topbar('책읽는 장병')}<div class="loading">불러오는 중...</div>`);
    const d = await api('GET', '/api/dashboard');
    if (seq !== renderSeq) return;
    const [y, m] = d.month.split('-');
    const pct = Math.min(100, Math.round((d.me.approved / d.me.monthlyLimit) * 100));
    render(`
      ${topbar('책읽는 장병', { right: `<button class="link-btn" data-go="#/password">비밀번호</button><button class="link-btn" data-logout>로그아웃</button>` })}
      ${me.mustChangePw ? '<div class="notice warn">임시 비밀번호를 사용 중입니다. <a href="#/password">비밀번호 변경하기 ›</a></div>' : ''}
      <p style="margin:0 0 12px;font-size:17px"><b>${esc(me.displayName)}</b>님, 오늘도 한 권 어때요?</p>

      <section class="card point-card">
        <h2>나의 적립 예정 포인트 <small>${Number(m)}월</small></h2>
        <div class="point-grid">
          <div><div class="label">이번 달</div><div class="value">${num(d.me.monthPoints)}<span>P</span></div></div>
          <div><div class="label">누적</div><div class="value">${num(d.me.totalPoints)}<span>P</span></div></div>
        </div>
        <p class="point-note">※ 승인 기준 적립 예정 포인트입니다. 지자체 실제 적립은 지자체 앱에서 확인하세요.</p>
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
            <span class="who">${esc(r.displayName)}${r.isMe ? ' (나)' : ''}</span>
            <span class="cnt">${r.count}건</span></li>`).join('')}</ol>`
          : '<div class="empty">아직 이번 달 승인된 일지가 없습니다.<br>첫 번째 주인공이 되어 보세요!</div>'}
        ${d.myRank && d.myRank > 10 ? `<div class="my-rank">나의 순위: <b>${d.myRank}위</b></div>` : ''}
        ${!d.myRank && d.ranking.length ? '<div class="my-rank">이번 달 승인 1건부터 순위에 오릅니다.</div>' : ''}
      </section>

      <section class="card">
        <h2>이번 달 부대 독서 현황</h2>
        <div class="stat-row three">
          <div><div class="num">${num(d.unit.approved)}</div><div class="lbl">승인 일지</div></div>
          <div><div class="num">${num(d.unit.participants)}</div><div class="lbl">참여 장병</div></div>
          <div><div class="num">${num(d.unit.approved * meta.points)}</div><div class="lbl">적립 예정 P</div></div>
        </div>
        ${d.unit.recentBooks.length ? `<div style="margin-top:14px;font-size:13px;color:var(--muted)">최근 승인된 책</div>
          <ol class="book-list">${d.unit.recentBooks.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
      </section>

      <div class="bottom-bar"><div class="inner">
        <button class="btn secondary" data-go="#/my">내 일지 목록</button>
        <button class="btn" data-go="#/write">독서일지 쓰기</button>
      </div></div>
    `);
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
        ${[['#/admin', '승인 대기'], ['#/admin/export', '명단 내보내기'], ['#/admin/soldiers', '장병 관리']]
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
                  <div><div class="title">${esc(j.displayName)} <small style="color:var(--muted);font-weight:400">(${esc(j.phoneTail)})</small></div>
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
      <section class="card" id="list"><div class="loading" style="padding:20px 0">불러오는 중...</div></section>
    `);
    const list = root.querySelector('#list');
    let searchSeq = 0;
    async function load(q) {
      const my = ++searchSeq;
      const { soldiers } = await api('GET', `/api/admin/soldiers?q=${encodeURIComponent(q)}`);
      if (my !== searchSeq || seq !== renderSeq) return;
      list.innerHTML = `<h2>가입 장병 <small>${soldiers.length}명</small></h2>` + (soldiers.length ? soldiers.map((s) => `
        <div class="soldier-row">
          <div><div><b>${esc(s.rank)} ${esc(s.name)}</b></div><div class="sub">${esc(s.phone)} · 가입 ${fmtDate(s.createdAt)}</div></div>
          <button class="btn secondary small" data-reset="${s.id}" data-name="${esc(s.rank)} ${esc(s.name)}">비밀번호 초기화</button>
        </div>`).join('') : '<div class="empty">검색 결과가 없습니다.</div>');
      list.querySelectorAll('[data-reset]').forEach((b) => {
        b.onclick = () => confirmReset(Number(b.dataset.reset), b.dataset.name);
      });
    }
    let t;
    root.querySelector('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()).catch(handleError), 250); });
    await load('');
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
        if (hash !== '#/login') return go('#/login');
        return viewLogin();
      }
      if (isPublic || hash === '#/' || hash === '') return go(homeOf());
      if (hash === '#/password') return viewPassword();

      if (me.role === 'admin') {
        if (hash === '#/admin') return await viewAdminPending(seq);
        if (hash === '#/admin/export') return await viewAdminExport(seq);
        if (hash === '#/admin/soldiers') return await viewAdminSoldiers(seq);
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
