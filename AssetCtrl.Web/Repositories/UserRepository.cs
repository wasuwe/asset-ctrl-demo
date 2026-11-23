using System;
using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Models;

namespace AssetCtrl.Repositories
{
    /// <summary>
    /// Users and their Work Center grants (user_work_centers).
    /// A user sees the assets/tickets of the Work Centers granted to them; admins see everything.
    /// (The old departments / user_departments / users.department_id data is left untouched.)
    /// </summary>
    public class UserRepository
    {
        private readonly Database _db;

        public UserRepository(Database db)
        {
            _db = db;
        }

        /// <summary>
        /// Filters: q, role, wc (work center id), active ('1' | '0' | '').
        /// Returns { rows, pager: Paginator }.
        /// </summary>
        public Row Search(Row f, int page, int perPage = 50)
        {
            var p = new Row();
            var w = new List<string> { "1 = 1" };
            if (!f.Empty("q"))
            {
                w.Add(@"(u.emp_code ILIKE :q1 OR u.first_name ILIKE :q2 OR u.last_name ILIKE :q3 OR u.email ILIKE :q4
                     OR EXISTS (SELECT 1 FROM user_work_centers qx JOIN work_centers qw ON qw.id = qx.work_center_id
                                WHERE qx.user_id = u.id AND (qw.code ILIKE :q5 OR qw.name ILIKE :q6)))");
                string like = "%" + Database.LikeEscape(f.Str("q")) + "%";
                foreach (var k in new[] { "q1", "q2", "q3", "q4", "q5", "q6" })
                {
                    p[k] = like;
                }
            }
            if (!f.Empty("role"))
            {
                w.Add("u.role = :role");
                p["role"] = f.Str("role");
            }
            if (!f.Empty("wc"))
            {
                w.Add("EXISTS (SELECT 1 FROM user_work_centers x WHERE x.user_id = u.id AND x.work_center_id = :wc)");
                p["wc"] = f.Int("wc");
            }
            if (!f.IsNull("active") && f.Str("active") != "")
            {
                w.Add("u.is_active = :active");
                p["active"] = f.Int("active");
            }
            string where = string.Join(" AND ", w);
            string from = "FROM users u WHERE " + where;
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) " + from, p));
            var pager = new Paginator(total, perPage, page);
            // MySQL FIELD(u.role, 'admin', 'user') -> CASE (0 when not listed, like FIELD).
            var rows = _db.All(
                @"SELECT u.id, u.emp_code, u.first_name, u.last_name, u.email, u.phone, u.role, u.can_repair, u.is_active,
                    u.must_change_password, u.locked_until, u.last_login_at, u.created_at
             " + from + @"
             ORDER BY u.is_active DESC, CASE u.role WHEN 'admin' THEN 1 WHEN 'user' THEN 2 ELSE 0 END, u.emp_code
             LIMIT " + pager.PerPage + " OFFSET " + pager.Offset(),
                p);
            var grants = WorkCentersFor(rows.Select(r => r.Int("id")).ToList());
            var shaped = new List<Row>();
            foreach (var r in rows)
            {
                var s = Shape(r);
                List<Row> wcs;
                s["work_centers"] = grants.TryGetValue(r.Int("id"), out wcs) ? wcs : new List<Row>();
                shaped.Add(s);
            }
            return new Row { { "rows", shaped }, { "pager", pager } };
        }

        /// <summary>Public shape of a user row (no password hash).</summary>
        public static Row Shape(Row u)
        {
            bool locked = false;
            if (!u.Empty("locked_until"))
            {
                DateTime until;
                locked = DateTime.TryParse(u.Str("locked_until"), Php.Inv, System.Globalization.DateTimeStyles.None, out until)
                    && until > Database.NowDate();
            }
            return new Row
            {
                { "id", u.Int("id") },
                { "emp_code", u.Get("emp_code") },
                { "first_name", u.Get("first_name") },
                { "last_name", u.Get("last_name") },
                { "name", (u.Str("first_name") + " " + u.Str("last_name")).Trim() },
                { "email", u.Str("email") },
                { "phone", u.Str("phone") },
                { "role", u.Get("role") },
                { "can_repair", u.Int("can_repair") != 0 },
                { "is_active", u.Int("is_active") != 0 },
                { "must_change_password", u.Int("must_change_password") != 0 },
                { "locked", locked },
                { "last_login_at", u.Get("last_login_at") },
                { "created_at", u.Get("created_at") },
            };
        }

        /// <summary>user id => [{id, code, name}]</summary>
        private Dictionary<int, List<Row>> WorkCentersFor(List<int> userIds)
        {
            var o = new Dictionary<int, List<Row>>();
            if (userIds.Count == 0)
            {
                return o;
            }
            var p = new Row();
            string inSql = Database.InClause("uw.user_id", userIds, p, "u");
            foreach (var r in _db.All(
                @"SELECT uw.user_id, w.id, w.code, w.name FROM user_work_centers uw JOIN work_centers w ON w.id = uw.work_center_id
             WHERE " + inSql + " ORDER BY w.code",
                p))
            {
                int uid = r.Int("user_id");
                if (!o.ContainsKey(uid)) o[uid] = new List<Row>();
                o[uid].Add(new Row { { "id", r.Int("id") }, { "code", r.Get("code") }, { "name", r.Get("name") } });
            }
            return o;
        }

        public Row Find(long id)
        {
            return _db.One("SELECT * FROM users WHERE id = :id", new Row { { "id", (int)id } });
        }

        public Row FindByEmpCode(string code)
        {
            return _db.One("SELECT * FROM users WHERE emp_code = :c", new Row { { "c", code } });
        }

        /// <summary>Work Center ids granted directly to a user.</summary>
        public List<int> WorkCenters(long userId)
        {
            return _db.Column("SELECT work_center_id FROM user_work_centers WHERE user_id = :id", new Row { { "id", (int)userId } })
                .Select(Php.ToInt).ToList();
        }

        /// <summary>Replace a user's Work Center grants.</summary>
        public void SetWorkCenters(long userId, IEnumerable<int> wcIds)
        {
            _db.Execute("DELETE FROM user_work_centers WHERE user_id = :id", new Row { { "id", (int)userId } });
            var rows = new List<Row>();
            foreach (int w in wcIds.Distinct())
            {
                if (w != 0)
                {
                    rows.Add(new Row { { "user_id", (int)userId }, { "work_center_id", w } });
                }
            }
            _db.InsertMany("user_work_centers", rows);
        }

        /// <summary>Admins who take repair jobs, with their open workload.</summary>
        public List<Row> Technicians()
        {
            return _db.All(
                @"SELECT u.id, u.emp_code, u.first_name, u.last_name, u.role,
                    (SELECT COUNT(*) FROM repair_tickets t WHERE t.assignee_id = u.id
                        AND t.status IN ('new','assigned','in_progress','waiting_parts')) AS open_count
             FROM users u
             WHERE u.is_active = 1 AND u.role = :r AND u.can_repair = 1
             ORDER BY u.first_name",
                new Row { { "r", Role.Admin } });
        }

        public int CountActiveAdmins(long exceptId = 0)
        {
            return Php.ToInt(_db.Value(
                "SELECT COUNT(*) FROM users WHERE role = :r AND is_active = 1 AND id <> :id",
                new Row { { "r", Role.Admin }, { "id", (int)exceptId } }));
        }
    }
}
