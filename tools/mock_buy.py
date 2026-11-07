import openpyxl, json, datetime, sys
keep=['หมวด','ประเภท','Code','PART NAME','DESCRIPTION',"Q'TY",'หน่วย(BOM)','MY ACC CODE','MY ACC GOOD NAME','มีของ/ไม่มีของ','จำนวนที่ต้องซื้อ','POR NO.','สรุป Supplier','Price/EA','วันที่รับสินค้า','ต้นทุนเข้าจ๊อบ','เปิด PO']
wb=openpyxl.load_workbook(sys.argv[1]+"/jt2569.xlsx",read_only=True,data_only=True)
out={}
for i,ws in enumerate(wb.worksheets):
    if not ws.title.startswith('JT-'): continue
    rows=list(ws.iter_rows(values_only=True)); h=[str(x).strip() if x is not None else '' for x in rows[9]]
    ci=[h.index(k) if k in h else -1 for k in keep]
    data=[]
    for r in rows[10:]:
        if not any(r[a] not in (None,'') for a in range(6)) and not r[ci[15]]: continue
        o=[]
        for c in ci:
            v=r[c] if c>=0 and c<len(r) else ''
            if isinstance(v,datetime.datetime): v=v.strftime('%Y-%m-%d')
            o.append('' if v is None else v)
        data.append(o)
    out[ws.title]={'title':ws.title,'cols':keep,'rows':data,'fileId':'FID_JT','sheetId':i}
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,default=str)
print(len(out))
