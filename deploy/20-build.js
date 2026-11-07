/**
 * STT NOVA-Costing
 * 20-build.js — ดึงข้อมูลจากทุกแหล่ง → ส่งให้สมองคำนวณ (10-engine.js) → เก็บผล
 *
 * แหล่งข้อมูล (อ่านอย่างเดียว)
 *  NOVA   : ทุกไฟล์ใน REGISTRY (source = NOVA, Active ≠ N) → ทุกแท็บจ๊อบ → คอลัมน์ หมวด / สรุป Supplier / ต้นทุนเข้าจ๊อบ
 *  MASTER : Budget Cost Sales JT / JM (ราคาขาย)
 *  HR     : JOB_MASTER (ทะเบียนจ๊อบ) · ACTUAL_WIDE · Sale Budget (A:C) · Estimate Budget · Cost ผรม to HR · Cost ผรม พนักงาน STT… · SRC_YYYY_MM
 *  JOBTRACK: Job_Log_YYYY_MM ทุกเดือน · TIMESHEET_DIRECT…
 */

function gatherNova_() {
  var files = novaFiles_();
  return files.map(function (f) {
    var tabs = listTabs_(f.fileId).filter(function (t) { return eIsNovaJobTab_(t.title); });
    // รอบ 1: หัวแท็บ (A2:B12) + แถวหัวตาราง (A9:BZ12)
    var ranges = [];
    tabs.forEach(function (t) { ranges.push(q_(t.title) + '!A2:B12'); ranges.push(q_(t.title) + '!A9:BZ12'); });
    var got = batchGet_(f.fileId, ranges);
    var want = [], meta = [];
    tabs.forEach(function (t, i) {
      var head = eNovaHead_(got[i * 2] || []);
      var hdrBlock = got[i * 2 + 1] || [];
      var hdrRow = -1, hdr = null;
      for (var r = 0; r < hdrBlock.length; r++) {
        if (String((hdrBlock[r] || [])[0] || '').trim() === 'หมวด') { hdrRow = 9 + r; hdr = hdrBlock[r]; break; }
      }
      if (!hdr) { meta.push({ t: t, head: head, skip: 'ไม่พบหัวตาราง "หมวด"' }); return; }
      var c = eNovaCols_(hdr);
      if (c.cost < 0) { meta.push({ t: t, head: head, skip: 'ไม่พบคอลัมน์ ต้นทุนเข้าจ๊อบ' }); return; }
      var start = hdrRow + 1;
      var m = { t: t, head: head, idx: want.length, hasV: c.vendor >= 0 };
      want.push(q_(t.title) + '!' + colA1_(c.cat) + start + ':' + colA1_(c.cat));
      want.push(q_(t.title) + '!' + colA1_(c.cost) + start + ':' + colA1_(c.cost));
      if (c.vendor >= 0) want.push(q_(t.title) + '!' + colA1_(c.vendor) + start + ':' + colA1_(c.vendor));
      meta.push(m);
    });
    // รอบ 2: 3 คอลัมน์ของทุกแท็บ
    var cols = batchGet_(f.fileId, want);
    var out = [], skipped = [];
    meta.forEach(function (m) {
      if (m.skip) { skipped.push({ tab: m.t.title, why: m.skip }); return; }
      var cat = cols[m.idx] || [], cost = cols[m.idx + 1] || [], ven = m.hasV ? (cols[m.idx + 2] || []) : [];
      var n = Math.max(cat.length, cost.length), rows = [];
      for (var i = 0; i < n; i++) {
        rows.push([(cat[i] || [])[0], (ven[i] || [])[0], (cost[i] || [])[0]]);
      }
      out.push({ title: m.t.title, sheetId: m.t.sheetId, head: m.head, rows: rows });
    });
    return { fileType: f.fileType, fileId: f.fileId, fileName: f.fileName, tabs: out, skipped: skipped };
  });
}

function gatherAll_() {
  var t0 = Date.now(), timing = {};
  var input = { builtAt: new Date().toISOString() };

  input.nova = gatherNova_(); timing.nova = Date.now() - t0;

  var t1 = Date.now();
  input.salesJT = readTab_(CFG.MASTER, CFG.TAB.SALES_JT);
  input.salesJM = readTab_(CFG.MASTER, CFG.TAB.SALES_JM);
  timing.sales = Date.now() - t1;

  var t2 = Date.now();
  var hrTabs = listTabs_(CFG.HR).map(function (x) { return x.title; });
  input.jobMaster  = readTab_(CFG.HR, CFG.TAB.JOB_MASTER);
  input.hrWide     = readTab_(CFG.HR, CFG.TAB.HR_WIDE);
  input.saleBudget = readTab_(CFG.HR, CFG.TAB.SALE_BUDGET, 'A:C');
  input.estBudget  = readTab_(CFG.HR, CFG.TAB.EST_BUDGET);
  input.contrHR    = readTab_(CFG.HR, CFG.TAB.CONTR_HR);
  var sttTab = hrTabs.filter(function (t) { return t.indexOf(CFG.TAB.CONTR_STT_PREFIX) === 0; })[0];
  input.contrSTT = sttTab ? readTab_(CFG.HR, sttTab) : [];
  input.src = {};
  var srcTabs = hrTabs.filter(function (t) { return /^SRC_\d{4}_\d{2}$/.test(t); });
  var srcVals = batchGet_(CFG.HR, srcTabs.map(function (t) { return q_(t); }));
  srcTabs.forEach(function (t, i) { var m = t.match(/(\d{4})_(\d{2})/); input.src[m[1] + '-' + m[2]] = srcVals[i]; });
  timing.hr = Date.now() - t2;

  var t3 = Date.now();
  var logTabs = listTabs_(CFG.JOBLOG).map(function (x) { return x.title; });
  var lt = logTabs.filter(function (t) { return /^Job_Log_\d{4}_\d{2}$/.test(t); });
  var tt = logTabs.filter(function (t) { return /^TIMESHEET_DIRECT/i.test(t); });
  var lv = batchGet_(CFG.JOBLOG, lt.concat(tt).map(function (t) { return q_(t); }));
  input.logs = lt.map(function (t, i) { return { title: t, values: lv[i] }; });
  input.tsd = tt.map(function (t, i) { return { title: t, values: lv[lt.length + i] }; });
  timing.jobtrack = Date.now() - t3;

  input._timing = timing;
  return input;
}

/** สร้างผลคำนวณใหม่ทั้งหมด (ล็อกกันคนกดพร้อมกัน) */
function rebuild_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { busy: true };
  try {
    var t0 = Date.now();
    var input = gatherAll_();
    var tg = Date.now() - t0;
    var snap = eBuildSnapshot_(input);
    snap.version = COSTING_VERSION;
    snap.timing = input._timing; snap.timing.gather = tg; snap.timing.total = Date.now() - t0;
    snap.diag.novaSkipped = [];
    input.nova.forEach(function (f) { (f.skipped || []).forEach(function (s) { s.file = f.fileName; snap.diag.novaSkipped.push(s); }); });
    var json = JSON.stringify(snap);
    snapSave_(json);
    PropertiesService.getScriptProperties().setProperty('SNAP_AT', snap.builtAt);
    return { ok: true, builtAt: snap.builtAt, ms: snap.timing.total, jobs: snap.jobs.length, size: json.length };
  } finally {
    lock.releaseLock();
  }
}

/** ตัวตั้งเวลา: อัปเดตอัตโนมัติทุก CFG.AUTO_MIN นาที (ติดตั้งให้เองครั้งแรกที่มีคนเปิดใช้) */
function ensureTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoRebuild'; });
  if (!has) ScriptApp.newTrigger('autoRebuild').timeBased().everyMinutes(CFG.AUTO_MIN).create();
}

function autoRebuild() { rebuild_(); }

/* ======================= ฟังก์ชันที่หน้าเว็บเรียก ======================= */

/** ข้อมูลทั้งหมดของหน้าเว็บ (ผลคำนวณล่าสุด) */
function getSnapshot(token) {
  requireAuth_(token);
  try { ensureTrigger_(); } catch (e) {}
  var json = snapLoad_();
  if (!json) { rebuild_(); json = snapLoad_(); }
  return json;
}

/** ปุ่ม "อัปเดตตอนนี้" */
function refreshNow(token) {
  var s = requireAuth_(token);
  logAccess_(s.emp, 'refresh');
  var r = rebuild_();
  if (r.busy) return { ok: false, msg: 'ระบบกำลังอัปเดตอยู่แล้ว รอสักครู่แล้วกดโหลดใหม่' };
  return r;
}

/** รายการจัดซื้อรายบรรทัดของจ๊อบ (สด จากแท็บ NOVA) */
function getJobPurchase(token, code) {
  requireAuth_(token);
  var json = snapLoad_(); if (!json) throw new Error('ยังไม่มีข้อมูล กรุณากดอัปเดต');
  var snap = JSON.parse(json);
  var idx = snap.novaIndex[code] || [];
  var keep = ['หมวด', 'ประเภท', 'Code', 'PART NAME', 'DESCRIPTION', "Q'TY", 'หน่วย(BOM)', 'MY ACC CODE', 'MY ACC GOOD NAME',
              'มีของ/ไม่มีของ', 'จำนวนที่ต้องซื้อ', 'POR NO.', 'สรุป Supplier', 'Price/EA', 'วันที่รับสินค้า', 'ต้นทุนเข้าจ๊อบ', 'เปิด PO'];
  var tabs = idx.map(function (x) {
    var v = readTab_(x.fileId, x.title, 'A1:BZ');
    var h = -1;
    for (var i = 0; i < Math.min(v.length, 20); i++) if (String((v[i] || [])[0] || '').trim() === 'หมวด') { h = i; break; }
    if (h < 0) return { title: x.title, units: x.units, error: 'ไม่พบหัวตาราง' };
    var ci = keep.map(function (k) { return eCol_(v[h], [k]); });
    var rows = [];
    for (var r = h + 1; r < v.length; r++) {
      var row = v[r] || [];
      var cost = eNum_(row[ci[keep.length - 2]]);
      var any = false; for (var a = 0; a < 6; a++) if (String(row[a] || '').trim()) any = true;
      if (!any && !cost) continue;
      rows.push(ci.map(function (c, k) {
        var val = c >= 0 ? row[c] : '';
        if (keep[k] === 'วันที่รับสินค้า' && typeof val === 'number') val = eDate_(val);
        return val === undefined ? '' : val;
      }));
    }
    return { title: x.title, units: x.units, fileId: x.fileId, sheetId: x.sheetId, cols: keep, rows: rows };
  });
  return { code: code, tabs: tabs, novaUrl: PropertiesService.getScriptProperties().getProperty('NOVA_URL') || '' };
}

/** วันทำงานรายวันของจ๊อบ (สด จาก JOBTRACK + Timesheet HR) */
function getJobDays(token, code) {
  requireAuth_(token);
  var tabs = listTabs_(CFG.JOBLOG).map(function (x) { return x.title; });
  var lt = tabs.filter(function (t) { return /^Job_Log_\d{4}_\d{2}$/.test(t); });
  var tt = tabs.filter(function (t) { return /^TIMESHEET_DIRECT/i.test(t); });
  var lv = batchGet_(CFG.JOBLOG, lt.concat(tt).map(function (t) { return q_(t); }));
  var logs = lt.map(function (t, i) { return { title: t, values: lv[i] }; });
  var tsd = tt.map(function (t, i) { return { title: t, values: lv[lt.length + i] }; });
  return { code: code, rows: eJobDays_(logs, tsd, code) };
}
