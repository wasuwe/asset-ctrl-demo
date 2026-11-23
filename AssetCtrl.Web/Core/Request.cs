using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using Newtonsoft.Json.Linq;

namespace AssetCtrl.Core
{
    /// <summary>
    /// Request input (port of the PHP Request class).
    /// Query and body values are strings, or List&lt;object&gt; / Row for arrays ("ids[]" or JSON arrays/objects),
    /// exactly as PHP's $_GET / $_POST would hold them. JSON bodies are converted the same way the PHP
    /// kernel did: scalars become strings, booleans "1"/"0", null "".
    /// </summary>
    public class Request
    {
        private readonly HttpRequest _http;
        private readonly Row _get;
        private Row _post;

        public Request(HttpRequest http)
        {
            _http = http;
            _get = FromCollection(http.QueryString);
            string type = http.ContentType ?? "";
            if (type.IndexOf("application/json", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                _post = new Row();
            }
            else
            {
                _post = FromCollection(http.Form);
            }
        }

        /// <summary>Merge a JSON body into the POST data (called by the kernel).</summary>
        public void ReadJsonBody()
        {
            string type = _http.ContentType ?? "";
            if (type.IndexOf("application/json", StringComparison.OrdinalIgnoreCase) < 0) return;
            string raw;
            _http.InputStream.Position = 0;
            using (var reader = new System.IO.StreamReader(_http.InputStream, System.Text.Encoding.UTF8))
            {
                raw = reader.ReadToEnd();
            }
            if (string.IsNullOrEmpty(raw)) return;
            JToken token;
            try
            {
                token = JToken.Parse(raw);
            }
            catch (Exception)
            {
                throw new ApiException(400, "Request body is not valid JSON.", "bad_json");
            }
            var obj = token as JObject;
            if (obj == null)
            {
                throw new ApiException(400, "Request body is not valid JSON.", "bad_json");
            }
            _post = (Row)Stringify(obj);
        }

        private static object Stringify(JToken t)
        {
            switch (t.Type)
            {
                case JTokenType.Object:
                    var row = new Row();
                    foreach (var p in ((JObject)t).Properties()) row[p.Name] = Stringify(p.Value);
                    return row;
                case JTokenType.Array:
                    return ((JArray)t).Select(Stringify).ToList();
                case JTokenType.Boolean:
                    return t.Value<bool>() ? "1" : "0";
                case JTokenType.Null:
                case JTokenType.Undefined:
                    return "";
                case JTokenType.Float:
                    return t.Value<double>().ToString("R", Php.Inv);
                default:
                    return Convert.ToString(((JValue)t).Value, Php.Inv);
            }
        }

        /// <summary>"ids[]=1&amp;ids[]=2" -> ids: ["1","2"]; "a[b]=1" -> a: {b: "1"}.</summary>
        private static Row FromCollection(System.Collections.Specialized.NameValueCollection c)
        {
            var row = new Row();
            foreach (string rawKey in c.AllKeys)
            {
                if (rawKey == null) continue;
                var values = c.GetValues(rawKey) ?? new string[0];
                if (rawKey.EndsWith("[]", StringComparison.Ordinal))
                {
                    string key = rawKey.Substring(0, rawKey.Length - 2);
                    object existing;
                    var list = row.TryGetValue(key, out existing) && existing is List<object> l ? l : new List<object>();
                    list.AddRange(values);
                    row[key] = list;
                }
                else if (rawKey.Contains("[") && rawKey.EndsWith("]", StringComparison.Ordinal))
                {
                    int i = rawKey.IndexOf('[');
                    string key = rawKey.Substring(0, i);
                    string sub = rawKey.Substring(i + 1, rawKey.Length - i - 2);
                    object existing;
                    var map = row.TryGetValue(key, out existing) && existing is Row r ? r : new Row();
                    map[sub] = values.Length > 0 ? values[values.Length - 1] : "";
                    row[key] = map;
                }
                else
                {
                    row[rawKey] = values.Length > 0 ? values[values.Length - 1] : "";
                }
            }
            return row;
        }

        public string Method()
        {
            return (_http.HttpMethod ?? "GET").ToUpperInvariant();
        }

        public bool IsPost()
        {
            return Method() == "POST";
        }

        private static object Trimmed(object v)
        {
            return v is string s ? s.Trim() : v;
        }

        public object QueryRaw(string key, object def = null)
        {
            return Trimmed(_get.Get(key, def));
        }

        public object PostRaw(string key, object def = null)
        {
            return Trimmed(_post.Get(key, def));
        }

        public object InputRaw(string key, object def = null)
        {
            return _post.ContainsKey(key) ? PostRaw(key, def) : QueryRaw(key, def);
        }

        /// <summary>$request->query(key, default) as string.</summary>
        public string Query(string key, string def = "")
        {
            return Php.ToStr(QueryRaw(key, def));
        }

        public string Post(string key, string def = "")
        {
            return Php.ToStr(PostRaw(key, def));
        }

        public string Input(string key, string def = "")
        {
            var v = InputRaw(key, def);
            return v is string s ? s : (v == null ? def : Php.ToStr(v));
        }

        /// <summary>Raw (untrimmed) POST value, e.g. passwords: (string) array_get($_POST, key, '').</summary>
        public string PostUntrimmed(string key)
        {
            var v = _post.Get(key, "");
            return v is string s ? s : "";
        }

        public int Int(string key, int def = 0)
        {
            var v = InputRaw(key, null);
            if (v == null || !(v is string)) return def;
            string s = (string)v;
            if (s == "" || !Php.IsNumeric(s)) return def;
            return Php.ToInt(s);
        }

        /// <summary>Array input (e.g. checkboxes): always a list of non-empty trimmed strings.</summary>
        public List<string> Arr(string key)
        {
            var v = InputRaw(key, null);
            if (v is List<object> list)
            {
                return list.Select(x => Php.ToStr(x).Trim()).Where(x => x.Length > 0).ToList();
            }
            if (v is Row map)
            {
                return map.Values.Select(x => Php.ToStr(x).Trim()).Where(x => x.Length > 0).ToList();
            }
            string s = v as string;
            if (string.IsNullOrEmpty(s)) return new List<string>();
            return new List<string> { s };
        }

        /// <summary>The whole POST body ($_POST).</summary>
        public Row All()
        {
            return _post;
        }

        public HttpPostedFile File(string key)
        {
            return _http.Files[key];
        }

        public string Ip()
        {
            return _http.UserHostAddress ?? "";
        }

        public string Header(string name)
        {
            return _http.Headers[name] ?? "";
        }
    }
}
