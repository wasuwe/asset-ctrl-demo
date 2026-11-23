using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using AssetCtrl.Core;
using AssetCtrl.Services;

namespace AssetCtrl.Repositories
{
    public class AssetRepository
    {
        private readonly Database _db;

        public AssetRepository(Database db)
        {
            _db = db;
        }

        /// <summary>
        /// Columns every asset row carries (Work Center resolved). "department" is the
        /// master-sheet "2300-ICS" Work Center text used by the re-importable export.
        /// </summary>
        private static string Columns()
        {
            return @"a.*, wc.code AS work_center, wc.name AS work_center_name,
                CASE WHEN wc.code IS NULL THEN '' WHEN wc.name = '' THEN wc.code ELSE CONCAT(wc.code, '-', wc.name) END AS department,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS updated_by_name";
        }

        private static string BaseSelect()
        {
            return "SELECT " + Columns() + " FROM " + AssetFilter.From() + " LEFT JOIN users u ON u.id = a.updated_by";
        }

        /// <summary>Returns { rows: List&lt;Row&gt;, pager: Paginator }.</summary>
        public Row Search(AssetFilter filter, Auth auth, int page, int perPage)
        {
            var p = new Row();
            string where = filter.Where(p, auth);
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) FROM " + AssetFilter.From() + " WHERE " + where, p));
            var pager = new Paginator(total, perPage, page);
            string sql = "SELECT " + Columns() + @",
                    (SELECT COUNT(*) FROM repair_tickets t WHERE t.asset_id = a.id
                        AND t.status IN ('new','assigned','in_progress','waiting_parts')) AS open_tickets,
                    (SELECT t.ticket_no FROM repair_tickets t WHERE t.asset_id = a.id
                        AND t.status IN ('new','assigned','in_progress','waiting_parts','resolved')
                        ORDER BY t.created_at DESC LIMIT 1) AS open_ticket_no
                FROM " + AssetFilter.From() + @" LEFT JOIN users u ON u.id = a.updated_by
                WHERE " + where + " ORDER BY " + filter.OrderBy()
                + " LIMIT " + pager.PerPage + " OFFSET " + pager.Offset();
            return new Row { { "rows", _db.All(sql, p) }, { "pager", pager } };
        }

        /// <summary>
        /// Every matching row in list order (export). PHP returned a PDO statement to stream;
        /// here the rows are read into memory.
        /// </summary>
        public List<Row> Cursor(AssetFilter filter, Auth auth)
        {
            var p = new Row();
            string where = filter.Where(p, auth);
            return _db.All(BaseSelect() + " WHERE " + where + " ORDER BY " + filter.OrderBy(), p);
        }

        public List<int> IdsMatching(AssetFilter filter, Auth auth, int limit = 5000)
        {
            var p = new Row();
            string where = filter.Where(p, auth);
            return _db.Column("SELECT a.id FROM " + AssetFilter.From() + " WHERE " + where + " LIMIT " + limit, p)
                .Select(Php.ToInt).ToList();
        }

        public int CountMatching(AssetFilter filter, Auth auth)
        {
            var p = new Row();
            string where = filter.Where(p, auth);
            return Php.ToInt(_db.Value("SELECT COUNT(*) FROM " + AssetFilter.From() + " WHERE " + where, p));
        }

        /// <summary>
        /// Monthly check counts for the list header, over the same filter but ignoring its own "checked" choice.
        /// Returns { done: int, total: int }.
        /// </summary>
        public Row CheckSummary(AssetFilter filter, Auth auth, string monthStart)
        {
            var f = filter.Clone();
            f.Checked = "";
            var p = new Row();
            string where = f.Where(p, auth);
            p["cm_start"] = monthStart;
            var row = _db.One(
                "SELECT COUNT(*) AS total, SUM(CASE WHEN a.user_checked_at >= :cm_start THEN 1 ELSE 0 END) AS done FROM "
                + AssetFilter.From() + " WHERE " + where,
                p);
            return new Row { { "done", row != null ? row.Int("done") : 0 }, { "total", row != null ? row.Int("total") : 0 } };
        }

        public Row Find(long id)
        {
            return _db.One(BaseSelect() + " WHERE a.id = :id", new Row { { "id", (int)id } });
        }

        public Row FindByNo(string assetNo)
        {
            return _db.One(BaseSelect() + " WHERE a.asset_no = :no", new Row { { "no", Php.CleanCode(assetNo) } });
        }

        public List<Row> FindMany(IEnumerable<int> ids)
        {
            var list = ids == null ? new List<int>() : ids.ToList();
            if (list.Count == 0)
            {
                return new List<Row>();
            }
            var p = new Row();
            string inSql = Database.InClause("a.id", list, p);
            return _db.All(BaseSelect() + " WHERE " + inSql + " ORDER BY a.asset_no", p);
        }

        public List<Row> Suggest(string term, Auth auth, int limit = 10)
        {
            var p = new Row { { "t", Database.LikeEscape(Php.CleanCode(term)) + "%" } };
            string where = "a.asset_no ILIKE :t";
            if (!auth.SeesAll())
            {
                where += " AND " + auth.ScopeSql(p, "a.work_center_id");
            }
            return _db.All(
                @"SELECT a.id, a.asset_no, a.description, a.area, a.status, wc.code AS work_center, wc.name AS work_center_name
                 FROM " + AssetFilter.From() + " WHERE " + where + " ORDER BY a.asset_no LIMIT " + limit,
                p);
        }

        /// <summary>
        /// Values for filter dropdowns (within the user's scope).
        /// work_centers: [{id, code, name}] — every Work Center for admins, the granted ones for users.
        /// </summary>
        /// <summary>Filter lists (Work Centers, locations …) within the user's scope; auth null = every Work Center (public list).</summary>
        public Row FilterOptions(Auth auth)
        {
            var p = new Row();
            string scope = "1 = 1";
            string wcWhere = "1 = 1";
            var wcParams = new Row();
            if (auth != null && !auth.SeesAll())
            {
                scope = auth.ScopeSql(p, "a.work_center_id");
                wcWhere = auth.ScopeSql(wcParams, "w.id");
            }
            string from = "FROM assets a WHERE " + scope;
            var wcs = new List<Row>();
            foreach (var r in _db.All("SELECT w.id, w.code, w.name FROM work_centers w WHERE " + wcWhere + " ORDER BY w.code", wcParams))
            {
                wcs.Add(new Row { { "id", r.Int("id") }, { "code", r.Get("code") }, { "name", r.Get("name") } });
            }
            return new Row
            {
                { "work_centers", wcs },
                { "locations", _db.Column("SELECT DISTINCT a.location " + from + " AND a.location <> '' ORDER BY a.location", p) },
                { "buildings", _db.Column("SELECT DISTINCT a.building " + from + " AND a.building <> '' ORDER BY a.building", p) },
                { "types", _db.Column("SELECT DISTINCT a.asset_type " + from + " AND a.asset_type <> '' ORDER BY a.asset_type", p) },
                { "pc_types", _db.Column("SELECT DISTINCT a.pc_type " + from + " AND a.pc_type <> '' ORDER BY a.pc_type", p) },
                { "os", _db.Column("SELECT DISTINCT a.os_name " + from + " AND a.os_name <> '' ORDER BY a.os_name", p) },
            };
        }

        /// <summary>Asset rows keyed by asset_no (import diffing).</summary>
        public Dictionary<string, Row> AllKeyedByNo()
        {
            var rows = _db.All("SELECT a.*, wc.code AS work_center FROM assets a LEFT JOIN work_centers wc ON wc.id = a.work_center_id");
            var o = new Dictionary<string, Row>(StringComparer.Ordinal);
            foreach (var r in rows)
            {
                r["work_center"] = r.Str("work_center");
                o[r.Str("asset_no")] = r;
            }
            return o;
        }

        private static readonly Regex TypeRe = new Regex("^[A-Z]+");

        public static string TypeOf(string assetNo)
        {
            var m = TypeRe.Match((assetNo ?? "").ToUpperInvariant());
            return m.Success ? (m.Value.Length > 8 ? m.Value.Substring(0, 8) : m.Value) : "";
        }
    }
}
