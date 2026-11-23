# Asset Ctrl (.NET)

ทะเบียนอุปกรณ์ IT และงานซ่อม รุ่น .NET ย้ายมาจาก `asset_ctrl_v2` (PHP + MySQL) มาใช้ **ASP.NET Web Forms บน .NET Framework 4.8** กับ **PostgreSQL**
หน้าเว็บ (HTML/JS/CSS ใน `AssetCtrl.Web/assets`) เป็นชุดเดียวกับรุ่น PHP เปลี่ยนเฉพาะหลังบ้าน

## รันเลย

เปิด `AssetCtrl.sln` ใน Visual Studio 2022 แล้วกด **F5** เว็บจะเปิดที่ http://localhost:8471/

ถ้ายังไม่มีฐานข้อมูล ระบบจะเปิดเป็น **โหมดสาธิต** (ข้อมูลตัวอย่าง ไม่บันทึกอะไร) เข้าระบบด้วย Admin `EMP0007` หรือ User `DEMO01` รหัสผ่านอะไรก็ได้
วิธีสร้างฐานข้อมูลจริงอยู่ใน [docs/01](01-setup-and-run.md)

## เอกสาร

| # | เรื่อง | อ่านเมื่อ |
|---|---|---|
| [01](01-setup-and-run.md) | ตั้งค่าฐานข้อมูล รัน ทดสอบ ค่าใน Web.config | เครื่องใหม่ / ต่อฐานข้อมูล |
| [02](02-porting.md) | โค้ด PHP เทียบกับ C# และกติกา MySQL → PostgreSQL | แก้หรือย้ายโค้ดเพิ่ม |

## Stack

| ชั้น | ใช้อะไร |
|---|---|
| Runtime | .NET Framework 4.8, C# 7.3, IIS / IIS Express |
| หน้าเว็บ | `Default.aspx` ส่งหน้าเปล่า + SPA เดิมของรุ่น PHP (Bootstrap 5) |
| API | `api.ashx?r=<route>` ตัวเดียว route และ JSON เหมือน `api.php` |
| ฐานข้อมูล | PostgreSQL, Npgsql 4.1, Dapper |
| อื่น ๆ | BCrypt.Net (รหัสผ่านรูปแบบเดียวกับ PHP `password_hash`), Newtonsoft.Json, Excel อ่าน/เขียนเอง (ไม่ใช้ไลบรารี) |
| Test | xUnit (unit test ไม่ต้องใช้ฐานข้อมูล) |

## โครงไฟล์

```
AssetCtrl.sln
AssetCtrl.Web/
├─ Default.aspx           หน้าเปล่า โหลด assets/js ทั้งหมด
├─ api.ashx               ทางเข้า API ทุก route
├─ Api/
│  ├─ Kernel.cs           รับ request, ตรวจ CSRF, เรียก controller, แปลง error เป็น JSON (db_unavailable → โหมดสาธิต)
│  ├─ Routes.cs           route ทั้งหมด (ชื่อ action เดียวกับ PHP)
│  └─ Controllers/        13 controller ตามรุ่น PHP
├─ Services/              กติกาธุรกิจ, Import/Export Excel, Audit, งานซ่อม
├─ Repositories/          SQL (Dapper)
├─ Models/
├─ Core/                  Database, Session (ตาราง app_sessions), Auth, Csrf, Lang, AppConfig, Php helpers
├─ Database/schema.pg.sql ตารางทั้งหมด
├─ App_Data/lang/th.json  ข้อความภาษาไทยฝั่งเซิร์ฟเวอร์ (สร้างจาก lang/th.php)
├─ assets/                หน้าเว็บ (ชุดเดียวกับ asset_ctrl_v2/public/assets)
├─ Web.config             ค่าตั้งระบบ
└─ ConnectionStrings.config(.example)   การเชื่อมต่อฐานข้อมูล (ตัวจริงไม่เก็บใน git)
AssetCtrl.Setup/           โปรแกรมตั้งค่า: สร้างตาราง, ผู้ดูแลคนแรก, ข้อมูลตัวอย่าง (docs/01 ข้อ 4)
AssetCtrl.Tests/Unit/     helper แบบ PHP, รหัสผ่าน, แบ่งหน้า, route ทุกตัวมี action, Excel/CSV
docs/
```

## สถานะ

ย้ายครบทุก route ของรุ่น PHP แล้ว และ build ผ่าน มีโหมดสาธิตเมื่อต่อฐานข้อมูลไม่ได้
ทดสอบกับ PostgreSQL 17 แล้วทุกหน้า: เข้าระบบ, งานซ่อม (ค้นหา/กรองวันที่/จัดการหลายใบ), Setting Room, Dashboard,
เครื่อง (เพิ่ม/แก้/แก้หลายเครื่อง/Export), Import (ไฟล์ทั้งก้อนและแบ่งส่ง), Audit, Master data, Work Center, ผู้ใช้, ประวัติการแก้ไข
