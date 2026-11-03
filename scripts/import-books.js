// 부대 도서관 도서 목록(엑셀/CSV)을 도서 DB로 불러온다.
// 사용법: npm run import-books -- <파일.xlsx|파일.csv>
// 첫 번째 열 = 도서 코드, 두 번째 열 = 도서 제목 (첫 행이 머리글이면 자동으로 건너뜀)
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { upsertBooks, parseCsvLine } = require('../db');

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('사용법: npm run import-books -- <파일.xlsx|파일.csv>');
    process.exit(1);
  }

  let rows;
  if (path.extname(file).toLowerCase() === '.csv') {
    rows = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.worksheets[0];
    rows = [];
    ws.eachRow((row) => {
      const cell = (i) => {
        const v = row.getCell(i).value;
        return v && typeof v === 'object' ? (v.text ?? v.result ?? '') : (v ?? '');
      };
      rows.push([String(cell(1)).trim(), String(cell(2)).trim()]);
    });
  }

  if (rows.length && /코드|code/i.test(rows[0][0])) rows.shift();
  const count = upsertBooks(rows);
  console.log(`도서 ${count}권을 불러왔습니다.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
