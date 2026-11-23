using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Web;
using AssetCtrl.Core;
using Newtonsoft.Json;

namespace AssetCtrl.Api
{
    /// <summary>
    /// JSON API front controller: api.ashx?r=&lt;route&gt; (port of App\Api\Kernel / public/api.php).
    ///
    /// Every response is JSON:
    ///   success  { "ok": true,  "data": ..., "message": "..." }
    ///   failure  { "ok": false, "errors": ["..."], "code": "..." }  with an HTTP status
    ///
    /// Authentication uses the session cookie (HttpOnly). POST requests must send the CSRF
    /// token from GET session in the X-CSRF-Token header (or a "_token" field for multipart uploads).
    /// Request bodies may be JSON (application/json) or form data.
    /// </summary>
    public class Kernel : IHttpHandler
    {
        private static readonly Router Router = Routes.Build();

        private static readonly JsonSerializerSettings JsonSettings = new JsonSerializerSettings
        {
            StringEscapeHandling = StringEscapeHandling.Default,
            DateFormatString = "yyyy-MM-dd HH:mm:ss",
        };

        public bool IsReusable { get { return true; } }

        public void ProcessRequest(HttpContext http)
        {
            http.Response.ContentType = "application/json";
            http.Response.Charset = "utf-8";
            http.Response.AddHeader("Cache-Control", "no-store");
            http.Response.AddHeader("X-Content-Type-Options", "nosniff");

            string lang = http.Request.Headers["X-Lang"];
            if (string.IsNullOrEmpty(lang)) lang = http.Request.QueryString["lang"] ?? "en"; // ?lang= for file downloads
            Lang.SetLocale(lang);

            using (var app = new AppCtx(http))
            {
                try
                {
                    // Inside the try: reading the form of an over-sized upload throws (maxRequestLength).
                    var request = new Request(http.Request);
                    request.ReadJsonBody();
                    app.Session.Start();
                    string route = (request.Query("r", "") ?? "").Trim();
                    var handler = Router.Match(route, request.Method());
                    if (handler == null)
                    {
                        throw new Core.HttpException(404, "Unknown API route: " + route);
                    }
                    if (request.IsPost() && !app.Csrf.Validate(CsrfToken(http, request)))
                    {
                        throw new ApiException(419, "Your session expired. Reload the page and try again.", "csrf");
                    }
                    Dispatch(app, request, route, handler.Value.Key, handler.Value.Value);
                    // An action that returns without responding sends an empty success.
                    WriteJson(http, 200, new Row { { "ok", true }, { "data", null } });
                }
                catch (ResponseSentException)
                {
                    // Response already written by the controller.
                }
                catch (DatabaseUnavailableException ex)
                {
                    System.Diagnostics.Trace.TraceError("[{0:o}] API {1}", DateTime.Now, ex.Message);
                    // With DemoFallback on (default), the code tells the browser app to switch to Demo mode.
                    Error(http, 503, new[] { "The database is not available." }, AppConfig.DemoFallback ? "db_unavailable" : null);
                }
                catch (ApiException ex)
                {
                    Error(http, ex.Status, new[] { ex.Message }, ex.Code);
                }
                catch (ValidationException ex)
                {
                    Error(http, 422, ex.Errors);
                }
                catch (Core.HttpException ex)
                {
                    Error(http, ex.Status, new[] { ex.Message });
                }
                catch (System.Web.HttpException ex) when (ex.WebEventCode == System.Web.Management.WebEventCodes.RuntimeErrorPostTooLarge
                    || (ex.Message ?? "").IndexOf("Maximum request length", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    Error(http, 413, new[] { "The file is too large." });
                }
                catch (Exception ex)
                {
                    var inner = ex is TargetInvocationException && ex.InnerException != null ? ex.InnerException : ex;
                    System.Diagnostics.Trace.TraceError("[{0:o}] API {1}: {2}\n{3}", DateTime.Now, inner.GetType().Name, inner.Message, inner.StackTrace);
                    string message = AppConfig.Debug ? inner.GetType().Name + ": " + inner.Message : "Internal error. The IT team has been notified.";
                    Error(http, 500, new[] { message });
                }
                finally
                {
                    try { if (!app.Db.Unavailable) app.Session.Save(); }
                    catch (Exception ex) { System.Diagnostics.Trace.TraceError("Session save failed: " + ex.Message); }
                }
            }
        }

        private static void Dispatch(AppCtx app, Request request, string route, string controllerName, string action)
        {
            var type = Type.GetType("AssetCtrl.Api.Controllers." + controllerName);
            if (type == null)
            {
                throw new ApiException(501, "This part is not available in the .NET version yet: " + route, "not_ported");
            }
            string methodName = char.ToUpperInvariant(action[0]) + action.Substring(1);
            var method = type.GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            if (method == null)
            {
                throw new ApiException(501, "This part is not available in the .NET version yet: " + route, "not_ported");
            }
            var controller = (ApiController)Activator.CreateInstance(type);
            controller.Init(app, request, route);
            controller.Before();
            try
            {
                method.Invoke(controller, null);
            }
            catch (TargetInvocationException ex) when (ex.InnerException != null)
            {
                System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(ex.InnerException).Throw();
            }
        }

        private static string CsrfToken(HttpContext http, Request request)
        {
            string h = http.Request.Headers["X-CSRF-Token"];
            if (!string.IsNullOrEmpty(h)) return h;
            return request.Post("_token");
        }

        public static void Error(HttpContext http, int status, IEnumerable<string> errors, string code = null)
        {
            var body = new Row { { "ok", false }, { "errors", Lang.All(errors) } };
            if (code != null) body["code"] = code;
            WriteJson(http, status, body);
        }

        public static void WriteJson(HttpContext http, int status, object body)
        {
            http.Response.ClearContent();
            http.Response.StatusCode = status;
            http.Response.TrySkipIisCustomErrors = true;
            http.Response.ContentType = "application/json";
            http.Response.Charset = "utf-8";
            http.Response.Write(JsonConvert.SerializeObject(body, JsonSettings));
        }
    }
}
