# 배포 안내 (GitHub + Vercel + Supabase)

| 서비스 | 하는 일 | 비용 |
|---|---|---|
| **GitHub** | 코드 보관 (비공개 저장소) | 무료 |
| **Supabase** | 데이터베이스 (장병·일지·공지) — 서울 리전 | 무료 플랜 |
| **Vercel** | 웹사이트 서버, `https://○○.vercel.app` 주소 발급 — 서울 리전 | 무료(Hobby) |

GitHub에 코드를 올리면 Vercel이 자동으로 다시 배포합니다.

## 0. 배포 전 반드시 확인

- [ ] **부대 보안 담당 승인:** 장병 개인정보(이름·생년월일·휴대폰 번호·지자체 앱 ID)가 외부 클라우드(Supabase 서울 리전)에 저장됩니다.
- [ ] **개인정보 보유 기간:** 시범 운영 종료일과 파기 방법 확정 (아래 6번)
- [ ] **실제 도서 목록:** 부대 도서관 엑셀 정리 (1열 도서 코드, 2열 제목)
- [ ] Supabase 무료 플랜은 **1주일 동안 접속이 없으면 일시 정지**됩니다. 대시보드에서 "Restore"를 누르면 다시 켜집니다.

## 1. Supabase — 데이터베이스 만들기

1. https://supabase.com 가입 (GitHub 계정으로 로그인 가능)
2. **New project**
   - Name: `book-point`
   - Database Password: **직접 정한 강한 비밀번호** (따로 적어 두기)
   - Region: **Northeast Asia (Seoul)**
3. 프로젝트가 만들어지면 위쪽 **Connect** 버튼 → **Transaction pooler** 의 연결 문자열(URI)을 복사
   - 모양: `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`
   - `[YOUR-PASSWORD]` 부분을 2번에서 정한 비밀번호로 바꾼 것이 **DATABASE_URL** 입니다.

테이블은 앱이 처음 실행될 때 자동으로 만들어집니다. (Supabase 공개 API로는 읽을 수 없도록 RLS가 켜집니다)

## 2. GitHub — 코드 올리기

```bash
gh auth login
gh repo create book-point --private --source . --push
```

## 3. Vercel — 웹사이트 배포

```bash
vercel login
vercel link
vercel env add DATABASE_URL production
vercel env add ADMIN_PASSWORD production
vercel env add SESSION_SECRET production
vercel git connect
vercel deploy --prod
```

| 환경변수 | 값 |
|---|---|
| `DATABASE_URL` | 1번에서 만든 Supabase 연결 문자열 |
| `ADMIN_PASSWORD` | 관리자(`admin`) 로그인 비밀번호 — 8자 이상 |
| `SESSION_SECRET` | 로그인 쿠키 서명용 무작위 문자열 (자동 생성) |
| `SAMPLE_DATA` | (선택) `0`이면 샘플 장병 50명을 만들지 않음 |

배포가 끝나면 `https://book-point-xxxx.vercel.app` 주소가 나옵니다. 이 링크를 장병들에게 공유합니다.

## 4. 첫 로그인과 확인

1. 배포 주소 접속 → ID `admin`, 비밀번호는 `ADMIN_PASSWORD` 값
2. 처음 접속 때 테이블·도서 100권·샘플 장병 50명·공지 3건이 자동으로 만들어집니다 (10초 정도 걸릴 수 있음)
3. 관리자 > 장병 관리 > 원하는 장병의 **체험 기록 넣기**로 체험용 독서 기록 10권을 넣을 수 있습니다

### 실제 도서 목록 넣기

PC에서 (Supabase 연결 문자열을 임시 환경변수로 지정해서) 실행합니다.

```bash
npm run import-books -- 도서목록.xlsx
```

PowerShell에서는 먼저 `$env:DATABASE_URL="연결 문자열"` 을 입력한 뒤 위 명령을 실행합니다. 같은 도서 코드는 제목만 갱신됩니다.

## 5. 운영 중

- **샘플 정리:** 정식 운영 시작 때 관리자 > 장병 관리 > **샘플 데이터 모두 삭제**
- **코드 수정 반영:** GitHub에 올리면(`git push`) Vercel이 자동 재배포
- **오류 확인:** Vercel 대시보드 > 프로젝트 > **Logs**
- **백업:** 월말 명단 엑셀을 따로 보관. (Supabase 무료 플랜은 자동 백업이 제한적)

## 6. 시범 운영 종료 시 파기

1. 마지막 명단 엑셀을 내려받아 지자체에 전달
2. Supabase 프로젝트 **Settings > General > Delete project**
3. Vercel 프로젝트 **Settings > Delete Project**
4. 내려받은 엑셀 파일도 부대 규정에 따라 파기

## 로컬 개발

`npm install` → `npm start` → http://localhost:3000
`DATABASE_URL` 이 없으면 내장 PGlite(로컬 Postgres)를 `data/pgdata` 에 만들어 씁니다.
