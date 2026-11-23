using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;

namespace AssetCtrl.Api
{
    /// <summary>
    /// Labels and enums the browser app needs, defined once here (and in the models) and never
    /// duplicated in JavaScript. Sent with GET session.
    /// </summary>
    public static class Meta
    {
        public static Row Build()
        {
            var labels = new Row();
            foreach (var kv in AssetFields.Labels()) labels[kv.Key] = Lang.T(Php.ToStr(kv.Value));

            return new Row
            {
                { "lang", Lang.Locale() },
                { "app_name", AppConfig.AppName },
                { "org_name", AppConfig.OrgName },
                { "repair_area", AppConfig.RepairArea },
                { "asset_type_labels", AppConfig.AssetTypeLabels },
                { "asset_statuses", Pairs(AssetStatus.All()) },
                { "ticket_statuses", Pairs(TicketStatus.All()) },
                { "ticket_steps", TicketStatus.Steps() },
                { "ticket_open_statuses", TicketStatus.OpenStatuses() },
                { "ticket_transitions", TicketStatus.Transitions() },
                { "priorities", Pairs(TicketStatus.Priorities()) },
                { "roles", Simple(Role.Labels()) },
                { "field_labels", labels },
                { "user_editable", AssetFields.UserEditable() },
                { "admin_editable", AssetFields.AdminEditable() },
                { "bulk_editable", AssetFields.BulkEditable() },
                { "history_sources", Simple(HistoryRepository.SourceLabels()) },
                { "export_presets", Presets() },
            };
        }

        /// <summary>code => [label, tone]  ->  [{code, label, tone}] (keeps order)</summary>
        private static List<Row> Pairs(IEnumerable<KeyValuePair<string, string[]>> all)
        {
            return all.Select(kv => new Row { { "code", kv.Key }, { "label", Lang.T(kv.Value[0]) }, { "tone", kv.Value[1] } }).ToList();
        }

        /// <summary>code => label  ->  [{code, label}]</summary>
        private static List<Row> Simple(Row all)
        {
            return all.Select(kv => new Row { { "code", kv.Key }, { "label", Lang.T(Php.ToStr(kv.Value)) } }).ToList();
        }

        private static List<Row> Presets()
        {
            return AssetFields.ExportPresets()
                .Select(kv => new Row { { "code", kv.Key }, { "label", Lang.T((string)kv.Value[0]) }, { "columns", kv.Value[1] } })
                .ToList();
        }

        private static readonly string[] Abilities =
        {
            "assets.view", "assets.edit", "assets.create", "assets.export", "tickets.create", "tickets.manage",
            "history.view_all", "audit.run", "import.run", "users.manage",
        };

        /// <summary>Public shape of the signed-in user (null when signed out).</summary>
        public static Row User(AppCtx app)
        {
            var auth = app.Auth;
            var u = auth.User();
            if (u == null) return null;
            var wcs = new List<Row>();
            if (!auth.IsAdmin() && auth.WcIds().Count > 0)
            {
                var p = new Row();
                string inSql = Database.InClause("id", auth.WcIds(), p, "w");
                foreach (var w in app.Db.All("SELECT id, code, name FROM work_centers WHERE " + inSql + " ORDER BY code", p))
                {
                    wcs.Add(new Row { { "id", w.Int("id") }, { "code", w.Str("code") }, { "name", w.Str("name") } });
                }
            }
            return new Row
            {
                { "id", u.Int("id") },
                { "emp_code", u.Str("emp_code") },
                { "first_name", u.Str("first_name") },
                { "last_name", u.Str("last_name") },
                { "name", auth.Name() },
                { "email", u.Str("email") },
                { "phone", u.Str("phone") },
                { "role", u.Str("role") },
                { "is_admin", auth.IsAdmin() },
                { "can_repair", u.Int("can_repair") != 0 },
                { "must_change_password", u.Int("must_change_password") != 0 },
                { "work_centers", wcs },
                { "abilities", Abilities.Where(auth.Can).ToList() },
            };
        }
    }
}
