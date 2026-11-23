using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;

namespace AssetCtrl.Models
{
    /// <summary>
    /// Metadata for asset columns: labels, who may edit what, legacy CSV order and export column sets.
    /// "work_center" holds the Work Center code (2300); its name comes from the work_centers table.
    /// </summary>
    public static class AssetFields
    {
        public static Row Labels()
        {
            return new Row
            {
                { "asset_no", "IT Asset" },
                { "fix_no", "Fix No." },
                { "asset_type", "Type" },
                { "description", "Description" },
                { "work_center", "Work Center" },
                { "work_center_name", "Work Center Name" },
                { "pc_type", "Type PC" },
                { "location", "Location" },
                { "building", "Building / floor" },
                { "area", "Area" },
                { "remark", "Remark" },
                { "status", "Status" },
                { "os_name", "OS" },
                { "os_version", "OS Version" },
                // Not shown, edited, imported or exported; labels kept so older history entries still read well.
                { "brand", "Brand" },
                { "model", "Model" },
                { "cpu", "CPU" },
                { "ram", "RAM" },
                { "mac_address", "MAC Address" },
                { "last_use", "Last Use" },
                { "editor_note", "Member" },
                { "updated_at", "Last updated" },
                { "updated_by_name", "Updated by" },
                { "department", "Work Center (master sheet)" },
            };
        }

        public static string Label(string field)
        {
            if (field == "_created") return "Created";
            var l = Labels();
            return l.ContainsKey(field) ? l.Str(field) : field;
        }

        /// <summary>Fields a user may change on assets of their Work Centers.</summary>
        public static List<string> UserEditable()
        {
            return new List<string> { "area", "remark", "status", "building", "location" };
        }

        /// <summary>Fields an admin may change.</summary>
        public static List<string> AdminEditable()
        {
            return new List<string>
            {
                "fix_no", "description", "work_center", "pc_type", "location", "building", "area", "remark", "status",
                "os_name", "os_version",
            };
        }

        public static List<string> BulkEditable()
        {
            return new List<string> { "status", "work_center", "location", "building", "area", "remark", "pc_type" };
        }

        /// <summary>Legacy master-sheet order (14 columns, no header). Column 6 is "2300-ICS".</summary>
        public static List<string> LegacyCsvColumns()
        {
            return new List<string>
            {
                "asset_no", "fix_no", "description", "os_name", "os_version", "work_center", "pc_type",
                "location", "building", "area", "remark", "status", "editor_note", "last_use",
            };
        }

        /// <summary>Accepted import headers. Thai aliases stay so legacy Thai sheets still import.</summary>
        public static List<KeyValuePair<string, string[]>> HeaderAliases()
        {
            return new List<KeyValuePair<string, string[]>>
            {
                Kv("asset_no", "asset_no", "asset no", "assetno", "it asset", "it-asset", "it_asset", "asset"),
                Kv("fix_no", "fix_no", "fix no", "fix no.", "fixno", "fixed asset"),
                Kv("description", "description", "descript", "รายละเอียด"),
                Kv("os_name", "os", "os_name", "operatingsystem", "operating system"),
                Kv("os_version", "os_version", "os version"),
                Kv("work_center", "work_center", "work center", "workcenter", "wc", "department", "dept",
                    "แผนก", "work center (ชีตหลัก)", "work center (master sheet)"),
                Kv("pc_type", "pc_type", "type_pc", "type pc"),
                Kv("location", "location"),
                Kv("building", "building", "building / floor", "อาคาร/ชั้น", "อาคาร"),
                Kv("area", "area"),
                Kv("remark", "remark"),
                Kv("status", "status", "สถานะ"),
                Kv("editor_note", "member", "editor", "editor_note", "editor (master sheet)", "ผู้แก้ไข (ชีตหลัก)"),
                Kv("last_use", "last_use", "last use"),
            };
        }

        private static KeyValuePair<string, string[]> Kv(string field, params string[] aliases)
        {
            return new KeyValuePair<string, string[]>(field, aliases);
        }

        public static List<string> Importable()
        {
            return HeaderAliases().Select(kv => kv.Key).ToList();
        }

        /// <summary>Columns an export may contain (every one is read back by Import).</summary>
        public static List<string> Exportable()
        {
            return new List<string>
            {
                "asset_no", "fix_no", "description", "os_name", "os_version", "work_center", "pc_type",
                "building", "location", "area", "remark", "status", "editor_note", "last_use",
            };
        }

        /// <summary>Export presets: key => [label, columns].</summary>
        public static List<KeyValuePair<string, object[]>> ExportPresets()
        {
            return new List<KeyValuePair<string, object[]>>
            {
                new KeyValuePair<string, object[]>("full", new object[] { "All columns (re-importable)", Exportable() }),
            };
        }
    }
}
