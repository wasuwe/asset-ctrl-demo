using System;
using System.Collections.Generic;
using AssetCtrl.Core;

namespace AssetCtrl.Repositories
{
    /// <summary>
    /// Work centers: code + name + active flag. Users are granted Work Centers directly
    /// (user_work_centers); the old department_id column is no longer used.
    /// The master sheet writes "2300-ICS" which is split into code 2300 / name ICS.
    /// </summary>
    public class WorkCenterRepository
    {
        private readonly Database _db;

        /// <summary>code => (id, has name)</summary>
        private readonly Dictionary<string, Tuple<int, bool>> _cache = new Dictionary<string, Tuple<int, bool>>(StringComparer.Ordinal);

        public WorkCenterRepository(Database db)
        {
            _db = db;
        }

        /// <summary>"2300-ICS" -> ["2300", "ICS"]; "2300" -> ["2300", ""].</summary>
        public static string[] Split(string raw)
        {
            raw = Php.CleanCode(raw);
            int pos = raw.IndexOf('-');
            if (pos < 0)
            {
                return new[] { Left(raw, 16), "" };
            }
            return new[] { Left(raw.Substring(0, pos).Trim(), 16), raw.Substring(pos + 1).Trim() };
        }

        /// <summary>substr($s, 0, $n) (codes are ASCII; counted in characters here).</summary>
        private static string Left(string s, int n)
        {
            return s.Length > n ? s.Substring(0, n) : s;
        }

        /// <summary>
        /// Resolve a code to an id, creating the work center when new. A name is
        /// only written when the work center has none yet (admins own names).
        /// </summary>
        public int? IdFor(string code, string name = "")
        {
            code = Php.CleanCode(code);
            name = name ?? "";
            if (code == "")
            {
                return null;
            }
            Tuple<int, bool> cached;
            if (_cache.TryGetValue(code, out cached) && (name == "" || cached.Item2))
            {
                return cached.Item1;
            }
            var row = _db.One("SELECT id, name FROM work_centers WHERE code = :c", new Row { { "c", code } });
            string now = Database.Now();
            int id;
            bool hasName;
            if (row == null)
            {
                id = (int)_db.Insert("work_centers", new Row
                {
                    { "code", code }, { "name", name }, { "is_active", 1 }, { "created_at", now }, { "updated_at", now },
                });
                hasName = name != "";
            }
            else
            {
                id = row.Int("id");
                hasName = row.Str("name") != "";
                if (!hasName && name != "")
                {
                    _db.Update("work_centers", new Row { { "name", name }, { "updated_at", now } }, "id = :id", new Row { { "id", id } });
                    hasName = true;
                }
            }
            _cache[code] = Tuple.Create(id, hasName);
            return id;
        }

        /// <summary>
        /// Filters: q, active ('1' | '0' | '').
        /// Returns { rows, pager }.
        /// </summary>
        public Row Search(Row f, int page, int perPage = 100)
        {
            var p = new Row();
            var w = new List<string> { "1 = 1" };
            if (!f.Empty("q"))
            {
                w.Add("(w.code ILIKE :q1 OR w.name ILIKE :q2)");
                p["q1"] = p["q2"] = "%" + Database.LikeEscape(f.Str("q")) + "%";
            }
            if (f.Get("active") != null && f.Str("active") != "")
            {
                w.Add("w.is_active = :active");
                p["active"] = f.Int("active");
            }
            string where = string.Join(" AND ", w);
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) FROM work_centers w WHERE " + where, p));
            var pager = new Paginator(total, perPage, page);
            var rows = _db.All(
                @"SELECT w.id, w.code, w.name, w.is_active, w.created_at, w.updated_at,
                        (SELECT COUNT(*) FROM assets a WHERE a.work_center_id = w.id) AS asset_count,
                        (SELECT COUNT(*) FROM user_work_centers uw WHERE uw.work_center_id = w.id) AS user_count
                 FROM work_centers w
                 WHERE " + where + " ORDER BY w.code LIMIT " + pager.PerPage + " OFFSET " + pager.Offset(),
                p);
            var shaped = new List<Row>();
            foreach (var r in rows) shaped.Add(Shape(r));
            return new Row { { "rows", shaped }, { "pager", pager } };
        }

        public static Row Shape(Row r)
        {
            var o = new Row
            {
                { "id", r.Int("id") },
                { "code", r.Get("code") },
                { "name", r.Get("name") },
                { "is_active", r.Int("is_active") != 0 },
            };
            foreach (var k in new[] { "asset_count", "user_count" })
            {
                if (!r.IsNull(k))
                {
                    o[k] = r.Int(k);
                }
            }
            return o;
        }

        public Row Find(long id)
        {
            return _db.One(
                @"SELECT w.*, (SELECT COUNT(*) FROM assets a WHERE a.work_center_id = w.id) AS asset_count,
                        (SELECT COUNT(*) FROM user_work_centers uw WHERE uw.work_center_id = w.id) AS user_count
                 FROM work_centers w WHERE w.id = :id",
                new Row { { "id", (int)id } });
        }

        public Row FindByCode(string code)
        {
            return _db.One("SELECT * FROM work_centers WHERE code = :c", new Row { { "c", Php.CleanCode(code) } });
        }

        /// <summary>Every Work Center as [{id, code, name, is_active}] (for pickers and filters).</summary>
        public List<Row> All()
        {
            var o = new List<Row>();
            foreach (var r in _db.All("SELECT id, code, name, is_active FROM work_centers ORDER BY code"))
            {
                o.Add(Shape(r));
            }
            return o;
        }

        /// <summary>code => "code · name" for selects.</summary>
        public Row Options()
        {
            var o = new Row();
            foreach (var r in _db.All("SELECT code, name FROM work_centers ORDER BY code"))
            {
                o[r.Str("code")] = r.Str("code") + (r.Str("name") != "" ? " · " + r.Str("name") : "");
            }
            return o;
        }

        /// <summary>Change the name and active flag (the code never changes).</summary>
        public void Update(long id, string name, bool? isActive = null)
        {
            var data = new Row { { "name", name }, { "updated_at", Database.Now() } };
            if (isActive.HasValue)
            {
                data["is_active"] = isActive.Value ? 1 : 0;
            }
            _db.Update("work_centers", data, "id = :id", new Row { { "id", (int)id } });
        }
    }
}
