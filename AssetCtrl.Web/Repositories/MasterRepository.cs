using System;
using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;

namespace AssetCtrl.Repositories
{
    /// <summary>
    /// Master lists for asset code fields: Type PC, Location, Building / floor (table asset_masters).
    /// Assets keep the code as text in the column of the same name (assets.pc_type, .location, .building).
    /// </summary>
    public class MasterRepository
    {
        private readonly Database _db;

        /// <summary>kind => codes already known to exist (ensure()).</summary>
        private readonly Dictionary<string, HashSet<string>> _known = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        /// <summary>kind => active code set (activeSet()), PHP $known['_active'].</summary>
        private readonly Dictionary<string, HashSet<string>> _active = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        public MasterRepository(Database db)
        {
            _db = db;
        }

        /// <summary>kind => [label, max code length]. The kind is also the asset column name.</summary>
        public static List<KeyValuePair<string, object[]>> Kinds()
        {
            return new List<KeyValuePair<string, object[]>>
            {
                new KeyValuePair<string, object[]>("pc_type", new object[] { "Type PC", 64 }),
                new KeyValuePair<string, object[]>("location", new object[] { "Location", 32 }),
                new KeyValuePair<string, object[]>("building", new object[] { "Building / floor", 64 }),
            };
        }

        private static IEnumerable<string> KindKeys()
        {
            return Kinds().Select(kv => kv.Key);
        }

        public static bool IsKind(string kind)
        {
            return KindKeys().Contains(kind ?? "");
        }

        public static int MaxLength(string kind)
        {
            return (int)Kinds().First(kv => kv.Key == kind).Value[1];
        }

        /// <summary>Label of a kind (PHP: kinds()[kind][0]).</summary>
        public static string KindLabel(string kind)
        {
            return (string)Kinds().First(kv => kv.Key == kind).Value[0];
        }

        public static Row Shape(Row r)
        {
            var o = new Row
            {
                { "id", r.Int("id") },
                { "kind", r.Get("kind") },
                { "code", r.Get("code") },
                { "name", r.Get("name") },
                { "is_active", r.Int("is_active") != 0 },
            };
            if (!r.IsNull("asset_count"))
            {
                o["asset_count"] = r.Int("asset_count");
            }
            return o;
        }

        private static string AssetCountSql()
        {
            // kind is one of the fixed column names from kinds(), never user input.
            var parts = new List<string>();
            foreach (var k in KindKeys())
            {
                parts.Add("WHEN '" + k + "' THEN (SELECT COUNT(*) FROM assets a WHERE a." + k + " = m.code)");
            }
            return "CASE m.kind " + string.Join(" ", parts) + " ELSE 0 END";
        }

        /// <summary>
        /// Filters: kind (required), q, active ('1' | '0' | '').
        /// Returns { rows, pager }.
        /// </summary>
        public Row Search(string kind, Row f, int page, int perPage = 100)
        {
            var p = new Row { { "kind", kind } };
            var w = new List<string> { "m.kind = :kind" };
            if (!f.Empty("q"))
            {
                w.Add("(m.code ILIKE :q1 OR m.name ILIKE :q2)");
                p["q1"] = p["q2"] = "%" + Database.LikeEscape(f.Str("q")) + "%";
            }
            if (f.Get("active") != null && f.Str("active") != "")
            {
                w.Add("m.is_active = :active");
                p["active"] = f.Int("active");
            }
            string where = string.Join(" AND ", w);
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) FROM asset_masters m WHERE " + where, p));
            var pager = new Paginator(total, perPage, page);
            var rows = _db.All(
                "SELECT m.*, " + AssetCountSql() + @" AS asset_count
                 FROM asset_masters m WHERE " + where + " ORDER BY m.code LIMIT " + pager.PerPage + " OFFSET " + pager.Offset(),
                p);
            var shaped = rows.Select(Shape).ToList();
            return new Row { { "rows", shaped }, { "pager", pager } };
        }

        /// <summary>Per kind: total, inactive, and values used on assets but missing from the master.</summary>
        public Row Counts()
        {
            var o = new Row();
            foreach (var k in KindKeys())
            {
                o[k] = new Row
                {
                    { "total", Php.ToInt(_db.Value("SELECT COUNT(*) FROM asset_masters WHERE kind = :k", new Row { { "k", k } })) },
                    { "inactive", Php.ToInt(_db.Value("SELECT COUNT(*) FROM asset_masters WHERE kind = :k AND is_active = 0", new Row { { "k", k } })) },
                    { "missing", Php.ToInt(_db.Value(
                        "SELECT COUNT(DISTINCT a." + k + @") FROM assets a
                         LEFT JOIN asset_masters m ON m.kind = :k AND m.code = a." + k + @"
                         WHERE a." + k + " <> '' AND m.id IS NULL",
                        new Row { { "k", k } })) },
                };
            }
            return o;
        }

        /// <summary>
        /// Tabs of the Master data page: Work Center (its own table, work_centers) first,
        /// then the asset_masters kinds. [{ code, label, total }]
        /// </summary>
        public List<Row> Tabs()
        {
            var o = new List<Row>
            {
                new Row
                {
                    { "code", "work_center" },
                    { "label", "Work Center" },
                    { "total", Php.ToInt(_db.Value("SELECT COUNT(*) FROM work_centers")) },
                },
            };
            foreach (var kv in Kinds())
            {
                o.Add(new Row
                {
                    { "code", kv.Key },
                    { "label", kv.Value[0] },
                    { "total", Php.ToInt(_db.Value("SELECT COUNT(*) FROM asset_masters WHERE kind = :k", new Row { { "k", kv.Key } })) },
                });
            }
            return o;
        }

        public Row Find(long id)
        {
            return _db.One(
                "SELECT m.*, " + AssetCountSql() + " AS asset_count FROM asset_masters m WHERE m.id = :id",
                new Row { { "id", (int)id } });
        }

        public Row FindByCode(string kind, string code)
        {
            return _db.One("SELECT * FROM asset_masters WHERE kind = :k AND code = :c", new Row { { "k", kind }, { "c", code } });
        }

        public int Insert(string kind, string code, string name = "", bool active = true)
        {
            string now = Database.Now();
            return (int)_db.Insert("asset_masters", new Row
            {
                { "kind", kind }, { "code", code }, { "name", name ?? "" }, { "is_active", active ? 1 : 0 },
                { "created_at", now }, { "updated_at", now },
            });
        }

        /// <summary>Change the name and active flag (the code never changes: assets refer to it).</summary>
        public void Update(long id, string name, bool active)
        {
            _db.Update("asset_masters", new Row
            {
                { "name", name ?? "" }, { "is_active", active ? 1 : 0 }, { "updated_at", Database.Now() },
            }, "id = :id", new Row { { "id", (int)id } });
        }

        /// <summary>Add a code to the master when it is not there yet (import). Codes must already be normalised.</summary>
        public void Ensure(string kind, string code)
        {
            HashSet<string> known;
            if (string.IsNullOrEmpty(code) || !IsKind(kind) || (_known.TryGetValue(kind, out known) && known.Contains(code)))
            {
                return;
            }
            if (FindByCode(kind, code) == null)
            {
                Insert(kind, code);
            }
            if (!_known.TryGetValue(kind, out known))
            {
                known = new HashSet<string>(StringComparer.Ordinal);
                _known[kind] = known;
            }
            known.Add(code);
        }

        /// <summary>Add every value already used on assets but missing from the master. Returns rows added.</summary>
        public int SyncFromAssets(string kind = null)
        {
            int added = 0;
            foreach (var k in KindKeys())
            {
                if (kind != null && kind != k)
                {
                    continue;
                }
                var codes = _db.Column(
                    "SELECT DISTINCT UPPER(TRIM(a." + k + @")) FROM assets a
                     LEFT JOIN asset_masters m ON m.kind = :k AND m.code = a." + k + @"
                     WHERE a." + k + " <> '' AND m.id IS NULL",
                    new Row { { "k", k } });
                foreach (var code in codes)
                {
                    if (!string.IsNullOrEmpty(code) && FindByCode(k, code) == null)
                    {
                        Insert(k, code);
                        added++;
                    }
                }
            }
            return added;
        }

        /// <summary>Active codes per kind for pickers: kind => [[code, label], ...].</summary>
        public Row ActiveOptions()
        {
            var o = new Row();
            foreach (var k in KindKeys())
            {
                o[k] = new List<string[]>();
            }
            foreach (var r in _db.All("SELECT kind, code, name FROM asset_masters WHERE is_active = 1 ORDER BY kind, code"))
            {
                object list;
                if (o.TryGetValue(r.Str("kind"), out list))
                {
                    ((List<string[]>)list).Add(new[] { r.Str("code"), r.Str("code") + (r.Str("name") != "" ? " · " + r.Str("name") : "") });
                }
            }
            return o;
        }

        /// <summary>Active codes of one kind as a set (upper-cased codes), for validation.</summary>
        public HashSet<string> ActiveSet(string kind)
        {
            HashSet<string> set;
            if (!_active.TryGetValue(kind, out set))
            {
                set = new HashSet<string>(StringComparer.Ordinal);
                foreach (var c in _db.Column("SELECT code FROM asset_masters WHERE kind = :k AND is_active = 1", new Row { { "k", kind } }))
                {
                    set.Add((c ?? "").ToUpperInvariant());
                }
                _active[kind] = set;
            }
            return set;
        }
    }
}
