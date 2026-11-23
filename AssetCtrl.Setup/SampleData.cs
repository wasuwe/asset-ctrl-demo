using System;
using System.Collections.Generic;
using System.Globalization;
using AssetCtrl.Core;

namespace AssetCtrl.Setup
{
    /// <summary>
    /// Sample data for trying the system on an empty database. Everything is made up:
    /// Work Centers D100-D300 (DEMO-A..C), DEMO-* assets, users DEMO01 / DEMO02, repair tickets of the last 30 days.
    /// No real plant data. The tickets are not in the Setting Room, so the repair queue starts empty.
    /// </summary>
    public static class SampleData
    {
        public static string Load(Database db, string password)
        {
            return db.Transaction(() =>
            {
                string now = Database.Now();
                var wc = new Dictionary<string, int>();
                foreach (var w in new[] { new[] { "D100", "DEMO-A" }, new[] { "D200", "DEMO-B" }, new[] { "D300", "DEMO-C" } })
                {
                    object id = db.Value("SELECT id FROM work_centers WHERE code = :c", new Row { { "c", w[0] } });
                    wc[w[0]] = id != null ? Php.ToInt(id) : (int)db.Insert("work_centers", new Row
                    {
                        { "code", w[0] }, { "name", w[1] }, { "is_active", 1 }, { "created_at", now }, { "updated_at", now },
                    });
                }

                var masters = new[]
                {
                    new[] { "pc_type", "DESKTOP", "Desktop" }, new[] { "pc_type", "NOTEBOOK", "Notebook" },
                    new[] { "location", "BLDG-A", "Building A" }, new[] { "location", "BLDG-B", "Building B" }, new[] { "location", "BLDG-C", "Building C" },
                    new[] { "building", "A-1F", "A 1st floor" }, new[] { "building", "A-2F", "A 2nd floor" },
                    new[] { "building", "B-1F", "B 1st floor" }, new[] { "building", "B-2F", "B 2nd floor" }, new[] { "building", "C-1F", "C 1st floor" },
                };
                foreach (var m in masters)
                {
                    db.Execute(@"INSERT INTO asset_masters (kind, code, name, is_active, created_at, updated_at)
                                 VALUES (:k, :c, :n, 1, :t1, :t2) ON CONFLICT (kind, code) DO NOTHING",
                        new Row { { "k", m[0] }, { "c", m[1] }, { "n", m[2] }, { "t1", now }, { "t2", now } });
                }

                string hash = Passwords.Hash(password);
                int user = EnsureUser(db, "DEMO01", "สมชาย", "ใจดี", "user", 0, hash, now);
                int tech = EnsureUser(db, "DEMO02", "ช่าง", "ตัวอย่าง", "admin", 1, hash, now);
                foreach (var code in new[] { "D100", "D200" })
                {
                    db.Execute("INSERT INTO user_work_centers (user_id, work_center_id) VALUES (:u, :w) ON CONFLICT DO NOTHING",
                        new Row { { "u", user }, { "w", wc[code] } });
                }

                // asset no, type, description, Work Center, area, status, Type PC, location, building
                var assets = new[]
                {
                    new[] { "DEMO-PC-001", "PC", "Desktop PC", "D100", "LINE-A3", "USE", "DESKTOP", "BLDG-A", "A-1F" },
                    new[] { "DEMO-PC-002", "PC", "Desktop PC", "D100", "LINE-A4", "USE", "DESKTOP", "BLDG-A", "A-1F" },
                    new[] { "DEMO-PC-003", "PC", "Desktop PC", "D100", "LINE-A3", "USE", "DESKTOP", "BLDG-A", "A-1F" },
                    new[] { "DEMO-PC-004", "PC", "Desktop PC", "D300", "LINE-C1", "USE", "DESKTOP", "BLDG-C", "C-1F" },
                    new[] { "DEMO-NB-001", "NB", "Notebook", "D100", "OFFICE-2F", "USE", "NOTEBOOK", "BLDG-A", "A-2F" },
                    new[] { "DEMO-NB-002", "NB", "Notebook", "D200", "OFFICE-2F", "STOCK", "NOTEBOOK", "BLDG-B", "B-2F" },
                    new[] { "DEMO-MN-001", "MN", "Monitor 24\"", "D200", "QC-ROOM", "SPARE", "", "BLDG-B", "B-1F" },
                    new[] { "DEMO-PR-001", "PR", "Printer", "D200", "QC-ROOM", "USE", "", "BLDG-B", "B-1F" },
                    new[] { "DEMO-PC-005", "PC", "Desktop PC", "D200", "LINE-B2", "USE", "DESKTOP", "BLDG-B", "B-1F" },
                    new[] { "DEMO-PC-006", "PC", "Desktop PC", "D300", "LINE-C2", "USE", "DESKTOP", "BLDG-C", "C-1F" },
                    new[] { "DEMO-NB-003", "NB", "Notebook", "D300", "OFFICE-1F", "USE", "NOTEBOOK", "BLDG-C", "C-1F" },
                    new[] { "DEMO-MN-002", "MN", "Monitor 22\"", "D100", "LINE-A3", "USE", "", "BLDG-A", "A-1F" },
                };
                var assetIds = new List<KeyValuePair<string[], int>>();
                int n = 0;
                foreach (var a in assets)
                {
                    n++;
                    bool pc = a[1] == "PC" || a[1] == "NB";
                    int id = (int)db.Insert("assets", new Row
                    {
                        { "asset_no", a[0] }, { "asset_type", a[1] }, { "fix_no", "DEMO-FA-" + n.ToString("0000", CultureInfo.InvariantCulture) },
                        { "description", a[2] }, { "os_name", pc ? "Windows 11 Pro" : "" }, { "os_version", pc ? "23H2" : "" },
                        { "work_center_id", wc[a[3]] }, { "pc_type", a[6] }, { "location", a[7] }, { "building", a[8] },
                        { "area", a[4] }, { "status", a[5] }, { "created_at", now }, { "updated_at", now },
                    });
                    assetIds.Add(new KeyValuePair<string[], int>(a, id));
                }

                var problems = new[]
                {
                    new[] { "เปิดเครื่องไม่ติด", "กดปุ่มเปิดแล้วไม่มีไฟ" }, new[] { "เครื่องช้ามาก", "เปิดโปรแกรมช้า ค้างบ่อย" },
                    new[] { "เข้าระบบไม่ได้", "ใส่รหัสผ่านแล้วขึ้น error" }, new[] { "พิมพ์ไม่ออก", "สั่งพิมพ์แล้วงานค้างในคิว" },
                    new[] { "จอดับเป็นช่วง ๆ", "จอดับเองแล้วกลับมาติด" }, new[] { "ต่อเน็ตไม่ได้", "ไอคอนเครือข่ายขึ้นเครื่องหมายตกใจ" },
                };
                // created (hours ago), status — a few today, the rest over the last 30 days
                var plan = new List<KeyValuePair<double, string>>();
                string[] recent = { "new", "new", "assigned", "in_progress", "resolved" };
                string[] older = { "closed", "closed", "resolved", "closed", "in_progress", "cancelled" };
                for (int i = 0; i < 30; i++)
                {
                    double h = i < 5 ? 0.5 + i : 8 + (i - 5) * 28;
                    plan.Add(new KeyValuePair<double, string>(h, i < 5 ? recent[i] : older[i % older.Length]));
                }
                var nowDate = Database.NowDate();
                Func<double, string> ago = hours => nowDate.AddHours(-hours).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                int tickets = 0;
                foreach (var p in plan)
                {
                    var a = assetIds[tickets % assetIds.Count];
                    var pr = problems[tickets % problems.Length];
                    string status = p.Value;
                    double h = p.Key;
                    bool assigned = status != "new" && status != "cancelled";
                    bool resolved = status == "resolved" || status == "closed";
                    var t = new Row
                    {
                        { "flolites_no", "DEMO-" + (3001 + tickets).ToString(CultureInfo.InvariantCulture) },
                        { "asset_id", a.Value }, { "asset_no", a.Key[0] }, { "work_center_id", wc[a.Key[3]] },
                        { "reporter_id", user }, { "contact_name", "สมชาย ใจดี" }, { "contact_phone", "02-000-1234" },
                        { "location_note", a.Key[4] }, { "title", pr[0] }, { "symptom", pr[1] },
                        { "priority", tickets % 7 == 0 ? "urgent" : "normal" }, { "status", status },
                        { "assignee_id", assigned ? (object)tech : null },
                        { "resolution", resolved ? "แก้ไขแล้ว ทดสอบใช้งานได้" : null },
                        { "created_at", ago(h) }, { "updated_at", ago(h * 0.4) },
                        { "assigned_at", assigned ? ago(h * 0.9) : null },
                        { "started_at", assigned && status != "assigned" ? ago(h * 0.8) : null },
                        { "resolved_at", resolved ? ago(h * 0.5) : null },
                        { "closed_at", status == "closed" || status == "cancelled" ? ago(h * 0.4) : null },
                    };
                    int id = (int)db.Insert("repair_tickets", t);
                    var created = DateTime.ParseExact(ago(h), "yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                    db.Update("repair_tickets", new Row { { "ticket_no", "RP" + created.ToString("yyMM", CultureInfo.InvariantCulture) + "-" + id.ToString("0000", CultureInfo.InvariantCulture) } },
                        "id = :id", new Row { { "id", id } });
                    Event(db, id, user, "created", null, "new", null, ago(h));
                    if (assigned) Event(db, id, tech, "assigned", null, "ช่าง ตัวอย่าง", null, ago(h * 0.9));
                    if (resolved) Event(db, id, tech, "status", "in_progress", "resolved", "แก้ไขแล้ว ทดสอบใช้งานได้", ago(h * 0.5));
                    if (status == "closed") Event(db, id, tech, "status", "resolved", "closed", null, ago(h * 0.4));
                    if (status == "cancelled") Event(db, id, tech, "status", "new", "cancelled", "แจ้งซ้ำ", ago(h * 0.4));
                    tickets++;
                }
                return "3 Work Centers, " + masters.Length + " master values, 2 users (DEMO01 user of D100+D200, DEMO02 technician), "
                    + assets.Length + " assets, " + tickets + " repair tickets.";
            });
        }

        private static int EnsureUser(Database db, string code, string first, string last, string role, int canRepair, string hash, string now)
        {
            object id = db.Value("SELECT id FROM users WHERE emp_code = :c", new Row { { "c", code } });
            if (id != null) return Php.ToInt(id);
            return (int)db.Insert("users", new Row
            {
                { "emp_code", code }, { "first_name", first }, { "last_name", last }, { "role", role }, { "can_repair", canRepair },
                { "password_hash", hash }, { "must_change_password", 0 }, { "is_active", 1 }, { "created_at", now }, { "updated_at", now },
            });
        }

        private static void Event(Database db, int ticketId, int userId, string type, string from, string to, string note, string at)
        {
            db.Insert("repair_events", new Row
            {
                { "ticket_id", ticketId }, { "user_id", userId }, { "event_type", type },
                { "from_value", from }, { "to_value", to }, { "note", note }, { "created_at", at },
            });
        }
    }
}
