/**
 * STT NOVA-Costing
 * 99-diag.js — ตรวจระบบด้วยการวัดจริง (อ่านอย่างเดียว รันได้ปลอดภัยเสมอ)
 *
 * วิธีใช้: เปิด Apps Script → เลือกฟังก์ชัน → Run → ก๊อป Log มาให้ Candy ทั้งหมด
 *   costingSelfTest()  ตรวจว่าเปิดไฟล์ทุกแหล่งได้ไหม + สร้างผลคำนวณ 1 รอบ + จับเวลา
 *   setupAuto()        ติดตั้งตัวอัปเดตอัตโนมัติทุก 10 นาที (ปกติระบบติดตั้งเองตอนเปิดเว็บครั้งแรก)
 *   showAccessLog()    ดูว่าใครเข้าใช้/กดอัปเดตเมื่อไหร่
 */

function costingSelfTest() {
  var L = [];
  function log(s) { L.push(s); Logger.log(s); }
  log('STT NOVA-Costing ' + COSTING_VERSION + ' · engine ' + ENGINE_VERSION);
  [['MASTER', CFG.MASTER], ['HR', CFG.HR], ['JOBLOG', CFG.JOBLOG]].forEach(function (x) {
    try { log('✅ เปิดได้ ' + x[0] + ' — ' + listTabs_(x[1]).length + ' แท็บ'); }
    catch (e) { log('❌ เปิดไม่ได้ ' + x[0] + ' — ' + e.message); }
  });
  try {
    novaFiles_().forEach(function (f) {
      try { log('✅ NOVA ' + f.fileName + ' — ' + listTabs_(f.fileId).filter(function (t) { return eIsNovaJobTab_(t.title); }).length + ' แท็บจ๊อบ'); }
      catch (e) { log('❌ NOVA ' + f.fileName + ' — ' + e.message); }
    });
  } catch (e) { log('❌ REGISTRY — ' + e.message); }
  try {
    var u = readUsers_();
    Object.keys(ALLOW).forEach(function (k) { log((u[k] && u[k].pin ? '✅ ' : '❌ ') + 'ผู้ใช้ ' + k + ' ' + ALLOW[k] + (u[k] && u[k].pin ? ' มี PIN' : ' ไม่พบ/ไม่มี PIN')); });
  } catch (e) { log('❌ USERS — ' + e.message); }
  var r = rebuild_();
  log('สร้างผลคำนวณ: ' + JSON.stringify(r));
  var snap = JSON.parse(snapLoad_());
  log('เวลาแต่ละส่วน (ms): ' + JSON.stringify(snap.timing));
  log('จ๊อบ ' + snap.jobs.length + ' · แท็บ NOVA ' + snap.diag.novaTabs + ' · บรรทัด ' + snap.diag.novaLines +
      ' · ต้นทุน NOVA รวม ' + Math.round(snap.diag.novaCost).toLocaleString());
  snap.monthCheck.forEach(function (m) {
    log(m.m + (m.closed ? ' ปิดงวด' : ' ยังไม่ปิด') + ' HR ใส่ ' + m.hrInput + ' · รวมจ๊อบ ' + m.sumJobs + ' · ต่าง ' + m.diff + ' · ประมาณการ ' + m.est);
  });
  return L.join('\n');
}

function setupAuto() { ensureTrigger_(); Logger.log('ติดตั้งตัวอัปเดตอัตโนมัติแล้ว ทุก ' + CFG.AUTO_MIN + ' นาที'); }

function showAccessLog() {
  Logger.log(PropertiesService.getScriptProperties().getProperty('ACCESS_LOG') || '[]');
}
