using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;

namespace AssetCtrl.Models
{
    /// <summary>
    /// Two roles:
    ///  admin – IT team: everything. "can_repair" marks who can be assigned repair jobs.
    ///  user  – department staff: assets of their Work Centers, limited edits, open and follow repair tickets.
    /// </summary>
    public static class Role
    {
        public const string Admin = "admin";
        public const string User = "user";

        public static Row Labels()
        {
            return new Row
            {
                { Admin, "Admin (IT team)" },
                { User, "User (department staff)" },
            };
        }

        public static string Label(string role)
        {
            var l = Labels();
            return l.ContainsKey(role ?? "") ? l.Str(role) : role;
        }

        private static readonly string[] UserAbilities = { "assets.view", "assets.edit", "assets.export", "tickets.create" };

        public static bool Allows(string role, string ability)
        {
            if (role == Admin) return true;
            return role == User && UserAbilities.Contains(ability);
        }

        /// <summary>Area a role lands in after login.</summary>
        public static string Home(string role)
        {
            return role == Admin ? "admin/dashboard" : "user/home";
        }
    }

    /// <summary>Asset status codes: code => [label, tone].</summary>
    public static class AssetStatus
    {
        public const string Unknown = "";

        public static List<KeyValuePair<string, string[]>> All()
        {
            return new List<KeyValuePair<string, string[]>>
            {
                Kv("USE", "In use", "ok"),
                Kv("SPARE", "Spare", "info"),
                Kv("STOCK", "In stock", "neutral"),
                Kv("REPAIR", "In repair", "warn"),
                Kv("FAIL", "Broken", "bad"),
                Kv("DISPOSE", "Disposed", "muted"),
                Kv("LOST", "Lost", "lost"),
            };
        }

        internal static KeyValuePair<string, string[]> Kv(string code, string label, string tone)
        {
            return new KeyValuePair<string, string[]>(code, new[] { label, tone });
        }

        public static List<string> Codes()
        {
            return All().Select(kv => kv.Key).ToList();
        }

        public static bool IsValid(string code)
        {
            return code == Unknown || Codes().Contains(code);
        }

        public static string Label(string code)
        {
            var m = All().FirstOrDefault(kv => kv.Key == code);
            return m.Value != null ? m.Value[0] : "Unspecified";
        }

        /// <summary>Normalise legacy spellings.</summary>
        public static string Normalise(object value)
        {
            string v = Php.ToStr(value).Trim().ToUpperInvariant();
            switch (v)
            {
                case "NG": return "FAIL";
                case "DISP": return "DISPOSE";
                case "UNKNOW":
                case "UNKNOWN":
                case "-": return "";
            }
            return v;
        }
    }

    /// <summary>Repair ticket workflow.</summary>
    public static class TicketStatus
    {
        public const string New = "new";
        public const string Assigned = "assigned";
        public const string InProgress = "in_progress";
        public const string Waiting = "waiting_parts";
        public const string Resolved = "resolved";
        public const string Closed = "closed";
        public const string Cancelled = "cancelled";

        public static List<KeyValuePair<string, string[]>> All()
        {
            return new List<KeyValuePair<string, string[]>>
            {
                AssetStatus.Kv(New, "New", "info"),
                AssetStatus.Kv(Assigned, "Assigned", "neutral"),
                AssetStatus.Kv(InProgress, "In progress", "warn"),
                AssetStatus.Kv(Waiting, "Waiting for parts", "warn"),
                AssetStatus.Kv(Resolved, "Resolved", "ok"),
                AssetStatus.Kv(Closed, "Closed", "muted"),
                AssetStatus.Kv(Cancelled, "Cancelled", "muted"),
            };
        }

        public static List<string> Steps()
        {
            return new List<string> { New, Assigned, InProgress, Resolved, Closed };
        }

        public static List<string> OpenStatuses()
        {
            return new List<string> { New, Assigned, InProgress, Waiting };
        }

        public static List<string> ActiveStatuses()
        {
            return new List<string> { New, Assigned, InProgress, Waiting, Resolved };
        }

        public static Row Transitions()
        {
            return new Row
            {
                { New, new List<string> { Assigned, InProgress, Cancelled } },
                { Assigned, new List<string> { InProgress, Waiting, Resolved, Cancelled } },
                { InProgress, new List<string> { Waiting, Resolved } },
                { Waiting, new List<string> { InProgress, Resolved } },
                { Resolved, new List<string> { Closed, InProgress } },
                { Closed, new List<string>() },
                { Cancelled, new List<string>() },
            };
        }

        public static bool CanTransition(string from, string to)
        {
            var t = Transitions();
            return t.ContainsKey(from ?? "") && ((List<string>)t[from]).Contains(to);
        }

        public static string Label(string code)
        {
            var m = All().FirstOrDefault(kv => kv.Key == code);
            return m.Value != null ? m.Value[0] : code;
        }

        /// <summary>Two levels only. Anything else is treated as "normal".</summary>
        public static List<KeyValuePair<string, string[]>> Priorities()
        {
            return new List<KeyValuePair<string, string[]>>
            {
                AssetStatus.Kv("normal", "Normal", "neutral"),
                AssetStatus.Kv("urgent", "Urgent", "bad"),
            };
        }

        public static Row Categories()
        {
            return new Row
            {
                { "hardware", "Hardware" },
                { "software", "Software / OS" },
                { "network", "Network" },
                { "printer", "Printer" },
                { "account", "Account / access" },
                { "other", "Other" },
            };
        }
    }
}
