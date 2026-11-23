using System;
using System.Collections.Generic;
using System.Web;
using Newtonsoft.Json;

namespace AssetCtrl.Core
{
    /// <summary>
    /// Server-side session stored in PostgreSQL (table app_sessions), keyed by a random id in an
    /// HttpOnly cookie. Replaces the PHP session: survives app-pool recycles, supports
    /// regenerate() on sign-in, and does not serialise parallel requests the way
    /// ASP.NET's own session state does.
    /// </summary>
    public class Session
    {
        public const string CookieName = "assetctrl_sid";

        private readonly Database _db;
        private readonly HttpContext _http;
        private Dictionary<string, object> _data = new Dictionary<string, object>(StringComparer.Ordinal);
        private string _id;
        private string _loadedId;
        private bool _started;

        public Session(Database db, HttpContext http)
        {
            _db = db;
            _http = http;
        }

        public void Start()
        {
            if (_started) return;
            _started = true;

            var cookie = _http.Request.Cookies[CookieName];
            string id = cookie != null ? cookie.Value : null;
            if (!string.IsNullOrEmpty(id) && id.Length == 64)
            {
                var row = _db.One("SELECT data FROM app_sessions WHERE id = :id", new Row { { "id", id } });
                if (row != null)
                {
                    _id = id;
                    _loadedId = id;
                    try
                    {
                        _data = JsonConvert.DeserializeObject<Dictionary<string, object>>(row.Str("data"))
                            ?? new Dictionary<string, object>(StringComparer.Ordinal);
                    }
                    catch (JsonException)
                    {
                        _data = new Dictionary<string, object>(StringComparer.Ordinal);
                    }
                }
            }
            if (_id == null)
            {
                _id = Php.RandomToken(32); // strict mode: never accept an unknown id from the client
            }

            // Idle timeout
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            long idle = AppConfig.SessionIdleMinutes * 60L;
            long last = _data.ContainsKey("_last_seen") ? Php.ToLong(_data["_last_seen"]) : now;
            if (idle > 0 && now - last > idle && _data.ContainsKey("user_id"))
            {
                _data.Clear();
                Regenerate();
            }
            _data["_last_seen"] = now;

            // Occasionally drop sessions idle for more than twice the timeout.
            if (new Random().Next(100) == 0)
            {
                _db.Execute("DELETE FROM app_sessions WHERE last_seen < :t",
                    new Row { { "t", Database.NowDate().AddSeconds(-Math.Max(idle, 3600) * 2) } });
            }
        }

        public object Get(string key, object def = null)
        {
            object v;
            return _data.TryGetValue(key, out v) ? v : def;
        }

        public void Set(string key, object value)
        {
            _data[key] = value;
        }

        public void Forget(string key)
        {
            _data.Remove(key);
        }

        /// <summary>New session id, same data (after sign-in / password change).</summary>
        public void Regenerate()
        {
            _id = Php.RandomToken(32);
        }

        public void Destroy()
        {
            _data.Clear();
            Regenerate();
        }

        /// <summary>Persist the session and send the cookie. Called once at the end of every API request.</summary>
        public void Save()
        {
            if (!_started) return;
            if (_loadedId != null && _loadedId != _id)
            {
                _db.Execute("DELETE FROM app_sessions WHERE id = :id", new Row { { "id", _loadedId } });
            }
            string json = JsonConvert.SerializeObject(_data);
            _db.Execute(
                "INSERT INTO app_sessions (id, data, last_seen) VALUES (:id, :data, :t) " +
                "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, last_seen = EXCLUDED.last_seen",
                new Row { { "id", _id }, { "data", json }, { "t", Database.NowDate() } });
            _loadedId = _id;

            var cookie = new HttpCookie(CookieName, _id)
            {
                HttpOnly = true,
                Path = string.IsNullOrEmpty(_http.Request.ApplicationPath) ? "/" : _http.Request.ApplicationPath,
                Secure = _http.Request.IsSecureConnection,
            };
            _http.Response.Cookies.Set(cookie);
        }
    }
}
