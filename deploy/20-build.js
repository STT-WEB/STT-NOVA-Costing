/**
 * STT NOVA-Costing
 * 20-build.js — ดึงข้อมูลจากทุกแหล่ง → ส่งให้สมองคำนวณ (10-engine.js) → เก็บผล
 *
 * แหล่งข้อมูล (อ่านอย่างเดียว)
 *  NOVA   : ทุกไฟล์ใน REGISTRY (source = NOVA, Active ≠ N) → ทุกแท็บจ๊อบ → คอลัมน์ หมวด / สรุป Supplier / ต้นทุนเข้าจ๊อบ
 *  MASTER : Budget Cost Sales JT / JM (ราคาขาย) · Cost Purchase 2022-2025 (ต้นทุนจัดซื้อย้อนหลัง ปี 65–68)
 *  HR     : JOB_MASTER (ทะเบียนจ๊อบ) · ACTUAL_WIDE · Sale Budget (A:C) · Estimate Budget · Cost ผรม to HR · Cost ผรม พนักงาน STT… · SRC_YYYY_MM
 *  JOBTRACK: Job_Log_YYYY_MM ทุกเดือน · TIMESHEET_DIRECT…
 */

var NOVA_SCHEMA = 2;             // 2 = เก็บคอลัมน์ "หมายเหตุจาก BOM" (ระบุคัน) ด้วย — แคชรุ่นเก่าจะถูกอ่านใหม่
var NOVA_BUDGET_MS = 230000;     // อ่าน NOVA ได้ไม่เกิน ~4 นาทีต่อรอบ (Apps Script ตัดที่ 6 นาที) — ไฟล์ที่เหลืออ่านต่อรอบถัดไป

/** อ่านไฟล์ NOVA ทุกไฟล์ — ไฟล์ที่ไม่ได้แก้ใช้ผลเดิม · หมดเวลาแล้วไฟล์ที่เหลือใช้ผลเดิม (ถ้ามี) */
function gatherNova_(t0) {
  t0 = t0 || Date.now();
  return novaFiles_().map(function (f) {
    var stamp = fileStamp_(f.fileId);
    var c = novaCacheGet_(f.fileId);
    if (c && stamp && c.stamp === stamp && c.schema === NOVA_SCHEMA) { c.state = 'ไม่มีการแก้ (ใช้ผลรอบก่อน)'; return c; }
    if (Date.now() - t0 > NOVA_BUDGET_MS) {
      if (c) { c.state = 'ข้อมูลรอบก่อน — รออ่านใหม่รอบถัดไป'; c.stale = 1; return c; }
      return { fileType: f.fileType, fileId: f.fileId, fileName: f.fileName, tabs: [], skipped: [], pending: 1, state: 'ยังอ่านไม่ทัน — อ่านต่อรอบถัดไป' };
    }
    var res = readNovaFile_(f);
    res.stamp = stamp; res.schema = NOVA_SCHEMA; res.readAt = new Date().toISOString();
    novaCacheSet_(f.fileId, res);
    res.state = 'อ่านใหม่';
    return res;
  });
}

/** อ่านไฟล์ NOVA 1 ไฟล์: (1) หัวแท็บ+หัวตาราง ช่วงเดียว A2:BZ12 (2) 4 คอลัมน์ หมวด/ต้นทุน/Supplier/หมายเหตุจาก BOM */
function readNovaFile_(f) {
  var tabs = listTabs_(f.fileId).filter(function (t) { return eIsNovaJobTab_(t.title); });
  var got = batchGet_(f.fileId, tabs.map(function (t) { return q_(t.title) + '!A2:BZ12'; }));
  var want = [], meta = [];
  tabs.forEach(function (t, i) {
    var blk = got[i] || [];
    var head = eNovaHead_(blk.map(function (r) { return [(r || [])[0], (r || [])[1]]; }));
    var hdrRow = -1, hdr = null;
    for (var r = 0; r < blk.length; r++) {
      if (String((blk[r] || [])[0] || '').trim() === 'หมวด') { hdrRow = 2 + r; hdr = blk[r]; break; }
    }
    if (!hdr) { meta.push({ t: t, head: head, skip: 'ไม่พบหัวตาราง "หมวด"' }); return; }
    var c = eNovaCols_(hdr);
    if (c.cost < 0) { meta.push({ t: t, head: head, skip: 'ไม่พบคอลัมน์ ต้นทุนเข้าจ๊อบ' }); return; }
    var start = hdrRow + 1;
    var m = { t: t, head: head, idx: want.length, iV: -1, iN: -1 };
    want.push(q_(t.title) + '!' + colA1_(c.cat) + start + ':' + colA1_(c.cat));
    want.push(q_(t.title) + '!' + colA1_(c.cost) + start + ':' + colA1_(c.cost));
    if (c.vendor >= 0) { m.iV = want.length; want.push(q_(t.title) + '!' + colA1_(c.vendor) + start + ':' + colA1_(c.vendor)); }
    if (c.note >= 0)   { m.iN = want.length; want.push(q_(t.title) + '!' + colA1_(c.note) + start + ':' + colA1_(c.note)); }
    meta.push(m);
  });
  var cols = batchGet_(f.fileId, want);
  var out = [], skipped = [];
  meta.forEach(function (m) {
    if (m.skip) { skipped.push({ tab: m.t.title, why: m.skip }); return; }
    var cat = cols[m.idx] || [], cost = cols[m.idx + 1] || [],
        ven = m.iV >= 0 ? (cols[m.iV] || []) : [], note = m.iN >= 0 ? (cols[m.iN] || []) : [];
    var n = Math.max(cat.length, cost.length), rows = [];
    for (var i = 0; i < n; i++) {
      var cv = (cost[i] || [])[0];
      if (cv === undefined || cv === '' || cv === 0) continue;          // เก็บเฉพาะบรรทัดที่มีต้นทุน (ไฟล์เล็กลง)
      rows.push([(cat[i] || [])[0], (ven[i] || [])[0], cv, (note[i] || [])[0] || '']);
    }
    out.push({ title: m.t.title, sheetId: m.t.sheetId, head: m.head, rows: rows });
  });
  return { fileType: f.fileType, fileId: f.fileId, fileName: f.fileName, tabs: out, skipped: skipped };
}

function gatherAll_() {
  var t0 = Date.now(), timing = {};
  var input = { builtAt: new Date().toISOString() };

  input.nova = gatherNova_(t0); timing.nova = Date.now() - t0;

  var t1 = Date.now();
  input.salesJT = readTab_(CFG.MASTER, CFG.TAB.SALES_JT);
  input.salesJM = readTab_(CFG.MASTER, CFG.TAB.SALES_JM);
  try { input.histCost = readTabLoose_(CFG.MASTER, CFG.TAB.HIST_COST); }      // ต้นทุนจัดซื้อย้อนหลัง ปี 65–68
  catch (e) { input.histCost = []; input.histErr = String(e.message || e); }
  try { input.wip = readTabLoose_(CFG.MASTER, CFG.TAB.WIP); }                  // Model / ประเภทงานซ่อม
  catch (e) { input.wip = []; input.wipErr = String(e.message || e); }
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
  var props = PropertiesService.getScriptProperties();
  try {
    var t0 = Date.now();
    var input = gatherAll_();
    var tg = Date.now() - t0;
    var snap = eBuildSnapshot_(input);
    snap.version = COSTING_VERSION;
    snap.masterId = CFG.MASTER;
    if (input.wipErr) snap.diag.notes.push('อ่านแท็บ All WIP JT/JM ไม่ได้: ' + input.wipErr);
    if (input.histErr) snap.diag.notes.push('อ่านแท็บ Cost Purchase 2022-2025 ไม่ได้: ' + input.histErr);
    snap.timing = input._timing; snap.timing.gather = tg; snap.timing.total = Date.now() - t0;
    snap.diag.novaSkipped = [];
    input.nova.forEach(function (f) { (f.skipped || []).forEach(function (s) { s.file = f.fileName; snap.diag.novaSkipped.push(s); }); });
    snap.diag.novaFiles.forEach(function (x, i) {
      var f = input.nova[i] || {};
      x.state = f.state || ''; x.pending = f.pending ? 1 : 0; x.stale = f.stale ? 1 : 0; x.readAt = f.readAt || '';
    });
    var json = JSON.stringify(snap);
    snapSave_(json);
    props.setProperty('SNAP_AT', snap.builtAt);
    props.deleteProperty('BUILD_ERR');
    var pend = input.nova.filter(function (f) { return f.pending || f.stale; }).length;
    return { ok: true, builtAt: snap.builtAt, ms: snap.timing.total, jobs: snap.jobs.length, size: json.length, novaPending: pend };
  } catch (e) {
    // จดข้อผิดพลาดไว้ให้หน้าเว็บโชว์ (เดิมล้มเงียบ ๆ แล้วเว็บยังโชว์ข้อมูลเก่า)
    props.setProperty('BUILD_ERR', JSON.stringify({ at: new Date().toISOString(), msg: String(e && e.message || e).slice(0, 400) }));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** ตัวตั้งเวลา: อัปเดตอัตโนมัติทุก CFG.AUTO_MIN นาที (ติดตั้งให้เองครั้งแรกที่มีคนเปิดใช้) */
function ensureTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoRebuild'; });
  if (!has) ScriptApp.newTrigger('autoRebuild').timeBased().everyMinutes(CFG.AUTO_MIN).create();
}

function autoRebuild() { try { rebuild_(); } catch (e) { /* จดไว้ใน BUILD_ERR แล้ว */ } }

/** สถานะการอัปเดตล่าสุด (หน้าเว็บเรียกตอนเปิด) */
function getStatus(token) {
  requireAuth_(token);
  var p = PropertiesService.getScriptProperties();
  var err = p.getProperty('BUILD_ERR');
  return { snapAt: p.getProperty('SNAP_AT') || '', err: err ? JSON.parse(err) : null };
}

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
  var keep = ['หมวด', 'ประเภท', 'Code', 'PART NAME', 'DESCRIPTION', 'หมายเหตุจาก BOM', "Q'TY", 'หน่วย(BOM)', 'MY ACC CODE', 'MY ACC GOOD NAME',
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
  return { code: code, tabs: tabs, novaUrl: PropertiesService.getScriptProperties().getProperty('NOVA_URL') || CFG.NOVA_URL || '' };
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
