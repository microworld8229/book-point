// 장병 북포인트 - API 서버 + 정적 파일 제공
// 로컬: `npm start` (내장 PGlite), 운영: Vercel 서버리스 함수(api/index.js) + Supabase Postgres
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const { db, tx, initSchema, kstNow, hashPassword, verifyPassword, loadSecret } = require('./db');
const { seedSample, seedNotices, sampleStatus, removeSample, addSampleReading } = require('./sample');

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

// ── 공통 유틸 ───────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
// async 핸들러의 오류를 Express 오류 처리로 넘긴다
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

// ── 초기화: 스키마·초기 데이터 (서버리스 인스턴스마다 첫 요청에서 한 번) ──
let initPromise = null;
let SECRET = null;
function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      SECRET = loadSecret();
      await tx(async (q) => {
        await initSchema(q);
        await seedNotices(q);
        // 처음 방문한 장병이 화면을 이해하도록 샘플 장병 50명을 넣는다 (SAMPLE_DATA=0 이면 생략, 관리자 화면에서 삭제 가능)
        if (process.env.SAMPLE_DATA !== '0') {
          const n = await seedSample(q);
          if (n) console.log(`[seed] 샘플 장병 50명, 일지 ${n}건 등록 (관리자 > 장병 관리에서 삭제 가능)`);
        }
      });
    })().catch((err) => {
      initPromise = null; // 다음 요청에서 다시 시도
      err.isInit = true;
      throw err;
    });
  }
  return initPromise;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// 배포 플랫폼 헬스체크용 (DB 응답까지 확인)
app.get('/healthz', h(async (req, res) => {
  await ensureInit();
  await db.get('SELECT 1 AS ok');
  res.json({ ok: true });
}));

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
app.use('/api', h(async (req, res, next) => { await ensureInit(); next(); }));

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

const getUserById = (id) => db.get('SELECT * FROM users WHERE id = $1', [id]);

const auth = h(async (req, res, next) => {
  const payload = readToken(getCookie(req, 'sid'));
  const user = payload && Number.isInteger(payload.uid) ? await getUserById(payload.uid) : null;
  if (!user || user.token_version !== payload.tv) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  req.user = user;
  next();
});

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

// ── 로그인 시도 제한 (5회 실패 시 5분 잠금, 서버 인스턴스 단위) ─────
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

app.post('/api/signup', h(async (req, res) => {
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

  if (await db.get('SELECT 1 FROM users WHERE phone = $1', [phone])) {
    fail(409, '이미 가입된 휴대폰 번호입니다. 비밀번호를 잊었다면 관리자에게 초기화를 요청하세요.');
  }
  const now = kstNow();
  const user = await db.get(
    `INSERT INTO users (phone, password_hash, name, rank, birth, local_id, role, consent_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'soldier', $7, $8) ON CONFLICT (phone) DO NOTHING RETURNING *`,
    [phone, hashPassword(password), name, rank, birth, localId, now, now]
  );
  if (!user) fail(409, '이미 가입된 휴대폰 번호입니다.');
  setSession(req, res, user);
  res.json({ user: meView(user) });
}));

app.post('/api/login', h(async (req, res) => {
  const raw = String(req.body?.id ?? '').trim();
  const id = /^[0-9\-\s]+$/.test(raw) ? normalizePhone(raw) : raw.toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!id || !password) fail(400, '휴대폰 번호와 비밀번호를 입력해 주세요.');
  checkLock(id);
  const user = await db.get('SELECT * FROM users WHERE phone = $1', [id]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFail(id);
    fail(401, '휴대폰 번호 또는 비밀번호가 올바르지 않습니다.');
  }
  loginFails.delete(id);
  setSession(req, res, user);
  res.json({ user: meView(user) });
}));

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: meView(req.user) }));

app.post('/api/me/password', auth, h(async (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  if (!verifyPassword(current, req.user.password_hash)) fail(400, '현재 비밀번호가 올바르지 않습니다.');
  if (next.length < 8) fail(400, '새 비밀번호는 8자 이상이어야 합니다.');
  if (next !== String(req.body?.next2 ?? '')) fail(400, '새 비밀번호 확인이 일치하지 않습니다.');
  const user = await db.get(
    'UPDATE users SET password_hash = $1, must_change_pw = 0, token_version = token_version + 1 WHERE id = $2 RETURNING *',
    [hashPassword(next), req.user.id]
  );
  setSession(req, res, user);
  res.json({ user: meView(user) });
}));

// ── 도서 조회 ───────────────────────────────────────────────────
const findBook = (code, q = db) => q.get('SELECT code, title FROM books WHERE lower(code) = lower($1)', [String(code ?? '').trim()]);

app.get('/api/books/:code', auth, h(async (req, res) => {
  const book = await findBook(req.params.code);
  if (!book) return res.status(404).json({ error: '부대 도서 목록에 없는 코드입니다.' });
  res.json({ book });
}));

// ── 독서일지 (장병) ─────────────────────────────────────────────
// 제출 시 자동 검사: R4 글자 수, R5 같은 책 중복, R6 도서 코드 존재
async function validateJournal(q, userId, body, excludeId = 0) {
  const book = await findBook(body?.bookCode, q);
  if (!book) fail(400, '부대 도서 목록에 없는 코드입니다.');
  const title = String(body?.title ?? '').trim() || book.title;
  if (charCount(title) > 100) fail(400, '책 제목이 너무 깁니다.');
  const content = normalizeText(body?.content);
  const len = charCount(content);
  if (len < MIN_LEN || len > MAX_LEN) fail(400, `독서일지는 ${MIN_LEN}자 이상 ${MAX_LEN}자 이하로 작성해 주세요. (현재 ${len}자)`);
  const dup = await q.get(
    `SELECT 1 FROM journals WHERE user_id = $1 AND book_code = $2 AND status IN ('pending', 'approved') AND id <> $3`,
    [userId, book.code, excludeId]
  );
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

const parseId = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) fail(404, '찾을 수 없습니다.');
  return id;
};

app.get('/api/journals', auth, soldierOnly, h(async (req, res) => {
  const rows = await db.all('SELECT * FROM journals WHERE user_id = $1 ORDER BY submitted_at DESC, id DESC', [req.user.id]);
  res.json({ journals: rows.map(journalView) });
}));

app.get('/api/journals/:id', auth, soldierOnly, h(async (req, res) => {
  const j = await db.get('SELECT * FROM journals WHERE id = $1 AND user_id = $2', [parseId(req.params.id), req.user.id]);
  if (!j) fail(404, '일지를 찾을 수 없습니다.');
  res.json({ journal: journalView(j) });
}));

app.post('/api/journals', auth, soldierOnly, h(async (req, res) => {
  const j = await tx(async (q) => {
    // 같은 장병의 동시 제출이 R5 검사를 함께 통과하지 않도록 장병 단위로 잠근다
    await q.query('SELECT pg_advisory_xact_lock(1, $1)', [req.user.id]);
    const v = await validateJournal(q, req.user.id, req.body);
    return q.get(
      `INSERT INTO journals (user_id, book_code, title, content, status, submitted_at) VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *`,
      [req.user.id, v.bookCode, v.title, v.content, kstNow()]
    );
  });
  res.json({ journal: journalView(j) });
}));

// R8: 반려된 일지를 수정해 재제출 → 대기 상태, 제출 일시 갱신
app.put('/api/journals/:id', auth, soldierOnly, h(async (req, res) => {
  const id = parseId(req.params.id);
  const j = await tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(1, $1)', [req.user.id]);
    const cur = await q.get('SELECT * FROM journals WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!cur) fail(404, '일지를 찾을 수 없습니다.');
    if (cur.status !== 'rejected') fail(400, '반려된 일지만 수정해서 다시 제출할 수 있습니다.');
    const v = await validateJournal(q, req.user.id, req.body, id);
    return q.get(
      `UPDATE journals SET book_code = $1, title = $2, content = $3, status = 'pending', submitted_at = $4,
              rejected_at = NULL, reject_reason = NULL WHERE id = $5 RETURNING *`,
      [v.bookCode, v.title, v.content, kstNow(), id]
    );
  });
  res.json({ journal: journalView(j) });
}));

// ── 메인 대시보드 ───────────────────────────────────────────────
app.get('/api/dashboard', auth, soldierOnly, h(async (req, res) => {
  const now = kstNow();
  const month = monthOf(now);
  const uid = req.user.id;

  const popularSql = (where) =>
    `SELECT COALESCE(b.title, MIN(j.title)) AS title, COUNT(*)::int AS cnt FROM journals j LEFT JOIN books b ON b.code = j.book_code
     WHERE j.status = 'approved' ${where} GROUP BY j.book_code, b.title ORDER BY cnt DESC, MAX(j.approved_at) DESC LIMIT 5`;

  const [mine, ranking, monthPopular, notices, sample, unit, recent] = await Promise.all([
    db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'approved' AND substr(approved_at, 1, 7) = $1 THEN points END), 0)::int AS "monthPoints",
         COALESCE(SUM(CASE WHEN status = 'approved' THEN points END), 0)::int AS "totalPoints",
         COUNT(CASE WHEN substr(submitted_at, 1, 7) = $1 THEN 1 END)::int AS "submitted",
         COUNT(CASE WHEN status = 'pending' THEN 1 END)::int AS "pending",
         COUNT(CASE WHEN status = 'approved' AND substr(approved_at, 1, 7) = $1 THEN 1 END)::int AS "approved",
         COUNT(CASE WHEN status = 'rejected' AND substr(rejected_at, 1, 7) = $1 THEN 1 END)::int AS "rejected",
         COUNT(CASE WHEN status = 'approved' THEN 1 END)::int AS "totalBooks"
       FROM journals WHERE user_id = $2`,
      [month, uid]
    ),
    // 랭킹: 이번 달 승인 건수 내림차순, 동점이면 마지막 승인 일시가 빠른 장병이 위
    db.all(
      `SELECT u.id, u.name, u.rank, u.is_sample, COUNT(*)::int AS cnt, MAX(j.approved_at) AS last_at
       FROM journals j JOIN users u ON u.id = j.user_id
       WHERE j.status = 'approved' AND substr(j.approved_at, 1, 7) = $1 AND u.role = 'soldier'
       GROUP BY u.id ORDER BY cnt DESC, last_at ASC, u.id ASC`,
      [month]
    ),
    // 독서활동 인기도서: 이번 달 승인 일지가 많은 책 (이번 달 기록이 없으면 전체 기간)
    db.all(popularSql('AND substr(j.approved_at, 1, 7) = $1'), [month]),
    db.all('SELECT id, title, important, created_at FROM notices ORDER BY important DESC, id DESC LIMIT 3'),
    db.get('SELECT COUNT(*)::int AS n FROM users WHERE is_sample = 1'),
    db.get(
      `SELECT COUNT(*)::int AS approved, COUNT(DISTINCT user_id)::int AS participants
       FROM journals WHERE status = 'approved' AND substr(approved_at, 1, 7) = $1`,
      [month]
    ),
    db.all(
      `SELECT COALESCE(b.title, j.title) AS title FROM journals j LEFT JOIN books b ON b.code = j.book_code
       WHERE j.status = 'approved' ORDER BY j.approved_at DESC, j.id DESC LIMIT 5`
    ),
  ]);
  const popularBooks = monthPopular.length ? monthPopular : await db.all(popularSql(''));

  const myIndex = ranking.findIndex((r) => r.id === uid);
  const top10 = ranking.slice(0, 10).map((r, i) => ({
    rank: i + 1, displayName: displayName(r), count: r.cnt, isMe: r.id === uid, isSample: !!r.is_sample,
  }));

  res.json({
    month,
    me: { ...mine, monthlyLimit: MONTHLY_LIMIT },
    ranking: top10,
    myRank: myIndex >= 0 ? myIndex + 1 : null,
    unit: { ...unit, recentBooks: recent.map((r) => r.title) },
    popularBooks: popularBooks.map((b) => ({ title: b.title, count: b.cnt })),
    notices: notices.map((n) => ({ id: n.id, title: n.title, important: !!n.important, createdAt: n.created_at })),
    sampleSoldiers: sample.n,
  });
}));

// ── 공지사항 ────────────────────────────────────────────────────
const noticeView = (n) => ({ id: n.id, title: n.title, body: n.body, important: !!n.important, createdAt: n.created_at });

app.get('/api/notices', auth, h(async (req, res) => {
  const rows = await db.all('SELECT * FROM notices ORDER BY important DESC, id DESC');
  res.json({ notices: rows.map(noticeView) });
}));

app.post('/api/admin/notices', auth, adminOnly, h(async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  const body = normalizeText(req.body?.body);
  if (!title || charCount(title) > 100) fail(400, '제목을 100자 이내로 입력해 주세요.');
  if (!body || charCount(body) > 3000) fail(400, '내용을 3,000자 이내로 입력해 주세요.');
  const notice = await db.get(
    'INSERT INTO notices (title, body, important, created_at) VALUES ($1, $2, $3, $4) RETURNING *',
    [title, body, req.body?.important ? 1 : 0, kstNow()]
  );
  res.json({ notice: noticeView(notice) });
}));

app.delete('/api/admin/notices/:id', auth, adminOnly, h(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM notices WHERE id = $1', [parseId(req.params.id)]);
  if (!rowCount) fail(404, '공지를 찾을 수 없습니다.');
  res.json({ ok: true });
}));

// ── 관리자: 샘플 데이터 ─────────────────────────────────────────
app.get('/api/admin/sample', auth, adminOnly, h(async (req, res) => res.json(await sampleStatus())));

app.delete('/api/admin/sample', auth, adminOnly, h(async (req, res) => res.json(await removeSample())));

// ── 관리자: 승인 대기 목록 ──────────────────────────────────────
app.get('/api/admin/pending', auth, adminOnly, h(async (req, res) => {
  const now = kstNow();
  const rows = await db.all(
    `SELECT j.*, u.name, u.rank, u.phone, GREATEST(u.is_sample, j.is_sample) AS sample,
       (SELECT COUNT(*)::int FROM journals a WHERE a.user_id = j.user_id AND a.status = 'approved' AND substr(a.approved_at, 1, 10) = $1) AS today_approved,
       (SELECT COUNT(*)::int FROM journals a WHERE a.user_id = j.user_id AND a.status = 'approved' AND substr(a.approved_at, 1, 7) = $2) AS month_approved
     FROM journals j JOIN users u ON u.id = j.user_id
     WHERE j.status = 'pending' ORDER BY j.submitted_at ASC, j.id ASC`,
    [dateOf(now), monthOf(now)]
  );
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
      todayApproved: r.today_approved,
      monthApproved: r.month_approved,
    })),
  });
}));

// 일괄 승인: 장병별로 제출이 빠른 순서대로, 일 5건·월 31건(승인일 기준)을 넘는 일지는 대기 유지
app.post('/api/admin/approve', auth, adminOnly, h(async (req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 2147483647))];
  if (!ids.length) fail(400, '승인할 일지를 선택해 주세요.');

  const result = await tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(2, 0)'); // 동시 승인으로 한도를 넘지 않도록
    const now = kstNow();
    const rows = await q.all(
      `SELECT id, user_id FROM journals WHERE status = 'pending' AND id = ANY($1::int[])
       ORDER BY user_id, submitted_at ASC, id ASC`,
      [ids]
    );
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const counts = userIds.length ? await q.all(
      `SELECT user_id,
         COUNT(CASE WHEN substr(approved_at, 1, 10) = $2 THEN 1 END)::int AS day,
         COUNT(CASE WHEN substr(approved_at, 1, 7) = $3 THEN 1 END)::int AS month
       FROM journals WHERE status = 'approved' AND user_id = ANY($1::int[]) GROUP BY user_id`,
      [userIds, dateOf(now), monthOf(now)]
    ) : [];
    const counters = new Map(userIds.map((u) => [u, { day: 0, month: 0 }]));
    for (const c of counts) counters.set(c.user_id, { day: c.day, month: c.month });

    const toApprove = [];
    let held = 0;
    for (const r of rows) {
      const c = counters.get(r.user_id);
      if (c.day < DAILY_LIMIT && c.month < MONTHLY_LIMIT) {
        toApprove.push(r.id);
        c.day++;
        c.month++;
      } else {
        held++;
      }
    }
    if (toApprove.length) {
      await q.query(
        `UPDATE journals SET status = 'approved', approved_at = $1, points = $2, reject_reason = NULL, rejected_at = NULL WHERE id = ANY($3::int[])`,
        [now, POINTS_PER_JOURNAL, toApprove]
      );
    }
    return { approved: toApprove.length, held, skipped: ids.length - rows.length };
  });
  res.json(result);
}));

app.post('/api/admin/reject', auth, adminOnly, h(async (req, res) => {
  const id = parseId(req.body?.id);
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) fail(400, '반려 사유를 입력해 주세요.');
  if (charCount(reason) > 200) fail(400, '반려 사유는 200자 이내로 입력해 주세요.');
  const { rowCount } = await db.query(
    `UPDATE journals SET status = 'rejected', reject_reason = $1, rejected_at = $2 WHERE id = $3 AND status = 'pending'`,
    [reason, kstNow(), id]
  );
  if (!rowCount) fail(404, '대기 중인 일지를 찾을 수 없습니다.');
  res.json({ ok: true });
}));

// ── 관리자: 장병 관리 / 비밀번호 초기화 ────────────────────────
app.get('/api/admin/soldiers', auth, adminOnly, h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const digits = normalizePhone(q);
  const rows = await db.all(
    `SELECT u.id, u.name, u.rank, u.phone, u.created_at, u.is_sample,
       (SELECT COUNT(*)::int FROM journals j WHERE j.user_id = u.id AND j.is_sample = 1) AS sample_journals
     FROM users u
     WHERE u.role = 'soldier' AND ($1::text = '' OR u.name LIKE $2 OR ($3::text <> '' AND u.phone LIKE $4))
     ORDER BY u.is_sample, u.name LIMIT 200`,
    [q, `%${q}%`, digits, `%${digits}%`]
  );
  res.json({
    soldiers: rows.map((r) => ({
      id: r.id, name: r.name, rank: r.rank, phone: r.is_sample ? '샘플 계정' : formatPhone(r.phone),
      createdAt: r.created_at, isSample: !!r.is_sample, sampleJournals: r.sample_journals,
    })),
  });
}));

async function getRealSoldier(idParam) {
  const user = await getUserById(parseId(idParam));
  if (!user || user.role !== 'soldier' || user.is_sample) fail(404, '장병을 찾을 수 없습니다.');
  return user;
}

app.post('/api/admin/soldiers/:id/reset-password', auth, adminOnly, h(async (req, res) => {
  const user = await getRealSoldier(req.params.id);
  // 헷갈리는 문자(0/O, 1/l/I)를 뺀 8자리 임시 비밀번호
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const temp = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
  await db.query('UPDATE users SET password_hash = $1, must_change_pw = 1, token_version = token_version + 1 WHERE id = $2',
    [hashPassword(temp), user.id]);
  res.json({ tempPassword: temp, displayName: displayName(user) });
}));

// 가입한 장병 계정에 체험용 샘플 독서 기록(승인 N건 + 대기·반려 각 1건)을 넣는다 — 엑셀 명단에서는 제외
app.post('/api/admin/soldiers/:id/sample-reading', auth, adminOnly, h(async (req, res) => {
  const user = await getRealSoldier(req.params.id);
  const count = Math.min(30, Math.max(1, Number(req.body?.count) || 10));
  try {
    res.json({ ...(await addSampleReading(user.id, count)), displayName: displayName(user) });
  } catch (err) {
    fail(400, err.message);
  }
}));

// ── 관리자: 월별 승인 명단 / 엑셀 ──────────────────────────────
// 샘플 장병·샘플 일지는 지자체 명단에 넣지 않는다
function exportRows(month) {
  return db.all(
    `SELECT u.name, u.rank, u.birth, u.phone, u.local_id, COUNT(*)::int AS cnt, SUM(j.points)::int AS pts
     FROM journals j JOIN users u ON u.id = j.user_id
     WHERE j.status = 'approved' AND substr(j.approved_at, 1, 7) = $1 AND u.is_sample = 0 AND j.is_sample = 0
     GROUP BY u.id ORDER BY u.name, u.id`,
    [month]
  );
}

const countSampleApproved = async (month) => (await db.get(
  `SELECT COUNT(*)::int AS n FROM journals j JOIN users u ON u.id = j.user_id
   WHERE j.status = 'approved' AND substr(j.approved_at, 1, 7) = $1 AND (u.is_sample = 1 OR j.is_sample = 1)`,
  [month]
)).n;

function parseMonth(q) {
  const month = String(q ?? '').trim() || monthOf(kstNow());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, '월 형식이 올바르지 않습니다.');
  return month;
}

app.get('/api/admin/export', auth, adminOnly, h(async (req, res) => {
  const month = parseMonth(req.query.month);
  const [monthRows, rows, sampleExcluded] = await Promise.all([
    db.all(`SELECT DISTINCT substr(approved_at, 1, 7) AS m FROM journals WHERE status = 'approved' ORDER BY m DESC`),
    exportRows(month),
    countSampleApproved(month),
  ]);
  const months = monthRows.map((r) => r.m);
  const current = monthOf(kstNow());
  if (!months.includes(current)) months.unshift(current);
  res.json({
    month,
    months,
    rows: rows.map((r) => ({ name: r.name, rank: r.rank, count: r.cnt, points: r.pts })),
    total: { soldiers: rows.length, count: rows.reduce((s, r) => s + r.cnt, 0), points: rows.reduce((s, r) => s + r.pts, 0) },
    sampleExcluded,
  });
}));

app.get('/api/admin/export.xlsx', auth, adminOnly, h(async (req, res) => {
  const month = parseMonth(req.query.month);
  const rows = await exportRows(month);
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

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `독서포인트_승인명단_${month}.xlsx`;
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="bookpoint_${month}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.set('Cache-Control', 'no-store');
  res.send(Buffer.from(buffer));
}));

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
  // 초기화(DB 연결·환경변수) 실패는 원인을 바로 알 수 있도록 메시지를 보여 준다
  if (err.isInit) return res.status(500).json({ error: `서버 초기화 실패: ${err.message}` });
  res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
});

module.exports = app;

// 로컬 실행 (`npm start`)
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const server = app.listen(PORT, () => {
    console.log(`장병 북포인트 서버 실행 중: http://localhost:${PORT}`);
    ensureInit().catch((err) => console.error('[init] 초기화 실패:', err.message));
  });

  // 재시작 시 진행 중인 요청을 마치고 DB를 닫는다
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      server.close(async () => {
        await db.close();
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}
