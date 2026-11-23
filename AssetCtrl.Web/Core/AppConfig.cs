using System.Collections.Generic;
using System.Configuration;
using System.Linq;

namespace AssetCtrl.Core
{
    /// <summary>
    /// Settings from Web.config (port of config/config.php).
    ///   connectionStrings: AssetCtrl
    ///   appSettings: AppName, OrgName, TimeZone, Debug, RepairArea, RoomOverdueDays,
    ///                SessionIdleMinutes, AssetTypeLabels ("PCD=PC Desktop;PCN=Notebook")
    /// </summary>
    public static class AppConfig
    {
        public static string Get(string key, string def = "")
        {
            string v = ConfigurationManager.AppSettings[key];
            return string.IsNullOrEmpty(v) ? def : v;
        }

        public static int GetInt(string key, int def)
        {
            int v;
            return int.TryParse(Get(key, ""), out v) ? v : def;
        }

        public static bool Debug
        {
            get { return Get("Debug", "false").ToLowerInvariant() == "true"; }
        }

        public static string ConnectionString
        {
            get
            {
                var cs = ConfigurationManager.ConnectionStrings["AssetCtrl"];
                if (cs == null || string.IsNullOrEmpty(cs.ConnectionString))
                {
                    throw new ConfigurationErrorsException("Connection string \"AssetCtrl\" is missing in Web.config.");
                }
                return cs.ConnectionString;
            }
        }

        /// <summary>When the database cannot be connected, the browser app runs in Demo mode (default true).</summary>
        public static bool DemoFallback
        {
            get { return Get("DemoFallback", "true").ToLowerInvariant() != "false"; }
        }

        public static string AppName { get { return Get("AppName", "Asset Ctrl"); } }
        public static string OrgName { get { return Get("OrgName", ""); } }
        public static string RepairArea { get { return Get("RepairArea", "ICS-SETTING-ROOM"); } }
        public static int RoomOverdueDays { get { return GetInt("RoomOverdueDays", 3); } }
        public static int SessionIdleMinutes { get { return GetInt("SessionIdleMinutes", 240); } }

        /// <summary>Optional friendly names for asset-number prefixes, "PCD=PC Desktop;PCN=Notebook".</summary>
        public static Row AssetTypeLabels
        {
            get
            {
                var o = new Row();
                foreach (var part in Get("AssetTypeLabels", "").Split(';').Select(s => s.Trim()).Where(s => s.Contains("=")))
                {
                    int i = part.IndexOf('=');
                    o[part.Substring(0, i).Trim()] = part.Substring(i + 1).Trim();
                }
                return o;
            }
        }
    }
}
