"""แปลงไฟล์ xlsx ที่ดาวน์โหลดจาก Drive → JSON หน้าตาเดียวกับที่ Sheets API (UNFORMATTED_VALUE + SERIAL_NUMBER) ส่งให้ Apps Script
ใช้กับชุดทดสอบ node เท่านั้น"""
import sys, json, re, datetime, openpyxl

D = sys.argv[1]
OUT = sys.argv[2]

def cell(v):
    if isinstance(v, datetime.datetime):
        # serial ของ Google Sheets (นับจาก 1899-12-30)
        return (v - datetime.datetime(1899, 12, 30)).total_seconds() / 86400.0
    if isinstance(v, datetime.date):
        return (datetime.datetime(v.year, v.month, v.day) - datetime.datetime(1899, 12, 30)).days
    if isinstance(v, datetime.time):
        return (v.hour * 3600 + v.minute * 60 + v.second) / 86400.0
    if v is None:
        return ""
    return v

def vals(ws, max_row=None):
    out = []
    for r in ws.iter_rows(values_only=True, max_row=max_row):
        r = [cell(x) for x in r]
        while r and r[-1] == "":
            r.pop()
        out.append(r)
    while out and not out[-1]:
        out.pop()
    return out

def col_letter_free(rows, idx):
    return [(r[idx] if len(r) > idx else "") for r in rows]

master = openpyxl.load_workbook(f"{D}/master.xlsx", read_only=True, data_only=True)
hr = openpyxl.load_workbook(f"{D}/jobcost.xlsx", read_only=True, data_only=True)
log = openpyxl.load_workbook(f"{D}/joblog.xlsx", read_only=True, data_only=True)

inp = {"builtAt": "2026-11-06T18:00:00+07:00"}
inp["salesJT"] = vals(master["Budget Cost Sales JT"])
inp["salesJM"] = vals(master["Budget Cost Sales JM"])
inp["jobMaster"] = vals(hr["JOB_MASTER"])
inp["hrWide"] = vals(hr["ACTUAL_WIDE"])
inp["saleBudget"] = [r[:3] for r in vals(hr["Sale Budget"])]
inp["estBudget"] = vals(hr["Estimate Budget"])
inp["contrHR"] = vals(hr["Cost ผรม to HR"])
stt = [n for n in hr.sheetnames if n.startswith("Cost ผรม พนักงาน STT")]
inp["contrSTT"] = vals(hr[stt[0]]) if stt else []
inp["src"] = {}
for n in hr.sheetnames:
    m = re.match(r"^SRC_(\d{4})_(\d{2})$", n)
    if m:
        inp["src"][m.group(1) + "-" + m.group(2)] = vals(hr[n])
inp["logs"] = [{"title": n, "values": vals(log[n])} for n in log.sheetnames if re.match(r"^Job_Log_\d{4}_\d{2}$", n)]
inp["tsd"] = [{"title": n, "values": vals(log[n])} for n in log.sheetnames if n.upper().startswith("TIMESHEET_DIRECT")]

# NOVA: จำลองสิ่งที่ 20-gather.js ดึงมา (หัวแท็บ + 3 คอลัมน์)
nova = []
for ftype, fname, path in [("JT", "STT-DB-JT-2569", "jt2569.xlsx"), ("JM", "STT-DB-JM-2569", "jm2569.xlsx")]:
    wb = openpyxl.load_workbook(f"{D}/{path}", read_only=True, data_only=True)
    tabs = []
    for i, ws in enumerate(wb.worksheets):
        t = ws.title
        if not re.match(r"^[A-Z]{1,5}-\d{6}", t):
            continue
        # ชื่อแท็บจริงใน Google Sheets มี "/" (xlsx ตัดทิ้ง) → คืนรูปจริงให้เหมือนที่ระบบเจอบนเว็บ
        t = re.sub(r"^([A-Z]{1,5})-(\d{2})(\d{4})", r"\1-\2/\3", t)
        rows = vals(ws)
        head = rows[1:12]
        hdr_i = next((k for k in range(1, 15) if len(rows) > k and rows[k] and str(rows[k][0]).strip() == "หมวด"), -1)
        hdr = rows[hdr_i]
        def ci(name):
            return [str(x).strip() for x in hdr].index(name)
        c_cat, c_v, c_cost = 0, ci("สรุป Supplier"), ci("ต้นทุนเข้าจ๊อบ")
        data = [[(r[c_cat] if len(r) > c_cat else ""), (r[c_v] if len(r) > c_v else ""), (r[c_cost] if len(r) > c_cost else "")] for r in rows[hdr_i + 1:]]
        hd = {"jobNo": "", "jobName": "", "units": 0}
        for r in head:
            a = str(r[0]).strip().upper() if r else ""
            b = r[1] if r and len(r) > 1 else ""
            if a == "JOB NO": hd["jobNo"] = b
            elif a == "JOB NAME": hd["jobName"] = b
            elif a.startswith("TOTAL JOB"): hd["units"] = b
        tabs.append({"title": t, "sheetId": i, "head": hd, "rows": data})
    nova.append({"fileType": ftype, "fileId": "FID_" + ftype, "fileName": fname, "tabs": tabs})
inp["nova"] = nova
json.dump(inp, open(OUT, "w"), ensure_ascii=False, default=str)
print("ok", OUT)
