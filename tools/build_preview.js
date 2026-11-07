// ประกอบไฟล์ตัวอย่าง (preview) จากโค้ดจริงใน deploy/ + ข้อมูลจริง (snapshot) — ใช้ตรวจหน้าตาก่อนขึ้นระบบ
// การเรียก google.script.run ถูกแทนด้วยตัวจำลองที่ตอบจากข้อมูลจริงที่ดึงไว้
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', 'deploy');
const E = require(path.join(D, '10-engine.js'));
const DATA = process.argv[2], OUT = process.argv[3];
const inp = JSON.parse(fs.readFileSync(path.join(DATA, 'fixture.json'), 'utf8'));
const snap = E.eBuildSnapshot_(inp); snap.version = (fs.readFileSync(path.join(D, '00-config.js'), 'utf8').match(/COSTING_VERSION = '([^']+)'/) || [])[1]; snap.builtAt = new Date().toISOString();
snap.timing = {};
const buy = JSON.parse(fs.readFileSync(path.join(DATA, 'mock_buy.json'), 'utf8'));
const cfg = fs.readFileSync(path.join(D, '00-config.js'), 'utf8');
const ver = (cfg.match(/COSTING_VERSION = '([^']+)'/) || [])[1];

// วันทำงานของจ๊อบ JT-69 ทั้งหมด (ตัวจำลอง)
const days = {};
snap.jobs.filter(j => /^JT-69\//.test(j.code)).forEach(j => { days[j.code] = E.eJobDays_(inp.logs, inp.tsd, j.code); });
const buyByJob = {};
Object.keys(snap.novaIndex).forEach(code => {
  buyByJob[code] = snap.novaIndex[code].map(x => Object.assign({ units: x.units }, buy[x.title] || { title: x.title, cols: [], rows: [] }));
});

let html = fs.readFileSync(path.join(D, 'Index.html'), 'utf8');
html = html.replace(/<\?!= include\('([^']+)'\) \?>/g, (m, n) => fs.readFileSync(path.join(D, n + '.html'), 'utf8'));
html = html.replace(/<\?= version \?>/g, ver);
if (/<\?/.test(html)) throw new Error('ยังมี template tag เหลือ');

const mock = `<script>
/* ===== ตัวจำลอง google.script.run (เฉพาะไฟล์ตัวอย่าง) ===== */
var __SNAP = ${JSON.stringify(JSON.stringify(snap))};
var __BUY = ${JSON.stringify(buyByJob)};
var __DAYS = ${JSON.stringify(days)};
var google = { script: { run: (function () {
  function mk(ok, fail) {
    var api = {
      withSuccessHandler: function (f) { return mk(f, fail); },
      withFailureHandler: function (f) { return mk(ok, f); },
      login: function (e, p) { setTimeout(function () { ok(String(e) === '6100030' ? { ok: true, token: 'a'.repeat(64), name: 'คุณ ศศิภา กัลยาณมิตร' } : { ok: false, msg: 'รหัสพนักงานนี้ไม่มีสิทธิ์เข้าโปรแกรม STT NOVA-Costing' }); }, 150); },
      whoAmI: function () { setTimeout(function () { ok({ name: 'คุณ ศศิภา กัลยาณมิตร' }); }, 50); },
      logout: function () { ok && ok({ ok: true }); },
      getSnapshot: function () { setTimeout(function () { ok(__SNAP); }, 200); },
      refreshNow: function () { setTimeout(function () { ok({ ok: true, jobs: 0, ms: 1000 }); }, 300); },
      getJobPurchase: function (t, c) { setTimeout(function () { ok({ code: c, tabs: __BUY[c] || [], novaUrl: '' }); }, 200); },
      getJobDays: function (t, c) { setTimeout(function () { ok({ code: c, rows: __DAYS[c] || [] }); }, 200); }
    };
    return api;
  }
  return mk(null, null);
})() } };
</script>`;
html = html.replace('<?!= include', '').replace('</head>', mock + '\n</head>');
fs.writeFileSync(OUT, html);
console.log('preview', OUT, (html.length / 1e6).toFixed(2) + ' MB', 'version', ver);
