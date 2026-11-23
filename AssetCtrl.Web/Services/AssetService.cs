using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;

namespace AssetCtrl.Services
{
    /// <summary>
    /// All writes to assets go through here so every change lands in asset_history.
    ///
    /// Field values are passed as a Row of field => string (PHP array of strings).
    /// A change set is field => [old, new] (ordered, like the PHP array).
    /// </summary>
    public class AssetService
    {
        private readonly Database _db;
        private readonly AssetRepository _assets;
        private readonly WorkCenterRepository _workCenters;
        private readonly HistoryRepository _history;
        private readonly MasterRepository _masters;

        /// <summary>Column max lengths (characters).</summary>
        private static readonly Dictionary<string, int> Limits = new Dictionary<string, int>
        {
            { "asset_no", 32 }, { "fix_no", 64 }, { "description", 255 }, { "os_name", 64 }, { "os_version", 64 },
            { "work_center", 16 }, { "pc_type", 64 }, { "location", 32 }, { "building", 64 }, { "area", 191 },
            { "remark", 255 }, { "status", 16 }, { "last_use", 64 }, { "editor_note", 128 }, { "mac_address", 64 },
            { "cpu", 128 }, { "ram", 32 }, { "brand", 64 }, { "model", 128 },
        };

        public AssetService(Database db)
        {
            _db = db;
            _assets = new AssetRepository(db);
            _workCenters = new WorkCenterRepository(db);
            _history = new HistoryRepository(db);
            _masters = new MasterRepository(db);
        }

        public MasterRepository Masters()
        {
            return _masters;
        }

        /// <summary>
        /// Type PC / Location / Building must come from their master list (active values).
        /// A value the asset already has is always accepted, so an old or inactive value
        /// does not block saving other fields. Empty is allowed.
        /// Returns error messages.
        /// </summary>
        public List<string> MasterErrors(Row values, Row asset = null)
        {
            var errors = new List<string>();
            foreach (var kv in MasterRepository.Kinds())
            {
                string kind = kv.Key;
                if (!values.ContainsKey(kind) || Php.ToStr(values[kind]) == "")
                {
                    continue;
                }
                string v = Php.ToStr(values[kind]);
                if (asset != null && !asset.IsNull(kind) && asset.Str(kind) == v)
                {
                    continue;
                }
                var set = _masters.ActiveSet(kind);
                if (!set.Contains(v.ToUpperInvariant()))
                {
                    errors.Add(Lang.T("{field} \"{value}\" is not in the master list. Add it under Settings › Master data first.", new Row
                    {
                        { "field", Lang.T((string)kv.Value[0]) }, { "value", v },
                    }));
                }
            }
            return errors;
        }

        public WorkCenterRepository WorkCenters()
        {
            return _workCenters;
        }

        /// <summary>Normalise a single field value the same way everywhere (form, bulk, import).</summary>
        public static string Normalise(string field, object raw)
        {
            string value = Php.ToStr(raw);
            switch (field)
            {
                case "work_center":
                    value = WorkCenterRepository.Split(value)[0];
                    break;
                case "asset_no":
                case "fix_no":
                case "location":
                case "building":
                case "pc_type":
                case "mac_address":
                    value = Php.CleanCode(value);
                    break;
                case "status":
                    value = AssetStatus.Normalise(value);
                    break;
                default:
                    value = Php.CleanText(value);
                    break;
            }
            if (value == "-" && field == "fix_no")
            {
                value = "";
            }
            int max;
            if (!Limits.TryGetValue(field, out max)) max = 255;
            if (Php.MbLen(value) > max)
            {
                value = Php.MbLeft(value, max);
            }
            return value;
        }

        private static readonly Regex AssetNoRe = new Regex(@"^[A-Z0-9][A-Z0-9_\-\./]*$");

        /// <summary>Validate normalised values; returns list of error messages.</summary>
        public static List<string> Validate(Row values)
        {
            var errors = new List<string>();
            if (values.ContainsKey("asset_no"))
            {
                string no = values.Str("asset_no");
                if (no == "")
                {
                    errors.Add("Please enter the IT Asset number.");
                }
                else if (!AssetNoRe.IsMatch(no))
                {
                    errors.Add("The IT Asset number may only contain A-Z, 0-9 and - _ . /");
                }
            }
            if (values.ContainsKey("status") && !AssetStatus.IsValid(values.Str("status")))
            {
                errors.Add("Status \"" + values.Str("status") + "\" is not valid.");
            }
            return errors;
        }

        /// <summary>
        /// Compare current asset values with proposed ones.
        /// Returns field => [old, new] for fields that actually change.
        /// </summary>
        public static Dictionary<string, string[]> Diff(Row asset, Row values)
        {
            var changes = new Dictionary<string, string[]>(StringComparer.Ordinal);
            foreach (var kv in values)
            {
                string field = kv.Key;
                if (field.StartsWith("_", StringComparison.Ordinal))
                {
                    continue; // helper keys such as _wc_name
                }
                string old = asset.Str(field);
                string nv = Php.ToStr(kv.Value);
                if (old != nv)
                {
                    changes[field] = new[] { old, nv };
                }
            }
            return changes;
        }

        /// <summary>Turn field changes into an assets-table row (Work Center code -> id).</summary>
        private Row ColumnsFor(IDictionary<string, string[]> changes)
        {
            var cols = new Row();
            foreach (var kv in changes)
            {
                if (kv.Key == "work_center")
                {
                    cols["work_center_id"] = _workCenters.IdFor(kv.Value[1]);
                }
                else
                {
                    cols[kv.Key] = kv.Value[1];
                }
            }
            return cols;
        }

        /// <summary>
        /// Update one asset with the given raw input, restricted to allowedFields.
        /// Returns the applied changes. Throws ValidationException.
        /// </summary>
        public Dictionary<string, string[]> Update(Row asset, Row input, IEnumerable<string> allowedFields, int? userId,
            string source = "edit", long? refId = null, string note = null)
        {
            var values = new Row();
            foreach (var field in allowedFields)
            {
                if (input.ContainsKey(field))
                {
                    values[field] = Normalise(field, input[field]);
                }
            }
            var errors = Validate(values).Concat(MasterErrors(values, asset)).ToList();
            if (errors.Count > 0)
            {
                throw new ValidationException(errors);
            }
            var changes = Diff(asset, values);
            if (changes.Count == 0)
            {
                return new Dictionary<string, string[]>();
            }
            _db.Transaction(() =>
            {
                WriteChanges(asset.Long("id"), changes, userId, source, refId, note);
            });
            return changes;
        }

        /// <summary>A User (department) saved this asset: it counts as checked for the current month.</summary>
        public void MarkUserChecked(long assetId, int? userId)
        {
            _db.Update("assets", new Row
            {
                { "user_checked_at", Database.Now() },
                { "user_checked_by", userId },
            }, "id = :id", new Row { { "id", (int)assetId } });
        }

        /// <summary>First moment of the current month: assets checked by a User on or after it are green.</summary>
        public static string CheckMonthStart()
        {
            return Database.NowDate().ToString("yyyy-MM-01 00:00:00", Php.Inv);
        }

        /// <summary>@internal used inside transactions</summary>
        public void WriteChanges(long assetId, IDictionary<string, string[]> changes, int? userId, string source, long? refId = null, string note = null)
        {
            var cols = ColumnsFor(changes);
            cols["updated_at"] = Database.Now();
            cols["updated_by"] = userId;
            _db.Update("assets", cols, "id = :id", new Row { { "id", (int)assetId } });
            _history.Record(assetId, changes, source, userId, refId, note);
        }

        /// <summary>
        /// Create a new asset.
        /// Returns the new id. Throws ValidationException.
        /// </summary>
        public long Create(Row input, int? userId, string source = "edit", long? refId = null)
        {
            var fields = new List<string> { "asset_no" };
            fields.AddRange(AssetFields.AdminEditable());
            fields.Add("last_use");
            fields.Add("editor_note");
            var values = new Row();
            foreach (var f in fields)
            {
                values[f] = Normalise(f, input.Get(f, ""));
            }
            var errors = Validate(values).Concat(MasterErrors(values)).ToList();
            if (errors.Count == 0 && _assets.FindByNo(values.Str("asset_no")) != null)
            {
                errors.Add("IT Asset " + values.Str("asset_no") + " already exists.");
            }
            if (errors.Count > 0)
            {
                throw new ValidationException(errors);
            }
            return _db.Transaction(() =>
            {
                var row = RowForInsert(values, userId);
                long id = _db.Insert("assets", row);
                _history.Record(id, new Dictionary<string, string[]> { { "_created", new[] { "", values.Str("asset_no") } } }, source, userId, refId);
                return id;
            });
        }

        /// <summary>@internal Build an INSERT row from normalised values.</summary>
        public Row RowForInsert(Row values, int? userId)
        {
            string now = Database.Now();
            var row = new Row
            {
                { "asset_no", values.Str("asset_no") },
                { "asset_type", AssetRepository.TypeOf(values.Str("asset_no")) },
                { "work_center_id", _workCenters.IdFor(values.Str("work_center"), values.Str("_wc_name")) },
                { "created_at", now },
                { "updated_at", now },
                { "updated_by", userId },
            };
            foreach (var kv in values)
            {
                if (kv.Key != "work_center" && kv.Key != "asset_no" && !kv.Key.StartsWith("_", StringComparison.Ordinal))
                {
                    row[kv.Key] = kv.Value;
                }
            }
            return row;
        }

        /// <summary>
        /// Apply the same values to many assets. Empty values are ignored unless the
        /// field is listed in clearFields.
        /// Returns { assets: int, changes: int }.
        /// </summary>
        public Row BulkUpdate(IList<Row> assets, Row input, IList<string> clearFields, int? userId, string note = null)
        {
            var values = new Row();
            foreach (var f in AssetFields.BulkEditable())
            {
                string v = input.ContainsKey(f) ? Normalise(f, input[f]) : "";
                if (v != "" || clearFields.Contains(f))
                {
                    values[f] = v;
                }
            }
            if (values.Count == 0)
            {
                throw new ValidationException(new[] { "Enter at least one value to change." });
            }
            var errors = Validate(values).Concat(MasterErrors(values)).ToList();
            if (errors.Count > 0)
            {
                throw new ValidationException(errors);
            }
            return _db.Transaction(() =>
            {
                int touched = 0;
                int count = 0;
                foreach (var asset in assets)
                {
                    var changes = Diff(asset, values);
                    if (changes.Count > 0)
                    {
                        WriteChanges(asset.Long("id"), changes, userId, "bulk", null, note);
                        touched++;
                        count += changes.Count;
                    }
                }
                return new Row { { "assets", touched }, { "changes", count } };
            });
        }
    }
}
