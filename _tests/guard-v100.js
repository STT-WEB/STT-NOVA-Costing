/**
 * ชุดทดสอบกันพัง STT NOVA-Costing v1.0.0
 * รัน: node _tests/guard-v100.js <โฟลเดอร์ที่มี fixture.json>
 * fixture.json = ข้อมูลจริงที่ดึงจาก Drive (สร้างด้วย tools/make_fixture.py)
 * ถ้าไม่ส่งโฟลเดอร์มา จะตรวจเฉพาะโครงสร้างโค้ด (ไม่ต้องมีข้อมูล)
 */
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', 'deploy');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('❌ ' + msg); } }
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.02 : tol); }

/* ---------- 1) โครงสร้างโค้ด ---------- */
const files = fs.readdirSync(D);
const read = f => fs.readFileSync(path.join(D, f), 'utf8');
const cfg = read('00-config.js');
const allow = cfg.match(/var ALLOW = \{([\s\S]*?)\};/)[1];
ok((allow.match(/'\d+'\s*:/g) || []).length === 3, 'ALLOW ต้องมี 3 คนพอดี');
['6100030', '999999', '888888'].forEach(id => ok(allow.indexOf("'" + id + "'") >= 0, 'ALLOW ต้องมี ' + id));
const appjs = files.filter(f => /\.js$/.test(f)).map(read).join('\n');
// ทุกฟังก์ชันที่หน้าเว็บเรียกได้ (ไม่มี _ ท้ายชื่อ) และส่งข้อมูล ต้องเรียก requireAuth_ บรรทัดแรก
['getSnapshot', 'refreshNow', 'getJobPurchase', 'getJobDays', 'whoAmI'].forEach(fn => {
  const m = appjs.match(new RegExp('function ' + fn + '\\s*\\([^)]*\\)\\s*\\{\\s*\\n\\s*(var s = )?requireAuth_\\('));
  ok(!!m, fn + ' ต้องเรียก requireAuth_ เป็นบรรทัดแรก');
});
ok(!/getEffectiveUser/.test(appjs), 'ห้ามใช้ getEffectiveUser');
ok(/UNFORMATTED_VALUE/.test(read('02-io.js')), 'ต้องอ่าน Sheets แบบ UNFORMATTED_VALUE');
ok(!/SpreadsheetApp|Sheets\.|CacheService|DriveApp/.test(read('10-engine.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), '10-engine.js ห้ามเรียกบริการ Google');
ok(!/\.setValue|\.setValues|appendRow|insertSheet|deleteRow/.test(appjs), 'ระบบต้องอ่านอย่างเดียว ห้ามเขียนลง Sheets');
files.filter(f => /\.html$/.test(f)).forEach(f => {
  const s = read(f);
  (s.match(/<script>([\s\S]*?)<\/script>/g) || []).forEach(b => ok(b.indexOf('?>') < 0, f + ': ห้ามมี ?> ในโค้ด JS'));
  (s.match(/include\('([^']+)'\)/g) || []).forEach(m => { const n = m.match(/'([^']+)'/)[1]; ok(files.indexOf(n + '.html') >= 0, f + ' include ไฟล์ที่ไม่มี: ' + n); });
});
files.filter(f => /\.(js|html)$/.test(f)).forEach(f => ok(read(f).split('\n').length <= 1500, f + ' ยาวเกิน 1,500 บรรทัด'));
ok(/COSTING_VERSION = 'v\d+\.\d+\.\d+'/.test(cfg), 'ต้องมี COSTING_VERSION');
const chg = fs.readFileSync(path.join(D, 'CHANGELOG.md'), 'utf8');
ok(chg.indexOf('## ' + cfg.match(/COSTING_VERSION = '([^']+)'/)[1]) >= 0, 'CHANGELOG ต้องมีเวอร์ชันปัจจุบัน');
const man = JSON.parse(read('appsscript.json'));
ok(man.dependencies.enabledAdvancedServices.some(s => s.serviceId === 'sheets'), 'manifest ต้องเปิด Sheets API');
ok(man.webapp && man.webapp.executeAs === 'USER_DEPLOYING', 'web app ต้อง execute as เจ้าของ');

/* ---------- 2) ตัวเลขจากข้อมูลจริง ---------- */
const DATA = process.argv[2];
if (DATA && fs.existsSync(path.join(DATA, 'fixture.json'))) {
  const E = require(path.join(D, '10-engine.js'));
  const inp = JSON.parse(fs.readFileSync(path.join(DATA, 'fixture.json'), 'utf8'));
  const s = E.eBuildSnapshot_(inp);
  const J = {}; s.jobs.forEach(j => J[j.code] = j);

  // 2.1 ค่าแรงรายเดือน = แถว TOTal ของ ACTUAL_WIDE (นับเองจากต้นฉบับ ไม่ใช้โค้ดระบบ)
  const w = inp.hrWide; const hi = w.findIndex(r => r.indexOf('JOB CODE') >= 0);
  const totRow = w.find(r => r.some(x => String(x).indexOf('TOTal ของแต่ละเดือน') >= 0));
  s.months.forEach(m => {
    const c = w[hi].indexOf(m); if (c < 0 || !s.closed[m]) return;
    let sum = 0; s.jobs.forEach(j => sum += j.laborM[m] || 0);
    ok(near(sum, Number(totRow[c]) || 0, 0.05), 'ค่าแรงเดือน ' + m + ' รวมทุกจ๊อบ ' + sum.toFixed(2) + ' ≠ แถว TOTal ' + totRow[c]);
  });
  // 2.2 ต้นทุน NOVA ทุกบาทต้องลงจ๊อบครบ (หารคันแล้วรวมกลับต้องเท่าเดิม)
  let raw = 0; inp.nova.forEach(f => f.tabs.forEach(t => { if (/ยกเลิก/.test(t.title)) return; t.rows.forEach(r => raw += Number(r[2]) || 0); }));
  let alloc = 0; s.jobs.forEach(j => alloc += j.pTotal);
  ok(near(raw, alloc, 1), 'ต้นทุน NOVA ดิบ ' + raw.toFixed(2) + ' ≠ ที่ลงจ๊อบ ' + alloc.toFixed(2));
  ok(near(raw, s.diag.novaCost, 1), 'diag.novaCost ต้องเท่ายอดดิบ');
  // 2.3 ค่าแรงราย Process ของเดือนที่ปิดงวด รวมกลับต้องเท่าค่าแรงจ๊อบเดือนนั้น
  const pj = {}; s.proc.forEach(p => { if (s.closed[p[1]]) { const k = p[0] + '|' + p[1]; pj[k] = (pj[k] || 0) + p[7]; } });
  let bad = 0; s.jobs.forEach(j => { for (const m in j.laborM) { if (!s.closed[m]) continue; if (!near(pj[j.code + '|' + m] || 0, j.laborM[m], 0.6)) bad++; } });
  ok(bad === 0, 'ค่าแรงราย Process รวมกลับไม่เท่าค่าแรงจ๊อบ ' + bad + ' จุด');
  // 2.4 ผรม: ที่นับ + ที่ซ้ำ = ยอดทางการ
  let b2 = 0; s.jobs.forEach(j => { if (!near(j.cHR + j.cHRdup, j.cHRofficial, 0.02)) b2++; });
  ok(b2 === 0, 'cHR + cHRdup ≠ ยอดทางการ ' + b2 + ' จ๊อบ');
  // 2.5 จ๊อบตัวอย่าง (ตัวเลขยืนยันด้วย Python แยกต่างหาก 6 พ.ย. 2569)
  const j1 = J['JT-69/0001'];
  ok(near(j1.sale, 2990654.21), 'JT-69/0001 ราคาขาย');
  ok(near(j1.pTotal, 2071050.43), 'JT-69/0001 ต้นทุน NOVA');
  ok(near(j1.p.c11, 27000) && near(j1.cHRdup, 27000), 'JT-69/0001 ผรม ซ้ำ 27,000 ต้องถูกตัด');
  ok(near(j1.labor, 82026.21), 'JT-69/0001 ค่าแรง STT');
  ok(near(j1.cHRofficial, 161154.64) && near(j1.cHR, 134154.64), 'JT-69/0001 ผรม HR');
  ['JT-69/0002', 'JT-69/0003'].forEach(c => ok(near(J[c].pTotal, 3602077.22 / 2, 0.02), c + ' ต้องได้จัดซื้อครึ่งหนึ่งของแท็บรวม'));
  ok(near(J['JT-69/0002'].labor, 80050.11) && near(J['JT-69/0003'].labor, 80298.47), 'ค่าแรง 0002/0003 ใช้ยอด HR ตามจริง ไม่หาร');
  ok(near(J['JT-69/0003'].cHRdup, 32000), 'JT-69/0003 ส่วนที่ HR ไม่มีบรรทัด 27,000 + 5,000 ต้องจับคู่กับ NOVA');
  const j44 = J['JT-69/0044'];
  ok(near(j44.pTotal, 1111643.3) && near(j44.cHRdup, 8000) && near(j44.sale, 2035000), 'JT-69/0044');
  ok(j44.laborEst > 0 && Object.keys(j44.laborEstM).every(m => !s.closed[m]), 'ประมาณการต้องอยู่เฉพาะเดือนที่ยังไม่ปิดงวด');
  // 2.6 ไม่มีจ๊อบไหนนับค่าแรงเดือนที่ยังไม่ปิดงวดเข้า "จริง"
  let b3 = 0; s.jobs.forEach(j => { let a = j.laborCF; for (const m in j.laborM) if (s.closed[m]) a += j.laborM[m]; if (!near(a, j.labor, 0.05)) b3++; });
  ok(b3 === 0, 'labor ต้อง = ยกมา + เดือนที่ปิดงวด');
  // 2.7 ส่วนต่าง มิ.ย. ต้องชี้ได้ว่าเป็น JMS-69/0235 (แถวซ้ำใน ACTUAL_WIDE)
  ok(s.diag.srcVsWide.some(x => x.job === 'JMS-69/0235' && x.m === '2026-06' && near(x.diff, 1631.05)), 'ต้องหาเจอว่า มิ.ย. ต่าง 1,631.05 จาก JMS-69/0235');
  console.log('ข้อมูลจริง: ' + s.jobs.length + ' จ๊อบ · NOVA ' + raw.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' บาท');
} else {
  console.log('(ข้ามการตรวจตัวเลข — ไม่มี fixture.json)');
}
console.log((fail ? '❌ ' : '✅ ') + 'guard-v100: ผ่าน ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
