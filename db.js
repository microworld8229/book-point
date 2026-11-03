// SQLite(내장 node:sqlite) 연결, 스키마, 초기 데이터
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    phone         TEXT NOT NULL UNIQUE,          -- 로그인 ID (관리자는 'admin')
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    rank          TEXT NOT NULL,
    birth         TEXT NOT NULL DEFAULT '',      -- YYYY-MM-DD
    local_id      TEXT NOT NULL DEFAULT '',      -- 지자체 앱 회원 ID
    role          TEXT NOT NULL DEFAULT 'soldier' CHECK (role IN ('soldier', 'admin')),
    consent_at    TEXT,
    created_at    TEXT NOT NULL,
    must_change_pw INTEGER NOT NULL DEFAULT 0,
    token_version INTEGER NOT NULL DEFAULT 0     -- 비밀번호 변경·초기화 시 기존 로그인 무효화
  );

  CREATE TABLE IF NOT EXISTS books (
    code  TEXT PRIMARY KEY COLLATE NOCASE,
    title TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS journals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    book_code     TEXT NOT NULL,
    title         TEXT NOT NULL,
    content       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    submitted_at  TEXT NOT NULL,                 -- 재제출 시 갱신
    approved_at   TEXT,                          -- 한도·포인트 귀속 월 기준
    rejected_at   TEXT,
    reject_reason TEXT,
    points        INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_journals_user ON journals(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(status, approved_at);

  CREATE TABLE IF NOT EXISTS notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    important  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// 기존 DB 마이그레이션: 샘플 장병·샘플 일지 구분 컬럼 (샘플은 엑셀 명단에서 제외)
for (const table of ['users', 'journals']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'is_sample')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0`);
  }
}

const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

// 모든 시각은 한국시간(KST) 'YYYY-MM-DD HH:MM:SS' 문자열로 저장한다.
function kstNow() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// 세션 서명 키: 환경변수 우선, 없으면 data/ 에 생성해 재시작 후에도 유지
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(file, 'utf8').trim();
}

// CSV 한 줄 파싱 (따옴표 지원)
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// [[code, title], ...] 를 도서 DB에 반영 (같은 코드는 제목 갱신)
function upsertBooks(rows) {
  const stmt = db.prepare(
    'INSERT INTO books (code, title) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET title = excluded.title'
  );
  let count = 0;
  tx(() => {
    for (const [code, title] of rows) {
      if (!code || !title) continue;
      stmt.run(String(code).trim(), String(title).trim());
      count++;
    }
  });
  return count;
}

function seed() {
  // 도서 DB가 비어 있으면 seed/books.csv 로 초기화
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM books').get();
  const seedFile = path.join(__dirname, 'seed', 'books.csv');
  if (n === 0 && fs.existsSync(seedFile)) {
    const lines = fs.readFileSync(seedFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const rows = lines.map(parseCsvLine).filter((r, i) => !(i === 0 && /코드|code/i.test(r[0])));
    const count = upsertBooks(rows);
    console.log(`[seed] 도서 ${count}권 등록`);
  }

  // 관리자 계정이 없으면 1개 생성
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (!admin) {
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
    db.prepare(
      `INSERT INTO users (phone, password_hash, name, rank, role, created_at, must_change_pw)
       VALUES ('admin', ?, '관리자', '관리자', 'admin', ?, ?)`
    ).run(hashPassword(password), kstNow(), process.env.ADMIN_PASSWORD ? 0 : 1);
    // 운영(클라우드)에서는 평문 파일을 남기지 않는다
    if (!process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== 'production') {
      fs.writeFileSync(path.join(DATA_DIR, 'ADMIN_INITIAL_PASSWORD.txt'), `ID: admin\nPW: ${password}\n`);
    }
    // 환경변수로 지정한 비밀번호는 로그에 남기지 않는다
    const shown = process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD 값)' : `${password}  (로그인 후 비밀번호를 변경하세요)`;
    console.log(`[seed] 관리자 계정 생성 - ID: admin / PW: ${shown}`);
  }
}

module.exports = { db, tx, kstNow, hashPassword, verifyPassword, loadSecret, upsertBooks, parseCsvLine, seed, getSetting, setSetting, DATA_DIR };
