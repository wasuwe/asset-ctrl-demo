# 01 · ตั้งค่าและรัน

## 1. สิ่งที่ต้องมี

- Visual Studio 2022 (workload **ASP.NET and web development**) ซึ่งมี IIS Express มาด้วย
- PostgreSQL (เครื่องนี้ใช้ PostgreSQL 17 ที่พอร์ต **5433**) ไม่มีก็รันได้ ระบบจะเปิดเป็นโหมดสาธิต

## 2. ฐานข้อมูล

สร้างฐานข้อมูลและผู้ใช้ฐานข้อมูลด้วยบัญชี `postgres` เอง (พิมพ์รหัสผ่านในหน้าต่างของคุณ):

```powershell
psql -h localhost -p 5433 -U postgres -c "CREATE ROLE demo_user LOGIN PASSWORD 'demo_password'"
psql -h localhost -p 5433 -U postgres -c "CREATE DATABASE asset_ctrl_demo OWNER demo_user ENCODING 'UTF8'"
```

ต้องให้ `demo_user` เป็นเจ้าของ (OWNER) ฐานข้อมูล เพื่อให้สร้างตารางและติดตั้ง `pg_trgm` (ตัวช่วยค้นหา) ได้
ส่วนการสร้างตารางใช้เครื่องมือ Setup ในข้อ 4

## 3. การเชื่อมต่อ

แก้ `AssetCtrl.Web\ConnectionStrings.config` (ไม่เก็บใน git) ถ้ายังไม่มีไฟล์นี้ build ครั้งแรกจะคัดลอกจาก `ConnectionStrings.config.example` ให้เอง

```xml
<add name="AssetCtrl"
     connectionString="Host=localhost;Port=5433;Database=asset_ctrl_demo;Username=demo_user;Password=...;Timezone=Asia/Bangkok;Timeout=5"
     providerName="Npgsql" />
```

`Timeout=5` คือรอการเชื่อมต่อไม่เกิน 5 วินาที ถ้าต่อไม่ได้หน้าเว็บจะเปลี่ยนเป็นโหมดสาธิต

## 4. สร้างตาราง ผู้ดูแลคนแรก และข้อมูลตัวอย่าง (AssetCtrl.Setup)

โปรเจกต์ `AssetCtrl.Setup` ใน solution เป็นโปรแกรม console อ่านการเชื่อมต่อจาก `AssetCtrl.Web\ConnectionStrings.config` เดียวกับเว็บ

**ใน Visual Studio:** คลิกขวา `AssetCtrl.Setup` › **Debug › Start New Instance** จะขึ้นเมนู

```
  1  Check the connection
  2  Create / update the tables
  3  Create the first admin (or reset an admin password)
  4  Load sample data (DEMO-*)
```

ทำตามลำดับ 2 → 3 (→ 4 ถ้าอยากได้ข้อมูลตัวอย่าง) แล้วรันเว็บ เข้าระบบด้วยรหัสพนักงานและรหัสผ่านที่ตั้งในข้อ 3

**หรือสั่งจากบรรทัดคำสั่ง** (`AssetCtrl.Setup\bin\Debug\net48\AssetCtrl.Setup.exe`):

| คำสั่ง | ทำอะไร |
|---|---|
| `check` | ต่อได้ไหม มีตารางหรือยัง ผู้ใช้/เครื่อง/งานซ่อมกี่รายการ เปิดตัวช่วยค้นหาแล้วหรือยัง |
| `schema` | สร้าง/อัปเดตตาราง รันซ้ำได้ ข้อมูลเดิมไม่หาย (ใช้หลังอัปเดตโปรแกรมทุกครั้ง) |
| `admin EMP0001 --first-name ชื่อ --last-name นามสกุล` | สร้างผู้ดูแลคนแรก ถามรหัสผ่านโดยไม่แสดงบนจอ |
| `admin EMP0001 --reset` | ตั้งรหัสผ่านใหม่ให้บัญชีที่มีอยู่ ทำให้เป็น Admin ที่ใช้งานได้ และปลดล็อก (กรณีลืมรหัสหรือโดนล็อก) |
| `demo` | ใส่ข้อมูลตัวอย่าง: Work Center D100–D300, เครื่อง DEMO-* 12 เครื่อง, ผู้ใช้ DEMO01 (User) และ DEMO02 (ช่าง), งานซ่อม 30 ใบในเดือนที่ผ่านมา ถามรหัสผ่านของผู้ใช้ตัวอย่าง ใส่ซ้ำไม่ได้ |

ทุกคำสั่งใส่ `--conn "Host=...;Port=...;Database=...;Username=...;Password=..."` หรือ `--config <ไฟล์>` เพื่อใช้ฐานข้อมูลอื่นได้

ย้ายมาจากรุ่น PHP: คัดลอกตาราง `users` มาได้เลย รหัสผ่านเดิมใช้ได้ เพราะเป็น bcrypt รูปแบบเดียวกัน

## 5. รัน

| วิธี | ทำอย่างไร |
|---|---|
| Visual Studio | เปิด `AssetCtrl.sln` กด **F5** (หรือ Ctrl+F5 ถ้าไม่ต้อง debug) เปิดที่ http://localhost:8471/ |

ตรวจว่าต่อฐานข้อมูลได้: `AssetCtrl.Setup check` หรือเปิด http://localhost:8471/api.ashx?r=session ต้องได้ `"user"`, `"csrf"`, `"meta"`
ถ้าได้ `db_unavailable` (503) แปลว่ายังต่อไม่ได้ และหน้าเว็บอยู่ในโหมดสาธิต

## 6. ทดสอบ

- Visual Studio: **Test › Run All Tests**
- คำสั่ง: `dotnet test AssetCtrl.Tests` (หลัง build ใน Visual Studio)

unit test ไม่ต้องใช้ฐานข้อมูล ครอบคลุม helper แบบ PHP, รหัสผ่าน bcrypt, การแบ่งหน้า, Excel/CSV และตรวจว่า **ทุก route มี action จริง** (ถ้าเพิ่ม route แล้วลืมเขียน action เทสต์จะแจ้ง)

## 7. เพิ่มไฟล์ใหม่

`AssetCtrl.Web.csproj` ระบุไฟล์ทีละไฟล์ (เหมือนโปรเจกต์อื่น) ไฟล์ที่เพิ่มผ่าน Visual Studio จะถูกเพิ่มให้เอง
ถ้าสร้างไฟล์จากนอก Visual Studio ให้คลิกขวา **Include In Project** ไม่อย่างนั้นไฟล์ `.cs` จะไม่ถูก build

## ค่าใน Web.config

| key | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `AppName` / `OrgName` | Asset Ctrl / IT Section | ชื่อบนหน้าจอ |
| `TimeZone` | `SE Asia Standard Time` | เวลาของระบบ (UTC+7) |
| `Debug` | `false` | `true` = แสดงรายละเอียด error ใน API ห้ามเปิดบน production |
| `SessionIdleMinutes` | `240` | ไม่ใช้งานนานเท่านี้แล้วต้องเข้าระบบใหม่ |
| `RepairArea` | `ICS-SETTING-ROOM` | Area ที่ตั้งให้เครื่องเมื่อรับเข้า Setting Room |
| `RoomOverdueDays` | `3` | อยู่ใน Setting Room เกินกี่วันจึงขึ้น "ต้องดูแล" |
| `DemoFallback` | `true` | ต่อฐานข้อมูลไม่ได้ให้เปิดโหมดสาธิต (`false` = แสดง error) |
| `ImportMaxMb` | `200` | ไฟล์ Import ใหญ่สุด (อัปโหลดทีละ 1 MB) |
| `AssetTypeLabels` | ว่าง | ชื่อประเภทจาก prefix เลขเครื่อง เช่น `PCD=PC Desktop;PCN=Notebook` |

ตอน Publish แบบ Release ไฟล์ `Web.Release.config` จะปิด debug และซ่อนรายละเอียด error ให้

ข้อความภาษาไทยฝั่งเซิร์ฟเวอร์อยู่ใน `App_Data/lang/th.json` (ข้อความอังกฤษ → ไทย) ถ้าเพิ่มหรือแก้ข้อความใน `lang/th.php` ของรุ่น PHP ให้แก้ไฟล์นี้ให้ตรงกันด้วย

## การค้นหางานซ่อม

ช่องค้นหาในหน้างานซ่อมค้นแบบ "มีคำนี้อยู่" ใน เลขงาน, Flowlites, เลขเครื่อง, หัวข้อ, อาการ และผู้ติดต่อ
คำสั่ง `schema` ติดตั้ง `pg_trgm` และสร้าง index ให้ทั้ง 6 ช่อง PostgreSQL จึงค้นจาก index ได้ ไม่ต้องอ่านทั้งตาราง แม้มีงานหลายแสนใบ
(ใช้ได้เมื่อคำค้นยาว 3 ตัวอักษรขึ้นไป สั้นกว่านั้นยังค้นได้แต่อ่านทั้งตาราง)
ถ้าผู้ใช้ฐานข้อมูลไม่มีสิทธิ์ติดตั้ง `pg_trgm` ระบบข้าม index ชุดนี้ไป การค้นหายังใช้ได้ตามปกติ `check` จะแจ้งว่าเปิดอยู่หรือไม่
