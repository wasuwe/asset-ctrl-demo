using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;

namespace AssetCtrl.Repositories
{
    /// <summary>Field-level asset change log.</summary>
    public class HistoryRepository
    {
        private readonly Database _db;

        public HistoryRepository(Database db)
        {
            _db = db;
        }

        /// <summary>Record one change per field in changes = {field: [old, new]}.</summary>
        public void Record(long assetId, IDictionary<string, string[]> changes, string source, int? userId = null, long? refId = null, string note = null)
        {
            if (changes == null || changes.Count == 0) return;
            string now = Database.Now();
            var rows = new List<Row>();
            foreach (var kv in changes)
            {
                rows.Add(new Row
                {
                    { "asset_id", (int)assetId },
                    { "field", kv.Key },
                    { "old_value", kv.Value[0] },
                    { "new_value", kv.Value[1] },
                    { "source", source },
                    { "ref_id", refId.HasValue ? (object)(int)refId.Value : null },
                    { "note", note },
                    { "changed_by", userId.HasValue ? (object)userId.Value : null },
                    { "changed_at", now },
                });
            }
            _db.InsertMany("asset_history", rows);
        }

        /// <summary>Insert many prepared history rows at once (import).</summary>
        public void InsertRows(IList<Row> rows)
        {
            for (int i = 0; i < rows.Count; i += 300)
            {
                _db.InsertMany("asset_history", rows.Skip(i).Take(300).ToList());
            }
        }

        public List<Row> ForAsset(long assetId, string field = "")
        {
            var p = new Row { { "id", (int)assetId } };
            string where = "h.asset_id = :id";
            if (!string.IsNullOrEmpty(field))
            {
                where += " AND h.field = :f";
                p["f"] = field;
            }
            return _db.All(
                @"SELECT h.*, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS user_name,
                         t.ticket_no
                  FROM asset_history h
                  LEFT JOIN users u ON u.id = h.changed_by
                  LEFT JOIN repair_tickets t ON h.source = 'repair' AND t.id = h.ref_id
                  WHERE " + where + @"
                  ORDER BY h.changed_at DESC, h.id DESC
                  LIMIT 500",
                p);
        }

        /// <summary>Count of changes per field for one asset (for tab badges).</summary>
        public Row FieldCounts(long assetId)
        {
            return _db.Pairs("SELECT field, COUNT(*) FROM asset_history WHERE asset_id = :id GROUP BY field", new Row { { "id", (int)assetId } });
        }

        /// <summary>Global change log with filters: field, source, q (asset no), from, to (yyyy-mm-dd).</summary>
        public Row Search(Row f, Auth auth, int page, int perPage = 50)
        {
            var p = new Row();
            var w = new List<string> { "1 = 1" };
            if (!f.Empty("field"))
            {
                w.Add("h.field = :field");
                p["field"] = f.Str("field");
            }
            if (!f.Empty("source"))
            {
                w.Add("h.source = :source");
                p["source"] = f.Str("source");
            }
            if (!f.Empty("q"))
            {
                w.Add("(a.asset_no ILIKE :q OR h.old_value ILIKE :q OR h.new_value ILIKE :q)");
                p["q"] = "%" + Database.LikeEscape(f.Str("q")) + "%";
            }
            if (!f.Empty("from"))
            {
                w.Add("h.changed_at >= :from");
                p["from"] = f.Str("from") + " 00:00:00";
            }
            if (!f.Empty("to"))
            {
                w.Add("h.changed_at <= :to");
                p["to"] = f.Str("to") + " 23:59:59";
            }
            if (!auth.SeesAll())
            {
                w.Add(auth.ScopeSql(p));
            }
            string where = string.Join(" AND ", w);
            string from = @"FROM asset_history h
                 JOIN assets a ON a.id = h.asset_id
                 LEFT JOIN work_centers wc ON wc.id = a.work_center_id
                 LEFT JOIN users u ON u.id = h.changed_by
                 WHERE " + where;
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) " + from, p));
            var pager = new Paginator(total, perPage, page);
            var rows = _db.All(
                @"SELECT h.*, a.asset_no, a.description, wc.code AS work_center, wc.name AS work_center_name,
                         TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS user_name
                  " + from + " ORDER BY h.changed_at DESC, h.id DESC LIMIT " + pager.PerPage + " OFFSET " + pager.Offset(),
                p);
            return new Row { { "rows", rows }, { "pager", pager } };
        }

        public List<Row> Recent(Auth auth, int limit = 12)
        {
            return (List<Row>)Search(new Row { { "source", "" } }, auth, 1, limit)["rows"];
        }

        public static Row SourceLabels()
        {
            return new Row
            {
                { "edit", "Web edit" },
                { "bulk", "Bulk edit" },
                { "import", "File import" },
                { "repair", "Repair" },
                { "audit", "Audit" },
                { "migration", "Legacy migration" },
            };
        }

        public static string SourceLabel(string s)
        {
            var l = SourceLabels();
            return l.ContainsKey(s ?? "") ? l.Str(s) : s;
        }
    }
}
