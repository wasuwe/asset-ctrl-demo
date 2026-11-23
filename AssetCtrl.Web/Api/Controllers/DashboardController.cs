using System;
using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Repositories;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>Numbers for the public overview, the admin dashboard and the user home page.</summary>
    public class DashboardController : ApiController
    {
        public override void Before()
        {
            // publicView is open to everyone; the others check inside.
        }

        /// <summary>GET dashboard — organisation-wide totals, no sign-in needed.</summary>
        public void PublicView()
        {
            Respond(Merge(
                new Row { { "generated_at", Database.Now() } },
                Shape(DashboardData.Build(Db, null))
            ));
        }

        /// <summary>GET admin/dashboard</summary>
        public void Admin()
        {
            RequireAdmin();
            var tickets = new TicketRepository(Db);
            var mine = tickets.Search(new Row { { "view", "mine" } }, Auth, 1, 8);

            // "Needs attention": each number matches the list its link opens.
            var room = tickets.InRepairRoom();
            int overdueDays = Math.Max(1, AppConfig.RoomOverdueDays);
            DateTime limit = Database.NowDate().AddDays(-overdueDays);
            int readyOut = 0;
            int overdue = 0;
            foreach (var r in room)
            {
                if (r.Str("status") == "resolved" || r.Str("status") == "closed")
                {
                    readyOut++;
                }
                else if (ParseTime(r.Str("received_at")) < limit)
                {
                    overdue++;
                }
            }
            var urgent = tickets.Search(new Row { { "view", "open" }, { "priority", "urgent" } }, Auth, 1, 1);
            var unassigned = tickets.Search(new Row { { "view", "unassigned" } }, Auth, 1, 1);

            Respond(Merge(
                new Row { { "generated_at", Database.Now() } },
                Shape(DashboardData.Build(Db, null)),
                new Row
                {
                    { "my_tickets", mine["rows"] },
                    { "workload", tickets.Workload() },
                    { "in_room", room.Count },
                    { "attention", new Row
                        {
                            { "urgent", ((Paginator)urgent["pager"]).Total },
                            { "unassigned", ((Paginator)unassigned["pager"]).Total },
                            { "ready_out", readyOut },
                            { "overdue", overdue },
                            { "overdue_days", overdueDays },
                        }
                    },
                    { "recent_changes", new HistoryRepository(Db).Recent(Auth, 10) },
                }
            ));
        }

        /// <summary>GET user/home — limited to the user's Work Centers.</summary>
        public void UserHome()
        {
            RequireLogin();
            if (Auth.IsAdmin())
            {
                Forbidden("Admins use the admin dashboard.");
            }
            var tickets = new TicketRepository(Db);
            var open = tickets.Search(new Row { { "view", "open" } }, Auth, 1, 6);
            var data = Shape(DashboardData.Build(Db, Auth));

            // "Needs attention" for staff: devices still to bring to the Setting Room, and repaired devices.
            var allOpen = tickets.Search(new Row { { "view", "open" } }, Auth, 1, 500);
            int toBring = 0;
            foreach (var r in (List<Row>)allOpen["rows"])
            {
                if (!r.Empty("asset_id") && r.Empty("received_at"))
                {
                    toBring++;
                }
            }
            var repaired = tickets.Search(new Row { { "view", "resolved" } }, Auth, 1, 1);

            Respond(new Row
            {
                { "by_status", data["by_status"] },
                { "matrix", data["matrix"] },
                { "open_tickets", open["rows"] },
                { "open_total", ((Paginator)open["pager"]).Total },
                { "attention", new Row
                    {
                        { "to_bring", toBring },
                        { "repaired", ((Paginator)repaired["pager"]).Total },
                    }
                },
            });
        }

        /// <summary>Convert DashboardData output into JSON-friendly snake_case lists.</summary>
        private static Row Shape(Row d)
        {
            var matrix = new List<Row>();
            foreach (var kv in (Row)d["matrix"])
            {
                var row = (Row)kv.Value;
                int total = row.Int("_total");
                var byStatus = new Row(); // (object) $row without '_total'
                foreach (var cell in row)
                {
                    if (cell.Key != "_total") byStatus[cell.Key] = cell.Value;
                }
                matrix.Add(new Row { { "type", kv.Key }, { "total", total }, { "by_status", byStatus } });
            }
            var s = (Row)d["ticketSummary"];
            var byStatusCounts = new Row(); // (object) array_map('intval', ...)
            foreach (var kv in (Row)d["byStatus"])
            {
                byStatusCounts[kv.Key] = Php.ToInt(kv.Value);
            }
            return new Row
            {
                { "by_status", byStatusCounts },
                { "matrix", matrix },
                { "locations", d["locations"] },
                { "work_centers", d["workCenters"] },
                { "ticket_summary", new Row
                    {
                        { "open_count", Php.ToInt(s.Get("open_count", 0)) },
                        { "new_count", Php.ToInt(s.Get("new_count", 0)) },
                        { "urgent", Php.ToInt(s.Get("urgent", 0)) },
                        { "closed_30d", Php.ToInt(s.Get("closed_30d", 0)) },
                        { "avg_minutes", Php.ToDouble(s.Get("avg_minutes", 0)) },
                    }
                },
            };
        }

        /// <summary>array_merge of string-keyed arrays: later keys overwrite, order kept.</summary>
        private static Row Merge(params Row[] parts)
        {
            var o = new Row();
            foreach (var part in parts)
            {
                foreach (var kv in part) o[kv.Key] = kv.Value;
            }
            return o;
        }

        /// <summary>strtotime(): unparseable / empty -> the epoch (PHP false compares as 0).</summary>
        private static DateTime ParseTime(string value)
        {
            DateTime t;
            return DateTime.TryParse(value, Php.Inv, System.Globalization.DateTimeStyles.None, out t) ? t : DateTime.MinValue;
        }
    }
}
