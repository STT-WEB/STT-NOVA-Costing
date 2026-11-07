# STT NOVA-Costing — ความจำถาวรของโปรเจกต์

> อ่านไฟล์นี้ก่อนเริ่มงานทุกครั้ง · Candy = ชื่อที่เบียร์ (sasipa@suteetankers.com) เรียก Claude
> **เวอร์ชันจริงอยู่บรรทัดแรกของ `deploy/CHANGELOG.md`** · ป้ายบนเว็บดึงจาก `COSTING_VERSION` ใน `deploy/00-config.js`

## 0. คืออะไร
Dashboard ต้นทุนงานจริง: จัดซื้อ (NOVA ทุกไฟล์ใน REGISTRY) + ค่าแรง STT (HR ACTUAL_WIDE) + ผู้รับเหมา (NOVA หมวด 11 + HR)
เทียบราคาขาย (Budget Cost Sales JT/JM) · **อ่านอย่างเดียว ไม่เขียนกลับไฟล์ไหนเลย**

## 1. แหล่งข้อมูล
| แหล่ง | File ID / ที่มา | แท็บ |
|---|---|---|
| NOVA จัดซื้อ | REGISTRY (source=NOVA, Active≠N) — ห้ามฝัง ID | ทุกแท็บจ๊อบ: หมวด · สรุป Supplier · ต้นทุนเข้าจ๊อบ |
| MASTER | `1ZCKb_KRECWRSRaObBQz4nDUmwazvV2lhoPMj2O5j744` | USERS · REGISTRY · Budget Cost Sales JT/JM |
| HR JOB COST MASTER | `10u8sLbe6dtGtFtWwAMruvAgrawDOScqEBmJRA3avPcM` | ACTUAL_WIDE · Sale Budget A:C · Estimate Budget · Cost ผรม to HR · Cost ผรม พนักงาน STT… · SRC_YYYY_MM |
| JOBTRACK | `1ZPl3uVRtM5r4sPA-yX1OwTyp34XCTIcKRC0Sx8qsr9s` | Job_Log_YYYY_MM (พ.ศ.) · TIMESHEET_DIRECT… |

## 2. กติกาที่เบียร์เคาะ (6 พ.ย. 2569)
1. **ผรม:** NOVA หมวด 11 = ยอดหลัก · HR นับเฉพาะที่ไม่ซ้ำ (จ๊อบ+ชื่อ+ยอด · ผลรวมรายคน · ส่วนที่ HR ไม่มีรายบรรทัดแต่เท่ากับ NOVA)
   ยอดทางการ HR = คอลัมน์ "ค่าแรงผู้รับเหมา Sub + พนักงาน STT" ใน ACTUAL_WIDE (ใช้ค่ามากสุดถ้าแถวซ้ำ)
2. **ค่าแรง HR:** ตามจ๊อบจริง ไม่หาร · **จัดซื้อแท็บรวมหลายคัน:** หารเท่ากัน ← เบียร์ยังไม่ยืนยันฝั่งจัดซื้อ
3. **Process (บาท)** = ค่าแรงจ๊อบเดือนนั้น × ชม.Process ÷ ชม.รวม → รวมกลับเท่าเงินเดือน (เทสต์เช็ค)
   งวดที่มี TIMESHEET_DIRECT ใช้ตัวนั้นทั้งงวด (ตรง SRC) · นอกนั้น JOBTRACK
4. **เดือนยังไม่ปิดงวด** (แถว "HR ใส่ตัวเลข" ว่าง) = ประมาณการ ชม. × อัตรา (Σต้นทุน SRC ÷ Σชม. SRC ของจ๊อบ · ไม่มีใช้อัตราเดือนล่าสุดทั้งโรงงาน)
5. **มุมมอง:** ① จัดซื้อ (1–11) ② HR (ค่าแรง+ผรม HR) ③ จัดซื้อ+ค่าแรง STT ④ สินค้า+ค่าแรง STT+ผรมทั้งหมด (ต้นทุนเต็ม)
6. **สิทธิ์:** ALLOW ใน 00-config.js มี 3 รหัส (6100030 · 999999 · 888888) + PIN จาก USERS · ทุก endpoint เรียก `requireAuth_` บรรทัดแรก

## 3. Deploy
GitHub: `STT-WEB/STT-NOVA-Costing` (เบียร์สร้าง repo เอง → `เชื่อม GitHub.bat` ครั้งแรก) · .gitignore แบบ P&S: ไม่ขึ้นรหัส clasp / ข้อมูลจริง / preview
`อัปเดตระบบ Costing.bat` = git → `node _tests/guard-v100.js` → `clasp push -f` → `clasp deploy` (id ใน deploy/.deployid)
ครั้งแรก: `สร้างโปรเจกต์ครั้งแรก.bat` (clasp create แล้วคืน appsscript.json ของเรา)

## 4. ทดสอบกับข้อมูลจริง (ในคลาวด์ของ Candy)
1. ดาวน์โหลด xlsx ของ MASTER / HR / JOBLOG / STT-DB-JT-2569 / STT-DB-JM-2569 ด้วย Drive connector
2. `python3 tools/make_fixture.py <dir> <dir>/fixture.json`
3. `node _tests/guard-v100.js <dir>` · `node tools/build_preview.js <dir> preview/x.html`

## 5. ค้างอยู่ / ต้องขอจากเบียร์
- หน้าภาพรวม v1.1.0 = แบบผู้บริหารจอเดียว (เบียร์เลือก 7 พ.ย.) — มุมมอง ② HR ยังเทียบกับราคาขาย อาจควรเทียบงบค่าแรง
- ยืนยัน: ต้นทุนจัดซื้อแท็บรวมหลายคัน หารเท่ากันถูกไหม
- ลิงก์เว็บ NOVA ใหญ่ + วิธีเปิดจ๊อบตรง (ใส่ Script Property `NOVA_URL`) — ตอนนี้ปุ่มเปิดแท็บ Google Sheet ของจ๊อบแทน
  โฟลเดอร์โค้ด NOVA ใหญ่ชื่อมีอักษรไทยซ้อน ขอสิทธิ์จากระบบไม่ได้ → ให้เบียร์ "Add folder" เอง
- ราคาขาย JMS/JMC/JMT ไม่อยู่ใน Budget Cost Sales JM (384 จ๊อบไม่มีราคาขาย) — ถามว่าอยู่ไฟล์ไหน
- HR แก้แถวซ้ำ JMS-69/0235 ใน ACTUAL_WIDE (มิ.ย. นับซ้ำ 1,631.05)
