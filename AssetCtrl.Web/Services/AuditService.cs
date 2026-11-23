using System.Collections.Generic;
using AssetCtrl.Core;

namespace AssetCtrl.Services
{
    /// <summary>
    /// Physical stock-count rounds. Assets in scope = every asset not disposed/lost
    /// (optionally limited to one location). Scanning an asset records a check;
    /// if the area found differs, the asset's area is updated with history.
    /// </summary>
    public class AuditService
    {
        private readonly Database _db;

        public AuditService(Database db)
        {
            _db = db;
        }

        private string ScopeWhere(Row round, Row p)
        {
            string w = "a.status NOT IN ('DISPOSE','LOST')";
            if (round.Str("location") != "")
            {
                w += " AND a.location = :loc";
                p["loc"] = round.Str("location");
            }
            return w;
        }

        public List<Row> Rounds()
        {
            var rounds = _db.All(
                @"SELECT r.*, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS started_by_name,
                        (SELECT COUNT(*) FROM audit_checks c WHERE c.round_id = r.id) AS checked
                 FROM audit_rounds r LEFT JOIN users u ON u.id = r.started_by ORDER BY r.id DESC");
            foreach (var r in rounds)
            {
                r["total"] = ScopeCount(r);
            }
            return rounds;
        }

        public Row Round(long id)
        {
            return _db.One("SELECT * FROM audit_rounds WHERE id = :id", new Row { { "id", (int)id } });
        }

        public int ScopeCount(Row round)
        {
            var p = new Row();
            string w = ScopeWhere(round, p);
            return Php.ToInt(_db.Value("SELECT COUNT(*) FROM assets a WHERE " + w, p));
        }

        public long Start(string name, string location, int? userId)
        {
            name = Php.CleanText(name);
            if (name == "")
            {
                throw new ValidationException(new[] { "Please give the audit round a name." });
            }
            return _db.Insert("audit_rounds", new Row
            {
                { "name", name },
                { "location", Php.CleanCode(location) },
                { "started_by", userId },
                { "started_at", Database.Now() },
            });
        }

        public void Close(long id)
        {
            _db.Update("audit_rounds", new Row { { "closed_at", Database.Now() } }, "id = :id AND closed_at IS NULL", new Row { { "id", (int)id } });
        }

        /// <summary>
        /// Delete one check result (e.g. a wrong scan). Only while the round is open; the asset goes
        /// back to "not checked". Area changes the check already made to the asset are not undone
        /// (they stay in the asset history).
        /// Returns the deleted check (with asset_no).
        /// </summary>
        public Row DeleteCheck(Row round, long checkId)
        {
            if (!round.Empty("closed_at"))
            {
                throw new ValidationException(new[] { "This round is closed, so its results cannot be deleted." });
            }
            var check = _db.One(
                "SELECT c.*, a.asset_no FROM audit_checks c JOIN assets a ON a.id = c.asset_id WHERE c.id = :id AND c.round_id = :r",
                new Row { { "id", (long)checkId }, { "r", round.Int("id") } });
            if (check == null)
            {
                throw new ValidationException(new[] { "Check result not found." });
            }
            _db.Execute("DELETE FROM audit_checks WHERE id = :id", new Row { { "id", check.Long("id") } });
            return check;
        }

        /// <summary>
        /// Delete a whole round with all of its results (open or closed).
        /// Returns the number of results deleted with it.
        /// </summary>
        public int DeleteRound(Row round)
        {
            return _db.Transaction(() =>
            {
                int n = Php.ToInt(_db.Value("SELECT COUNT(*) FROM audit_checks WHERE round_id = :r", new Row { { "r", round.Int("id") } }));
                _db.Execute("DELETE FROM audit_checks WHERE round_id = :r", new Row { { "r", round.Int("id") } });
                _db.Execute("DELETE FROM audit_rounds WHERE id = :r", new Row { { "r", round.Int("id") } });
                return n;
            });
        }

        /// <summary>Progress per Work Center for a round.</summary>
        public List<Row> Progress(Row round)
        {
            var p = new Row { { "rid", round.Int("id") } };
            string w = ScopeWhere(round, p);
            return _db.All(
                @"SELECT COALESCE(wc.code, '—') AS work_center, COALESCE(wc.name, '') AS work_center_name,
                        COUNT(*) AS total, COUNT(c.id) AS checked
                 FROM assets a
                 LEFT JOIN work_centers wc ON wc.id = a.work_center_id
                 LEFT JOIN audit_checks c ON c.asset_id = a.id AND c.round_id = :rid
                 WHERE " + w + " GROUP BY wc.code, wc.name ORDER BY (COUNT(*) - COUNT(c.id)) DESC, wc.code NULLS FIRST",
                p);
        }

        public List<Row> RecentChecks(long roundId, int limit = 15)
        {
            return _db.All(
                @"SELECT c.*, a.asset_no, a.description, a.area,
                        TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS checked_by_name
                 FROM audit_checks c JOIN assets a ON a.id = c.asset_id LEFT JOIN users u ON u.id = c.checked_by
                 WHERE c.round_id = :r ORDER BY c.checked_at DESC, c.id DESC LIMIT " + limit,
                new Row { { "r", (int)roundId } });
        }

        public Row FindCheck(long roundId, long assetId)
        {
            return _db.One("SELECT * FROM audit_checks WHERE round_id = :r AND asset_id = :a",
                new Row { { "r", (int)roundId }, { "a", (int)assetId } });
        }

        /// <summary>Unchecked assets in scope for one Work Center ('—' = none).</summary>
        public List<Row> Unchecked(Row round, string workCenter = "", int limit = 500)
        {
            var p = new Row { { "rid", round.Int("id") } };
            string w = ScopeWhere(round, p);
            if (workCenter == "—")
            {
                w += " AND wc.code IS NULL";
            }
            else if (workCenter != "")
            {
                w += " AND wc.code = :wc";
                p["wc"] = workCenter;
            }
            return _db.All(
                @"SELECT a.id, a.asset_no, a.description, a.area, a.status, wc.code AS work_center
                 FROM assets a LEFT JOIN work_centers wc ON wc.id = a.work_center_id
                 LEFT JOIN audit_checks c ON c.asset_id = a.id AND c.round_id = :rid
                 WHERE " + w + " AND c.id IS NULL ORDER BY wc.code NULLS FIRST, a.asset_no LIMIT " + limit,
                p);
        }

        /// <summary>
        /// Record (or update) a check.
        /// </summary>
        public void Check(Row round, Row asset, Row input, int? userId)
        {
            if (!round.Empty("closed_at"))
            {
                throw new ValidationException(new[] { "This audit round is closed." });
            }
            string areaFound = AssetService.Normalise("area", input.Get("area_found", asset.Get("area")));
            string inResult = input.Get("result") as string;
            string result = inResult == "found" || inResult == "damaged" ? inResult : "found";
            if (areaFound != asset.Str("area"))
            {
                result = result == "damaged" ? "damaged" : "moved";
            }
            string inNetwork = input.Get("network") as string;
            string network = inNetwork == "online" || inNetwork == "offline" ? inNetwork : "";
            string note = AssetService.Normalise("remark", input.Get("note", ""));

            var db = _db;
            db.Transaction(() =>
            {
                var existing = db.One("SELECT id FROM audit_checks WHERE round_id = :r AND asset_id = :a",
                    new Row { { "r", round.Int("id") }, { "a", asset.Int("id") } });
                var data = new Row
                {
                    { "result", result },
                    { "network", network },
                    { "area_found", areaFound },
                    { "note", note },
                    { "checked_by", userId },
                    { "checked_at", Database.Now() },
                };
                if (existing != null)
                {
                    db.Update("audit_checks", data, "id = :id", new Row { { "id", existing.Long("id") } });
                }
                else
                {
                    var insert = new Row { { "round_id", round.Int("id") }, { "asset_id", asset.Int("id") } };
                    foreach (var kv in data) insert[kv.Key] = kv.Value;
                    db.Insert("audit_checks", insert);
                }
                if (areaFound != "" && areaFound != asset.Str("area"))
                {
                    var svc = new AssetService(db);
                    svc.Update(asset, new Row { { "area", areaFound } }, new[] { "area" }, userId, "audit", round.Int("id"), round.Str("name"));
                }
            });
        }

        /// <summary>Every in-scope asset with its check (for export).</summary>
        public List<Row> ExportCursor(Row round)
        {
            var p = new Row { { "rid", round.Int("id") } };
            string w = ScopeWhere(round, p);
            return _db.All(
                @"SELECT a.asset_no, a.description, wc.code AS work_center, wc.name AS work_center_name,
                        a.location, a.building, a.area, a.status,
                        COALESCE(c.result, 'not_checked') AS result, c.area_found, c.network, c.note, c.checked_at,
                        TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS checked_by
                 FROM assets a
                 LEFT JOIN work_centers wc ON wc.id = a.work_center_id
                 LEFT JOIN audit_checks c ON c.asset_id = a.id AND c.round_id = :rid
                 LEFT JOIN users u ON u.id = c.checked_by
                 WHERE " + w + " ORDER BY wc.code NULLS FIRST, a.asset_no",
                p);
        }

        /// <summary>Header labels of the audit export columns that are not asset fields.</summary>
        public static Dictionary<string, string> ExportLabels()
        {
            return new Dictionary<string, string>
            {
                { "result", "Result" },
                { "area_found", "Area found" },
                { "network", "Network" },
                { "note", "Note" },
                { "checked_at", "Checked at" },
                { "checked_by", "Checked by" },
            };
        }

        public static Dictionary<string, string> NetworkLabels()
        {
            return new Dictionary<string, string> { { "online", "Online" }, { "offline", "Offline" } };
        }

        public static List<KeyValuePair<string, string>> ResultLabels()
        {
            return new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("found", "Found, in place"),
                new KeyValuePair<string, string>("moved", "Found, moved"),
                new KeyValuePair<string, string>("damaged", "Found, damaged"),
                new KeyValuePair<string, string>("not_checked", "Not checked"),
            };
        }
    }
}
