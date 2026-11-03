// 처음 방문한 장병이 화면을 이해하기 쉽도록 넣는 샘플 데이터 (장병 50명 + 일지 + 공지)
// - 샘플 장병은 users.is_sample = 1, 로그인 불가(무작위 비밀번호), 엑셀 명단에서 제외
// - 관리자 화면에서 한 번에 삭제할 수 있고, 삭제 후에는 다시 생성하지 않는다
const crypto = require('node:crypto');
const { db, tx, insertMany, kstNow, hashPassword, getSetting, setSetting } = require('./db');

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN = ['민준', '서준', '도윤', '예준', '시우', '하준', '주원', '지호', '지후', '준서', '준우', '현우', '도현', '건우', '우진',
  '선우', '연우', '유준', '정우', '승우', '승현', '시윤', '준혁', '은우', '지환', '승민', '지훈', '유찬', '민재', '현준',
  '태윤', '민성', '재윤', '한결', '성민', '동현', '윤호', '태민', '상현', '진우'];

const OPENERS = [
  '일과 후 생활관 독서카페에서 이 책을 읽었다.',
  '주말 개인정비 시간에 끝까지 읽은 책이다.',
  '동기 추천으로 읽기 시작했는데 생각보다 훨씬 몰입해서 읽었다.',
  '불침번 서기 전 짬을 내어 조금씩 읽어 완독했다.',
  '부대 도서관에서 빌려 일주일 동안 읽었다.',
  '전역 후 진로를 고민하던 중에 이 책을 만났다.',
];
const MIDDLES = [
  '가장 기억에 남는 부분은 주인공이 어려움 속에서도 포기하지 않는 장면이었다.',
  '평소 생각해 보지 못한 관점을 알게 되어 시야가 넓어진 느낌이다.',
  '작가의 문장이 담백하면서도 오래 곱씹게 되는 힘이 있었다.',
  '책 속 이야기가 지금 군 생활과 겹쳐 보여 공감이 많이 됐다.',
  '어렵게 느껴지는 부분도 있었지만 메모하며 읽으니 이해가 됐다.',
  '역사적 배경을 알고 나니 지금 우리가 누리는 일상이 새롭게 보였다.',
];
const CLOSERS = [
  '전역 전까지 이 작가의 다른 책도 읽어 볼 생각이다.',
  '생활관 동기들에게도 꼭 추천하고 싶다.',
  '읽은 내용을 실천으로 옮기는 것이 다음 목표다.',
  '하루 10분이라도 꾸준히 읽는 습관을 이어 가겠다.',
  '휴가 나가면 서점에서 관련 책을 더 찾아볼 계획이다.',
];

const NOTICES = [
  {
    important: 1,
    title: '책읽는 장병 시범 운영 안내',
    body: '부대 독서카페(도서관)에서 책을 읽고 독서일지를 제출하면, 관리자 승인 후 1건당 100P가 적립 예정 포인트로 쌓입니다.\n승인된 실적은 매월 말 명단으로 정리해 경기도 "천권으로 독서포인트"에 전달되며, 지자체 앱에서 지역화폐로 전환됩니다.\n\n※ 현재 보이는 랭킹·현황에는 이해를 돕기 위한 샘플 장병 50명의 데이터가 포함되어 있으며, 정식 운영 전에 삭제됩니다.',
  },
  {
    important: 1,
    title: '2026년 천권으로 독서포인트 일정 안내',
    body: '경기도 천권으로 독서포인트 기준 일정입니다. (지자체 사정에 따라 바뀔 수 있습니다)\n\n· 적립 가능 기한: 2026년 11월 30일까지 (예산 조기 소진 시 마감)\n· 지역화폐 전환: 매월 15일, 전월 적립분 자동 전환\n· 사용 유효기간: 2026년 12월 20일까지 (기한 내 미사용 시 소멸)\n· 사용처: 지역화폐 가맹점으로 등록된 지역서점',
  },
  {
    important: 0,
    title: '독서일지 잘 쓰는 요령',
    body: '· 50자 이상 200자 이하로 작성합니다. (공백 포함)\n· 줄거리 요약보다 기억에 남는 문장, 느낀 점, 앞으로의 다짐을 적어 주세요.\n· 다른 일지를 그대로 옮기거나 같은 내용을 반복하면 반려될 수 있습니다.\n· 반려되면 사유를 확인하고 고쳐서 다시 제출할 수 있습니다.',
  },
];

// 재현 가능한 의사난수 (매번 같은 샘플이 만들어지도록)
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
// KST 기준 오늘에서 offset일 전 날짜 'YYYY-MM-DD'
function dayBefore(today, offset) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

async function seedNotices(q) {
  if (await getSetting(q, 'notices_seeded')) return;
  const now = kstNow();
  await insertMany(q, 'notices', ['title', 'body', 'important', 'created_at'], [...NOTICES].reverse().map((n) => [n.title, n.body, n.important, now]));
  await setSetting(q, 'notices_seeded', '1');
}

const JOURNAL_COLS = ['user_id', 'book_code', 'title', 'content', 'status', 'submitted_at', 'approved_at', 'rejected_at', 'reject_reason', 'points', 'is_sample'];

// 기존(실제) 계정에 체험용 샘플 독서활동을 넣는다: 승인 count건 + 대기 1건 + 반려 1건
async function addSampleReading(userId, count = 10) {
  const rand = rng(userId * 7919 + count);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const now = kstNow();
  const today = now.slice(0, 10);
  const used = new Set((await db.all('SELECT book_code FROM journals WHERE user_id = $1', [userId])).map((r) => r.book_code));
  const shelf = (await db.all('SELECT code, title FROM books ORDER BY code')).filter((b) => !used.has(b.code)).sort(() => rand() - 0.5);
  if (shelf.length < count + 2) throw new Error('남은 도서가 부족합니다.');
  const rows = [];
  const ins = { run: (...v) => rows.push([...v, 1]) };
  const content = () => `${pick(OPENERS)} ${pick(MIDDLES)} ${pick(CLOSERS)}`;

  // 이번 달 1일부터 어제까지 하루 최대 3건, 모자라면 지난달로 (승인일 기준 한도 R2·R3 이내)
  const days = [];
  for (let offset = 1; days.length < count; offset++) {
    const day = dayBefore(today, offset);
    const perDay = day.slice(0, 7) === today.slice(0, 7) ? 3 : 1;
    for (let k = 0; k < perDay && days.length < count; k++) days.push(day);
  }
  let b = 0;
  days.forEach((day, k) => {
    const book = shelf[b++];
    ins.run(userId, book.code, book.title, content(), 'approved', `${day} 19:${pad(10 + k)}:00`, `${day} 21:${pad(10 + k)}:00`, null, null, 100);
  });
  const pending = shelf[b++];
  ins.run(userId, pending.code, pending.title, content(), 'pending', `${today} ${now.slice(11, 13)}:00:00`, null, null, null, 0);
  const rejected = shelf[b++];
  const rday = dayBefore(today, 2);
  ins.run(userId, rejected.code, rejected.title, '재미있었다. 다음에도 읽고 싶다. 좋은 책이었다. 추천한다. 재미있었다. 다음에도 읽고 싶다.', 'rejected',
    `${rday} 19:00:00`, null, `${rday} 21:00:00`, '분량 부족·내용 불충분', 0);
  await tx((q) => insertMany(q, 'journals', JOURNAL_COLS, rows));
  return { approved: count, pending: 1, rejected: 1 };
}

// 샘플 장병 50명과 일지를 만든다 (메모리에서 만든 뒤 여러 행씩 한 번에 저장)
async function seedSample(q) {
  if (await getSetting(q, 'sample_seeded')) return 0;
  const books = await q.all('SELECT code, title FROM books ORDER BY code');
  if (books.length < 10) return 0;

  const rand = rng(20261103);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const now = kstNow();
  const today = now.slice(0, 10);
  const pwHash = hashPassword(crypto.randomBytes(24).toString('hex')); // 로그인 불가

  const users = [];
  const journalRows = []; // [phone, ...나머지 컬럼] — 저장 후 phone 을 user_id 로 바꾼다
  const insJournal = { run: (phone, ...v) => journalRows.push([phone, ...v, 1]) };

  const usedNames = new Set();
  let journals = 0;
  {
    for (let i = 1; i <= 50; i++) {
      let name;
      do { name = pick(SURNAMES) + pick(GIVEN); } while (usedNames.has(name));
      usedNames.add(name);
      const r = rand();
      const rank = r < 0.1 ? '이병' : r < 0.4 ? '일병' : r < 0.75 ? '상병' : '병장';
      const birth = `${2002 + Math.floor(rand() * 5)}-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`;
      const joined = `${dayBefore(today, 70 + Math.floor(rand() * 20))} 19:${pad(Math.floor(rand() * 60))}:00`;
      const uid = `sample-${pad(i)}`;
      users.push([uid, pwHash, name, rank, birth, `sample_${pad(i)}`, 'soldier', joined, joined, 1]);

      // 독서량: 다독가 / 꾸준히 / 가끔 / 이제 시작
      const level = rand();
      const total = level < 0.16 ? 30 + Math.floor(rand() * 15) : level < 0.5 ? 14 + Math.floor(rand() * 12) : level < 0.85 ? 5 + Math.floor(rand() * 8) : Math.floor(rand() * 4);
      const shelf = [...books].sort(() => rand() - 0.5);
      let b = 0;
      const content = () => `${pick(OPENERS)} ${pick(MIDDLES)} ${pick(CLOSERS)}`;

      // 승인 일지: 최근 65일(오늘 제외)에 흩어 놓되 하루 최대 4건, 한 달 최대 31건 (R2·R3)
      const perDay = new Map();
      const perMonth = new Map();
      for (let k = 0; k < total && b < shelf.length; k++) {
        // 최근일수록 조금 더 많이 (이번 달 랭킹이 비지 않도록)
        const offset = 1 + Math.floor(Math.pow(rand(), 1.6) * 64);
        const day = dayBefore(today, offset);
        const month = day.slice(0, 7);
        if ((perDay.get(day) || 0) >= 4 || (perMonth.get(month) || 0) >= 31) continue;
        perDay.set(day, (perDay.get(day) || 0) + 1);
        perMonth.set(month, (perMonth.get(month) || 0) + 1);
        const book = shelf[b++];
        const submitted = `${dayBefore(today, offset + Math.floor(rand() * 2))} ${pad(18 + Math.floor(rand() * 4))}:${pad(Math.floor(rand() * 60))}:00`;
        const approved = `${day} ${pad(20 + Math.floor(rand() * 3))}:${pad(Math.floor(rand() * 60))}:${pad(Math.floor(rand() * 60))}`;
        insJournal.run(uid, book.code, book.title, content(), 'approved', submitted < approved ? submitted : `${day} 18:00:00`, approved, null, null, 100);
        journals++;
      }

      // 반려 일지 (일부)
      if (rand() < 0.14 && b < shelf.length) {
        const book = shelf[b++];
        const day = dayBefore(today, 3 + Math.floor(rand() * 20));
        insJournal.run(uid, book.code, book.title, '재미있었다. 다음에도 읽고 싶다. 좋은 책이었다. 추천한다. 재미있었다. 다음에도 읽고 싶다.', 'rejected',
          `${day} 19:10:00`, null, `${day} 21:30:00`, pick(['중복 내용', '분량 부족·내용 불충분']), 0);
        journals++;
      }

      // 승인 대기 일지 (어제·오늘 제출)
      if (rand() < 0.3 && b < shelf.length) {
        const book = shelf[b++];
        const day = dayBefore(today, Math.floor(rand() * 2));
        const time = day === today ? `${now.slice(11, 13)}:00:00` : `${pad(18 + Math.floor(rand() * 4))}:${pad(Math.floor(rand() * 60))}:00`;
        insJournal.run(uid, book.code, book.title, content(), 'pending', `${day} ${time}`, null, null, null, 0);
        journals++;
      }
    }
  }

  const inserted = await insertMany(q, 'users',
    ['phone', 'password_hash', 'name', 'rank', 'birth', 'local_id', 'role', 'consent_at', 'created_at', 'is_sample'], users, 'RETURNING id, phone');
  const idOf = new Map(inserted.map((u) => [u.phone, u.id]));
  await insertMany(q, 'journals', JOURNAL_COLS, journalRows.map(([phone, ...rest]) => [idOf.get(phone), ...rest]));
  await setSetting(q, 'sample_seeded', '1');
  return journals;
}

async function sampleStatus() {
  return {
    soldiers: (await db.get('SELECT COUNT(*)::int AS n FROM users WHERE is_sample = 1')).n,
    journals: (await db.get('SELECT COUNT(*)::int AS n FROM journals WHERE is_sample = 1 OR user_id IN (SELECT id FROM users WHERE is_sample = 1)')).n,
  };
}

function removeSample() {
  return tx(async (q) => {
    const { rowCount: journals } = await q.query('DELETE FROM journals WHERE is_sample = 1 OR user_id IN (SELECT id FROM users WHERE is_sample = 1)');
    const { rowCount: soldiers } = await q.query('DELETE FROM users WHERE is_sample = 1');
    await setSetting(q, 'sample_seeded', 'removed');
    return { soldiers, journals };
  });
}

module.exports = { seedSample, seedNotices, sampleStatus, removeSample, addSampleReading };
