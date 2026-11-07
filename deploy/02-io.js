/**
 * STT NOVA-Costing
 * 02-io.js — อ่าน Google Sheets (ค่าดิบ ไม่ใช่ข้อความที่จัดรูปแบบแล้ว) · เก็บ/อ่านผลคำนวณ (Snapshot)
 *
 * ⚠️ ต้องอ่านแบบ UNFORMATTED_VALUE เสมอ — ถ้าอ่านแบบปกติ ตัวเลขจะมาเป็นข้อความ "1,234.56"
 *    และวันที่จะมาเป็นข้อความตามรูปแบบเซลล์ → คำนวณเพี้ยน
 */

var RAW = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' };

function q_(title) { return "'" + String(title).replace(/'/g, "''") + "'"; }

/**
 * เรียก Google ซ้ำเมื่อโดนจำกัดโควตา (Sheets API: ~60 ครั้ง/นาที/ผู้ใช้)
 * บทเรียน v1.1.2: อ่าน NOVA ครบทุกแท็บ (~1,600 แท็บ) ยิงถี่จนโดน "Quota exceeded" → ทั้งรอบล้ม
 * รอ 5 → 10 → 20 → 40 วินาที แล้วลองใหม่ (สูงสุด 5 ครั้ง)
 */
function withRetry_(fn) {
  var wait = 5000;
  for (var n = 0; ; n++) {
    try { return fn(); }
    catch (e) {
      var m = String(e && e.message || e);
      if (n >= 4 || !/quota|rate|429|503|500|backend|timed out|try again|Service invoked too many|unavailable/i.test(m)) throw e;
      Utilities.sleep(wait + Math.floor(Math.random() * 1000));
      wait *= 2;
    }
  }
}

/** อ่านทั้งแท็บ (ค่าดิบ) */
function readTab_(fileId, tab, a1) {
  var r = withRetry_(function () { return Sheets.Spreadsheets.Values.get(fileId, q_(tab) + (a1 ? '!' + a1 : ''), RAW); });
  return (r && r.values) ? r.values : [];
}

/** รายชื่อแท็บ + sheetId */
function listTabs_(fileId) {
  var r = withRetry_(function () { return Sheets.Spreadsheets.get(fileId, { fields: 'sheets.properties(sheetId,title)' }); });
  return (r.sheets || []).map(function (s) { return { title: s.properties.title, sheetId: s.properties.sheetId }; });
}

/** อ่านหลายช่วงในครั้งเดียว (ชุดละ 120 ช่วง) → array ของ values ตามลำดับ */
function batchGet_(fileId, ranges) {
  var out = [];
  for (var i = 0; i < ranges.length; i += 120) {
    var part = ranges.slice(i, i + 120);
    var r = withRetry_(function () {
      return Sheets.Spreadsheets.Values.batchGet(fileId,
        { ranges: part, valueRenderOption: RAW.valueRenderOption, dateTimeRenderOption: RAW.dateTimeRenderOption });
    });
    var vr = r.valueRanges || [];
    for (var k = 0; k < part.length; k++) out.push((vr[k] && vr[k].values) ? vr[k].values : []);
  }
  return out;
}

/* ---------------- ที่เก็บผลอ่าน NOVA รายไฟล์ ----------------
 * ไฟล์ NOVA ไหน "ไม่ได้แก้" ตั้งแต่รอบก่อน (เวลาแก้ล่าสุดเท่าเดิม) → ใช้ผลเดิม ไม่ต้องอ่านใหม่ (เร็ว + ไม่เปลืองโควตา)
 * เก็บเป็นไฟล์ JSON ใน Drive ของเจ้าของสคริปต์ · map fileId→cacheId ใน Script Properties */
function novaCacheGet_(fid) {
  try {
    var map = JSON.parse(PropertiesService.getScriptProperties().getProperty('NOVA_CACHE') || '{}');
    if (!map[fid]) return null;
    return JSON.parse(DriveApp.getFileById(map[fid]).getBlob().getDataAsString('UTF-8'));
  } catch (e) { return null; }
}
function novaCacheSet_(fid, obj) {
  var p = PropertiesService.getScriptProperties();
  var map = JSON.parse(p.getProperty('NOVA_CACHE') || '{}');
  var json = JSON.stringify(obj), f = null;
  if (map[fid]) { try { f = DriveApp.getFileById(map[fid]); } catch (e) { f = null; } }
  if (f) f.setContent(json);
  else { f = DriveApp.createFile('STT-NOVA-Costing-CACHE-' + fid + '.json', json, 'application/json'); map[fid] = f.getId(); p.setProperty('NOVA_CACHE', JSON.stringify(map)); }
}
function fileStamp_(fid) {
  try { return DriveApp.getFileById(fid).getLastUpdated().getTime(); } catch (e) { return 0; }
}

/** เลขคอลัมน์ (0 = A) → ตัวอักษร */
function colA1_(i) {
  var s = ''; i = i + 1;
  while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

/** REGISTRY: เอาเฉพาะไฟล์ NOVA ที่ Active (ห้ามฝัง File ID ในโค้ด) */
function novaFiles_() {
  var v = readTab_(CFG.MASTER, CFG.TAB.REGISTRY);
  if (!v.length) throw new Error('อ่านแท็บ REGISTRY ไม่ได้');
  var h = v[0];
  var iSrc = eCol_(h, ['source']), iFid = eCol_(h, ['file_id']), iFnm = eCol_(h, ['file_name']),
      iAct = eCol_(h, ['active']), iTyp = eCol_(h, ['type']);
  var seen = {}, out = [];
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][iSrc] || '').trim().toUpperCase() !== 'NOVA') continue;
    if (String(v[i][iAct] || '').trim().toUpperCase() === 'N') continue;
    var fid = String(v[i][iFid] || '').trim();
    if (!fid || seen[fid]) continue;                   // ไฟล์เดียวลงทะเบียนซ้ำ = อ่านครั้งเดียว
    seen[fid] = 1;
    out.push({ fileType: String(v[i][iTyp] || '').trim(), fileId: fid, fileName: String(v[i][iFnm] || '').trim() });
  }
  return out;
}

/* ---------------- เก็บผลคำนวณ ----------------
 * ชั้น 1: CacheService แบ่งก้อนละ 30,000 ตัวอักษร (ไทย 1 ตัว = 3 ไบต์ → ไม่เกิน 100 KB) (เร็ว · อยู่ 6 ชม.)
 * ชั้น 2: ไฟล์ JSON ใน Drive ของเจ้าของสคริปต์ (ถาวร · ID เก็บใน Script Properties)
 */
function snapSave_(json) {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('SNAP_FILE_ID');
  var file = null;
  if (id) { try { file = DriveApp.getFileById(id); } catch (e) { file = null; } }
  if (file) file.setContent(json);
  else { file = DriveApp.createFile(CFG.SNAP_NAME, json, 'application/json'); p.setProperty('SNAP_FILE_ID', file.getId()); }
  try { cachePutBig_('SNAP', json); } catch (e) { /* แคชเต็ม/ใหญ่เกิน → ใช้ไฟล์ Drive อย่างเดียว ไม่ให้ทั้งรอบล้ม */ }
}

function snapLoad_() {
  var hit = cacheGetBig_('SNAP');
  if (hit) return hit;
  var id = PropertiesService.getScriptProperties().getProperty('SNAP_FILE_ID');
  if (!id) return null;
  try {
    var json = DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8');
    if (json) { try { cachePutBig_('SNAP', json); } catch (e) {} }
    return json || null;
  } catch (e) { return null; }
}

function cachePutBig_(key, str) {
  var c = CacheService.getScriptCache();
  var size = 30000, n = Math.ceil(str.length / size), o = {};
  if (n > 150) { c.remove(key + '_N'); return; }        // ใหญ่เกินแคช → ใช้ไฟล์ Drive อย่างเดียว (30,000 ตัวอักษร/ก้อน เผื่อภาษาไทย 3 ไบต์)
  for (var i = 0; i < n; i++) o[key + '_' + i] = str.substr(i * size, size);
  o[key + '_N'] = String(n);
  c.putAll(o, 21600);
}

function cacheGetBig_(key) {
  var c = CacheService.getScriptCache();
  var n = Number(c.get(key + '_N') || 0);
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] === undefined || got[keys[j]] === null) return null; s += got[keys[j]]; }
  return s;
}
