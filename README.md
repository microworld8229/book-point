# 책읽는 장병 (MVP)

장병 독서일지 제출 → 관리자 승인 → 지자체 전달용 명단(엑셀) 내보내기까지 처리하는 모바일 웹입니다.
PRD: `PRD_장병독서포인트 2.md` (v1.1)

## 실행

```bash
npm install
npm start
```

- 접속: http://localhost:3000 (같은 와이파이의 휴대폰은 `http://<PC IP>:3000`)
- 첫 실행 시 관리자 계정이 생성됩니다. ID는 `admin`, 비밀번호는 콘솔과 `data/ADMIN_INITIAL_PASSWORD.txt`에 출력됩니다. 로그인 후 바로 변경하고 파일은 지우세요.
- Node.js 22.13 이상 필요 (내장 `node:sqlite` 사용)

## 환경변수

| 이름 | 설명 |
|---|---|
| `PORT` | 포트 (기본 3000) |
| `DATA_DIR` | DB 저장 폴더 (기본 `./data`) |
| `ADMIN_PASSWORD` | 최초 관리자 비밀번호 지정 |
| `SESSION_SECRET` | 세션 서명 키 (미지정 시 `data/.session-secret` 자동 생성) |
| `COOKIE_SECURE` | `1`이면 Secure 쿠키 강제 (HTTPS 배포 시) |

## 배포

외부 휴대폰에서 접속하도록 클라우드에 올리는 방법은 [DEPLOY.md](DEPLOY.md)를 보세요. (`Dockerfile`, Render용 `render.yaml` 포함, 헬스체크 `/healthz`)

## 도서 DB 불러오기

부대 도서관 엑셀(1열 도서 코드, 2열 제목)을 불러옵니다. 같은 코드는 제목이 갱신됩니다.

```bash
npm run import-books -- 도서목록.xlsx
```

DB가 비어 있으면 첫 실행 때 `seed/books.csv`(예시 30권, 코드 `GOC-0001`~`GOC-0030`)가 자동 등록됩니다.

## 구조

- `server.js`: API, 업무 규칙(R1~R9), 엑셀 내보내기
- `db.js`: SQLite 스키마, 비밀번호 해시(scrypt), 초기 데이터
- `public/`: 모바일 웹 화면(S0~S5, 해시 라우팅 SPA)
- `scripts/import-books.js`: 도서 목록 불러오기

## 업무 규칙 구현 요약

- 제출 시: 50~200자(공백 포함, 앞뒤 공백 제외), 도서 코드 존재, 같은 책 대기·승인 일지 중복 차단
- 승인 시: 장병별 제출 순서대로 승인일 기준 일 5건·월 31건까지 승인, 넘는 건은 대기 유지
- 모든 시각은 한국시간(KST) 기준, 포인트 귀속 월 = 승인일이 속한 달
- 장병 화면에는 다른 장병의 실명·생년월일·휴대폰 번호가 나가지 않음 (랭킹은 "계급 + 가운데 가린 이름")
