using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using Newtonsoft.Json;

namespace AssetCtrl.Api
{
    /// <summary>
    /// Base class for JSON API controllers (port of App\Api\ApiController).
    ///
    /// Conventions:
    ///  - read input with Request.Input()/Int()/Arr()/File() (JSON bodies already merged)
    ///  - send data with Respond(data) or Ok("Saved", data); both end the action (like PHP's exit)
    ///  - validation problems: throw ValidationException or Fail("...")
    ///  - access: override Before() and call RequireLogin()/RequireAdmin()/RequireAbility()
    /// </summary>
    public abstract class ApiController
    {
        protected AppCtx App;
        protected Request Request;
        protected Database Db;
        protected Auth Auth;
        /// <summary>Matched route, e.g. "admin/assets".</summary>
        protected string Route;

        public void Init(AppCtx app, Request request, string route)
        {
            App = app;
            Request = request;
            Db = app.Db;
            Auth = app.Auth;
            Route = route;
        }

        /// <summary>Runs before every action. Default: signed-in user required.</summary>
        public virtual void Before()
        {
            RequireLogin();
        }

        /// <summary>200 { ok: true, data }</summary>
        protected void Respond(object data = null, int status = 200)
        {
            Send(new Row { { "ok", true }, { "data", data } }, status);
        }

        /// <summary>200 { ok: true, message, data } — for successful writes.</summary>
        protected void Ok(string message, object data = null)
        {
            Send(new Row { { "ok", true }, { "message", message }, { "data", data } });
        }

        /// <summary>422 { ok: false, errors }</summary>
        protected void Fail(IEnumerable<string> errors, int status = 422)
        {
            Send(new Row { { "ok", false }, { "errors", errors.ToList() } }, status);
        }

        protected void Fail(string error, int status = 422)
        {
            Fail(new[] { error }, status);
        }

        protected void NotFound(string message = "Not found")
        {
            throw new ApiException(404, message, "not_found");
        }

        protected void Forbidden(string message = "You do not have permission to do this.")
        {
            throw new ApiException(403, message, "forbidden");
        }

        private void Send(Row body, int status = 200)
        {
            // Every outgoing message is translated here (X-Lang header), so services keep plain English.
            if (body.Get("message") is string msg)
            {
                body["message"] = Lang.T(msg);
            }
            if (body.Get("errors") is List<string> errors)
            {
                body["errors"] = Lang.All(errors);
            }
            Kernel.WriteJson(App.Http, status, body);
            throw new ResponseSentException();
        }

        /// <summary>Standard list payload: { rows, pager }.</summary>
        protected Row Paged(IEnumerable<Row> rows, Paginator p)
        {
            return new Row { { "rows", rows.ToList() }, { "pager", Pager(p) } };
        }

        public static Row Pager(Paginator p)
        {
            return new Row
            {
                { "total", p.Total }, { "page", p.Page }, { "pages", p.Pages },
                { "per_page", p.PerPage }, { "from", p.From() }, { "to", p.To() },
            };
        }

        protected void RequireLogin()
        {
            if (!Auth.Check())
            {
                throw new ApiException(401, "Please sign in first.", "auth");
            }
            var user = Auth.User();
            if (user.Int("must_change_password") != 0 && Route != "session" && Route != "account/password" && Route != "logout")
            {
                throw new ApiException(403, "Please set a new password before using the system.", "password_change");
            }
        }

        protected void RequireAdmin()
        {
            RequireLogin();
            if (!Auth.IsAdmin())
            {
                Forbidden("This is for admins only.");
            }
        }

        protected void RequireAbility(string ability)
        {
            RequireLogin();
            if (!Auth.Can(ability))
            {
                Forbidden();
            }
        }

        /// <summary>(object) cast of PHP: an empty map serialises as {} not [].</summary>
        protected static object Obj(IDictionary<string, object> map)
        {
            return map ?? new Row();
        }

        protected static string Json(object o)
        {
            return JsonConvert.SerializeObject(o);
        }
    }
}
