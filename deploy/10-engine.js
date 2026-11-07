/**
 * STT NOVA-Costing
 * 10-engine.js — "สมองคำนวณ" ล้วน ๆ (ไม่เรียก Google เลย)
 *
 * ⚠️ ไฟล์นี้ต้องรันได้ทั้งใน Apps Script และใน node (ชุดทดสอบ _tests/ เอาไปรันกับข้อมูลจริง)
 *    ห้ามใช้ SpreadsheetApp / Sheets / CacheService ในไฟล์นี้เด็ดขาด
 *
 * กติกาที่เบียร์เคาะแล้ว (6 พ.ย. 2569)
 *  1. ผู้รับเหมา: ยึด NOVA หมวด 11 เป็นหลัก · ฝั่ง HR นับเฉพาะรายการที่ไม่มีใน NOVA
 *     (จับคู่ จ๊อบ + ชื่อผู้รับเหมา + ยอดเงิน) รายการที่ซ้ำ = ไม่นับ แต่โชว์ในหน้ากระทบยอด
 *  2. ค่าแรง HR: ใช้ยอดตามจ๊อบจริงจาก ACTUAL_WIDE ไม่หาร
 *     ต้นทุนจัดซื้อของแท็บที่รวมหลายคัน (เช่น JT-690002-0003): หารเท่ากันตามจำนวนคัน (รอเบียร์ยืนยัน)
 *  3. ค่าแรงราย Process = ค่าแรงจ๊อบเดือนนั้น × (ชม. Process ÷ ชม. รวมของจ๊อบเดือนนั้น)
 *  4. เดือนที่ HR ยังไม่ปิดงวด = ประมาณการ (ชม. × อัตราเฉลี่ยของจ๊อบ) แยกสีส้ม
 */

var ENGINE_VERSION = 'E1';

var COST_CATS = [
  { k: 'c1',  n: 1,  label: '1. Main Mat' },
  { k: 'c2',  n: 2,  label: '2. Inventory' },
  { k: 'c3',  n: 3,  label: '3. Forjob Short' },
  { k: 'c4',  n: 4,  label: '4. Forjob Long' },
  { k: 'c5',  n: 5,  label: '5. Service / Third party' },
  { k: 'c6',  n: 6,  label: '6. SDM' },
  { k: 'c7',  n: 7,  label: '7. Part' },
  { k: 'c8',  n: 8,  label: '8. Tankers & Tax & Shipping' },
  { k: 'c9',  n: 9,  label: '9. Consume' },
  { k: 'c10', n: 10, label: '10. Machine Part' },
  { k: 'c11', n: 11, label: '11. Subcontractor (ผู้รับเหมา)' },
  { k: 'c0',  n: 0,  label: 'ไม่ระบุหมวด (ใน NOVA)' }
];

/* ---------------- ตัวช่วยพื้นฐาน ---------------- */

function eStr_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function eNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v).replace(/,/g, '').replace(/฿/g, '').trim();
  if (!s || s === '-') return 0;
  var n = Number(s);
  return isFinite(n) ? n : 0;
}

function eRound2_(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }

/** หาคอลัมน์จากชื่อหัวตาราง — ตรงตัวก่อน แล้วค่อย "มีคำนี้อยู่ข้างใน" (บทเรียน P&S 15 ก.ย.) */
function eCol_(hdr, names) {
  var h = [];
  for (var j = 0; j < hdr.length; j++) h.push(eStr_(hdr[j]).toLowerCase());
  for (var k = 0; k < names.length; k++) {
    var w = String(names[k]).toLowerCase().trim();
    for (var a = 0; a < h.length; a++) if (h[a] === w) return a;
  }
  for (var k2 = 0; k2 < names.length; k2++) {
    var w2 = String(names[k2]).toLowerCase().trim();
    for (var b = 0; b < h.length; b++) if (h[b].indexOf(w2) >= 0) return b;
  }
  return -1;
}

/** หาคอลัมน์แบบตรงตัวเท่านั้น (ใช้กับชื่อสั้นที่ไปซ้อนในชื่ออื่น เช่น "Process" อยู่ใน "หมวด Process") */
function eColExact_(hdr, name) {
  var w = String(name).toLowerCase().trim();
  for (var a = 0; a < hdr.length; a++) if (eStr_(hdr[a]).toLowerCase() === w) return a;
  return -1;
}

/** หาแถวหัวตาราง: แถวแรกที่มีช่องตรงกับคำใดคำหนึ่ง */
function eFindHdrRow_(values, mustHave, maxScan) {
  var lim = Math.min(values.length, maxScan || 15);
  for (var i = 0; i < lim; i++) {
    var r = values[i] || [];
    for (var j = 0; j < r.length; j++) {
      if (eStr_(r[j]).toUpperCase() === String(mustHave).toUpperCase()) return i;
    }
  }
  return -1;
}

/** รหัสจ๊อบมาตรฐาน: ตัวใหญ่ ไม่มีช่องว่าง เช่น "JT-69/0001" */
function eJob_(v) {
  var s = eStr_(v).toUpperCase().replace(/\s+/g, '');
  var m = s.match(/^([A-Z]{1,5})-?(\d{2})\/(\d{3,5})$/);
  if (m) return m[1] + '-' + m[2] + '/' + m[3];
  return s;
}

/** รหัสจ๊อบที่ใช้ได้: ขึ้นต้นตัวอังกฤษ + ขีด เช่น JT-69/0001 · JMI-69/0025 · ST-0001 (Other Job) */
function eIsJob_(code) { return /^[A-Z]{1,5}-[0-9A-Z][0-9A-Z\/.\-]*$/.test(String(code)); }

/** ประเภทงานจากรหัส: JT / JM / JMI / JMS / JMC / JMT / JP / FG / อื่น ๆ */
function eJobType_(code) {
  var m = String(code).match(/^([A-Z]+)-/);
  return m ? m[1] : 'อื่นๆ';
}

/** วันที่ → 'YYYY-MM-DD' (รับ serial number ของ Sheets, Date, หรือข้อความ d/m/yyyy พ.ศ./ค.ศ.) */
function eDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  var y, mo, d;
  if (typeof v === 'number') {
    if (v < 1 || v > 400000) return '';
    var ms = Math.round((v - 25569) * 86400000);
    var dt = new Date(ms);
    y = dt.getUTCFullYear(); mo = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    y = v.getFullYear(); mo = v.getMonth() + 1; d = v.getDate();
  } else {
    var s = eStr_(v);
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else {
      var m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m2) return '';
      y = +m2[1]; mo = +m2[2]; d = +m2[3];
    }
  }
  if (y > 2400) y -= 543;                       // ปี พ.ศ. → ค.ศ.
  if (!y || !mo || !d) return '';
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}

/** งวดเงินเดือน: วันที่ 26 ขึ้นไป = งวดเดือนถัดไป (26–25) → 'YYYY-MM' */
function ePeriod_(isoDate) {
  if (!isoDate) return '';
  var y = +isoDate.substr(0, 4), m = +isoDate.substr(5, 2), d = +isoDate.substr(8, 2);
  if (d >= 26) { m++; if (m > 12) { m = 1; y++; } }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

/** หัวคอลัมน์เดือน: '2026-01' หรือ serial วันที่ → 'YYYY-MM' (ไม่ใช่เดือน = '') */
function eMonthKey_(v) {
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    var iso = eDate_(v); return iso ? iso.substr(0, 7) : '';
  }
  var s = eStr_(v);
  var m = s.match(/^(\d{4})-(\d{2})$/);
  return m ? s : '';
}

/** ชื่อผู้รับเหมา → กุญแจเทียบ (ตัดคำนำหน้า/ช่องว่าง/จุด) */
function eVendorKey_(v) {
  var s = eStr_(v).toLowerCase();
  s = s.replace(/ห้างหุ้นส่วนจำกัด|บริษัท|จำกัด|\(มหาชน\)|มหาชน|หจก\.?|บจก\.?|นางสาว|น\.ส\.|นาง|นาย|คุณ|ว่าที่\s*ร\.?ต\.?|สำนักงานใหญ่/g, '');
  return s.replace(/[\s.\-()]/g, '');
}

/** หมวดจากข้อความ "3. Forjob Short" → 'c3' · ว่าง = 'c0' */
function eCat_(v) {
  var m = eStr_(v).match(/^(\d{1,2})\s*\./);
  if (!m) return 'c0';
  var n = +m[1];
  return (n >= 1 && n <= 11) ? ('c' + n) : 'c0';
}

/* ---------------- 1) NOVA: ชื่อแท็บ → รายการจ๊อบ ---------------- */

/**
 * ชื่อแท็บจริงใน NOVA มี "/" เช่น 'JT-69/0001' · 'JT-69/0002-0003'
 * (ไฟล์ xlsx ที่ export ออกมาจะตัด "/" ทิ้งเป็น 'JT-690001' → รับได้ทั้งสองแบบ)
 * 'JT-69/0002-0003'              → { jobs:['JT-69/0002','JT-69/0003'] }
 * 'JT-690006-0007 งานแก้ไขผิวแท็งค' → 2 จ๊อบ + note
 * 'JM-690194(ยกเลิก)'            → cancelled
 */
function eNovaTabJobs_(title, jobNoCell) {
  var t = eStr_(title);
  var out = { title: t, jobs: [], cancelled: /ยกเลิก/.test(t), note: '' };
  var m = t.match(/^([A-Z]{1,5})-(\d{2})\/?(\d{4})(?:-(\d{4}))?(.*)$/);
  if (m) {
    var a = +m[3], b = m[4] ? +m[4] : a;
    if (b < a || b - a > 60) b = a;            // กันชื่อแท็บแปลก ๆ
    for (var n = a; n <= b; n++) {
      out.jobs.push(m[1] + '-' + m[2] + '/' + ('000' + n).slice(-4));
    }
    out.note = eStr_(m[5]).replace(/^[\s\-]+/, '');
  } else {
    var j = eJob_(jobNoCell);
    if (eIsJob_(j)) out.jobs.push(j);
  }
  return out;
}

/** แท็บไหนเป็นแท็บจ๊อบ (ไม่ใช่ Template / Copy of …) */
function eIsNovaJobTab_(title) {
  return /^[A-Z]{1,5}-\d{2}\/?\d{4}/.test(eStr_(title));
}

/**
 * อ่านหัวของแท็บจ๊อบ
 * head = ค่าช่วง A2:B12 · ใช้หา JOB NO, TOTAL JOB (คัน), แถวที่ช่อง A = 'หมวด'
 */
function eNovaHead_(head) {
  var o = { jobNo: '', jobName: '', units: 0, hdrRowOffset: -1 };
  for (var i = 0; i < head.length; i++) {
    var a = eStr_((head[i] || [])[0]).toUpperCase();
    var b = (head[i] || [])[1];
    if (a === 'JOB NO') o.jobNo = eJob_(b);
    else if (a === 'JOB NAME') o.jobName = eStr_(b);
    else if (a.indexOf('TOTAL JOB') === 0) o.units = eNum_(b);
    else if (a === 'หมวด') { o.hdrRowOffset = i; break; }
  }
  return o;
}

/** คอลัมน์ที่ต้องใช้ในแท็บจ๊อบ (ค้นจากชื่อหัวตาราง) */
function eNovaCols_(hdr) {
  return {
    cat:    eCol_(hdr, ['หมวด']),
    vendor: eCol_(hdr, ['สรุป Supplier']),
    cost:   eCol_(hdr, ['ต้นทุนเข้าจ๊อบ'])
  };
}

/* ---------------- 2) สร้างภาพรวมทั้งหมด (Snapshot) ---------------- */

/**
 * input = {
 *   nova:   [{ fileType, fileId, fileName, tabs:[{ title, sheetId, head:{jobNo,jobName,units}, rows:[[cat,vendor,cost],...] }] }],
 *   salesJT, salesJM, hrWide, saleBudget, estBudget, contrHR, contrSTT : ค่าของแต่ละแท็บ (array 2 มิติ)
 *   src:    { 'YYYY-MM': values }      แท็บ SRC_YYYY_MM
 *   logs:   [{ title, values }]        แท็บ Job_Log_YYYY_MM ของ JOBTRACK
 *   tsd:    [{ title, values }]        แท็บ TIMESHEET_DIRECT…
 *   builtAt: ISO string
 * }
 */
function eBuildSnapshot_(input) {
  var D = { notes: [] };                 // กล่องตรวจสอบ (หน้ากระทบยอด)
  var J = {};                            // job code -> record

  function job_(code) {
    if (!J[code]) {
      var r = { code: code, type: eJobType_(code), name: '', start: '', delivery: '', progress: '',
                sale: 0, saleSrc: '', budgetCost: 0, laborBudget: 0, estLabor: 0,
                p: {}, pTotal: 0, pTabs: [], pShared: 0,
                laborCF: 0, laborM: {}, laborEstM: {}, labor: 0, laborEst: 0, laborTotalCol: null,
                cNova: 0, cHR: 0, cHRdup: 0, cSTT: 0, cHRlines: 0, cHRofficial: 0, cHRgap: 0, hrContrCol: null,
                srcHours: 0, srcPeople: 0, srcM: {}, rate: 0,
                dHours: 0, dPeople: 0, dDays: 0, dFirst: '', dLast: '', flags: [] };
      for (var c = 0; c < COST_CATS.length; c++) r.p[COST_CATS[c].k] = 0;
      J[code] = r;
    }
    return J[code];
  }

  /* ---- 2.1 NOVA จัดซื้อ ---- */
  var novaIndex = {};                     // job -> [{fileId, sheetId, title, units}]
  var novaC11 = {};                       // job -> [{vendor, full, share, title}]
  D.novaTabs = 0; D.novaLines = 0; D.novaCost = 0; D.novaUnitsMismatch = []; D.novaCancelled = []; D.novaNoCat = [];
  D.novaFiles = [];
  (input.nova || []).forEach(function (f) {
    var fCost = 0, fTabs = 0;
    (f.tabs || []).forEach(function (t) {
      var tj = eNovaTabJobs_(t.title, t.head && t.head.jobNo);
      if (tj.cancelled) { D.novaCancelled.push({ file: f.fileName, tab: t.title }); return; }
      if (!tj.jobs.length) return;
      var units = tj.jobs.length;
      var headUnits = t.head ? eNum_(t.head.units) : 0;
      if (headUnits && headUnits !== units) {
        D.novaUnitsMismatch.push({ file: f.fileName, tab: t.title, tabJobs: units, totalJob: headUnits });
      }
      var sums = {}, c11 = [], noCat = 0;
      (t.rows || []).forEach(function (r) {
        var cost = eNum_(r[2]);
        if (!cost) return;
        var k = eCat_(r[0]);
        sums[k] = (sums[k] || 0) + cost;
        D.novaLines++;
        if (k === 'c0') noCat += cost;
        if (k === 'c11') c11.push({ vendor: eStr_(r[1]), full: cost });
      });
      var tabTotal = 0; for (var kk in sums) tabTotal += sums[kk];
      fCost += tabTotal; fTabs++; D.novaTabs++;
      if (noCat) D.novaNoCat.push({ file: f.fileName, tab: t.title, amount: eRound2_(noCat) });
      tj.jobs.forEach(function (code) {
        var r = job_(code);
        if (!r.name && t.head && t.head.jobName) r.name = t.head.jobName;
        for (var k2 in sums) r.p[k2] += sums[k2] / units;
        r.pTabs.push(t.title + (units > 1 ? ' (หาร ' + units + ' คัน)' : ''));
        if (units > 1) r.pShared = Math.max(r.pShared, units);
        (novaIndex[code] = novaIndex[code] || []).push({ fileId: f.fileId, sheetId: t.sheetId, title: t.title, units: units });
        c11.forEach(function (x) {
          (novaC11[code] = novaC11[code] || []).push({ vendor: x.vendor, full: x.full, share: x.full / units, title: t.title });
        });
      });
    });
    D.novaCost += fCost;
    D.novaFiles.push({ type: f.fileType, file: f.fileName, tabs: fTabs, cost: eRound2_(fCost) });
  });

  /* ---- 2.2 ราคาขาย ---- */
  D.salesDupJT = [];
  (function () {
    var v = input.salesJT || [];
    var h = eFindHdrRow_(v, 'DocuNo', 5); if (h < 0) { D.notes.push('ไม่พบหัวตาราง DocuNo ใน Budget Cost Sales JT'); return; }
    var iNo = eCol_(v[h], ['DocuNo']), iBC = eCol_(v[h], ['Budget cost']), iBL = eCol_(v[h], ['Budget labour']),
        iSV = eCol_(v[h], ['Sales Value no vat', 'Sales Value']);
    var seen = {};
    for (var i = h + 1; i < v.length; i++) {
      var code = eJob_(v[i][iNo]); if (!eIsJob_(code)) continue;
      var sv = eNum_(v[i][iSV]);
      if (seen[code]) { D.salesDupJT.push(code); continue; }   // ใช้แถวแรก
      seen[code] = { sale: sv, bc: eNum_(v[i][iBC]), bl: eNum_(v[i][iBL]) };
    }
    input._saleJT = seen;
  })();
  (function () {
    var v = input.salesJM || [];
    var h = eFindHdrRow_(v, 'DocuNo', 5); if (h < 0) { D.notes.push('ไม่พบหัวตาราง DocuNo ใน Budget Cost Sales JM'); return; }
    var iNo = eCol_(v[h], ['DocuNo']), iAmt = eCol_(v[h], ['billaftrDiscAmnt']);
    var s = {};
    for (var i = h + 1; i < v.length; i++) {
      var code = eJob_(v[i][iNo]); if (!eIsJob_(code)) continue;
      s[code] = (s[code] || 0) + eNum_(v[i][iAmt]);              // JM ใบเดียวอาจหลายบรรทัด → รวม
    }
    input._saleJM = s;
  })();

  /* ---- 2.3 งบค่าแรง (Sale Budget A:C) + Estimate Budget ---- */
  var laborBudget = {}, estLabor = {};
  (function () {
    var v = input.saleBudget || [];
    for (var i = 0; i < v.length; i++) {
      var code = eJob_((v[i] || [])[0]); if (!eIsJob_(code)) continue;
      if (laborBudget[code] === undefined) laborBudget[code] = eNum_(v[i][2]);
    }
    var e = input.estBudget || [];
    for (var j = 0; j < e.length; j++) {
      var c2 = eJob_((e[j] || [])[0]); if (!eIsJob_(c2)) continue;
      if (estLabor[c2] === undefined) estLabor[c2] = eNum_(e[j][2]);
    }
  })();

  /* ---- 2.4 HR ACTUAL_WIDE ---- */
  var months = [], closed = {}, hrInputRow = null, hrTotalRow = null;
  D.hrDupJobs = []; D.hrTotalColDiff = []; D.hrDedup = [];
  (function () {
    var v = input.hrWide || [];
    var h = eFindHdrRow_(v, 'JOB CODE', 10);
    if (h < 0) { D.notes.push('ไม่พบหัวตาราง JOB CODE ในแท็บ ACTUAL_WIDE'); return; }
    var hdr = v[h];
    var iType = eCol_(hdr, ['ประเภทงาน']), iCode = eCol_(hdr, ['JOB CODE']), iName = eCol_(hdr, ['JOB NAME']),
        iStart = eCol_(hdr, ['START DATE']), iDel = eCol_(hdr, ['LATEST DATE DELIVERY']),
        iProg = eCol_(hdr, ['TOTAL PROGRESS']), iCF = eCol_(hdr, ['ยอดยกมา']),
        iTot = eCol_(hdr, ['Total ค่าแรงพนักงาน STT']),
        iCon = eCol_(hdr, ['ค่าแรงผู้รับเหมา Sub + พนักงาน STT', 'ค่าแรงผู้รับเหมา']);
    var mCols = [];
    for (var c = 0; c < hdr.length; c++) {
      var mk = eMonthKey_(hdr[c]);
      if (mk) { mCols.push({ c: c, m: mk }); months.push(mk); }
    }
    // แถว "HR ใส่ตัวเลข" / "TOTal ของแต่ละเดือน" อยู่เหนือหัวตาราง
    for (var r0 = 0; r0 < h; r0++) {
      var row = v[r0] || [];
      for (var c0 = 0; c0 < row.length; c0++) {
        var tx = eStr_(row[c0]);
        if (tx.indexOf('HR ใส่ตัวเลข') >= 0) hrInputRow = row;
        if (tx.toUpperCase().indexOf('TOTAL ของแต่ละเดือน'.toUpperCase()) >= 0) hrTotalRow = row;
      }
    }
    mCols.forEach(function (mc) {
      var x = hrInputRow ? eNum_(hrInputRow[mc.c]) : 0;
      if (x > 0) closed[mc.m] = x;
    });
    var seen = {}, sigs = {};
    for (var i = h + 1; i < v.length; i++) {
      var code = eJob_(v[i][iCode]); if (!eIsJob_(code)) continue;
      var cf = iCF >= 0 ? eNum_(v[i][iCF]) : 0, con = iCon >= 0 ? eNum_(v[i][iCon]) : 0,
          any = cf !== 0 || con !== 0, ms = {};
      mCols.forEach(function (mc) {
        var x = eNum_(v[i][mc.c]);
        if (x) { ms[mc.m] = x; any = true; }
      });
      // รหัสซ้ำหลายแถว และมีตัวเลขมากกว่า 1 แถว = เสี่ยง HR นับ 2 ครั้ง ต้องตรวจ
      var anyLab = cf !== 0 || Object.keys(ms).length > 0;
      // เบียร์สั่ง 7 พ.ย. 2569: เลขจ๊อบซ้ำ + ตัวเลขเหมือนกันทุกช่อง = แถวซ้ำ → ตัดออก นับครั้งเดียว
      if (any) {
        var sig = [cf, con].concat(mCols.map(function (mc) { return eRound2_(ms[mc.m] || 0); })).join('|');
        var sg = sigs[code] = sigs[code] || {};
        if (sg[sig]) {
          var tot = cf; for (var dm in ms) tot += ms[dm];
          D.hrDedup.push({ job: code, row: i + 1, rowFirst: sg[sig], labor: eRound2_(tot), contr: eRound2_(con),
                           months: Object.keys(ms).sort().join(', '), monthly: ms });
          continue;
        }
        sg[sig] = i + 1;
      }
      // ซ้ำแต่ตัวเลขไม่เหมือนกัน และมีค่าแรงทั้ง 2 แถว = ต้องให้ HR ตรวจ (ยังนับรวมตามไฟล์)
      if (anyLab) { seen[code] = (seen[code] || 0) + 1; if (seen[code] === 2) D.hrDupJobs.push(code); }
      if (!any && !J[code]) {
        // ไม่มีค่าแรงเลย — เก็บข้อมูลจ๊อบไว้เผื่อมีจัดซื้อ/ผรม ภายหลัง
        input._hrInfo = input._hrInfo || {};
        input._hrInfo[code] = { type: eStr_(v[i][iType]), name: eStr_(v[i][iName]), start: eDate_(v[i][iStart]),
                                delivery: eDate_(v[i][iDel]), progress: eStr_(v[i][iProg]) };
        continue;
      }
      var r = job_(code);
      r.name = eStr_(v[i][iName]) || r.name;
      r.start = eDate_(v[i][iStart]) || r.start;
      r.delivery = eDate_(v[i][iDel]) || r.delivery;
      r.progress = eStr_(v[i][iProg]) || r.progress;
      r.laborCF += cf;
      for (var mm in ms) r.laborM[mm] = (r.laborM[mm] || 0) + ms[mm];
      // คอลัมน์สรุปของ HR เป็นสูตรดึงตามรหัส → แถวซ้ำจะได้ค่าเดียวกัน ใช้ค่ามากสุด ไม่บวกซ้ำ
      if (iTot >= 0) r.laborTotalCol = Math.max(r.laborTotalCol || 0, eNum_(v[i][iTot]));
      if (iCon >= 0) r.hrContrCol = Math.max(r.hrContrCol || 0, con);
    }
  })();
  var openMonths = months.filter(function (m) { return !closed[m]; });

  /* ---- 2.5 SRC_YYYY_MM: ชม./คน/ต้นทุน ต่อจ๊อบต่อเดือน (ใช้หาอัตราเฉลี่ย) ---- */
  var srcJM = {};                       // job -> month -> {hours, people, cost}
  var srcMonth = {};                    // month -> {hours, cost}
  Object.keys(input.src || {}).forEach(function (m) {
    var v = input.src[m];
    var h = eFindHdrRow_(v, 'JOB CODE', 5); if (h < 0) return;
    var iC = eCol_(v[h], ['JOB CODE']), iP = eCol_(v[h], ['จำนวนพนักงาน']), iH = eCol_(v[h], ['ชม. รวมทั้งหมด']),
        iCost = eCol_(v[h], ['ต้นทุน Direct รวม']);
    for (var i = h + 1; i < v.length; i++) {
      var code = eJob_(v[i][iC]); if (!eIsJob_(code)) continue;
      var o = { hours: eNum_(v[i][iH]), people: eNum_(v[i][iP]), cost: eNum_(v[i][iCost]) };
      (srcJM[code] = srcJM[code] || {})[m] = o;
      var sm = srcMonth[m] = srcMonth[m] || { hours: 0, cost: 0 };
      sm.hours += o.hours; sm.cost += o.cost;
    }
  });
  var lastClosed = months.filter(function (m) { return closed[m]; }).sort().pop() || '';
  var globalRate = (srcMonth[lastClosed] && srcMonth[lastClosed].hours) ? srcMonth[lastClosed].cost / srcMonth[lastClosed].hours : 0;

  /* ---- 2.6 รายละเอียดรายวัน: JOBTRACK + TIMESHEET_DIRECT ---- */
  var det = eParseDetailRows_(input.logs || [], input.tsd || []);
  D.detailRows = det.rows.length; D.detailSources = det.sources; D.detailUnknownJobs = det.unknownJobs;

  // งวดไหนมี Timesheet ของ HR (TSD) → ใช้ TSD ทั้งงวด (ตรงกับ SRC) · นอกนั้นใช้ JOBTRACK
  var tsdPeriods = {};
  det.rows.forEach(function (x) {
    if (x.src === 'HR') tsdPeriods[x.period] = 1;
    // งวดที่มีชั่วโมงแต่ยังไม่มีคอลัมน์ใน ACTUAL_WIDE (เช่นขึ้นปีใหม่) → นับเป็นเดือนที่ยังไม่ปิดงวด
    if (x.period && months.indexOf(x.period) < 0 && x.period >= (months[0] || '')) {
      months.push(x.period); months.sort(); openMonths.push(x.period); openMonths.sort();
    }
  });

  var procAgg = {};      // job|period|cat|sub -> {hours, people:{}, days:{}}
  var jpH = {};          // job|period -> hours (แหล่งที่เลือก)
  var jDet = {};         // job -> {people:{}, days:{}, first, last, hours}
  det.rows.forEach(function (x) {
    var useHR = !!tsdPeriods[x.period];
    if ((x.src === 'HR') !== useHR) return;
    var k = x.job + '|' + x.period + '|' + x.cat + '|' + x.sub;
    var a = procAgg[k] = procAgg[k] || { job: x.job, period: x.period, cat: x.cat, sub: x.sub, src: x.src, hours: 0, people: {}, days: {} };
    a.hours += x.hours; a.people[x.emp] = 1; a.days[x.date] = 1;
    jpH[x.job + '|' + x.period] = (jpH[x.job + '|' + x.period] || 0) + x.hours;
    var jd = jDet[x.job] = jDet[x.job] || { people: {}, days: {}, first: '', last: '', hours: 0 };
    jd.people[x.emp] = 1; jd.days[x.date] = 1; jd.hours += x.hours;
    if (!jd.first || x.date < jd.first) jd.first = x.date;
    if (!jd.last || x.date > jd.last) jd.last = x.date;
  });

  /* ---- 2.7 ประมาณการเดือนที่ยังไม่ปิดงวด ---- */
  Object.keys(J).concat(Object.keys(jDet)).forEach(function (code) {
    if (!eIsJob_(code)) return;
    var s = srcJM[code] || {}, hh = 0, cc = 0, pp = 0;
    for (var m in s) { if (!closed[m]) continue; hh += s[m].hours; cc += s[m].cost; pp = Math.max(pp, s[m].people); }
    var rate = hh > 0 ? cc / hh : globalRate;
    openMonths.forEach(function (m) {
      var h = jpH[code + '|' + m] || 0;
      if (h > 0) { var r = job_(code); r.laborEstM[m] = h * rate; r.rate = rate; }
    });
    if (J[code]) {
      J[code].srcHours = hh; J[code].srcPeople = pp; if (!J[code].rate) J[code].rate = hh > 0 ? cc / hh : 0;
      var sm = {}; for (var m2 in s) sm[m2] = [eRound2_(s[m2].hours), s[m2].people];
      J[code].srcM = sm;                    // ชม. / คน ตามทางการของ HR รายเดือน
    }
  });

  /* ---- 2.8 ตาราง Process (บาท) ---- */
  var proc = [];
  var jmHasDetail = {};
  Object.keys(procAgg).forEach(function (k) {
    var a = procAgg[k];
    var tot = jpH[a.job + '|' + a.period] || 0;
    var cost = 0, est = false;
    if (closed[a.period]) {
      var c = (J[a.job] && J[a.job].laborM[a.period]) || 0;
      cost = tot > 0 ? c * a.hours / tot : 0;
    } else {
      var rr = (J[a.job] && J[a.job].rate) || globalRate;
      cost = a.hours * rr; est = true;
    }
    jmHasDetail[a.job + '|' + a.period] = 1;
    proc.push([a.job, a.period, a.cat, a.sub, eRound2_(a.hours), Object.keys(a.people).length,
               Object.keys(a.days).length, eRound2_(cost), est ? 1 : 0, a.src]);
  });
  // เดือนที่ปิดงวดแล้ว มีค่าแรงแต่ไม่มีรายละเอียด → 1 แถว "ไม่มีรายละเอียด Process"
  Object.keys(J).forEach(function (code) {
    var r = J[code];
    for (var m in r.laborM) {
      if (!closed[m] || jmHasDetail[code + '|' + m]) continue;
      proc.push([code, m, '(ไม่มีรายละเอียด Process)', 'งวดนี้ยังไม่มีข้อมูลรายวันในระบบ', 0, 0, 0, eRound2_(r.laborM[m]), 0, '-']);
    }
  });

  /* ---- 2.9 ผู้รับเหมา ฝั่ง HR + จับคู่กับ NOVA หมวด 11 ---- */
  var contr = [];                         // ทุกบรรทัด (NOVA + HR + HR-STT)
  var hrC = eParseContrHR_(input.contrHR || []);
  D.contrHRcheck = hrC.check; D.contrHRnoJob = hrC.noJob;
  var stt = eParseContrSTT_(input.contrSTT || []);

  // ใส่บรรทัด NOVA หมวด 11 (ต่อจ๊อบ = ส่วนแบ่งต่อคัน)
  Object.keys(novaC11).forEach(function (code) {
    novaC11[code].forEach(function (x, i) {
      x.id = 'N' + code + '#' + i; x.used = 0;
      contr.push({ job: code, src: 'NOVA', vendor: x.vendor, desc: x.title, amount: eRound2_(x.share), dup: 0, match: '' });
    });
  });

  var hrByJob = {};
  hrC.lines.forEach(function (x) { (hrByJob[x.job] = hrByJob[x.job] || []).push(x); });
  Object.keys(hrByJob).forEach(function (code) {
    var lines = hrByJob[code], nv = novaC11[code] || [];
    // รอบ 1: ชื่อตรง + ยอดตรง (เทียบได้ทั้งยอดต่อคัน และยอดเต็มแท็บ)
    lines.forEach(function (x) {
      var vk = eVendorKey_(x.vendor);
      for (var i = 0; i < nv.length; i++) {
        var n = nv[i]; if (n.used) continue;
        if (eVendorKey_(n.vendor) !== vk || !vk) continue;
        if (Math.abs(n.share - x.amount) <= 1 || Math.abs(n.full - x.amount) <= 1) {
          n.used = 1; x.dup = 1; x.match = 'ตรงกับ NOVA ' + n.title + ' (' + n.vendor + ')'; break;
        }
      }
    });
    // รอบ 2: ชื่อตรง แต่ HR แบ่งจ่ายหลายงวด → ผลรวมของผู้รับเหมาคนนั้นเท่ากับ NOVA
    var byV = {};
    lines.forEach(function (x) { if (!x.dup) { var k = eVendorKey_(x.vendor); (byV[k] = byV[k] || []).push(x); } });
    Object.keys(byV).forEach(function (vk) {
      if (!vk) return;
      var hs = byV[vk], hsum = 0; hs.forEach(function (x) { hsum += x.amount; });
      var nsS = 0, nsF = 0, ns = [];
      nv.forEach(function (n) { if (!n.used && eVendorKey_(n.vendor) === vk) { nsS += n.share; nsF += n.full; ns.push(n); } });
      if (ns.length && (Math.abs(nsS - hsum) <= 1 || Math.abs(nsF - hsum) <= 1)) {
        ns.forEach(function (n) { n.used = 1; });
        hs.forEach(function (x) { x.dup = 1; x.match = 'ยอดรวมของผู้รับเหมาคนนี้ตรงกับ NOVA หมวด 11'; });
      }
    });
    // ยอดตรงแต่ชื่อไม่ตรง → "สงสัยซ้ำ" (ยังนับอยู่ ให้เบียร์ตรวจ)
    lines.forEach(function (x) {
      if (x.dup) return;
      for (var i = 0; i < nv.length; i++) {
        var n = nv[i]; if (n.used) continue;
        if (Math.abs(n.share - x.amount) <= 1 || Math.abs(n.full - x.amount) <= 1) {
          x.suspect = 'ยอดเท่ากับ NOVA (' + (n.vendor || 'ไม่ระบุชื่อ') + ') แต่ชื่อไม่ตรง'; break;
        }
      }
    });
  });
  hrC.lines.forEach(function (x) {
    if (!eIsJob_(x.job)) return;
    var r = job_(x.job);
    r.cHRlines += x.amount;
    if (x.dup) r.cHRdup += x.amount;
    contr.push({ job: x.job, src: 'HR', vendor: x.vendor, desc: x.desc, amount: eRound2_(x.amount),
                 dup: x.dup ? 1 : 0, match: x.match || x.suspect || '', suspect: x.suspect ? 1 : 0 });
  });
  stt.lines.forEach(function (x) {
    if (!eIsJob_(x.job)) return;
    var r = job_(x.job); r.cSTT += x.amount;
    contr.push({ job: x.job, src: 'HR-STT', vendor: x.vendor, desc: x.desc, amount: eRound2_(x.amount), dup: 0, match: '' });
  });

  /* ---- 2.9.1 ยอดผู้รับเหมาฝั่ง HR ที่ "ทางการ" ----
   *  ใช้คอลัมน์ "ค่าแรงผู้รับเหมา Sub + พนักงาน STT" ใน ACTUAL_WIDE (ตัวเดียวกับที่ HR ใช้คิด Total Cost)
   *  ถ้าไม่มีคอลัมน์ → ใช้ตารางสรุปขวามือของแท็บ Cost ผรม → ถ้าไม่มีอีก → ผลรวมบรรทัด
   *  ส่วนที่นับ = ยอดทางการ − ยอดที่ซ้ำกับ NOVA หมวด 11
   *  ยอดทางการ ≠ ผลรวมบรรทัด → ส่วนต่างโชว์เป็น "ไม่มีรายละเอียดบรรทัด" ให้ HR ตรวจ */
  D.contrGap = [];
  Object.keys(J).forEach(function (code) {
    var r = J[code];
    var lines = r.cHRlines + r.cSTT;
    var off = r.hrContrCol !== null ? r.hrContrCol : (hrC.pivot[code] !== undefined ? hrC.pivot[code] + r.cSTT : lines);
    r.cHRofficial = eRound2_(off);
    var gap = off - lines;
    // ส่วนที่ HR ไม่มีรายละเอียดบรรทัด แต่ยอดเท่ากับบรรทัด NOVA หมวด 11 ที่ยังไม่ถูกจับคู่ → เป็นก้อนเดียวกัน = ซ้ำ
    if (gap > 1) {
      var nv = (novaC11[code] || []).filter(function (n) { return !n.used && n.share > 0; });
      var hit = null, sumS = 0;
      nv.forEach(function (n) { sumS += n.share; if (!hit && (Math.abs(n.share - gap) <= 1 || Math.abs(n.full - gap) <= 1)) hit = [n]; });
      if (!hit && nv.length && Math.abs(sumS - gap) <= 1) hit = nv;
      if (hit) {
        var amt = 0; hit.forEach(function (n) { n.used = 1; amt += n.share; });
        r.cHRdup += gap; lines += gap;
        contr.push({ job: code, src: 'HR', vendor: hit.map(function (n) { return n.vendor; }).join(', '),
                     desc: '(ยอดใน HR ที่ไม่มีรายละเอียดบรรทัด)', amount: eRound2_(gap), dup: 1,
                     match: 'ยอดส่วนที่ไม่มีรายละเอียดใน HR เท่ากับ NOVA หมวด 11 (' + hit.map(function (n) { return n.title; }).join(', ') + ')', gapMatch: 1 });
      }
    }
    r.cHR = eRound2_(off - r.cHRdup);
    r.cHRgap = eRound2_(off - lines);
    if (Math.abs(r.cHRgap) > 1) {
      D.contrGap.push({ job: code, official: r.cHRofficial, lines: eRound2_(lines), gap: r.cHRgap,
                        pivot: hrC.pivot[code] === undefined ? null : eRound2_(hrC.pivot[code]) });
    }
  });

  /* ---- 2.10 เติมข้อมูลจ๊อบ + สรุป ---- */
  var hrInfo = input._hrInfo || {};
  Object.keys(J).forEach(function (code) {
    var r = J[code];
    var hi = hrInfo[code];
    if (hi) { r.name = r.name || hi.name; r.start = r.start || hi.start; r.delivery = r.delivery || hi.delivery; r.progress = r.progress || hi.progress; }
    var sj = input._saleJT && input._saleJT[code];
    if (sj) { r.sale = sj.sale; r.saleSrc = 'Sales JT'; r.budgetCost = sj.bc; }
    else if (input._saleJM && input._saleJM[code] !== undefined) { r.sale = input._saleJM[code]; r.saleSrc = 'Sales JM'; }
    r.laborBudget = laborBudget[code] || 0;
    r.estLabor = estLabor[code] || 0;
    var pt = 0; for (var k in r.p) { r.p[k] = eRound2_(r.p[k]); pt += r.p[k]; }
    r.pTotal = eRound2_(pt);
    r.cNova = r.p.c11;
    var lab = r.laborCF; for (var m in r.laborM) { if (closed[m]) lab += r.laborM[m]; }
    r.labor = eRound2_(lab);
    var le = 0; for (var m2 in r.laborEstM) { r.laborEstM[m2] = eRound2_(r.laborEstM[m2]); le += r.laborEstM[m2]; }
    r.laborEst = eRound2_(le);
    // ค่าแรงที่ HR ลงไว้ในเดือนที่ยังไม่ปิดงวด (ยอดบางส่วน) — เก็บไว้ให้ดู ไม่นับรวม
    var lo = 0; for (var m3 in r.laborM) { if (!closed[m3]) lo += r.laborM[m3]; }
    r.laborOpenPartial = eRound2_(lo);
    for (var m4 in r.laborM) r.laborM[m4] = eRound2_(r.laborM[m4]);
    r.cHRdup = eRound2_(r.cHRdup); r.cSTT = eRound2_(r.cSTT); r.cHRlines = eRound2_(r.cHRlines);
    var jd = jDet[code];
    if (jd) { r.dHours = eRound2_(jd.hours); r.dPeople = Object.keys(jd.people).length; r.dDays = Object.keys(jd.days).length; r.dFirst = jd.first; r.dLast = jd.last; }
    r.rate = eRound2_(r.rate);
    // ตรวจ: ผลรวมรายเดือน + ยกมา ต้องเท่ากับคอลัมน์ Total ของ HR
    if (r.laborTotalCol !== null) {
      var all = r.laborCF; for (var m5 in r.laborM) all += r.laborM[m5];
      if (Math.abs(all - r.laborTotalCol) > 1) D.hrTotalColDiff.push({ job: code, sumMonths: eRound2_(all), totalCol: eRound2_(r.laborTotalCol) });
    }
    if (r.pShared) r.flags.push('แบ่งจัดซื้อจากแท็บรวม ' + r.pShared + ' คัน');
    if (r.cHRdup) r.flags.push('ตัด ผรม ซ้ำ ' + r.cHRdup.toLocaleString('en-US'));
    if (Math.abs(r.cHRgap) > 1) r.flags.push('ผรม HR: ยอดรวมไม่ตรงรายบรรทัด');
    if (!r.sale && (r.type === 'JT' || r.type.indexOf('JM') === 0)) r.flags.push('ไม่พบราคาขาย');
    if (r.pTotal && !r.labor && !r.laborEst && r.type === 'JT') r.flags.push('มีจัดซื้อ แต่ไม่มีค่าแรง');
    if (r.p.c0) r.flags.push('มีบรรทัดไม่ระบุหมวดใน NOVA');
  });

  /* ---- 2.11 กระทบยอดรายเดือนของ HR ---- */
  var monthCheck = months.map(function (m) {
    var sum = 0; Object.keys(J).forEach(function (c) { sum += J[c].laborM[m] || 0; });
    var hrIn = closed[m] || 0;
    var est = 0; Object.keys(J).forEach(function (c) { est += J[c].laborEstM[m] || 0; });
    var src = srcMonth[m] || { hours: 0, cost: 0 };
    var ded = 0; (D.hrDedup || []).forEach(function (x) { ded += (x.monthly && x.monthly[m]) || 0; });
    return { m: m, closed: closed[m] ? 1 : 0, hrInput: eRound2_(hrIn), sumJobs: eRound2_(sum), dedup: eRound2_(ded),
             diff: closed[m] ? eRound2_(sum - hrIn) : 0, est: eRound2_(est), srcCost: eRound2_(src.cost), srcHours: eRound2_(src.hours) };
  });

  // ค่าแรงรายจ๊อบใน ACTUAL_WIDE เทียบ SRC_YYYY_MM (หาว่าส่วนต่างรายเดือนมาจากจ๊อบไหน)
  D.srcVsWide = [];
  months.forEach(function (m) {
    if (!closed[m] || !input.src || !input.src[m]) return;
    var codes = {};
    Object.keys(J).forEach(function (c) { if (J[c].laborM[m]) codes[c] = 1; });
    Object.keys(srcJM).forEach(function (c) { if (srcJM[c][m]) codes[c] = 1; });
    Object.keys(codes).forEach(function (c) {
      var w = (J[c] && J[c].laborM[m]) || 0, s = (srcJM[c] && srcJM[c][m]) ? srcJM[c][m].cost : 0;
      if (Math.abs(w - s) > 1) D.srcVsWide.push({ m: m, job: c, wide: eRound2_(w), src: eRound2_(s), diff: eRound2_(w - s) });
    });
  });

  // ความครอบคลุมของข้อมูลรายวัน เทียบชั่วโมงทางการของ HR (SRC)
  var coverage = [];
  Object.keys(srcJM).forEach(function (code) {
    for (var m in srcJM[code]) {
      var off = srcJM[code][m].hours; if (!off) continue;
      var dh = jpH[code + '|' + m] || 0;
      coverage.push([code, m, eRound2_(off), eRound2_(dh), Math.round(dh / off * 1000) / 10]);
    }
  });

  var jobs = Object.keys(J).sort().map(function (c) { return J[c]; });
  return {
    engine: ENGINE_VERSION, builtAt: input.builtAt || '', months: months, closed: closed, openMonths: openMonths,
    globalRate: eRound2_(globalRate), lastClosed: lastClosed,
    cats: COST_CATS, jobs: jobs, proc: proc, contr: contr, novaIndex: novaIndex,
    monthCheck: monthCheck, coverage: coverage, diag: D
  };
}

/* ---------------- 3) ตัวอ่านแต่ละแหล่ง ---------------- */

/** แถวรายวันจาก JOBTRACK (Job_Log_YYYY_MM) และ Timesheet ของ HR (TIMESHEET_DIRECT…) */
function eParseDetailRows_(logs, tsd) {
  var rows = [], sources = [], unknown = {};
  (logs || []).forEach(function (t) {
    var v = t.values || [];
    var h = eFindHdrRow_(v, 'Job ID', 5); if (h < 0) { sources.push({ tab: t.title, rows: 0, note: 'ไม่พบหัว Job ID' }); return; }
    var hdr = v[h];
    var iDate = eCol_(hdr, ['วันที่']), iJob = eCol_(hdr, ['Job ID']), iEmp = eCol_(hdr, ['รหัสพนักงาน']),
        iName = eCol_(hdr, ['ชื่อพนักงาน']), iDept = eCol_(hdr, ['แผนก']),
        iCat = eColExact_(hdr, 'หมวด Process'), iProc = eColExact_(hdr, 'Process'),
        iCode = eCol_(hdr, ['รหัสงาน']), iSub = eCol_(hdr, ['ชื่องานย่อย']),
        iHrs = eCol_(hdr, ['ชม.รวม (ปกติ+OT)', 'ชม.รวม']);
    var mm = String(t.title).match(/(\d{4})_(\d{2})/);
    var tabPeriod = mm ? ((+mm[1] > 2400 ? +mm[1] - 543 : +mm[1]) + '-' + mm[2]) : '';
    var n = 0;
    for (var i = h + 1; i < v.length; i++) {
      var r = v[i] || [];
      var job = eJob_(r[iJob]); var hrs = eNum_(r[iHrs]);
      if (!job || hrs <= 0) continue;
      if (!eIsJob_(job)) { unknown[job] = (unknown[job] || 0) + hrs; continue; }
      var date = eDate_(r[iDate]);
      var cat, sub;
      if (iCat >= 0) {
        cat = eStr_(r[iCat]) || '(ไม่ระบุหมวด)';
        sub = ((iCode >= 0 ? eStr_(r[iCode]) + ' ' : '') + (iSub >= 0 ? eStr_(r[iSub]) : '')).trim() || cat;
      } else {
        cat = eStr_(r[iProc]) || '(ไม่ระบุ Process)'; sub = cat;
      }
      rows.push({ src: 'JT', tab: t.title, date: date, period: tabPeriod || ePeriod_(date), job: job,
                  emp: eStr_(r[iEmp]).replace(/\.0$/, ''), name: eStr_(r[iName]), dept: iDept >= 0 ? eStr_(r[iDept]) : '',
                  cat: cat, sub: sub, hours: hrs });
      n++;
    }
    sources.push({ tab: t.title, src: 'JOBTRACK', period: tabPeriod, rows: n });
  });
  (tsd || []).forEach(function (t) {
    var v = t.values || [];
    var h = eFindHdrRow_(v, 'JOB CODE', 6); if (h < 0) { sources.push({ tab: t.title, rows: 0, note: 'ไม่พบหัว JOB CODE' }); return; }
    var hdr = v[h];
    var iDate = eCol_(hdr, ['วันที่ทำงาน']), iJob = eCol_(hdr, ['JOB CODE']), iEmp = eCol_(hdr, ['รหัสพนักงาน']),
        iName = eCol_(hdr, ['ชื่อพนักงาน']), iDept = eCol_(hdr, ['ชื่อแผนก']), iProc = eCol_(hdr, ['Process']),
        iHrs = eCol_(hdr, ['จำนวนชั่วโมงการทำงาน']);
    var n = 0, per = {};
    for (var i = h + 1; i < v.length; i++) {
      var r = v[i] || [];
      var job = eJob_(r[iJob]); var hrs = eNum_(r[iHrs]);
      if (!job || hrs <= 0) continue;
      if (!eIsJob_(job)) { unknown[job] = (unknown[job] || 0) + hrs; continue; }
      var date = eDate_(r[iDate]); var p = ePeriod_(date); per[p] = 1;
      var proc = eStr_(r[iProc]) || '(ไม่ระบุ Process)';
      rows.push({ src: 'HR', tab: t.title, date: date, period: p, job: job,
                  emp: eStr_(r[iEmp]).replace(/\.0$/, ''), name: eStr_(r[iName]), dept: iDept >= 0 ? eStr_(r[iDept]) : '',
                  cat: 'Timesheet HR', sub: proc, hours: hrs });
      n++;
    }
    sources.push({ tab: t.title, src: 'TIMESHEET HR', period: Object.keys(per).join(','), rows: n });
  });
  var unk = Object.keys(unknown).map(function (k) { return { job: k, hours: eRound2_(unknown[k]) }; });
  return { rows: rows, sources: sources, unknownJobs: unk };
}

/** แท็บ "Cost ผรม to HR" — ตารางซ้าย A:F (จ๊อบ/ผู้รับเหมาเขียนครั้งเดียว แถวต่อไปว่าง = ของเดิม) */
function eParseContrHR_(v) {
  var lines = [], check = [], noJob = [];
  var h = eFindHdrRow_(v, 'vendorname', 5);
  if (h < 0) return { lines: lines, check: check, noJob: noJob, pivot: {} };
  var hdr = v[h];
  var iJob = eCol_(hdr, ['JobCode']), iName = eCol_(hdr, ['JobName']), iV = eCol_(hdr, ['vendorname']),
      iG = eCol_(hdr, ['Goodname']), iA = eCol_(hdr, ['SUM ของ GoodAmnt', 'GoodAmnt']);
  var curJob = '', curV = '', subtotal = {}, sums = {};
  // ตารางขวา (สรุปต่อจ๊อบ) อยู่หลังตารางซ้าย: JobCode ตัวที่ 2
  var iJob2 = -1, iA2 = -1;
  for (var c = iA + 1; c < hdr.length; c++) {
    if (eStr_(hdr[c]).toLowerCase() === 'jobcode' && iJob2 < 0) iJob2 = c;
    if (iJob2 >= 0 && eStr_(hdr[c]).toLowerCase().indexOf('goodamnt') >= 0) { iA2 = c; break; }
  }
  var pivot = {};
  for (var i = h + 1; i < v.length; i++) {
    var r = v[i] || [];
    var jt = eStr_(r[iJob]);
    if (/รวม|total/i.test(eStr_(r[0]))) continue;      // แถว "ผลรวม" ทั้งตาราง
    if (iJob2 >= 0 && iA2 >= 0) {
      var pj = eJob_(r[iJob2]); if (pj && eIsJob_(pj)) pivot[pj] = (pivot[pj] || 0) + eNum_(r[iA2]);
    }
    if (/รวม|total/i.test(jt)) {                       // แถวรวมย่อย
      var sj = eJob_(jt.replace(/รวม|total/ig, ''));
      if (sj) subtotal[sj] = (subtotal[sj] || 0) + eNum_(r[iA]);
      curV = ''; continue;
    }
    if (jt) { curJob = eJob_(jt); curV = ''; }
    var vn = eStr_(r[iV]); if (vn) curV = vn;
    var amt = eNum_(r[iA]); if (!amt) continue;
    var line = { job: curJob, vendor: curV, desc: eStr_(r[iG]), amount: amt, dup: 0 };
    if (!eIsJob_(curJob)) { noJob.push({ job: curJob || '(ว่าง)', vendor: curV, desc: line.desc, amount: amt }); continue; }
    lines.push(line);
    sums[curJob] = (sums[curJob] || 0) + amt;
  }
  Object.keys(sums).forEach(function (j) {
    var st = subtotal[j], pv = pivot[j];
    var bad = (st !== undefined && Math.abs(st - sums[j]) > 1) || (pv !== undefined && Math.abs(pv - sums[j]) > 1);
    check.push({ job: j, lines: eRound2_(sums[j]), subtotal: st === undefined ? null : eRound2_(st),
                 pivot: pv === undefined ? null : eRound2_(pv), ok: bad ? 0 : 1 });
  });
  Object.keys(pivot).forEach(function (j) {
    if (sums[j] === undefined) check.push({ job: j, lines: 0, subtotal: subtotal[j] === undefined ? null : subtotal[j], pivot: eRound2_(pivot[j]), ok: 0 });
  });
  return { lines: lines, check: check, noJob: noJob, pivot: pivot };
}

/** แท็บ "Cost ผรม พนักงาน STT จ่ายผ่าน…" */
function eParseContrSTT_(v) {
  var lines = [];
  var h = eFindHdrRow_(v, 'JobCode', 5); if (h < 0) return { lines: lines };
  var hdr = v[h];
  var iJ = eCol_(hdr, ['JobCode']), iN = eCol_(hdr, ['ชื่อพนักงาน']), iA = eCol_(hdr, ['ยอดเงิน']), iD = eCol_(hdr, ['รายละเอียดงาน']);
  for (var i = h + 1; i < v.length; i++) {
    var r = v[i] || []; var amt = eNum_(r[iA]); if (!amt) continue;
    lines.push({ job: eJob_(r[iJ]), vendor: eStr_(r[iN]), desc: iD >= 0 ? eStr_(r[iD]) : '', amount: amt });
  }
  return { lines: lines };
}

/** รายละเอียดรายวันของจ๊อบเดียว (หน้า "วันทำงาน") */
function eJobDays_(logs, tsd, code) {
  var det = eParseDetailRows_(logs, tsd);
  var tsdPeriods = {};
  det.rows.forEach(function (x) { if (x.src === 'HR') tsdPeriods[x.period] = 1; });
  return det.rows.filter(function (x) {
    return x.job === code && ((x.src === 'HR') === !!tsdPeriods[x.period]);
  }).map(function (x) {
    return [x.date, x.period, x.emp, x.name, x.dept, x.cat, x.sub, eRound2_(x.hours), x.src === 'HR' ? 'Timesheet HR' : 'JOBTRACK'];
  }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
}

/* ให้ node require ได้ (Apps Script ไม่มี module → ข้าม) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { eBuildSnapshot_: eBuildSnapshot_, eNovaTabJobs_: eNovaTabJobs_, eNovaHead_: eNovaHead_,
    eNovaCols_: eNovaCols_, eIsNovaJobTab_: eIsNovaJobTab_, eJobDays_: eJobDays_, eDate_: eDate_, ePeriod_: ePeriod_,
    eVendorKey_: eVendorKey_, eCat_: eCat_, eJob_: eJob_, COST_CATS: COST_CATS, ENGINE_VERSION: ENGINE_VERSION };
}
