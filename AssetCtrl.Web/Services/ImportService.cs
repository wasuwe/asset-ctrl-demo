using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace AssetCtrl.Services
{
    /// <summary>
    /// Two-step import that never wipes data:
    ///   1. Stage()  – parse the file, diff every row against the database and store
    ///                 the result as a "preview" batch. Nothing in assets changes.
    ///   2. Apply()  – write creates/updates for the fields the admin chose, with a
    ///                 history row per changed field (source = import).
    /// </summary>
    public class ImportService
    {
        private readonly Database _db;

        public ImportService(Database db)
        {
            _db = db;
        }

        /// <summary>
        /// Map spreadsheet columns to asset fields.
        /// Returns map (column index => field, in order) and hasHeader.
        /// </summary>
        public static List<KeyValuePair<int, string>> DetectColumns(List<string> firstRow, out bool hasHeader)
        {
            var aliases = AssetFields.HeaderAliases();
            var map = new List<KeyValuePair<int, string>>();
            for (int i = 0; i < firstRow.Count; i++)
            {
                string key = System.Text.RegularExpressions.Regex.Replace(firstRow[i] ?? "", @"\s+", " ").Trim().ToLowerInvariant();
                foreach (var kv in aliases)
                {
                    if (kv.Value.Contains(key) && !map.Any(m => m.Value == kv.Key))
                    {
                        map.Add(new KeyValuePair<int, string>(i, kv.Key));
                        break;
                    }
                }
            }
            if (map.Any(m => m.Value == "asset_no") && map.Count >= 2)
            {
                hasHeader = true;
                return map;
            }
            // No header: assume the legacy 14-column master sheet layout.
            hasHeader = false;
            return AssetFields.LegacyCsvColumns().Select((f, i) => new KeyValuePair<int, string>(i, f)).ToList();
        }

        /// <summary>
        /// Parse + diff the file and store a preview batch.
        /// Returns the batch id. Throws ValidationException.
        /// </summary>
        public long Stage(string path, string originalName, int? userId)
        {
            var rows = SpreadsheetReader.Read(path, originalName);
            if (rows.Count == 0)
            {
                throw new ValidationException(new[] { "The file is empty." });
            }
            bool hasHeader;
            var map = DetectColumns(rows[0], out hasHeader);
            int startLine = 1;
            if (hasHeader)
            {
                rows.RemoveAt(0);
                startLine = 2;
            }
            var fieldsInFile = map.Select(m => m.Value).ToList();

            var existing = new AssetRepository(_db).AllKeyedByNo();
            var seen = new Dictionary<string, int>(StringComparer.Ordinal);
            var staged = new List<Row>();
            var counts = new Dictionary<string, int> { { "create", 0 }, { "update", 0 }, { "same", 0 }, { "error", 0 } };

            for (int i = 0; i < rows.Count; i++)
            {
                var row = rows[i];
                int line = i + startLine;
                if (!row.Any(c => !string.IsNullOrEmpty(c)))
                {
                    continue;
                }
                var values = new Row();
                foreach (var m in map)
                {
                    string raw = m.Key < row.Count ? row[m.Key] : "";
                    values[m.Value] = AssetService.Normalise(m.Value, raw);
                    if (m.Value == "work_center")
                    {
                        // "2300-ICS" -> code 2300 (compared) + name ICS (used for new work centers)
                        var split = WorkCenterRepository.Split(raw);
                        values["_wc_name"] = split[1];
                    }
                }
                string assetNo = values.Str("asset_no");
                string action;
                string message = null;
                Dictionary<string, string[]> diff = null;

                var errors = AssetService.Validate(values);
                if (errors.Count == 0 && seen.ContainsKey(assetNo))
                {
                    errors.Add("Duplicate asset number (same as line " + seen[assetNo] + ").");
                }
                if (errors.Count > 0)
                {
                    action = "error";
                    message = string.Join(" ", errors);
                }
                else
                {
                    seen[assetNo] = line;
                    if (!existing.ContainsKey(assetNo))
                    {
                        action = "create";
                    }
                    else
                    {
                        diff = AssetService.Diff(existing[assetNo], values);
                        action = diff.Count > 0 ? "update" : "same";
                    }
                }
                counts[action]++;
                staged.Add(new Row
                {
                    { "line_no", line },
                    { "asset_no", assetNo.Length > 32 ? assetNo.Substring(0, 32) : assetNo },
                    { "action", action },
                    { "payload", action == "same" ? "{}" : JsonConvert.SerializeObject(values) },
                    { "diff", diff != null && diff.Count > 0 ? JsonConvert.SerializeObject(diff) : null },
                    { "message", message },
                });
            }

            int missing = 0;
            foreach (var no in existing.Keys)
            {
                if (!seen.ContainsKey(no))
                {
                    missing++;
                }
            }

            return _db.Transaction(() =>
            {
                string name = Path.GetFileName(originalName ?? "");
                long batchId = _db.Insert("import_batches", new Row
                {
                    { "filename", name.Length > 191 ? name.Substring(0, 191) : name },
                    { "file_sha1", Sha1File(path) },
                    { "status", "preview" },
                    { "total_rows", staged.Count },
                    { "create_count", counts["create"] },
                    { "update_count", counts["update"] },
                    { "same_count", counts["same"] },
                    { "error_count", counts["error"] },
                    { "missing_count", missing },
                    { "applied_fields", JsonConvert.SerializeObject(fieldsInFile) },
                    { "uploaded_by", userId },
                    { "created_at", Database.Now() },
                });
                for (int c = 0; c < staged.Count; c += 300)
                {
                    var chunk = new List<Row>();
                    foreach (var r in staged.Skip(c).Take(300))
                    {
                        var withBatch = new Row { { "batch_id", (int)batchId } };
                        foreach (var kv in r) withBatch[kv.Key] = kv.Value;
                        chunk.Add(withBatch);
                    }
                    _db.InsertMany("import_rows", chunk);
                }
                return batchId;
            });
        }

        /// <summary>sha1_file(): lowercase hex.</summary>
        private static string Sha1File(string path)
        {
            using (var sha = SHA1.Create())
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read))
            {
                var hash = sha.ComputeHash(fs);
                var sb = new StringBuilder(40);
                foreach (var b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        public Row Batch(long id)
        {
            return _db.One(
                @"SELECT b.*, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS uploaded_by_name
                 FROM import_batches b LEFT JOIN users u ON u.id = b.uploaded_by WHERE b.id = :id",
                new Row { { "id", (int)id } });
        }

        public List<Row> Batches(int limit = 20)
        {
            return _db.All(
                @"SELECT b.*, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS uploaded_by_name
                 FROM import_batches b LEFT JOIN users u ON u.id = b.uploaded_by
                 ORDER BY b.id DESC LIMIT " + limit);
        }

        /// <summary>Fields present in the batch's file.</summary>
        public List<string> FieldsOf(Row batch)
        {
            var f = DecodeJson(batch.Str("applied_fields")) as List<object>;
            return f != null ? f.Select(Php.ToStr).ToList() : new List<string>();
        }

        /// <summary>Rows of one action type, paginated. Returns { rows, pager }.</summary>
        public Row Rows(long batchId, string action, int page, int perPage = 100)
        {
            var p = new Row { { "b", (int)batchId }, { "a", action } };
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) FROM import_rows WHERE batch_id = :b AND action = :a", p));
            var pager = new Paginator(total, perPage, page);
            var rows = _db.All(
                "SELECT * FROM import_rows WHERE batch_id = :b AND action = :a ORDER BY line_no LIMIT "
                + pager.PerPage + " OFFSET " + pager.Offset(),
                p);
            return new Row { { "rows", rows }, { "pager", pager } };
        }

        /// <summary>How many update rows touch each field.</summary>
        public Row FieldChangeCounts(long batchId)
        {
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            var order = new List<string>();
            foreach (var r in _db.All("SELECT diff FROM import_rows WHERE batch_id = :b AND action = 'update'", new Row { { "b", (int)batchId } }))
            {
                var d = DecodeJson(r.Str("diff")) as Row;
                if (d != null)
                {
                    foreach (var f in d.Keys)
                    {
                        if (counts.ContainsKey(f))
                        {
                            counts[f]++;
                        }
                        else
                        {
                            counts[f] = 1;
                            order.Add(f);
                        }
                    }
                }
            }
            // arsort
            var o = new Row();
            foreach (var f in order.OrderByDescending(k => counts[k]))
            {
                o[f] = counts[f];
            }
            return o;
        }

        /// <summary>Assets in the database that are absent from the file. Returns { rows, pager }.</summary>
        public Row Missing(long batchId, int page, int perPage = 100)
        {
            string from = @"FROM assets a
                 LEFT JOIN work_centers wc ON wc.id = a.work_center_id
                 LEFT JOIN import_rows r ON r.batch_id = :b AND r.asset_no = a.asset_no AND r.action <> 'error'
                 WHERE r.id IS NULL";
            var p = new Row { { "b", (int)batchId } };
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) " + from, p));
            var pager = new Paginator(total, perPage, page);
            var rows = _db.All(
                "SELECT a.asset_no, a.description, a.status, a.area, wc.code AS work_center " + from + " ORDER BY a.asset_no LIMIT "
                + pager.PerPage + " OFFSET " + pager.Offset(),
                p);
            return new Row { { "rows", rows }, { "pager", pager } };
        }

        /// <summary>
        /// Apply a preview batch.
        /// fields: fields allowed to be overwritten on existing assets
        /// createNew: insert assets that do not exist yet
        /// Returns { created: int, updated: int, changes: int }. Throws ValidationException.
        /// </summary>
        public Row Apply(long batchId, IList<string> fields, bool createNew, int? userId)
        {
            var batch = Batch(batchId);
            if (batch == null || batch.Str("status") != "preview")
            {
                throw new ValidationException(new[] { "This import batch has already been applied or discarded." });
            }
            var importable = AssetFields.Importable();
            var allowed = fields.Where(f => importable.Contains(f) && f != "asset_no").ToList();

            var assetService = new AssetService(_db);
            var history = new HistoryRepository(_db);
            int batchIdInt = batch.Int("id");

            return _db.Transaction(() =>
            {
                var existing = new AssetRepository(_db).AllKeyedByNo();
                var importRows = _db.All(
                    "SELECT asset_no, payload FROM import_rows WHERE batch_id = :b AND action IN ('create','update') ORDER BY line_no",
                    new Row { { "b", batchIdInt } });
                int created = 0;
                int updated = 0;
                int changesTotal = 0;
                string now = Database.Now();
                var historyRows = new List<Row>();

                var masters = assetService.Masters();
                var masterKinds = MasterRepository.Kinds().Select(kv => kv.Key).ToList();
                foreach (var r in importRows)
                {
                    var values = DecodeJson(r.Str("payload")) as Row;
                    if (values == null)
                    {
                        continue;
                    }
                    string no = values.Str("asset_no");
                    // New Type PC / Location / Building values join their master list automatically.
                    foreach (var mk in masterKinds)
                    {
                        bool writes = !existing.ContainsKey(no) ? createNew : allowed.Contains(mk);
                        if (writes && !values.Empty(mk))
                        {
                            masters.Ensure(mk, values.Str(mk));
                        }
                    }
                    if (!existing.ContainsKey(no))
                    {
                        if (!createNew)
                        {
                            continue;
                        }
                        long id = _db.Insert("assets", assetService.RowForInsert(values, userId));
                        historyRows.Add(new Row
                        {
                            { "asset_id", (int)id }, { "field", "_created" }, { "old_value", "" }, { "new_value", no },
                            { "source", "import" }, { "ref_id", batchIdInt }, { "note", null },
                            { "changed_by", userId }, { "changed_at", now },
                        });
                        existing[no] = new Row { { "id", id.ToString(Php.Inv) } };
                        created++;
                        continue;
                    }
                    if (!values.Empty("work_center"))
                    {
                        // Fills in the name of work centers that have none yet.
                        assetService.WorkCenters().IdFor(values.Str("work_center"), Php.ToStr(values.Get("_wc_name", "")));
                    }
                    var subset = new Row();
                    foreach (var f in allowed)
                    {
                        if (values.ContainsKey(f))
                        {
                            subset[f] = values[f];
                        }
                    }
                    // Re-diff against the live row in case it changed since preview.
                    var changes = AssetService.Diff(existing[no], subset);
                    if (changes.Count == 0)
                    {
                        continue;
                    }
                    int assetId = existing[no].Int("id");
                    var cols = new Row();
                    foreach (var kv in changes)
                    {
                        if (kv.Key == "work_center")
                        {
                            cols["work_center_id"] = assetService.WorkCenters().IdFor(kv.Value[1], Php.ToStr(values.Get("_wc_name", "")));
                        }
                        else
                        {
                            cols[kv.Key] = kv.Value[1];
                        }
                        historyRows.Add(new Row
                        {
                            { "asset_id", assetId }, { "field", kv.Key }, { "old_value", kv.Value[0] }, { "new_value", kv.Value[1] },
                            { "source", "import" }, { "ref_id", batchIdInt }, { "note", null },
                            { "changed_by", userId }, { "changed_at", now },
                        });
                    }
                    cols["updated_at"] = now;
                    cols["updated_by"] = userId;
                    _db.Update("assets", cols, "id = :id", new Row { { "id", assetId } });
                    updated++;
                    changesTotal += changes.Count;

                    if (historyRows.Count >= 500)
                    {
                        history.InsertRows(historyRows);
                        historyRows = new List<Row>();
                    }
                }
                history.InsertRows(historyRows);

                _db.Update("import_batches", new Row
                {
                    { "status", "applied" },
                    { "applied_at", now },
                    { "applied_fields", JsonConvert.SerializeObject(allowed) },
                }, "id = :id", new Row { { "id", batchIdInt } });
                // Diffs stay for the record; full payloads of updated rows are no longer needed.
                _db.Execute("UPDATE import_rows SET payload = '{}' WHERE batch_id = :b AND action = 'update'", new Row { { "b", batchIdInt } });

                return new Row { { "created", created }, { "updated", updated }, { "changes", changesTotal } };
            });
        }

        public void Discard(long batchId)
        {
            _db.Update("import_batches", new Row { { "status", "discarded" } }, "id = :id AND status = 'preview'", new Row { { "id", (int)batchId } });
            _db.Execute("DELETE FROM import_rows WHERE batch_id = :b AND action <> 'error'", new Row { { "b", (int)batchId } });
        }

        /* ------------------------------------------------------------ json_decode($s, true) */

        /// <summary>
        /// json_decode($s, true): objects -> Row, arrays -> List&lt;object&gt;, strings stay strings.
        /// Returns null for null/invalid JSON.
        /// </summary>
        public static object DecodeJson(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }
            try
            {
                // Strings that look like dates must stay strings (PHP has no date type).
                using (var reader = new JsonTextReader(new StringReader(json)) { DateParseHandling = DateParseHandling.None })
                {
                    var token = JToken.ReadFrom(reader);
                    return FromToken(token);
                }
            }
            catch (JsonException)
            {
                return null;
            }
        }

        private static object FromToken(JToken t)
        {
            switch (t.Type)
            {
                case JTokenType.Object:
                    var row = new Row();
                    foreach (var p in ((JObject)t).Properties()) row[p.Name] = FromToken(p.Value);
                    return row;
                case JTokenType.Array:
                    return ((JArray)t).Select(FromToken).ToList();
                case JTokenType.Null:
                case JTokenType.Undefined:
                    return null;
                default:
                    return ((JValue)t).Value;
            }
        }
    }
}
