// 책읽는 장병 - API 서버 + 정적 파일 제공
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const { db, tx, kstNow, hashPassword, verifyPassword, loadSecret, seed } = require('./db');
const { seedSample, seedNotices, sampleStatus, removeSample } = require('./sample');

// ── 업무 규칙 (PRD 7장) ──────────────────────────────────────────
const POINTS_PER_JOURNAL = 100; // R1
const DAILY_LIMIT = 5;          // R2 (승인일 기준)
const MONTHLY_LIMIT = 31;       // R3 (승인일 기준)
const MIN_LEN = 50;             // R4
const MAX_LEN = 200;
const RANKS = ['이병', '일병', '상병', '병장', '하사', '중사', '상사', '원사', '준위', '소위', '중위', '대위', '소령', '중령', '대령', '군무원'];
const REJECT_REASONS = ['중복 내용', '부적절한 표현', '분량 부족·내용 불충분'];

const SESSION_DAYS = 14;
const IS_PROD = process.env.NODE_ENV === 'production';
const SECRET = loadSecret();
seed();
seedNotices();
// 처음 방문한 장병이 화면을 이해하도록 샘플 장병 50명을 넣는다 (SAMPLE_DATA=0 이면 생략, 관리자 화면에서 삭제 가능)
if (process.env.SAMPLE_DATA !== '0') {
  const n = seedSample();
  if (n) console.log(`[seed] 샘플 장병 50명, 일지 ${n}건 등록 (관리자 > 장병 관리에서 삭제 가능)`);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// 배포 플랫폼 헬스체크용 (DB 응답까지 확인)
app.get('/healthz', (req, res) => {
  db.prepare('SELECT 1').get();
  res.json({ ok: true });
});

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  if (IS_PROD) {
    res.set('Strict-Transport-Security', 'max-age=31536000');
    // HTTP로 들어오면 HTTPS로 전환
    if (!req.secure) return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});
app.use(express.json({ limit: '32kb' }));

// ── 공통 유틸 ───────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// 공백 포함 글자 수 (앞뒤 공백 제외, 줄바꿈 정규화)
const normalizeText = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const charCount = (s) => [...s].length;

const normalizePhone = (s) => String(s ?? '').replace(/[^0-9]/g, '');
const formatPhone = (p) => (p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p);

// 표시명: 이름 3자 이상은 첫·끝 글자만 남기고 가운데 O, 2자는 끝 글자 O
function maskName(name) {
  const c = [...String(name)];
  if (c.length <= 1) return name;
  if (c.length === 2) return c[0] + 'O';
  return c[0] + 'O'.repeat(c.length - 2) + c[c.length - 1];
}
const displayName = (u) => `${u.rank} ${maskName(u.name)}`;

const monthOf = (ts) => ts.slice(0, 7);
const dateOf = (ts) => ts.slice(0, 10);

// ── 세션 (HMAC 서명 쿠키) ───────────────────────────────────────
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readToken(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSession(req, res, user) {
  const token = signToken({ uid: user.id, tv: user.token_version, exp: Date.now() + SESSION_DAYS * 864e5 });
  const secure = req.secure || IS_PROD || process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSession(res) {
  res.set('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

// 변경 요청은 JSON만 허용 → 폼 기반 CSRF 차단
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: '잘못된 요청 형식입니다.' });
  }
  next();
});

const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');

function auth(req, res, next) {
  const payload = readToken(getCookie(req, 'sid'));
  const user = payload && getUserById.get(payload.uid);
  if (!user || user.token_version !== payload.tv) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
  next();
}

function soldierOnly(req, res, next) {
  if (req.user.role !== 'soldier') return res.status(403).json({ error: '장병 계정으로 이용해 주세요.' });
  next();
}

const meView = (u) => ({
  id: u.id,
  name: u.name,
  rank: u.rank,
  role: u.role,
  displayName: u.role === 'admin' ? '관리자' : displayName(u),
  mustChangePw: !!u.must_change_pw,
});

// ── 로그인 시도 제한 (5회 실패 시 5분 잠금) ────────────────────
const loginFails = new Map();
function checkLock(id) {
  const rec = loginFails.get(id);
  if (rec && rec.lockedUntil > Date.now()) {
    fail(429, '로그인 시도가 너무 많습니다. 5분 후 다시 시도해 주세요.');
  }
}
function recordFail(id) {
  const rec = loginFails.get(id) || { count: 0, lockedUntil: 0 };
  rec.count++;
  if (rec.count >= 5) { rec.count = 0; rec.lockedUntil = Date.now() + 5 * 60e3; }
  loginFails.set(id, rec);
}

// ── 인증 API ────────────────────────────────────────────────────
app.get('/api/meta', (req, res) => {
  res.json({ ranks: RANKS, rejectReasons: REJECT_REASONS, minLen: MIN_LEN, maxLen: MAX_LEN, dailyLimit: DAILY_LIMIT, monthlyLimit: MONTHLY_LIMIT, points: POINTS_PER_JOURNAL });
});

app.post('/api/signup', (req, res) => {
  const b = req.body || {};
  const name = String(b.name ?? '').trim();
  const rank = String(b.rank ?? '').trim();
  const birth = String(b.birth ?? '').trim();
  const phone = normalizePhone(b.phone);
  const localId = String(b.localId ?? '').trim();
  const password = String(b.password ?? '');

  if (!b.consent) fail(400, '개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
  if (charCount(name) < 2 || charCount(name) > 20) fail(400, '이름을 정확히 입력해 주세요.');
  if (!RANKS.includes(rank)) fail(400, '계급을 선택해 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(Date.parse(birth))) fail(400, '생년월일을 정확히 입력해 주세요.');
  if (!/^01\d{8,9}$/.test(phone)) fail(400, '휴대폰 번호를 정확히 입력해 주세요. (예: 010-1234-5678)');
  if (!localId || localId.length > 50) fail(400, '지자체 앱 회원 ID를 입력해 주세요.');
  if (password.length < 8) fail(400, '비밀번호는 8자 이상이어야 합니다.');
  if (password !== String(b.password2 ?? '')) fail(400, '비밀번호 확인이 일치하지 않습니다.');

  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) {
    fail(409, '이미 가입된 휴대폰 번호입니다. 비밀번호를 잊었다면 관리자에게 초기화를 요청하세요.');
  }
  const now = kstNow();
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO users (phone, password_hash, name, rank, birth, local_id, role, consent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'soldier', ?, ?)`
  ).run(phone, hashPassword(password), name, rank, birth, localId, now, now);
  const user = getUserById.get(lastInsertRowid);
  setSession(req, res, user);
  res.json({ user: meView(user) });
});

app.post('/api/login', (req, res) => {
  const raw = String(req.body?.id ?? '').trim();
  const id = /^[0-9\-\s]+$/.test(raw) ? normalizePhone(raw) : raw.toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!id || !password) fail(400, '휴대폰 번호와 비밀번호를 입력해 주세요.');
  checkLock(id);
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(id);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFail(id);
    fail(401, '휴대폰 번호 또는 비밀번호가 올바르지 않습니다.');
  }
  loginFails.delete(id);
  setSession(req, res, user);
  res.json({ user: meView(user) });
});

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: meView(req.user) }));

app.post('/api/me/password', auth, (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  if (!verifyPassword(current, req.user.password_hash)) fail(400, '현재 비밀번호가 올바르지 않습니다.');
  if (next.length < 8) fail(400, '새 비밀번호는 8자 이상이어야 합니다.');
  if (next !== String(req.body?.next2 ?? '')) fail(400, '새 비밀번호 확인이 일치하지 않습니다.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0, token_version = token_version + 1 WHERE id = ?')
    .run(hashPassword(next), req.user.id);
  const user = getUserById.get(req.user.id);
  setSession(req, res, user);
  res.json({ user: meView(user) });
});

// ── 도서 조회 ───────────────────────────────────────────────────
const findBook = db.prepare('SELECT code, title FROM books WHERE code = ?');

app.get('/api/books/:code', auth, (req, res) => {
  const book = findBook.get(String(req.params.code).trim());
  if (!book) return res.status(404).json({ error: '부대 도서 목록에 없는 코드입니다.' });
  res.json({ book });
});

// ── 독서일지 (장병) ─────────────────────────────────────────────
// 제출 시 자동 검사: R4 글자 수, R5 같은 책 중복, R6 도서 코드 존재
function validateJournal(userId, body, excludeId = 0) {
  const book = findBook.get(String(body?.bookCode ?? '').trim());
  if (!book) fail(400, '부대 도서 목록에 없는 코드입니다.');
  const title = String(body?.title ?? '').trim() || book.title;
  if (charCount(title) > 100) fail(400, '책 제목이 너무 깁니다.');
  const content = normalizeText(body?.content);
  const len = charCount(content);
  if (len < MIN_LEN || len > MAX_LEN) fail(400, `독서일지는 ${MIN_LEN}자 이상 ${MAX_LEN}자 이하로 작성해 주세요. (현재 ${len}자)`);
  const dup = db.prepare(
    `SELECT 1 FROM journals WHERE user_id = ? AND book_code = ? AND status IN ('pending', 'approved') AND id != ?`
  ).get(userId, book.code, excludeId);
  if (dup) fail(409, '이미 이 책으로 제출한 일지가 있습니다.');
  return { bookCode: book.code, title, content };
}

const journalView = (j) => ({
  id: j.id,
  bookCode: j.book_code,
  title: j.title,
  content: j.content,
  status: j.status,
  submittedAt: j.submitted_at,
  approvedAt: j.approved_at,
  rejectedAt: j.rejected_at,
  rejectReason: j.reject_reason,
  points: j.points,
});

app.get('/api/journals', auth, soldierOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM journals WHERE user_id = ? ORDER BY submitted_at DESC, id DESC').all(req.user.id);
  res.json({ journals: rows.map(journalView) });
});

app.get('/api/journals/:id', auth, soldierOnly, (req, res) => {
  const j = db.prepare('SELECT * FROM journals WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!j) fail(404, '일지를 찾을 수 없습니다.');
  res.json({ journal: journalView(j) });
});

app.post('/api/journals', auth, soldierOnly, (req, res) => {
  const j = tx(() => {
    const v = validateJournal(req.user.id, req.body);
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO journals (user_id, book_code, title, content, status, submitted_at) VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(req.user.id, v.bookCode, v.title, v.content, kstNow());
    return db.prepare('SELECT * FROM journals WHERE id = ?').get(lastInsertRowid);
  });
  res.json({ journal: journalView(j) });
});

// R8: 반려된 일지를 수정해 재제출 → 대기 상태, 제출 일시 갱신
app.put('/api/journals/:id', auth, soldierOnly, (req, res) => {
  const id = Number(req.params.id);
  const j = tx(() => {
    const cur = db.prepare('SELECT * FROM journals WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!cur) fail(404, '일지를 찾을 수 없습니다.');
    if (cur.status !== 'rejected') fail(400, '반려된 일지만 수정해서 다시 제출할 수 있습니다.');
    const v = validateJournal(req.user.id, req.body, id);
    db.prepare(
      `UPDATE journals SET book_code = ?, title = ?, content = ?, status = 'pending', submitted_at = ?,
              rejected_at = NULL, reject_reason = NULL WHERE id = ?`
    ).run(v.bookCode, v.title, v.content, kstNow(), id);
    return db.prepare('SELECT * FROM journals WHERE id = ?').get(id);
  });
  res.json({ journal: journalView(j) });
});

// ── 메인 대시보드 ───────────────────────────────────────────────
app.get('/api/dashboard', auth, soldierOnly, (req, res) => {
  const now = kstNow();
  const month = monthOf(now);
  const uid = req.user.id;

  const mine = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'approved' AND substr(approved_at, 1, 7) = :m THEN points END), 0) AS monthPoints,
       COALESCE(SUM(CASE WHEN status = 'approved' THEN points END), 0) AS totalPoints,
       COUNT(CASE WHEN substr(submitted_at, 1, 7) = :m THEN 1 END) AS submitted,
       COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
       COUNT(CASE WHEN status = 'approved' AND substr(approved_at, 1, 7) = :m THEN 1 END) AS approved,
       COUNT(CASE WHEN status = 'rejected' AND substr(rejected_at, 1, 7) = :m THEN 1 END) AS rejected,
       COUNT(CASE WHEN status = 'approved' THEN 1 END) AS totalBooks
     FROM journals WHERE user_id = :uid`
  ).get({ m: month, uid });

  // 랭킹: 이번 달 승인 건수 내림차순, 동점이면 마지막 승인 일시가 빠른 장병이 위
  const ranking = db.prepare(
    `SELECT u.id, u.name, u.rank, u.is_sample, COUNT(*) AS cnt, MAX(j.approved_at) AS lastAt
     FROM journals j JOIN users u ON u.id = j.user_id
     WHERE j.status = 'approved' AND substr(j.approved_at, 1, 7) = ? AND u.role = 'soldier'
     GROUP BY u.id ORDER BY cnt DESC, lastAt ASC, u.id ASC`
  ).all(month);
  const myIndex = ranking.findIndex((r) => r.id === uid);
  const top10 = ranking.slice(0, 10).map((r, i) => ({
    rank: i + 1, displayName: displayName(r), count: r.cnt, isMe: r.id === uid, isSample: !!r.is_sample,
  }));

  // 독서활동 인기도서: 이번 달 승인 일지가 많은 책 (이번 달 기록이 없으면 전체 기간)
  const popularSql = (where) => db.prepare(
    `SELECT COALESCE(b.title, MIN(j.title)) AS title, COUNT(*) AS cnt FROM journals j LEFT JOIN books b ON b.code = j.book_code
     WHERE j.status = 'approved' ${where} GROUP BY j.book_code ORDER BY cnt DESC, MAX(j.approved_at) DESC LIMIT 5`
  );
  let popularBooks = popularSql("AND substr(j.approved_at, 1, 7) = ?").all(month);
  if (!popularBooks.length) popularBooks = popularSql('').all();

  const notices = db.prepare('SELECT id, title, important, created_at FROM notices ORDER BY important DESC, id DESC LIMIT 3').all()
    .map((n) => ({ id: n.id, title: n.title, important: !!n.important, createdAt: n.created_at }));
  const sampleSoldiers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_sample = 1').get().n;

  const unit = db.prepare(
    `SELECT COUNT(*) AS approved, COUNT(DISTINCT user_id) AS participants
     FROM journals WHERE status = 'approved' AND substr(approved_at, 1, 7) = ?`
  ).get(month);
  const recentBooks = db.prepare(
    `SELECT COALESCE(b.title, j.title) AS title FROM journals j LEFT JOIN books b ON b.code = j.book_code
     WHERE j.status = 'approved' ORDER BY j.approved_at DESC, j.id DESC LIMIT 5`
  ).all().map((r) => r.title);

  res.json({
    month,
    me: { ...mine, monthlyLimit: MONTHLY_LIMIT },
    ranking: top10,
    myRank: myIndex >= 0 ? myIndex + 1 : null,
    unit: { ...unit, recentBooks },
    popularBooks: popularBooks.map((b) => ({ title: b.title, count: b.cnt })),
    notices,
    sampleSoldiers,
  });
});

// ── 공지사항 ────────────────────────────────────────────────────
const noticeView = (n) => ({ id: n.id, title: n.title, body: n.body, important: !!n.important, createdAt: n.created_at });

app.get('/api/notices', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notices ORDER BY important DESC, id DESC').all();
  res.json({ notices: rows.map(noticeView) });
});

app.post('/api/admin/notices', auth, adminOnly, (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const body = normalizeText(req.body?.body);
  if (!title || charCount(title) > 100) fail(400, '제목을 100자 이내로 입력해 주세요.');
  if (!body || charCount(body) > 3000) fail(400, '내용을 3,000자 이내로 입력해 주세요.');
  const { lastInsertRowid } = db.prepare('INSERT INTO notices (title, body, important, created_at) VALUES (?, ?, ?, ?)')
    .run(title, body, req.body?.important ? 1 : 0, kstNow());
  res.json({ notice: noticeView(db.prepare('SELECT * FROM notices WHERE id = ?').get(lastInsertRowid)) });
});

app.delete('/api/admin/notices/:id', auth, adminOnly, (req, res) => {
  const { changes } = db.prepare('DELETE FROM notices WHERE id = ?').run(Number(req.params.id));
  if (!changes) fail(404, '공지를 찾을 수 없습니다.');
  res.json({ ok: true });
});

// ── 관리자: 샘플 데이터 ─────────────────────────────────────────
app.get('/api/admin/sample', auth, adminOnly, (req, res) => res.json(sampleStatus()));

app.delete('/api/admin/sample', auth, adminOnly, (req, res) => res.json(removeSample()));

// ── 관리자: 승인 대기 목록 ──────────────────────────────────────
app.get('/api/admin/pending', auth, adminOnly, (req, res) => {
  const now = kstNow();
  const rows = db.prepare(
    `SELECT j.*, u.name, u.rank, u.phone, (u.is_sample OR j.is_sample) AS sample,
       (SELECT COUNT(*) FROM journals a WHERE a.user_id = j.user_id AND a.status = 'approved' AND substr(a.approved_at, 1, 10) = :d) AS todayApproved,
       (SELECT COUNT(*) FROM journals a WHERE a.user_id = j.user_id AND a.status = 'approved' AND substr(a.approved_at, 1, 7) = :m) AS monthApproved
     FROM journals j JOIN users u ON u.id = j.user_id
     WHERE j.status = 'pending' ORDER BY j.submitted_at ASC, j.id ASC`
  ).all({ d: dateOf(now), m: monthOf(now) });
  res.json({
    today: dateOf(now),
    dailyLimit: DAILY_LIMIT,
    monthlyLimit: MONTHLY_LIMIT,
    journals: rows.map((r) => ({
      ...journalView(r),
      userId: r.user_id,
      displayName: displayName(r),
      phoneTail: r.phone.slice(-4),
      isSample: !!r.sample,
      todayApproved: r.todayApproved,
      monthApproved: r.monthApproved,
    })),
  });
});

// 일괄 승인: 장병별로 제출이 빠른 순서대로, 일 5건·월 31건(승인일 기준)을 넘는 일지는 대기 유지
app.post('/api/admin/approve', auth, adminOnly, (req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) fail(400, '승인할 일지를 선택해 주세요.');

  const result = tx(() => {
    const now = kstNow();
    const rows = db.prepare(
      `SELECT id, user_id FROM journals WHERE status = 'pending' AND id IN (${ids.map(() => '?').join(',')})
       ORDER BY user_id, submitted_at ASC, id ASC`
    ).all(...ids);
    const countDay = db.prepare(`SELECT COUNT(*) AS n FROM journals WHERE user_id = ? AND status = 'approved' AND substr(approved_at, 1, 10) = ?`);
    const countMonth = db.prepare(`SELECT COUNT(*) AS n FROM journals WHERE user_id = ? AND status = 'approved' AND substr(approved_at, 1, 7) = ?`);
    const approve = db.prepare(`UPDATE journals SET status = 'approved', approved_at = ?, points = ?, reject_reason = NULL, rejected_at = NULL WHERE id = ?`);

    let approved = 0;
    let held = 0;
    const counters = new Map();
    for (const r of rows) {
      if (!counters.has(r.user_id)) {
        counters.set(r.user_id, { day: countDay.get(r.user_id, dateOf(now)).n, month: countMonth.get(r.user_id, monthOf(now)).n });
      }
      const c = counters.get(r.user_id);
      if (c.day < DAILY_LIMIT && c.month < MONTHLY_LIMIT) {
        approve.run(now, POINTS_PER_JOURNAL, r.id);
        c.day++;
        c.month++;
        approved++;
      } else {
        held++;
      }
    }
    return { approved, held, skipped: ids.length - rows.length };
  });
  res.json(result);
});

app.post('/api/admin/reject', auth, adminOnly, (req, res) => {
  const id = Number(req.body?.id);
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) fail(400, '반려 사유를 입력해 주세요.');
  if (charCount(reason) > 200) fail(400, '반려 사유는 200자 이내로 입력해 주세요.');
  const { changes } = db.prepare(
    `UPDATE journals SET status = 'rejected', reject_reason = ?, rejected_at = ? WHERE id = ? AND status = 'pending'`
  ).run(reason, kstNow(), id);
  if (!changes) fail(404, '대기 중인 일지를 찾을 수 없습니다.');
  res.json({ ok: true });
});

// ── 관리자: 장병 관리 / 비밀번호 초기화 ────────────────────────
app.get('/api/admin/soldiers', auth, adminOnly, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const digits = normalizePhone(q);
  const rows = db.prepare(
    `SELECT id, name, rank, phone, created_at, is_sample FROM users
     WHERE role = 'soldier' AND (? = '' OR name LIKE ? OR (? != '' AND phone LIKE ?))
     ORDER BY is_sample, name LIMIT 200`
  ).all(q, `%${q}%`, digits, `%${digits}%`);
  res.json({
    soldiers: rows.map((r) => ({
      id: r.id, name: r.name, rank: r.rank, phone: r.is_sample ? '샘플 계정' : formatPhone(r.phone), createdAt: r.created_at, isSample: !!r.is_sample,
    })),
  });
});

app.post('/api/admin/soldiers/:id/reset-password', auth, adminOnly, (req, res) => {
  const user = getUserById.get(Number(req.params.id));
  if (!user || user.role !== 'soldier' || user.is_sample) fail(404, '장병을 찾을 수 없습니다.');
  // 헷갈리는 문자(0/O, 1/l/I)를 뺀 8자리 임시 비밀번호
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const temp = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1, token_version = token_version + 1 WHERE id = ?')
    .run(hashPassword(temp), user.id);
  res.json({ tempPassword: temp, displayName: displayName(user) });
});

// ── 관리자: 월별 승인 명단 / 엑셀 ──────────────────────────────
// 샘플 장병·샘플 일지는 지자체 명단에 넣지 않는다
function exportRows(month) {
  return db.prepare(
    `SELECT u.name, u.rank, u.birth, u.phone, u.local_id, COUNT(*) AS cnt, SUM(j.points) AS pts
     FROM journals j JOIN users u ON u.id = j.user_id
     WHERE j.status = 'approved' AND substr(j.approved_at, 1, 7) = ? AND u.is_sample = 0 AND j.is_sample = 0
     GROUP BY u.id ORDER BY u.name, u.id`
  ).all(month);
}

const countSampleApproved = (month) => db.prepare(
  `SELECT COUNT(*) AS n FROM journals j JOIN users u ON u.id = j.user_id
   WHERE j.status = 'approved' AND substr(j.approved_at, 1, 7) = ? AND (u.is_sample = 1 OR j.is_sample = 1)`
).get(month).n;

function parseMonth(q) {
  const month = String(q ?? '').trim() || monthOf(kstNow());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, '월 형식이 올바르지 않습니다.');
  return month;
}

app.get('/api/admin/export', auth, adminOnly, (req, res) => {
  const month = parseMonth(req.query.month);
  const months = db.prepare(
    `SELECT DISTINCT substr(approved_at, 1, 7) AS m FROM journals WHERE status = 'approved' ORDER BY m DESC`
  ).all().map((r) => r.m);
  const current = monthOf(kstNow());
  if (!months.includes(current)) months.unshift(current);
  const rows = exportRows(month);
  res.json({
    month,
    months,
    rows: rows.map((r) => ({ name: r.name, rank: r.rank, count: r.cnt, points: r.pts })),
    total: { soldiers: rows.length, count: rows.reduce((s, r) => s + r.cnt, 0), points: rows.reduce((s, r) => s + r.pts, 0) },
    sampleExcluded: countSampleApproved(month),
  });
});

app.get('/api/admin/export.xlsx', auth, adminOnly, async (req, res, next) => {
  try {
    const month = parseMonth(req.query.month);
    const rows = exportRows(month);
    const wb = new ExcelJS.Workbook();
    wb.created = new Date();
    const ws = wb.addWorksheet(`${month} 승인명단`);
    ws.columns = [
      { header: '이름', key: 'name', width: 12 },
      { header: '계급', key: 'rank', width: 8 },
      { header: '생년월일', key: 'birth', width: 13 },
      { header: '휴대폰 번호', key: 'phone', width: 16 },
      { header: '지자체 앱 회원 ID', key: 'localId', width: 22 },
      { header: '인정 건수', key: 'count', width: 10 },
      { header: '적립 예정 포인트', key: 'points', width: 16 },
      { header: '대상 월', key: 'month', width: 10 },
    ];
    for (const r of rows) {
      ws.addRow({ name: r.name, rank: r.rank, birth: r.birth, phone: formatPhone(r.phone), localId: r.local_id, count: r.cnt, points: r.pts, month });
    }
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const filename = `독서포인트_승인명단_${month}.xlsx`;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="bookpoint_${month}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.set('Cache-Control', 'no-store');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// ── 정적 파일 / 에러 처리 ───────────────────────────────────────
app.use('/api', (req, res) => res.status(404).json({ error: '없는 API입니다.' }));
app.use(express.static(path.join(__dirname, 'public'), {
  // 재배포 후 옛 화면이 남지 않도록 매번 변경 여부 확인
  setHeaders: (res, file) => { if (/\.(html|js|css)$/.test(file)) res.set('Cache-Control', 'no-cache'); },
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '잘못된 요청입니다.' });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
});

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => console.log(`책읽는 장병 서버 실행 중: http://localhost:${PORT}`));

// 재배포·재시작 시 진행 중인 요청을 마치고 DB를 닫는다
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
