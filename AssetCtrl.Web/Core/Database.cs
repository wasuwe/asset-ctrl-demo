using System;
using System.Collections;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using Dapper;
using Npgsql;
using NpgsqlTypes;

namespace AssetCtrl.Core
{
    /// <summary>
    /// Thin Npgsql + Dapper wrapper (port of the PHP Database class). Every query uses parameters.
    ///
    /// SQL uses :name placeholders, the same as the PHP version. Parameter values:
    ///  - string  -> sent as an *untyped* literal, so PostgreSQL reads it as whatever the column
    ///               needs ('12' into an int column, '2026-11-01 00:00:00' into a timestamp), the way
    ///               MySQL did. This keeps the ported SQL and services close to the original.
    ///  - int/long -> integer, DateTime -> timestamp, bool -> 1/0, null -> NULL.
    /// Rows come back with every value as a string (null stays null): see Row.
    /// </summary>
    public sealed class Database : IDisposable
    {
        private readonly string _connectionString;
        private NpgsqlConnection _conn;
        private NpgsqlTransaction _tx;
        private int _transactionDepth;

        /// <summary>True once connecting failed in this request (later calls fail fast).</summary>
        public bool Unavailable { get; private set; }

        /// <summary>Tables without an "id" column (Insert does not return an id).</summary>
        private static readonly HashSet<string> NoIdTables = new HashSet<string>(StringComparer.Ordinal)
        {
            "user_work_centers", "user_departments", "app_sessions",
        };

        public Database(string connectionString)
        {
            _connectionString = connectionString;
        }

        public NpgsqlConnection Connection
        {
            get
            {
                if (_conn == null)
                {
                    if (Unavailable)
                    {
                        throw new DatabaseUnavailableException("Cannot connect to the database (already failed in this request).");
                    }
                    var conn = new NpgsqlConnection(_connectionString);
                    try
                    {
                        conn.Open();
                    }
                    catch (Exception ex) when (ex is NpgsqlException || ex is System.Net.Sockets.SocketException
                        || ex is TimeoutException || ex is ArgumentException || ex is InvalidOperationException)
                    {
                        // Server down, wrong host/port/user/password, database missing, bad connection string ...:
                        // the API answers "db_unavailable" and the browser app switches to Demo mode (see Kernel).
                        conn.Dispose();
                        Unavailable = true;
                        throw new DatabaseUnavailableException("Cannot connect to the database: " + ex.Message, ex);
                    }
                    _conn = conn;
                }
                return _conn;
            }
        }

        public void Dispose()
        {
            if (_tx != null) { try { _tx.Rollback(); } catch { } _tx.Dispose(); _tx = null; }
            if (_conn != null) { _conn.Dispose(); _conn = null; }
        }

        /* ------------------------------------------------------------ queries */

        public List<Row> All(string sql, IDictionary<string, object> p = null)
        {
            var rows = new List<Row>();
            using (var reader = Connection.ExecuteReader(sql, new PgParams(p), _tx))
            {
                int n = reader.FieldCount;
                var names = new string[n];
                var types = new string[n];
                for (int i = 0; i < n; i++)
                {
                    names[i] = reader.GetName(i);
                    types[i] = reader.GetDataTypeName(i);
                }
                while (reader.Read())
                {
                    var row = new Row();
                    for (int i = 0; i < n; i++)
                    {
                        row[names[i]] = reader.IsDBNull(i) ? null : FormatValue(reader.GetValue(i), types[i]);
                    }
                    rows.Add(row);
                }
            }
            return rows;
        }

        public Row One(string sql, IDictionary<string, object> p = null)
        {
            var rows = All(sql, p);
            return rows.Count > 0 ? rows[0] : null;
        }

        /// <summary>First column of the first row as a string (null when no row / NULL).</summary>
        public string Value(string sql, IDictionary<string, object> p = null)
        {
            var row = One(sql, p);
            if (row == null || row.Count == 0) return null;
            return (string)row.Values.First();
        }

        /// <summary>First column of every row.</summary>
        public List<string> Column(string sql, IDictionary<string, object> p = null)
        {
            return All(sql, p).Select(r => (string)r.Values.First()).ToList();
        }

        /// <summary>Key => value pairs from the first two selected columns.</summary>
        public Row Pairs(string sql, IDictionary<string, object> p = null)
        {
            var o = new Row();
            foreach (var r in All(sql, p))
            {
                var v = r.Values.ToList();
                o[Php.ToStr(v[0])] = v.Count > 1 ? v[1] : null;
            }
            return o;
        }

        /// <summary>Execute a statement; returns the affected row count.</summary>
        public int Execute(string sql, IDictionary<string, object> p = null)
        {
            return Connection.Execute(sql, new PgParams(p), _tx);
        }

        /// <summary>INSERT and return the new id (0 for tables without an id column).</summary>
        public long Insert(string table, IDictionary<string, object> data)
        {
            var cols = data.Keys.ToList();
            string sql = "INSERT INTO " + Q(table) + " (" + string.Join(", ", cols.Select(Q)) + ") VALUES ("
                + string.Join(", ", cols.Select(c => ":" + c)) + ")";
            if (NoIdTables.Contains(table))
            {
                Execute(sql, data);
                return 0;
            }
            return Php.ToLong(Value(sql + " RETURNING id", data));
        }

        /// <summary>Multi-row insert of rows sharing the same columns.</summary>
        public void InsertMany(string table, IList<Row> rows)
        {
            if (rows == null || rows.Count == 0) return;
            var cols = rows[0].Keys.ToList();
            var p = new Row();
            var values = new List<string>();
            for (int r = 0; r < rows.Count; r++)
            {
                var names = new List<string>();
                foreach (var c in cols)
                {
                    string name = "m" + r + "_" + c;
                    names.Add(":" + name);
                    p[name] = rows[r].Get(c);
                }
                values.Add("(" + string.Join(", ", names) + ")");
            }
            Execute("INSERT INTO " + Q(table) + " (" + string.Join(", ", cols.Select(Q)) + ") VALUES " + string.Join(", ", values), p);
        }

        public int Update(string table, IDictionary<string, object> data, string where, IDictionary<string, object> whereParams = null)
        {
            var sets = new List<string>();
            var p = new Row();
            foreach (var kv in data)
            {
                sets.Add(Q(kv.Key) + " = :set_" + kv.Key);
                p["set_" + kv.Key] = kv.Value;
            }
            if (whereParams != null)
            {
                foreach (var kv in whereParams) p[kv.Key] = kv.Value;
            }
            return Execute("UPDATE " + Q(table) + " SET " + string.Join(", ", sets) + " WHERE " + where, p);
        }

        /// <summary>Run a callback inside a transaction (nested calls join the outer one).</summary>
        public T Transaction<T>(Func<T> callback)
        {
            if (_transactionDepth == 0)
            {
                _tx = Connection.BeginTransaction();
            }
            _transactionDepth++;
            try
            {
                T result = callback();
                _transactionDepth--;
                if (_transactionDepth == 0)
                {
                    _tx.Commit();
                    _tx.Dispose();
                    _tx = null;
                }
                return result;
            }
            catch
            {
                _transactionDepth--;
                if (_transactionDepth == 0 && _tx != null)
                {
                    try { _tx.Rollback(); } catch { }
                    _tx.Dispose();
                    _tx = null;
                }
                throw;
            }
        }

        public void Transaction(Action callback)
        {
            Transaction<object>(() => { callback(); return null; });
        }

        /* ------------------------------------------------------------ helpers */

        /// <summary>Build "col IN (:p_0, :p_1)" safely, adding to params.</summary>
        public static string InClause(string column, IEnumerable values, IDictionary<string, object> p, string prefix = "in")
        {
            var names = new List<string>();
            int i = 0;
            foreach (var v in values)
            {
                string name = prefix + "_" + i++;
                names.Add(":" + name);
                p[name] = v;
            }
            if (names.Count == 0) return "1 = 0";
            return column + " IN (" + string.Join(", ", names) + ")";
        }

        private static TimeZoneInfo _tz;

        /// <summary>Application time zone (appSetting TimeZone, default SE Asia Standard Time = Asia/Bangkok).</summary>
        public static TimeZoneInfo Zone
        {
            get
            {
                if (_tz == null)
                {
                    string id = AppConfig.Get("TimeZone", "SE Asia Standard Time");
                    try { _tz = TimeZoneInfo.FindSystemTimeZoneById(id); }
                    catch { _tz = TimeZoneInfo.Local; }
                }
                return _tz;
            }
        }

        public static DateTime NowDate()
        {
            return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Zone);
        }

        /// <summary>"yyyy-MM-dd HH:mm:ss" in the application time zone (PHP date('Y-m-d H:i:s')).</summary>
        public static string Now()
        {
            return NowDate().ToString("yyyy-MM-dd HH:mm:ss", Php.Inv);
        }

        /// <summary>Escape LIKE wildcards in user input.</summary>
        public static string LikeEscape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
        }

        /// <summary>Quote an identifier.</summary>
        public static string Q(string name)
        {
            return "\"" + name.Replace("\"", "\"\"") + "\"";
        }

        private static object FormatValue(object v, string type)
        {
            if (v is DateTime d)
            {
                return type == "date" ? d.ToString("yyyy-MM-dd", Php.Inv) : d.ToString("yyyy-MM-dd HH:mm:ss", Php.Inv);
            }
            if (v is bool b) return b ? "1" : "0";
            if (v is string s) return s;
            if (v is IFormattable f) return f.ToString(null, Php.Inv);
            return v.ToString();
        }

        /// <summary>Dapper parameter bag that sends strings untyped (see class comment).</summary>
        private sealed class PgParams : SqlMapper.IDynamicParameters
        {
            private readonly IDictionary<string, object> _p;

            public PgParams(IDictionary<string, object> p) { _p = p; }

            public void AddParameters(IDbCommand command, SqlMapper.Identity identity)
            {
                if (_p == null) return;
                var cmd = (NpgsqlCommand)command;
                foreach (var kv in _p)
                {
                    string name = kv.Key.TrimStart(':');
                    if (!cmd.CommandText.Contains(":" + name)) continue; // unused (like PDO, extra keys are ignored)
                    object v = kv.Value;
                    NpgsqlParameter prm;
                    if (v == null)
                    {
                        prm = new NpgsqlParameter(name, NpgsqlDbType.Unknown) { Value = DBNull.Value };
                    }
                    else if (v is string s)
                    {
                        prm = new NpgsqlParameter(name, NpgsqlDbType.Unknown) { Value = s };
                    }
                    else if (v is bool b)
                    {
                        prm = new NpgsqlParameter(name, NpgsqlDbType.Integer) { Value = b ? 1 : 0 };
                    }
                    else if (v is int || v is short)
                    {
                        prm = new NpgsqlParameter(name, NpgsqlDbType.Integer) { Value = Convert.ToInt32(v) };
                    }
                    else if (v is long)
                    {
                        prm = new NpgsqlParameter(name, NpgsqlDbType.Bigint) { Value = v };
                    }
                    else if (v is DateTime)
                    {
                        prm = new NpgsqlParameter(name, NpgsqlDbType.Timestamp) { Value = v };
                    }
                    else
                    {
                        prm = new NpgsqlParameter(name, NpgsqlDbType.Unknown) { Value = Php.ToStr(v) };
                    }
                    cmd.Parameters.Add(prm);
                }
            }
        }
    }
}
