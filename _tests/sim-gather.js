/**
 * จำลอง Google Sheets API แล้วรันโค้ดฝั่งเซิร์ฟเวอร์จริง (02-io.js + 20-build.js gatherNova_)
 * เพื่อจับบั๊กแบบ v1.1.0 (ชื่อแท็บจริงมี "/" → อ่าน NOVA ได้ 0 แท็บ) ก่อนขึ้นระบบ
 * รัน: node _tests/sim-gather.js <โฟลเดอร์ที่มี nova_full.json + fixture.json>
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const D = path.join(__dirname, '..', 'deploy'), DATA = process.argv[2];
const NOVA = JSON.parse(fs.readFileSync(path.join(DATA, 'nova_full.json'), 'utf8'));

function colNum(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
function parseRange(r) {               // 'title'!A2:B12  |  'title'!AO11:AO  |  'title'
  const m = r.match(/^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?)?$/);
  if (!m) throw new Error('ช่วงผิดรูปแบบ: ' + r);
  return { title: m[1].replace(/''/g, "'"), c1: m[2] ? colNum(m[2]) : 0, r1: m[3] ? +m[3] - 1 : 0, c2: m[4] ? colNum(m[4]) : 999, r2: m[5] ? +m[5] - 1 : 1e9 };
}
function slice(fid, r) {
  const p = parseRange(r), v = NOVA[fid][p.title];
  if (!v) throw new Error('ไม่มีแท็บ ' + p.title);
  const out = [];
  for (let i = p.r1; i <= Math.min(p.r2, v.length - 1); i++) {
    const row = (v[i] || []).slice(p.c1, p.c2 + 1);
    while (row.length && (row[row.length - 1] === '' || row[row.length - 1] === null)) row.pop();
    out.push(row);
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}
let calls = 0, quotaHits = 0, sleeps = 0;
const DRV = {}, PROPS = {};
const ctx = {
  console, JSON, Math, Date, Object, Array, String, Number, RegExp, isFinite,
  Sheets: { Spreadsheets: {
    get: (fid) => ({ sheets: Object.keys(NOVA[fid]).map((t, i) => ({ properties: { title: t, sheetId: i } })) }),
    Values: {
      batchGet: (fid, o) => {
        calls++;
        if (calls % 7 === 0 && quotaHits < 6) { quotaHits++; throw new Error('Quota exceeded for quota metric Read requests per minute per user'); }  // จำลองโดนโควตา
        if (o.ranges.length > 120) throw new Error('เกิน 120 ช่วง');
        return { valueRanges: o.ranges.map(r => ({ range: r, values: slice(fid, r) })) };
      },
      get: (fid, r) => ({ values: slice(fid, r) })
    } } },
  Utilities: { sleep: () => { sleeps++; } },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => PROPS[k] || null, setProperty: (k, v) => { PROPS[k] = v; }, deleteProperty: k => { delete PROPS[k]; } }) },
  DriveApp: {
    getFileById: id => { if (/^FID_/.test(id)) return { getLastUpdated: () => new Date(1794000000000) };
      if (!DRV[id]) throw new Error('no file'); return { getBlob: () => ({ getDataAsString: () => DRV[id] }), setContent: c => { DRV[id] = c; } }; },
    createFile: (n, c) => { const id = 'D' + Object.keys(DRV).length; DRV[id] = c; return { getId: () => id }; }
  }
};
vm.createContext(ctx);
['10-engine.js', '02-io.js', '20-build.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(D, f), 'utf8'), ctx, { filename: f }));
// REGISTRY จำลอง: 2 ไฟล์
ctx.novaFiles_ = () => [{ fileType: 'JT', fileId: 'FID_JT', fileName: 'STT-DB-JT-2569' }, { fileType: 'JM', fileId: 'FID_JM', fileName: 'STT-DB-JM-2569' }];
const nova = vm.runInContext('gatherNova_()', ctx);
// รอบ 2: ไฟล์ไม่ได้แก้ → ต้องใช้ผลเดิม ไม่ยิง API อ่านใหม่
const callsBefore = calls;
const nova2 = vm.runInContext('gatherNova_()', ctx);
// รอบ 3: หมดเวลาแล้ว + ไฟล์ถูกแก้ → ต้องใช้ผลรอบก่อนแบบ stale ไม่ล้ม
ctx.DriveApp.getFileById = (orig => id => /^FID_/.test(id) ? { getLastUpdated: () => new Date(1794000099999) } : orig(id))(ctx.DriveApp.getFileById);
const nova3 = vm.runInContext('gatherNova_(Date.now() - 999999)', ctx);
const inp = JSON.parse(fs.readFileSync(path.join(DATA, 'fixture.json'), 'utf8'));
inp.nova = nova;
const s = ctx.eBuildSnapshot_(inp);
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('❌ ' + m); } };
nova.forEach(f => ok(f.tabs.length > 0, f.fileName + ' อ่านได้ 0 แท็บ'));
ok(quotaHits > 0 && sleeps >= quotaHits, 'ต้องรอแล้วลองใหม่เมื่อโดนโควตา (โดน ' + quotaHits + ' · รอ ' + sleeps + ')');
ok(calls === callsBefore, 'รอบ 2 ไฟล์ไม่ได้แก้ ต้องไม่อ่านใหม่ (ยิงเพิ่ม ' + (calls - callsBefore) + ')');
ok(nova2.every(f => /ไม่มีการแก้/.test(f.state) && f.tabs.length > 0), 'รอบ 2 ต้องใช้ผลเดิม');
ok(nova3.every(f => f.stale && f.tabs.length > 0), 'รอบ 3 หมดเวลา ต้องใช้ผลรอบก่อนแบบ stale');
ok(nova.every(f => f.schema === 2), 'แคชต้องติด schema 2');
(function () { let n = 0; nova.forEach(f => f.tabs.forEach(t => t.rows.forEach(r => { if (/^JT-69\/000[23]$/.test(String(r[3] || '').trim())) n++; }))); ok(n > 0, 'ต้องอ่านคอลัมน์ หมายเหตุจาก BOM (ระบุคัน) ได้'); })();
ok(nova.every(f => !f.skipped.length), 'มีแท็บที่ข้าม: ' + JSON.stringify(nova.map(f => f.skipped)));
// เทียบกับ fixture (ที่ make_fixture.py อ่านจาก xlsx ตรง ๆ)
const fx = JSON.parse(fs.readFileSync(path.join(DATA, 'fixture.json'), 'utf8')).nova;
let a = 0, b = 0; fx.forEach(f => f.tabs.forEach(t => t.rows.forEach(r => a += Number(r[2]) || 0)));
nova.forEach(f => f.tabs.forEach(t => t.rows.forEach(r => b += Number(r[2]) || 0)));
ok(Math.abs(a - b) < 0.01, 'ยอด NOVA ผ่านโค้ดเซิร์ฟเวอร์ ' + b.toFixed(2) + ' ≠ อ่านตรง ' + a.toFixed(2));
const j = s.jobs.find(x => x.code === 'JT-69/0044');
ok(j && Math.abs(j.pTotal - 1111643.3) < 0.02, 'JT-69/0044 ผ่านโค้ดเซิร์ฟเวอร์');
console.log('API batchGet ' + callsBefore + ' ครั้ง · โดนโควตาจำลอง ' + quotaHits + ' ครั้ง');
console.log('แท็บที่อ่าน: ' + nova.map(f => f.fileName + ' ' + f.tabs.length).join(' · ') + ' · ยอด ' + b.toLocaleString('en-US', { maximumFractionDigits: 2 }));
console.log((fail ? '❌' : '✅') + ' sim-gather: ' + (fail ? fail + ' ข้อไม่ผ่าน' : 'ผ่าน'));
process.exit(fail ? 1 : 0);
