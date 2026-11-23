using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Services;

namespace AssetCtrl.Repositories
{
    /// <summary>
    /// Aggregate numbers for the dashboards. Pass scopes = null for "everything"
    /// (public dashboard / IT), or an Auth to limit to that user's Work Centers.
    /// </summary>
    public class StatsRepository
    {
        private readonly Database _db;

        public StatsRepository(Database db)
        {
            _db = db;
        }

        /// <summary>scopes: null = everything, an Auth = what that user may see.</summary>
        private string ScopeWhere(Auth scopes, Row p)
        {
            if (scopes == null || scopes.SeesAll())
            {
                return "1 = 1";
            }
            return scopes.ScopeSql(p);
        }

        private string From()
        {
            return "FROM " + AssetFilter.From();
        }

        /// <summary>status => count (values are strings, like PDO).</summary>
        public Row ByStatus(Auth scopes = null)
        {
            var p = new Row();
            string w = ScopeWhere(scopes, p);
            return _db.Pairs(
                "SELECT a.status, COUNT(*) " + From() + @"
                 WHERE " + w + " GROUP BY a.status",
                p);
        }

        /// <summary>[type => [status => count, '_total' => n]] sorted by total desc.</summary>
        public Row TypeStatusMatrix(Auth scopes = null)
        {
            var p = new Row();
            string w = ScopeWhere(scopes, p);
            var rows = _db.All(
                "SELECT a.asset_type, a.status, COUNT(*) AS n " + From() + @"
                 WHERE " + w + " GROUP BY a.asset_type, a.status",
                p);
            var m = new Row();
            foreach (var r in rows)
            {
                // PHP: $r['asset_type'] !== '' ? $r['asset_type'] : '—' (a NULL type became the key "")
                string t = r.IsNull("asset_type") ? "" : (r.Str("asset_type") != "" ? r.Str("asset_type") : "—");
                if (!m.ContainsKey(t))
                {
                    m[t] = new Row { { "_total", 0 } };
                }
                var cell = (Row)m[t];
                cell[r.Str("status")] = r.Int("n");
                cell["_total"] = cell.Int("_total") + r.Int("n");
            }
            var sorted = new Row();
            foreach (var kv in m.OrderByDescending(kv => ((Row)kv.Value).Int("_total")))
            {
                sorted[kv.Key] = kv.Value;
            }
            return sorted;
        }

        public List<Row> ByLocation(Auth scopes = null)
        {
            var p = new Row();
            string w = ScopeWhere(scopes, p);
            return _db.All(
                @"SELECT a.location, COUNT(*) AS total, SUM(CASE WHEN a.status = 'USE' THEN 1 ELSE 0 END) AS in_use
                 " + From() + @"
                 WHERE " + w + " GROUP BY a.location ORDER BY total DESC",
                p);
        }

        /// <summary>Largest Work Centers with in-use / broken counts.</summary>
        public List<Row> TopWorkCenters(Auth scopes = null, int limit = 8)
        {
            var p = new Row();
            string w = ScopeWhere(scopes, p);
            return _db.All(
                @"SELECT wc.id AS wc_id, wc.code AS wc_code, wc.name AS wc_name, COUNT(*) AS total,
                        SUM(CASE WHEN a.status = 'USE' THEN 1 ELSE 0 END) AS in_use,
                        SUM(CASE WHEN a.status IN ('FAIL','REPAIR') THEN 1 ELSE 0 END) AS broken
                 " + From() + @"
                 WHERE " + w + " GROUP BY wc.id, wc.code, wc.name ORDER BY total DESC LIMIT " + limit,
                p);
        }

        public int ChangesLast30Days(Auth scopes = null)
        {
            var p = new Row();
            string w = ScopeWhere(scopes, p);
            p["since"] = Database.NowDate().AddDays(-30);
            return Php.ToInt(_db.Value(
                @"SELECT COUNT(DISTINCT h.asset_id) FROM asset_history h
                 JOIN assets a ON a.id = h.asset_id LEFT JOIN work_centers wc ON wc.id = a.work_center_id
                 WHERE h.changed_at >= :since AND " + w,
                p));
        }
    }
}
