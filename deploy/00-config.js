/**
 * STT NOVA-Costing
 * 00-config.js — เวอร์ชัน · ค่าคงที่ · จุดเข้าเว็บแอป
 *
 * ⚠️ กฎเหล็ก (เหมือน NOVA / P&S Hub)
 *  - ระบบนี้ "อ่านอย่างเดียว" — ไม่เขียนอะไรลงไฟล์ NOVA / HR / JOBTRACK เลย
 *  - File ID ของไฟล์ NOVA รายปี ต้องอ่านจาก REGISTRY เท่านั้น ห้ามฝังในโค้ด
 *  - ห้ามใส่รหัสลับในโค้ด → ใช้ Script Properties
 *  - ป้ายเวอร์ชันบนเว็บดึงจาก COSTING_VERSION ตัวนี้ตัวเดียว (หลักฐานว่า deploy ขึ้นจริง)
 */

var COSTING_VERSION = 'v1.3.0';
var COSTING_BUILD   = '2026-11-09';

var CFG = {
  // ไฟล์กลางของ NOVA (USERS · SETTINGS · REGISTRY · Budget Cost Sales)
  MASTER : '1ZCKb_KRECWRSRaObBQz4nDUmwazvV2lhoPMj2O5j744',
  // 💰🚚STT JOB COST MASTER 2026 (NEW) — ฝั่ง HR
  HR     : '10u8sLbe6dtGtFtWwAMruvAgrawDOScqEBmJRA3avPcM',
  // JOBTRACK_Job_Log 2026 — บันทึกเวลารายวัน/ราย Process
  JOBLOG : '1ZPl3uVRtM5r4sPA-yX1OwTyp34XCTIcKRC0Sx8qsr9s',
  // ชื่อแท็บ
  TAB: {
    USERS: 'USERS', REGISTRY: 'REGISTRY', SALES_JT: 'Budget Cost Sales JT', SALES_JM: 'Budget Cost Sales JM',
    JOB_MASTER: 'JOB_MASTER', HR_WIDE: 'ACTUAL_WIDE', SALE_BUDGET: 'Sale Budget', EST_BUDGET: 'Estimate Budget',
    CONTR_HR: 'Cost ผรม to HR', CONTR_STT_PREFIX: 'Cost ผรม พนักงาน STT',
    WIP: 'All WIP JTJM',                            // MASTER: Model (JT) / ประเภทงานซ่อม (JM) / วันเริ่ม-ส่งมอบ
    HIST_COST: 'Cost Purchase 2022-2025'            // MASTER จัดซื้อ: ต้นทุนจ๊อบย้อนหลัง ปี 65–68
  },
  // เว็บ NOVA ใหญ่ (ต้องล็อกอินด้วยบัญชี suteetankers.com) — เปลี่ยนได้ที่ Script Property NOVA_URL
  NOVA_URL : 'https://script.google.com/a/macros/suteetankers.com/s/AKfycbwBox9KkE5P6AIPNoG_xlY9G70TZTaZaBIf3MwnKBFHtSt_3i5dyxsgsFhtrU9Ofxk3Kw/exec',
  SNAP_NAME : 'STT-NOVA-Costing-SNAPSHOT.json',   // ไฟล์เก็บผลคำนวณล่าสุด (ใน Drive ของเจ้าของสคริปต์)
  AUTO_MIN  : 10                                  // อัปเดตอัตโนมัติทุกกี่นาที
};

/**
 * 🔒 คนที่เข้าได้ — มีแค่ 3 คนนี้เท่านั้น (เบียร์สั่ง 6 พ.ย. 2569)
 * เข้าด้วย รหัสพนักงาน + PIN จากแท็บ USERS (ชุดเดียวกับ NOVA)
 * รหัสพนักงานอื่นต่อให้ PIN ถูก ก็เข้าไม่ได้ — เช็คที่ฝั่งเซิร์ฟเวอร์ทุกคำขอ
 */
var ALLOW = {
  '6100030': 'คุณศศิภา (เบียร์)',
  '999999' : 'คุณแบล็ค (VP)',
  '888888' : 'คุณประดิษฐ์ (President)'
};

var SESSION_HOURS = 8;     // ล็อกอินครั้งหนึ่งอยู่ได้กี่ชั่วโมง
var MAX_FAIL      = 5;     // ใส่ PIN ผิดกี่ครั้งถึงล็อก 15 นาที

function getVersion() { return { version: COSTING_VERSION, build: COSTING_BUILD, engine: ENGINE_VERSION }; }

/** จุดเข้าเว็บแอป */
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.version = COSTING_VERSION;
  return t.evaluate()
    .setTitle('STT NOVA-Costing')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** ใช้ใน template — ห้ามมีเครื่องหมายปิด template ในโค้ด JS ของไฟล์ .html */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
