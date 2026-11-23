using System;
using System.Collections.Generic;
using System.Globalization;

namespace AssetCtrl.Core
{
    /// <summary>
    /// Ordered string-keyed map used for DB rows, request input and JSON payloads
    /// (the PHP associative array of the original code).
    ///
    /// DB rows hold every value as a string (or null), exactly like PDO/MySQL did in the
    /// PHP version, so the JSON the browser receives is the same ("id": "12").
    /// Code that needs a number casts explicitly with Int()/Long(), as the PHP did with (int).
    /// </summary>
    public class Row : Dictionary<string, object>
    {
        public Row() : base(StringComparer.Ordinal) { }

        public Row(IDictionary<string, object> source) : base(source, StringComparer.Ordinal) { }

        /// <summary>Value as string; null/missing -> "" (PHP (string) cast).</summary>
        public string Str(string key)
        {
            object v;
            return TryGetValue(key, out v) ? Php.ToStr(v) : "";
        }

        public int Int(string key)
        {
            object v;
            return TryGetValue(key, out v) ? Php.ToInt(v) : 0;
        }

        public long Long(string key)
        {
            object v;
            return TryGetValue(key, out v) ? Php.ToLong(v) : 0;
        }

        /// <summary>PHP empty(): missing, null, "", "0".</summary>
        public bool Empty(string key)
        {
            object v;
            return !TryGetValue(key, out v) || Php.IsEmpty(v);
        }

        public bool IsNull(string key)
        {
            object v;
            return !TryGetValue(key, out v) || v == null;
        }

        /// <summary>array_get($row, key, default)</summary>
        public object Get(string key, object def = null)
        {
            object v;
            return TryGetValue(key, out v) ? v : def;
        }

        /// <summary>Chainable set: new Row().Set("a", 1).Set("b", 2)</summary>
        public Row Set(string key, object value)
        {
            this[key] = value;
            return this;
        }

        public Row Copy()
        {
            return new Row(this);
        }
    }

    /// <summary>Small PHP-semantics helpers (casts, empty(), text cleaning).</summary>
    public static class Php
    {
        public static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static string ToStr(object v)
        {
            if (v == null) return "";
            if (v is string s) return s;
            if (v is bool b) return b ? "1" : "";
            if (v is DateTime d) return d.ToString("yyyy-MM-dd HH:mm:ss", Inv);
            if (v is IFormattable f) return f.ToString(null, Inv);
            return v.ToString();
        }

        /// <summary>(int) cast: leading integer part of a string, 0 otherwise.</summary>
        public static int ToInt(object v)
        {
            long l = ToLong(v);
            if (l > int.MaxValue) return int.MaxValue;
            if (l < int.MinValue) return int.MinValue;
            return (int)l;
        }

        public static long ToLong(object v)
        {
            if (v == null) return 0;
            if (v is bool b) return b ? 1 : 0;
            if (v is int i) return i;
            if (v is long l) return l;
            if (v is short sh) return sh;
            if (v is decimal m) return (long)m;
            if (v is double dbl) return (long)dbl;
            string s = ToStr(v).Trim();
            int end = 0;
            if (end < s.Length && (s[end] == '-' || s[end] == '+')) end++;
            while (end < s.Length && char.IsDigit(s[end])) end++;
            long r;
            if (end > 0 && long.TryParse(s.Substring(0, end), NumberStyles.AllowLeadingSign, Inv, out r)) return r;
            double d;
            if (double.TryParse(s, NumberStyles.Float, Inv, out d)) return (long)d;
            return 0;
        }

        public static double ToDouble(object v)
        {
            if (v == null) return 0;
            double d;
            return double.TryParse(ToStr(v), NumberStyles.Float, Inv, out d) ? d : 0;
        }

        public static bool IsNumeric(string s)
        {
            double d;
            return !string.IsNullOrWhiteSpace(s) && double.TryParse(s.Trim(), NumberStyles.Float, Inv, out d);
        }

        /// <summary>PHP empty().</summary>
        public static bool IsEmpty(object v)
        {
            if (v == null) return true;
            if (v is string s) return s == "" || s == "0";
            if (v is bool b) return !b;
            if (v is int i) return i == 0;
            if (v is long l) return l == 0;
            if (v is System.Collections.ICollection c) return c.Count == 0;
            return false;
        }

        /// <summary>clean_text(): trim and collapse inner whitespace.</summary>
        public static string CleanText(object value)
        {
            string s = ToStr(value).Trim();
            return System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ");
        }

        /// <summary>clean_code(): clean_text + upper case.</summary>
        public static string CleanCode(object value)
        {
            return CleanText(value).ToUpperInvariant();
        }

        /// <summary>mb_strlen: number of Unicode code points (Thai marks count, like PHP).</summary>
        public static int MbLen(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            int n = 0;
            foreach (char c in s) if (!char.IsLowSurrogate(c)) n++;
            return n;
        }

        /// <summary>mb_substr($s, 0, $n) by code points.</summary>
        public static string MbLeft(string s, int n)
        {
            if (string.IsNullOrEmpty(s)) return "";
            int count = 0;
            for (int i = 0; i < s.Length; i++)
            {
                if (char.IsLowSurrogate(s[i])) continue;
                if (count == n) return s.Substring(0, i);
                count++;
            }
            return s;
        }

        public static string NumberFormat(long n)
        {
            return n.ToString("#,0", Inv);
        }

        public static string RandomToken(int bytes = 32)
        {
            var buf = new byte[bytes];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                rng.GetBytes(buf);
            }
            var sb = new System.Text.StringBuilder(bytes * 2);
            foreach (var b in buf) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        /// <summary>Constant-time string comparison (hash_equals).</summary>
        public static bool HashEquals(string known, string user)
        {
            if (known == null || user == null || known.Length != user.Length) return false;
            int r = 0;
            for (int i = 0; i < known.Length; i++) r |= known[i] ^ user[i];
            return r == 0;
        }
    }
}
