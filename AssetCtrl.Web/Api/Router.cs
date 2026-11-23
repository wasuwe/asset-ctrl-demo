using System;
using System.Collections.Generic;

namespace AssetCtrl.Api
{
    /// <summary>Route table: "METHOD route" -> (controller class, action). Port of App\Core\Router.</summary>
    public class Router
    {
        private readonly Dictionary<string, KeyValuePair<string, string>> _routes =
            new Dictionary<string, KeyValuePair<string, string>>(StringComparer.Ordinal);

        public Router Get(string route, string controller, string action)
        {
            _routes["GET " + route] = new KeyValuePair<string, string>(controller, action);
            return this;
        }

        public Router Post(string route, string controller, string action)
        {
            _routes["POST " + route] = new KeyValuePair<string, string>(controller, action);
            return this;
        }

        /// <summary>Every registered route as "METHOD route" -> (controller, action). Used by the tests.</summary>
        public IEnumerable<KeyValuePair<string, KeyValuePair<string, string>>> All()
        {
            return _routes;
        }

        /// <summary>Handler for a route; HEAD falls back to GET. Null when unknown.</summary>
        public KeyValuePair<string, string>? Match(string route, string method)
        {
            KeyValuePair<string, string> h;
            if (method == "HEAD") method = "GET";
            if (_routes.TryGetValue(method + " " + route, out h)) return h;
            return null;
        }
    }
}
