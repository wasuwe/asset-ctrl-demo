using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Hosting;
using Newtonsoft.Json;

namespace AssetCtrl.Core
{
    /// <summary>
    /// Backend translations. Source text is English; App_Data/lang/th.json maps English -> Thai
    /// (generated from the PHP version's lang/th.php).
    ///
    /// Keys are exact strings ("Saved.") or templates with {placeholders} ("Saved {code}."),
    /// so messages built by concatenation are matched as well.
    /// The locale is per request (X-Lang header).
    /// </summary>
    public static class Lang
    {
        [ThreadStatic] private static string _locale;

        private static readonly object Sync = new object();
        private static Dictionary<string, string> _exact;
        private static List<KeyValuePair<Regex, string>> _patterns;

        public static void SetLocale(string locale)
        {
            _locale = locale == "th" ? "th" : "en";
        }

        public static string Locale()
        {
            return _locale ?? "en";
        }

        /// <summary>Translate text; vars fill {placeholders} (also in English).</summary>
        public static string T(string text, IDictionary<string, object> vars = null)
        {
            text = text ?? "";
            string output = text;
            if (Locale() == "th" && text != "")
            {
                output = Lookup(text);
            }
            if (vars != null)
            {
                foreach (var kv in vars)
                {
                    output = output.Replace("{" + kv.Key + "}", Php.ToStr(kv.Value));
                }
            }
            return output;
        }

        public static List<string> All(IEnumerable<string> list)
        {
            return list.Select(s => T(s)).ToList();
        }

        private static string Lookup(string text)
        {
            Load();
            string key = Regex.Replace(text, @"\s+", " ").Trim();
            string found;
            if (_exact.TryGetValue(key, out found)) return found;
            foreach (var p in _patterns)
            {
                var m = p.Key.Match(key);
                if (!m.Success) continue;
                string output = p.Value;
                foreach (string name in p.Key.GetGroupNames())
                {
                    int n;
                    if (int.TryParse(name, out n)) continue;
                    output = output.Replace("{" + name + "}", m.Groups[name].Value);
                }
                return output;
            }
            return text;
        }

        private static void Load()
        {
            if (_exact != null) return;
            lock (Sync)
            {
                if (_exact != null) return;
                var exact = new Dictionary<string, string>(StringComparer.Ordinal);
                var patterns = new List<KeyValuePair<Regex, string>>();
                string file = HostingEnvironment.MapPath("~/App_Data/lang/th.json");
                var dict = file != null && File.Exists(file)
                    ? JsonConvert.DeserializeObject<Dictionary<string, string>>(File.ReadAllText(file))
                    : new Dictionary<string, string>();
                foreach (var kv in dict)
                {
                    string en = Regex.Replace(kv.Key, @"\s+", " ").Trim();
                    if (!en.Contains("{"))
                    {
                        exact[en] = kv.Value;
                        continue;
                    }
                    // "Saved {code}." -> ^Saved (?<code>.+?)\.$
                    string re = Regex.Escape(en);
                    re = Regex.Replace(re, @"\\\{(\w+)}", "(?<$1>.+?)");
                    patterns.Add(new KeyValuePair<Regex, string>(new Regex("^" + re + "$", RegexOptions.Singleline), kv.Value));
                }
                // Longer templates first so the most specific one wins.
                patterns = patterns.OrderByDescending(p => p.Key.ToString().Length).ToList();
                _patterns = patterns;
                _exact = exact;
            }
        }
    }
}
