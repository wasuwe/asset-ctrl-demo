using System;
using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Models;

namespace AssetCtrl.Core
{
    /// <summary>Authentication, login throttling and permission checks.</summary>
    public class Auth
    {
        public const int MaxFailed = 5;
        public const int LockMinutes = 15;

        /// <summary>Hash used to spend comparable time when the user does not exist.</summary>
        private const string DummyHash = "$2y$10$GsffY7kxa6tJpOc7gk3TD.uWmTpvOLjEzSyaCIG0dkOUL5yGTMY4S";

        private readonly Database _db;
        private readonly Session _session;
        private Row _user;
        private bool _loaded;
        private List<int> _wcIds;

        public Auth(Database db, Session session)
        {
            _db = db;
            _session = session;
        }

        public class AttemptResult
        {
            public bool Ok;
            public string Message;
        }

        public AttemptResult Attempt(string empCode, string password)
        {
            empCode = Php.CleanCode(empCode);
            var user = _db.One("SELECT * FROM users WHERE emp_code = :c", new Row { { "c", empCode } });
            var generic = new AttemptResult { Ok = false, Message = "Incorrect employee code or password." };

            if (user == null)
            {
                Passwords.Verify(password, DummyHash);
                return generic;
            }
            if (user.Int("is_active") == 0)
            {
                return new AttemptResult { Ok = false, Message = "This account is disabled. Please contact the administrator." };
            }
            if (!user.Empty("locked_until"))
            {
                DateTime until;
                if (DateTime.TryParse(user.Str("locked_until"), Php.Inv, System.Globalization.DateTimeStyles.None, out until) && until > Database.NowDate())
                {
                    int mins = (int)Math.Ceiling((until - Database.NowDate()).TotalSeconds / 60);
                    return new AttemptResult { Ok = false, Message = "Too many failed sign-ins. The account is locked; try again in " + mins + " min." };
                }
            }
            if (!Passwords.Verify(password, user.Str("password_hash")))
            {
                int failed = user.Int("failed_logins") + 1;
                var data = new Row { { "failed_logins", failed } };
                if (failed >= MaxFailed)
                {
                    data["locked_until"] = Database.NowDate().AddMinutes(LockMinutes).ToString("yyyy-MM-dd HH:mm:ss", Php.Inv);
                    data["failed_logins"] = 0;
                }
                _db.Update("users", data, "id = :id", new Row { { "id", user.Int("id") } });
                return generic;
            }

            var update = new Row { { "failed_logins", 0 }, { "locked_until", null }, { "last_login_at", Database.Now() } };
            if (Passwords.NeedsRehash(user.Str("password_hash")))
            {
                update["password_hash"] = Passwords.Hash(password);
            }
            _db.Update("users", update, "id = :id", new Row { { "id", user.Int("id") } });

            _session.Regenerate();
            _session.Set("user_id", user.Int("id"));
            Refresh();
            return new AttemptResult { Ok = true, Message = "" };
        }

        public void Logout()
        {
            _session.Destroy();
            _user = null;
            _loaded = true;
            _wcIds = null;
        }

        /// <summary>Forget cached user data (after the user's row changed).</summary>
        public void Refresh()
        {
            _user = null;
            _loaded = false;
            _wcIds = null;
        }

        public bool Check()
        {
            return User() != null;
        }

        public Row User()
        {
            if (!_loaded)
            {
                _loaded = true;
                _user = null;
                int id = Php.ToInt(_session.Get("user_id"));
                if (id > 0)
                {
                    var row = _db.One("SELECT u.* FROM users u WHERE u.id = :id AND u.is_active = 1", new Row { { "id", id } });
                    if (row != null)
                    {
                        _user = row;
                    }
                    else
                    {
                        _session.Forget("user_id");
                    }
                }
            }
            return _user;
        }

        /// <summary>Signed-in user id, or null.</summary>
        public int? Id()
        {
            var u = User();
            return u != null ? u.Int("id") : (int?)null;
        }

        public string Role()
        {
            var u = User();
            return u != null ? u.Str("role") : null;
        }

        public string Name()
        {
            var u = User();
            return u != null ? (u.Str("first_name") + " " + u.Str("last_name")).Trim() : "";
        }

        public bool IsAdmin()
        {
            return Role() == Models.Role.Admin;
        }

        /// <summary>Admins see every Work Center.</summary>
        public bool SeesAll()
        {
            return IsAdmin();
        }

        /// <summary>Work Center ids granted to the user (a user may have many).</summary>
        public List<int> WcIds()
        {
            if (_wcIds == null)
            {
                _wcIds = new List<int>();
                if (Id().HasValue)
                {
                    _wcIds = _db.Column("SELECT work_center_id FROM user_work_centers WHERE user_id = :id", new Row { { "id", Id().Value } })
                        .Select(Php.ToInt).ToList();
                }
            }
            return _wcIds;
        }

        /// <summary>May the current user act on something in this Work Center?</summary>
        public bool CoversWorkCenter(object wcId)
        {
            if (SeesAll()) return true;
            if (wcId == null || Php.ToStr(wcId) == "") return false;
            return WcIds().Contains(Php.ToInt(wcId));
        }

        /// <summary>SQL restricting rows to the user's Work Centers; "1 = 0" when nothing is granted.</summary>
        public string ScopeSql(IDictionary<string, object> p, string wcCol = "wc.id")
        {
            if (WcIds().Count == 0) return "1 = 0";
            return Database.InClause(wcCol, WcIds(), p, "sw");
        }

        public bool Can(string ability)
        {
            return Models.Role.Allows(Role(), ability);
        }
    }

    /// <summary>
    /// bcrypt password hashing, compatible with PHP password_hash()/password_verify()
    /// ($2y$ hashes from the PHP version keep working).
    /// </summary>
    public static class Passwords
    {
        private const int Cost = 10;

        public static string Hash(string password)
        {
            // PHP writes $2y$; BCrypt.Net writes $2a$ by default. Both verify the same way; keep PHP's prefix.
            return BCrypt.Net.BCrypt.HashPassword(password ?? "", Cost).Replace("$2a$", "$2y$");
        }

        public static bool Verify(string password, string hash)
        {
            if (string.IsNullOrEmpty(hash)) return false;
            try
            {
                return BCrypt.Net.BCrypt.Verify(password ?? "", hash);
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static bool NeedsRehash(string hash)
        {
            return string.IsNullOrEmpty(hash) || !hash.StartsWith("$2", StringComparison.Ordinal) || hash.Length < 7
                || hash.Substring(4, 2) != Cost.ToString("00");
        }
    }
}
