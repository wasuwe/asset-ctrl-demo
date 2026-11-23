using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using AssetCtrl.Core;
using AssetCtrl.Models;

namespace AssetCtrl.Services
{
    /// <summary>
    /// Search/filter criteria for the asset list. Drives the list, bulk edit
    /// selection and export, so the three always agree.
    ///
    /// SQL aliases expected: a = assets, wc = work_centers.
    /// Visibility: admins see everything; other users only assets whose Work
    /// Center is granted to them (user_work_centers).
    /// </summary>
    public class AssetFilter
    {
        public string Q = "";
        public string Status = "";
        /// <summary>Work Center id (numeric). A non-numeric value is matched as a Work Center code. 'none' = no Work Center.</summary>
        public string WorkCenter = "";
        public string Location = "";
        public string Building = "";
        public string Type = "";
        public string PcType = "";
        public string Os = "";
        public string HasTicket = "";
        /// <summary>Monthly check by the department: 'done' = saved by a User this month (green), 'pending' = not yet (yellow).</summary>
        public string Checked = "";
        public string Sort = "asset_no";
        public string Dir = "asc";

        public static Row Sortable()
        {
            return new Row
            {
                { "asset_no", "a.asset_no" },
                { "asset_type", "a.asset_type" },
                { "fix_no", "a.fix_no" },
                { "description", "a.description" },
                { "os_name", "a.os_name" },
                { "os_version", "a.os_version" },
                { "work_center", "wc.code" },
                { "pc_type", "a.pc_type" },
                { "building", "a.building" },
                { "location", "a.location" },
                { "area", "a.area" },
                { "remark", "a.remark" },
                { "status", "a.status" },
                { "editor_note", "a.editor_note" },
                { "last_use", "a.last_use" },
                { "updated_at", "a.updated_at" },
                { "user_checked_at", "a.user_checked_at" },
            };
        }

        /// <summary>FROM clause shared by every asset query.</summary>
        public static string From()
        {
            return "assets a LEFT JOIN work_centers wc ON wc.id = a.work_center_id";
        }

        public static AssetFilter FromRequest(Request r)
        {
            var f = new AssetFilter();
            f.Q = Php.CleanText(r.Input("q", ""));
            f.Status = r.Input("status", "");
            f.WorkCenter = r.Input("wc", "");
            f.Location = r.Input("location", "");
            f.Building = r.Input("building", "");
            f.Type = r.Input("type", "");
            f.PcType = r.Input("pc_type", "");
            f.Os = r.Input("os", "");
            f.HasTicket = r.Input("has_ticket", "") == "1" ? "1" : "";
            string chk = r.Input("checked", "");
            f.Checked = chk == "done" || chk == "pending" ? chk : "";
            string sort = r.Input("sort", "asset_no");
            f.Sort = Sortable().ContainsKey(sort) ? sort : "asset_no";
            f.Dir = r.Input("dir", "asc").ToLowerInvariant() == "desc" ? "desc" : "asc";
            return f;
        }

        /// <summary>PHP "clone $filter".</summary>
        public AssetFilter Clone()
        {
            return (AssetFilter)MemberwiseClone();
        }

        public Row ToArray()
        {
            return new Row
            {
                { "q", Q },
                { "status", Status },
                { "wc", WorkCenter },
                { "location", Location },
                { "building", Building },
                { "type", Type },
                { "pc_type", PcType },
                { "os", Os },
                { "has_ticket", HasTicket },
                { "checked", Checked },
            };
        }

        public bool IsEmpty()
        {
            foreach (var kv in ToArray())
            {
                if (Php.ToStr(kv.Value) != "")
                {
                    return false;
                }
            }
            return true;
        }

        public int ActiveCount()
        {
            int n = 0;
            foreach (var kv in ToArray())
            {
                if (kv.Key != "q" && Php.ToStr(kv.Value) != "")
                {
                    n++;
                }
            }
            return n;
        }

        public string OrderBy()
        {
            var s = Sortable();
            // NULLS FIRST/LAST keeps MySQL's ordering of NULLs (e.g. no Work Center, never checked).
            string dir = Dir.ToUpperInvariant();
            return s.Str(Sort) + " " + dir + (dir == "ASC" ? " NULLS FIRST" : " NULLS LAST")
                + (Sort != "asset_no" ? ", a.asset_no ASC" : "");
        }

        /// <summary>WHERE clause; non-admins are always limited to their own Work Centers.</summary>
        public string Where(Row p, Auth auth = null)
        {
            var w = new List<string>();

            if (Q != "")
            {
                var words = Regex.Split(Q, @"\s+").Take(6).ToList();
                for (int i = 0; i < words.Count; i++)
                {
                    string n = "q" + i;
                    p[n] = "%" + Database.LikeEscape(words[i]) + "%";
                    w.Add("(a.asset_no ILIKE :" + n + " OR a.fix_no ILIKE :" + n + " OR a.description ILIKE :" + n + " OR a.area ILIKE :" + n
                        + " OR a.remark ILIKE :" + n + " OR wc.code ILIKE :" + n + " OR wc.name ILIKE :" + n + ")");
                }
            }
            if (Status.Contains(","))
            {
                // Several statuses, e.g. "REPAIR,FAIL" from the dashboard's "In repair / broken" card.
                var codes = new List<string>();
                foreach (var raw in Status.Split(','))
                {
                    string code = raw.Trim();
                    if (code == "UNKNOWN")
                    {
                        codes.Add("");
                    }
                    else if (code != "" && AssetStatus.IsValid(code))
                    {
                        codes.Add(code);
                    }
                }
                w.Add(Database.InClause("a.status", codes, p, "st"));
            }
            else if (Status != "")
            {
                w.Add("a.status = :status");
                p["status"] = Status == "UNKNOWN" ? "" : Status;
            }
            if (WorkCenter == "none")
            {
                w.Add("a.work_center_id IS NULL");
            }
            else if (WorkCenter != "" && WorkCenter.All(c => c >= '0' && c <= '9'))
            {
                w.Add("a.work_center_id = :wc");
                p["wc"] = Php.ToInt(WorkCenter);
            }
            else if (WorkCenter != "")
            {
                w.Add("wc.code = :wc");
                p["wc"] = WorkCenter;
            }
            var simple = new[]
            {
                new[] { "location", Location, "a.location" },
                new[] { "building", Building, "a.building" },
                new[] { "type", Type, "a.asset_type" },
                new[] { "pcType", PcType, "a.pc_type" },
                new[] { "os", Os, "a.os_name" },
            };
            foreach (var s in simple)
            {
                if (s[1] != "")
                {
                    w.Add(s[2] + " = :f_" + s[0]);
                    p["f_" + s[0]] = s[1];
                }
            }
            if (HasTicket == "1")
            {
                w.Add("EXISTS (SELECT 1 FROM repair_tickets t WHERE t.asset_id = a.id AND t.status IN ('new','assigned','in_progress','waiting_parts'))");
            }
            if (Checked != "")
            {
                p["month_start"] = AssetService.CheckMonthStart();
                w.Add(Checked == "done"
                    ? "a.user_checked_at >= :month_start"
                    : "(a.user_checked_at IS NULL OR a.user_checked_at < :month_start)");
            }
            if (auth != null && !auth.SeesAll())
            {
                w.Add(auth.ScopeSql(p, "a.work_center_id"));
            }
            return w.Count > 0 ? string.Join(" AND ", w) : "1 = 1";
        }
    }
}
