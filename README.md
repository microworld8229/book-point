# 책읽는 장병 (MVP)

장병 독서일지 제출 → 관리자 승인 → 지자체 전달용 명단(엑셀) 내보내기까지 처리하는 모바일 웹입니다.
PRD: `PRD_장병독서포인트 2.md` (v1.1)

## 실행 (로컬)

```bash
npm install
npm start
```

- 접속: http://localhost:3000 (같은 와이파이의 휴대폰은 `http://<PC IP>:3000`)
- `DATABASE_URL`이 없으면 내장 PGlite(로컬 Postgres)를 `data/pgdata`에 만들어 씁니다.
- 첫 실행 시 관리자 계정이 생성됩니다. ID는 `admin`, 비밀번호는 콘솔과 `data/ADMIN_INITIAL_PASSWORD.txt`에 출력됩니다.
- Node.js 22 이상 필요

## 배포

GitHub + Vercel + Supabase로 배포합니다. 절차는 [DEPLOY.md](DEPLOY.md)를 보세요.

## 환경변수

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | Postgres 연결 문자열 (Supabase Transaction pooler). 없으면 로컬 PGlite |
| `ADMIN_PASSWORD` | 최초 관리자 비밀번호 |
| `SESSION_SECRET` | 세션 서명 키 (운영 필수, 로컬은 `data/.session-secret` 자동 생성) |
| `SAMPLE_DATA` | `0`이면 첫 실행 때 샘플 장병 50명을 만들지 않음 |
| `PORT` | 로컬 포트 (기본 3000) |
| `DATA_DIR` | 로컬 DB 폴더 (기본 `./data`) |

## 샘플 데이터

처음 방문한 장병이 랭킹·현황 화면을 이해할 수 있도록, 첫 실행 때 **샘플 장병 50명**(일지 약 650건)과 기본 공지 3건이 자동으로 들어갑니다.

- 샘플은 랭킹에 "샘플" 표시가 붙고, **엑셀 명단에서는 자동으로 빠집니다.**
- 관리자 > 장병 관리 > **샘플 데이터 모두 삭제**로 한 번에 지울 수 있으며, 지운 뒤에는 다시 만들지 않습니다.
- 가입한 계정에 체험용 독서 기록(승인 10권 + 대기·반려 각 1건)을 넣으려면 관리자 > 장병 관리 > **체험 기록 넣기**, 또는:

```bash
npm run add-sample-reading -- 01012345678 10
```

## 도서 DB 불러오기

부대 도서관 엑셀(1열 도서 코드, 2열 제목)을 불러옵니다. 같은 코드는 제목이 갱신됩니다.

```bash
npm run import-books -- 도서목록.xlsx
```

DB가 비어 있으면 첫 실행 때 `seed/books.csv`(예시 100권, 코드 `GOC-0001`~`GOC-0100`)가 자동 등록됩니다.

## 구조

- `server.js`: API, 업무 규칙(R1~R9), 엑셀 내보내기 (로컬 실행 + Vercel 함수 공용)
- `api/index.js`, `vercel.json`: Vercel 배포 설정 (서울 리전 `icn1`)
- `db.js`: Postgres 연결(Supabase/PGlite), 스키마, 비밀번호 해시(scrypt), 초기 데이터
- `sample.js`: 샘플 장병·공지·체험 기록
- `public/`: 모바일 웹 화면(해시 라우팅 SPA)
- `scripts/`: 도서 목록 불러오기, 체험 기록 넣기

## 업무 규칙 구현 요약

- 제출 시: 50~200자(공백 포함, 앞뒤 공백 제외), 도서 코드 존재, 같은 책 대기·승인 일지 중복 차단
- 승인 시: 장병별 제출 순서대로 승인일 기준 일 5건·월 31건까지 승인, 넘는 건은 대기 유지
- 모든 시각은 한국시간(KST) 기준, 포인트 귀속 월 = 승인일이 속한 달
- 장병 화면에는 다른 장병의 실명·생년월일·휴대폰 번호가 나가지 않음 (랭킹은 "계급 + 가운데 가린 이름")
