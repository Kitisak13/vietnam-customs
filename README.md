# Vietnam Customs Scraper Pipeline

ระบบดึงข้อมูลรายงานสถิติอัตโนมัติจากกรมศุลกากรเวียดนาม (`customs.gov.vn`) รองรับทั้งระบบ **Google Apps Script (Cloud Automation)** และ **Python CLI (Local Run)** ทะลุระบบ Geo-blocking ของเวียดนามผ่าน ScraperAPI

---

## 1. กลไกการทำงานของระบบ (Smart Incremental Update)

1. **ไม่เช็คเฉพาะชื่อเดือน**: เนื่องจากใน 1 เดือน ศุลกากรเวียดนามจะลงข้อมูล 3-4 ครั้ง (First half, Second half, Full Month, FDI ฯลฯ) ระบบจึงตรวจสอบความซ้ำซ้อนโดยใช้ **`ชื่อรายงาน + รอบเดือน` (Title + Month)** และ **URL ของไฟล์**
2. **ไม่โหลดข้อมูลประวัติซ้ำ**: ระบบจะดึงเฉพาะข้อมูลล่าสุด (Page 1 = 20 รายการล่าสุด) มาเทียบกับข้อมูลที่มีอยู่ใน Sheet และ Drive/Local
3. **ข้ามไฟล์ที่เคยมีอยู่แล้ว**: หากไฟล์ PDF นั้นเคยดาวน์โหลดไว้แล้ว ระบบจะข้ามทันที
4. **แจ้งเตือนเฉพาะเมื่อมีของใหม่**: ระบบจะส่งข้อความแจ้งเตือนเข้า Microsoft Teams Channel **เฉพาะรอบที่มีรายงานใหม่ถูกเผยแพร่ หรือมีไฟล์ถูกดาวน์โหลดเพิ่มจริงเท่านั้น** หากไม่มีอะไรใหม่ ระบบจะจบการทำงานรอบนั้นทันทีใน 2-3 วินาที

---

## 2. Google Apps Script (Automation)

### การตั้งค่า Script Properties

เข้าไปที่ **Project Settings (รูปเฟือง) > Script Properties** ใน Google Apps Script Editor แล้วเพิ่มคีย์ดังนี้:

| Property            | Description                                                                              |
| :------------------ | :--------------------------------------------------------------------------------------- |
| `SHEET_ID`          | ID ของ Google Sheet (เช่น `1BG1hbTFyM-fKuGBvrWeBi1Kbtg-N6526r7vb8cDk6SQ`)                |
| `ROOT_FOLDER_ID`    | ID ของโฟลเดอร์ Google Drive สำหรับจัดเก็บไฟล์ (เช่น `1xzIgYuZvtcoercgHVFIKgdfbBn0W4LFG`) |
| `SCRAPER_API_KEY`   | API Key จาก ScraperAPI สำหรับทะลุ Geo-blocking ของเวียดนาม                               |
| `TEAMS_WEBHOOK_URL` | URL ของ Microsoft Teams Incoming Webhook                                                 |

### การเริ่มใช้งานและตั้งเวลาอัตโนมัติ

1. เปิด Apps Script Editor
2. เลือกฟังก์ชัน **`setup`** แล้วกด **Run** หนึ่งครั้ง
   - ระบบจะตรวจสอบ Script Properties ทั้งหมด
   - สร้าง Trigger ทำงานวันละ 2 เวลา: **11:00 น.** และ **15:00 น.** อัตโนมัติ
   - มีระบบตรวจจับวันเสาร์–อาทิตย์ โดยจะข้ามการทำงานอัตโนมัติโดยไม่สิ้นเปลืองโควตา

---

## 3. Python CLI (Local Execution)

รันบนเครื่อง Local หรือตั้งเป็น Scheduled Task/Cron:

```bash
# ตรวจสอบรายงานล่าสุด (ค่าเริ่มต้น: หน้า 1 = 20 รายการล่าสุด) พร้อมผสานกับข้อมูลเก่าและโหลดไฟล์ใหม่
python scraper.py

# ดึงข้อมูลฉบับภาษาเวียดนาม
python scraper.py --lang TIENG_VIET

# ดึงเฉพาะตารางข้อมูลลง CSV และ JSON โดยไม่ดาวน์โหลดไฟล์
python scraper.py --no-download

# ระบุจำนวนหน้าที่ต้องการดึงแบบกำหนดเอง (เช่น 2 หน้า)
python scraper.py --pages 2
```
