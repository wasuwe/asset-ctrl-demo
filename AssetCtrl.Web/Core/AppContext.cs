using System;
using System.Web;

namespace AssetCtrl.Core
{
    /// <summary>
    /// Per-request container (port of the PHP App class): database, session, auth and CSRF.
    /// One instance per API request; disposed at the end of the request.
    /// </summary>
    public sealed class AppCtx : IDisposable
    {
        public HttpContext Http { get; private set; }
        public Database Db { get; private set; }
        public Session Session { get; private set; }
        public Auth Auth { get; private set; }
        public Csrf Csrf { get; private set; }

        public AppCtx(HttpContext http)
        {
            Http = http;
            Db = new Database(AppConfig.ConnectionString);
            Session = new Session(Db, http);
            Auth = new Auth(Db, Session);
            Csrf = new Csrf(Session);
        }

        public void Dispose()
        {
            Db.Dispose();
        }
    }
}
