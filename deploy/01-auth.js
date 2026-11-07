/**
 * STT NOVA-Costing
 * 01-auth.js — เข้าสู่ระบบ (รหัสพนักงาน + PIN) · ตั๋วเข้าใช้ (token) · กันคนนอก
 *
 * ขั้นตอน
 *  1. รหัสพนักงานต้องอยู่ใน ALLOW (00-config.js) — มี 3 คน
 *  2. PIN ต้องตรงกับแท็บ USERS ใน STT-DB-MASTER (ชุดเดียวกับ NOVA) และ active ≠ N
 *  3. ผ่านแล้วได้ token สุ่ม เก็บใน CacheService 8 ชม. — ทุกฟังก์ชันที่ส่งข้อมูลต้องเรียก requireAuth_(token)
 *  4. ใส่ PIN ผิด 5 ครั้ง → ล็อกรหัสนั้น 15 นาที
 */

function normId_(v) {
  return String(v === null || v === undefined ? '' : v).replace(/^'/, '').replace(/\.0+$/, '').trim();
}

function readUsers_() {
  var v = readTab_(CFG.MASTER, CFG.TAB.USERS);
  if (!v || v.length < 2) throw new Error('อ่านแท็บ USERS ใน STT-DB-MASTER ไม่ได้');
  var hdr = v[0];
  var iEmp = eCol_(hdr, ['รหัสพนักงาน', 'empid']), iPin = eCol_(hdr, ['pin']),
      iAct = eCol_(hdr, ['active']), iName = eCol_(hdr, ['display_name', 'name']);
  var out = {};
  for (var i = 1; i < v.length; i++) {
    var emp = normId_(v[i][iEmp]);
    if (!emp || !ALLOW[emp]) continue;                  // เก็บเฉพาะ 3 คนที่อนุญาต
    out[emp] = {
      pin: normId_(v[i][iPin]),
      active: String(v[i][iAct]).trim().toUpperCase() !== 'N',
      name: String(v[i][iName] || ALLOW[emp]).trim()
    };
  }
  return out;
}

/** หน้าเว็บเรียก: เข้าสู่ระบบ */
function login(empId, pin) {
  empId = normId_(empId); pin = normId_(pin);
  if (!empId || !pin) return { ok: false, msg: 'กรุณากรอกรหัสพนักงานและ PIN' };
  var c = CacheService.getScriptCache();
  var failKey = 'FAIL_' + empId;
  var fails = Number(c.get(failKey) || 0);
  if (fails >= MAX_FAIL) return { ok: false, msg: 'ใส่ PIN ผิดเกิน ' + MAX_FAIL + ' ครั้ง — ล็อก 15 นาที' };

  if (!ALLOW[empId]) {
    c.put(failKey, String(fails + 1), 900);
    return { ok: false, msg: 'รหัสพนักงานนี้ไม่มีสิทธิ์เข้าโปรแกรม STT NOVA-Costing' };
  }
  var us = readUsers_();
  var u = us[empId];
  if (!u || !u.pin || u.pin !== pin) {
    c.put(failKey, String(fails + 1), 900);
    return { ok: false, msg: 'รหัสพนักงานหรือ PIN ไม่ถูกต้อง' };
  }
  if (!u.active) return { ok: false, msg: 'บัญชีนี้ถูกระงับการใช้งาน' };

  c.remove(failKey);
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  c.put('TOK_' + token, JSON.stringify({ emp: empId, name: u.name, at: new Date().toISOString() }), SESSION_HOURS * 3600);
  logAccess_(empId, 'login');
  return { ok: true, token: token, name: u.name, version: COSTING_VERSION };
}

function logout(token) {
  try { CacheService.getScriptCache().remove('TOK_' + token); } catch (e) {}
  return { ok: true };
}

/** ⚠️ ทุกฟังก์ชันที่ส่งตัวเลขออกไป ต้องเรียกตัวนี้บรรทัดแรก */
function requireAuth_(token) {
  if (!token || !/^[0-9a-f]{40,80}$/i.test(String(token))) throw new Error('AUTH: กรุณาเข้าสู่ระบบใหม่');
  var raw = CacheService.getScriptCache().get('TOK_' + token);
  if (!raw) throw new Error('AUTH: หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  var s = JSON.parse(raw);
  if (!ALLOW[s.emp]) throw new Error('AUTH: ไม่มีสิทธิ์');
  return s;
}

function whoAmI(token) {
  var s = requireAuth_(token);
  return { name: s.name, emp: s.emp, version: COSTING_VERSION, build: COSTING_BUILD };
}

/** ประวัติการเข้าใช้ (เก็บ 200 รายการล่าสุดใน Script Properties) */
function logAccess_(emp, what) {
  try {
    var p = PropertiesService.getScriptProperties();
    var a = JSON.parse(p.getProperty('ACCESS_LOG') || '[]');
    a.unshift([new Date().toISOString(), emp, what]);
    p.setProperty('ACCESS_LOG', JSON.stringify(a.slice(0, 200)));
  } catch (e) {}
}
