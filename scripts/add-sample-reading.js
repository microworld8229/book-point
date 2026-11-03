// 가입된 계정에 체험용 샘플 독서활동(승인 N건 + 대기 1건 + 반려 1건)을 넣는다.
// 샘플 일지는 엑셀 명단에서 제외되고, 관리자 "샘플 데이터 삭제" 때 함께 지워진다.
// (관리자 화면 > 장병 관리 > "체험 기록 넣기" 버튼으로도 할 수 있다)
// 사용법: npm run add-sample-reading -- <휴대폰 번호> [승인 건수=10]
const { db } = require('../db');
const { addSampleReading } = require('../sample');

(async () => {
  const phone = String(process.argv[2] || '').replace(/[^0-9]/g, '');
  const count = Number(process.argv[3]) || 10;
  const user = await db.get("SELECT id, name, rank FROM users WHERE phone = $1 AND role = 'soldier'", [phone]);
  if (!user) {
    console.error('가입된 장병 계정을 찾을 수 없습니다. 사용법: npm run add-sample-reading -- <휴대폰 번호> [건수]');
    process.exitCode = 1;
  } else {
    const r = await addSampleReading(user.id, count);
    console.log(`${user.rank} ${user.name}: 승인 ${r.approved}건, 대기 ${r.pending}건, 반려 ${r.rejected}건 샘플 일지를 넣었습니다.`);
  }
  await db.close();
})().catch((err) => { console.error(err.message); process.exit(1); });
