using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml.Linq;
using AssetCtrl.Core;
using Npgsql;

namespace AssetCtrl.Setup
{
    /// <summary>
    /// Asset Ctrl setup tool (the .NET counterpart of asset_ctrl_v2/scripts/install.php).
    ///
    ///   AssetCtrl.Setup                      menu (run it from Visual Studio or double-click the exe)
    ///   AssetCtrl.Setup check                can it connect? which tables / how many users
    ///   AssetCtrl.Setup schema               create / update the tables (safe to run again)
    ///   AssetCtrl.Setup admin EMP0001 [--first-name Somchai] [--last-name Jaidee] [--reset]
    ///                                        create the first admin (asks for the password), --reset sets a new
    ///                                        password for an existing account and makes it an active admin
    ///   AssetCtrl.Setup demo                 load sample data (DEMO-* assets, Work Centers D100-D300, users, tickets)
    ///
    /// Options for every command:
    ///   --conn "Host=...;Port=...;..."       connection string (default: AssetCtrl.Web\ConnectionStrings.config)
    ///   --config path\ConnectionStrings.config
    /// </summary>
    public static class Program
    {
        public static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            try { Console.InputEncoding = Encoding.UTF8; } catch (IOException) { }
            var opts = Options.Parse(args);
            try
            {
                string conn = ConnectionString(opts);
                if (opts.Command == "")
                {
                    return Menu(conn);
                }
                return Run(opts.Command, opts, conn);
            }
            catch (SetupException ex)
            {
                Error(ex.Message);
                return 1;
            }
        }

        private static int Run(string command, Options opts, string conn)
        {
            switch (command)
            {
                case "check": return Check(conn);
                case "schema": return Schema(conn);
                case "admin": return Admin(conn, opts.Positional.FirstOrDefault() ?? "", opts.Get("first-name"), opts.Get("last-name"), opts.Has("reset"));
                case "demo": return Demo(conn);
                case "help":
                case "-h":
                case "--help":
                case "/?":
                    Help();
                    return 0;
            }
            throw new SetupException("Unknown command \"" + command + "\". Run with --help.");
        }

        /* ------------------------------------------------------------------ menu */

        private static int Menu(string conn)
        {
            Console.WriteLine("Asset Ctrl setup");
            Console.WriteLine("Database: " + Describe(conn));
            while (true)
            {
                Console.WriteLine();
                Console.WriteLine("  1  Check the connection");
                Console.WriteLine("  2  Create / update the tables");
                Console.WriteLine("  3  Create the first admin (or reset an admin password)");
                Console.WriteLine("  4  Load sample data (DEMO-*)");
                Console.WriteLine("  0  Exit");
                Console.Write("Choose: ");
                string c = (Console.ReadLine() ?? "0").Trim();
                try
                {
                    if (c == "1") Check(conn);
                    else if (c == "2") Schema(conn);
                    else if (c == "3")
                    {
                        string code = Ask("Employee code (login)");
                        bool exists = UserExists(conn, code);
                        if (exists && !Confirm("User " + Php.CleanCode(code) + " already exists. Set a new password and make it an active admin?"))
                        {
                            continue;
                        }
                        Admin(conn, code, exists ? "" : Ask("First name", "Administrator"), exists ? "" : Ask("Last name", ""), exists);
                    }
                    else if (c == "4") Demo(conn);
                    else if (c == "0" || c == "") return 0;
                }
                catch (SetupException ex)
                {
                    Error(ex.Message);
                }
            }
        }

        /* --------------------------------------------------------------- commands */

        private static int Check(string conn)
        {
            using (var c = Open(conn))
            {
                Ok("Connected: PostgreSQL " + c.PostgreSqlVersion + ", database \"" + c.Database + "\", user \"" + new NpgsqlConnectionStringBuilder(conn).Username + "\"");
                long tables = Scalar(c, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('users','assets','repair_tickets','app_sessions')");
                if (tables < 4)
                {
                    Warn("The tables are not created yet: run \"schema\" (menu 2).");
                    return 0;
                }
                long users = Scalar(c, "SELECT COUNT(*) FROM users");
                long admins = Scalar(c, "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1");
                long assets = Scalar(c, "SELECT COUNT(*) FROM assets");
                long tickets = Scalar(c, "SELECT COUNT(*) FROM repair_tickets");
                bool trgm = Scalar(c, "SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm'") > 0;
                Console.WriteLine("  Users: " + users + " (active admins: " + admins + ") · Assets: " + assets + " · Repair tickets: " + tickets);
                Console.WriteLine("  Fast ticket search (pg_trgm): " + (trgm ? "on" : "off — the database owner could not install the extension; search still works"));
                if (admins == 0)
                {
                    Warn("No active admin yet: run \"admin <employee code>\" (menu 3).");
                }
            }
            return 0;
        }

        private static int Schema(string conn)
        {
            string sql;
            using (var s = typeof(Program).Assembly.GetManifestResourceStream("schema.pg.sql"))
            using (var r = new StreamReader(s, Encoding.UTF8))
            {
                sql = r.ReadToEnd();
            }
            using (var c = Open(conn))
            {
                // Re-runs report every "already exists, skipping"; show only the notes that matter.
                c.Notice += (o, e) =>
                {
                    if (e.Notice.MessageText.IndexOf("already exists", StringComparison.Ordinal) < 0)
                    {
                        Console.WriteLine("  note: " + e.Notice.MessageText);
                    }
                };
                using (var cmd = new NpgsqlCommand(sql, c))
                {
                    cmd.CommandTimeout = 600;
                    try
                    {
                        cmd.ExecuteNonQuery();
                    }
                    catch (PostgresException ex)
                    {
                        throw new SetupException("Creating the tables failed: " + ex.MessageText
                            + (ex.SqlState == "42501" ? " (the user needs permission to create tables in this database: make it the owner)" : ""));
                    }
                }
            }
            Ok("Tables are ready (existing tables and data were kept).");
            return 0;
        }

        private static int Admin(string conn, string codeRaw, string first, string last, bool reset)
        {
            string code = Php.CleanCode(codeRaw);
            if (code == "")
            {
                throw new SetupException("Give the employee code, e.g.: admin EMP0001");
            }
            if (code.Length > 32)
            {
                throw new SetupException("The employee code may be at most 32 characters.");
            }
            using (var db = new Database(conn))
            {
                RequireTables(db);
                var existing = db.One("SELECT id, first_name FROM users WHERE emp_code = :c", new Row { { "c", code } });
                if (existing != null && !reset)
                {
                    throw new SetupException("User " + code + " already exists. Add --reset to set a new password and make it an active admin.");
                }
                string password = AskPassword(code);
                string now = Database.Now();
                if (existing == null)
                {
                    db.Insert("users", new Row
                    {
                        { "emp_code", code },
                        { "first_name", Php.CleanText(first) != "" ? Php.CleanText(first) : "Administrator" },
                        { "last_name", Php.CleanText(last) },
                        { "role", "admin" },
                        { "can_repair", 1 },
                        { "password_hash", Passwords.Hash(password) },
                        { "must_change_password", 0 },
                        { "is_active", 1 },
                        { "created_at", now },
                        { "updated_at", now },
                    });
                    Ok("Admin " + code + " created. Sign in on the web page with this code and password.");
                }
                else
                {
                    db.Update("users", new Row
                    {
                        { "role", "admin" },
                        { "is_active", 1 },
                        { "password_hash", Passwords.Hash(password) },
                        { "must_change_password", 0 },
                        { "failed_logins", 0 },
                        { "locked_until", null },
                        { "updated_at", now },
                    }, "id = :id", new Row { { "id", existing.Int("id") } });
                    Ok("Password of " + code + " set; the account is an active admin and unlocked.");
                }
            }
            return 0;
        }

        private static int Demo(string conn)
        {
            using (var db = new Database(conn))
            {
                RequireTables(db);
                if (Php.ToInt(db.Value("SELECT COUNT(*) FROM assets WHERE asset_no LIKE 'DEMO-%'")) > 0)
                {
                    Warn("Sample data is already there (DEMO-* assets found): nothing added.");
                    return 0;
                }
                Console.WriteLine("The sample users (DEMO01 user, DEMO02 technician) need a password.");
                string password = AskPassword("the sample users");
                var counts = SampleData.Load(db, password);
                Ok("Sample data added: " + counts);
            }
            return 0;
        }

        /* ---------------------------------------------------------------- helpers */

        /// <summary>--conn, else ConnectionStrings.config (given with --config, or found next to / above the exe).</summary>
        private static string ConnectionString(Options opts)
        {
            if (opts.Has("conn"))
            {
                return opts.Get("conn");
            }
            string file = opts.Has("config") ? opts.Get("config") : FindConfig();
            if (file == null || !File.Exists(file))
            {
                throw new SetupException("ConnectionStrings.config not found. Build AssetCtrl.Web once (it creates the file), "
                    + "or pass --config <path> or --conn \"Host=...;Database=...;Username=...;Password=...\".");
            }
            var add = XDocument.Load(file).Descendants("add").FirstOrDefault(e => (string)e.Attribute("name") == "AssetCtrl");
            string cs = add == null ? null : (string)add.Attribute("connectionString");
            if (string.IsNullOrWhiteSpace(cs))
            {
                throw new SetupException("No connection named \"AssetCtrl\" in " + file + ".");
            }
            return cs;
        }

        private static string FindConfig()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            for (int i = 0; i < 8 && dir != null; i++, dir = dir.Parent)
            {
                foreach (var candidate in new[] { Path.Combine(dir.FullName, "ConnectionStrings.config"), Path.Combine(dir.FullName, "AssetCtrl.Web", "ConnectionStrings.config") })
                {
                    if (File.Exists(candidate)) return candidate;
                }
            }
            return null;
        }

        /// <summary>"localhost:5433 / asset_ctrl_demo as demo_user" — never the password.</summary>
        private static string Describe(string conn)
        {
            try
            {
                var b = new NpgsqlConnectionStringBuilder(conn);
                return b.Host + ":" + b.Port + " / " + b.Database + " as " + b.Username;
            }
            catch (ArgumentException)
            {
                return "(connection string not readable)";
            }
        }

        private static NpgsqlConnection Open(string conn)
        {
            var c = new NpgsqlConnection(conn);
            try
            {
                c.Open();
                return c;
            }
            catch (Exception ex) when (ex is NpgsqlException || ex is System.Net.Sockets.SocketException || ex is TimeoutException || ex is ArgumentException)
            {
                c.Dispose();
                throw new SetupException("Cannot connect to " + Describe(conn) + ": " + (ex.InnerException != null ? ex.InnerException.Message : ex.Message));
            }
        }

        private static long Scalar(NpgsqlConnection c, string sql)
        {
            using (var cmd = new NpgsqlCommand(sql, c))
            {
                return Convert.ToInt64(cmd.ExecuteScalar());
            }
        }

        private static void RequireTables(Database db)
        {
            try
            {
                if (Php.ToInt(db.Value("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'users'")) == 0)
                {
                    throw new SetupException("The tables are not created yet: run \"schema\" first (menu 2).");
                }
            }
            catch (DatabaseUnavailableException ex)
            {
                throw new SetupException(ex.Message);
            }
        }

        private static bool UserExists(string conn, string code)
        {
            using (var db = new Database(conn))
            {
                RequireTables(db);
                return db.Value("SELECT id FROM users WHERE emp_code = :c", new Row { { "c", Php.CleanCode(code) } }) != null;
            }
        }

        /// <summary>Ask twice without showing it; same rules as "change password" on the web page.</summary>
        private static string AskPassword(string forWhom)
        {
            for (int attempt = 0; attempt < 3; attempt++)
            {
                string p1 = ReadHidden("Password for " + forWhom + " (at least 8 characters): ");
                if (Encoding.UTF8.GetByteCount(p1) < 8)
                {
                    Error("The password must be at least 8 characters.");
                    continue;
                }
                if (string.Equals(p1, forWhom, StringComparison.OrdinalIgnoreCase))
                {
                    Error("Do not use the employee code as the password.");
                    continue;
                }
                if (ReadHidden("Type it again: ") != p1)
                {
                    Error("The two passwords do not match.");
                    continue;
                }
                return p1;
            }
            throw new SetupException("No password set.");
        }

        private static string ReadHidden(string prompt)
        {
            Console.Write(prompt);
            if (Console.IsInputRedirected)
            {
                return Console.ReadLine() ?? "";
            }
            var sb = new StringBuilder();
            while (true)
            {
                var k = Console.ReadKey(true);
                if (k.Key == ConsoleKey.Enter) break;
                if (k.Key == ConsoleKey.Backspace)
                {
                    if (sb.Length > 0) { sb.Length--; Console.Write("\b \b"); }
                    continue;
                }
                if (!char.IsControl(k.KeyChar)) { sb.Append(k.KeyChar); Console.Write('*'); }
            }
            Console.WriteLine();
            return sb.ToString();
        }

        private static string Ask(string label, string def = null)
        {
            Console.Write(label + (def != null ? " [" + def + "]" : "") + ": ");
            string v = (Console.ReadLine() ?? "").Trim();
            return v == "" && def != null ? def : v;
        }

        private static bool Confirm(string question)
        {
            Console.Write(question + " (y/N): ");
            return (Console.ReadLine() ?? "").Trim().StartsWith("y", StringComparison.OrdinalIgnoreCase);
        }

        private static void Ok(string s) { Write(ConsoleColor.Green, s); }
        private static void Warn(string s) { Write(ConsoleColor.Yellow, s); }
        private static void Error(string s) { Write(ConsoleColor.Red, s); }

        private static void Write(ConsoleColor color, string s)
        {
            var old = Console.ForegroundColor;
            Console.ForegroundColor = color;
            Console.WriteLine(s);
            Console.ForegroundColor = old;
        }

        private static void Help()
        {
            Console.WriteLine(@"Asset Ctrl setup

  AssetCtrl.Setup                 menu
  AssetCtrl.Setup check           test the connection, show what is in the database
  AssetCtrl.Setup schema          create / update the tables (safe to run again; data is kept)
  AssetCtrl.Setup admin EMP0001 [--first-name Name] [--last-name Name] [--reset]
                                  create the first admin; asks for the password.
                                  --reset: new password for an existing account (also unlocks it)
  AssetCtrl.Setup demo            load sample data (DEMO-* assets, Work Centers D100-D300, users, tickets)

Options:
  --conn ""Host=...;Port=...;Database=...;Username=...;Password=...""
  --config path\ConnectionStrings.config   (default: AssetCtrl.Web\ConnectionStrings.config)");
        }
    }

    public class SetupException : Exception
    {
        public SetupException(string message) : base(message) { }
    }

    /// <summary>command [positional...] [--name value] [--flag]</summary>
    public class Options
    {
        public string Command = "";
        public List<string> Positional = new List<string>();
        private readonly Dictionary<string, string> _named = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private static readonly HashSet<string> Flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "reset" };

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a.StartsWith("--", StringComparison.Ordinal) && a.Length > 2 && a != "--help")
                {
                    string name = a.Substring(2);
                    if (Flags.Contains(name) || i + 1 >= args.Length)
                    {
                        o._named[name] = "1";
                    }
                    else
                    {
                        o._named[name] = args[++i];
                    }
                }
                else if (o.Command == "")
                {
                    o.Command = a.ToLowerInvariant();
                }
                else
                {
                    o.Positional.Add(a);
                }
            }
            return o;
        }

        public bool Has(string name) { return _named.ContainsKey(name); }
        public string Get(string name) { string v; return _named.TryGetValue(name, out v) ? v : ""; }
    }
}
