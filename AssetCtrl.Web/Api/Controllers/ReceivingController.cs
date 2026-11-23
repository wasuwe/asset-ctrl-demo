using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Setting Room (the IT repair room). Scan a device carried up to IT, match it
    /// to its open repair ticket and receive it (Area = repair area, status REPAIR);
    /// or scan a device in the room and send it back out.
    /// </summary>
    public class ReceivingController : ApiController
    {
        public override void Before()
        {
            RequireAdmin();
            RequireAbility("tickets.manage");
        }

        /// <summary>
        /// GET admin/receiving/export -> .xlsx download (not JSON)
        ///   sheet 1: devices waiting in the repair queue now, in queue order
        ///   sheet 2: devices repaired and waiting to be collected (still in the room, not sent out)
        /// Headers follow the user's language (?lang=); this report is not meant for re-import.
        /// </summary>
        public void Export()
        {
            if (!XlsxWriter.Available())
            {
                Fail("The server does not have the PHP \"zip\" extension enabled.");
            }
            var repo = new TicketRepository(Db);
            Func<string[], List<string>> h = labels => labels.Select(l => Lang.T(l)).ToList();
            DateTime now = Database.NowDate();
            Func<string, string> hours = since =>
            {
                DateTime d;
                if (string.IsNullOrEmpty(since) || !DateTime.TryParse(since, CultureInfo.InvariantCulture, DateTimeStyles.None, out d))
                {
                    return "";
                }
                double seconds = Math.Max(0, Math.Floor((now - d).TotalSeconds));
                return Math.Round(seconds / 3600, 1, MidpointRounding.AwayFromZero).ToString("0.0", CultureInfo.InvariantCulture);
            };
            Func<string, string> dt = v =>
            {
                DateTime d;
                if (string.IsNullOrEmpty(v) || !DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out d))
                {
                    return "";
                }
                return d.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
            };
            Func<Row, string> wc = t => (t.Str("work_center") + " " + t.Str("work_center_name")).Trim();
            Func<Row, object> who = t => t.Str("reporter_name") != "" ? t.Get("reporter_name") : t.Get("contact_name");

            // Sheet 1: repair queue
            var x = new XlsxWriter(h(new[] { "Queue no.", "IT Asset", "Description", "Work Center", "Ticket no.", "Flowlites",
                "Problem", "Priority", "Ticket status", "Technician", "Received (IN)", "Waiting (hours)", "Original Area", "Reported by", "Contact phone" }),
                Lang.T("Repair queue"));
            foreach (var t in repo.InRepairRoom())
            {
                if (t.Get("queue_no") == null)
                {
                    continue;
                }
                x.AddRow(new object[]
                {
                    t.Int("queue_no"), t.Get("asset_no"), t.Get("asset_description"),
                    wc(t), t.Get("ticket_no"), t.Get("flolites_no"), t.Get("title"),
                    Lang.T(Label(TicketStatus.Priorities(), t.Str("priority"))), Lang.T(TicketStatus.Label(t.Str("status"))),
                    t.Get("assignee_name"), dt(t.Str("received_at")), hours(t.Str("received_at")), t.Get("original_area"), who(t), t.Get("contact_phone"),
                });
            }

            // Sheet 2: repaired, waiting to be collected
            x.AddSheet(Lang.T("Repaired, waiting for pickup"), h(new[] { "IT Asset", "Description", "Work Center", "Ticket no.", "Flowlites",
                "Problem", "What was done", "Technician", "Received (IN)", "Repaired at", "Waiting for pickup (hours)", "Return to Area",
                "Reported by", "Contact phone" }));
            foreach (var t in repo.RepairedWaiting())
            {
                string done = !t.Empty("resolved_at") ? t.Str("resolved_at") : t.Str("closed_at");
                x.AddRow(new object[]
                {
                    t.Get("asset_no"), t.Get("asset_description"), wc(t), t.Get("ticket_no"), t.Get("flolites_no"), t.Get("title"),
                    t.Str("resolution"), t.Get("assignee_name"), dt(t.Str("received_at")), dt(done), hours(done),
                    t.Get("original_area"), who(t), t.Get("contact_phone"),
                });
            }

            string tmp = Path.GetTempFileName();
            byte[] bytes;
            try
            {
                x.Save(tmp);
                bytes = File.ReadAllBytes(tmp);
            }
            finally
            {
                try { File.Delete(tmp); } catch { }
            }
            var response = App.Http.Response;
            response.ClearContent();
            response.StatusCode = 200;
            response.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            response.Charset = "";
            response.AddHeader("Content-Disposition", "attachment; filename=\"setting-room-" + now.ToString("yyyyMMdd-HHmm", CultureInfo.InvariantCulture) + ".xlsx\"");
            response.AddHeader("Content-Length", bytes.Length.ToString(CultureInfo.InvariantCulture));
            // Cache-Control: no-store is already set by the Kernel for every response.
            response.BinaryWrite(bytes);
            throw new ResponseSentException();
        }

        private static string Label(List<KeyValuePair<string, string[]>> list, string code)
        {
            foreach (var kv in list)
            {
                if (kv.Key == code) return kv.Value[0];
            }
            return code;
        }

        /// <summary>
        /// GET admin/receiving ?mode=in|out &amp;scan=
        /// -> { room, mode, scan, matches[] (in), asset (in, no open ticket), out_ticket (out), in_room[] }
        /// </summary>
        public void Index()
        {
            var repo = new TicketRepository(Db);
            string mode = Request.Query("mode", "in") == "out" ? "out" : "in";
            string scan = Php.CleanCode(Request.Query("scan", ""));
            var matches = new List<Row>();
            Row asset = null;
            Row outTicket = null;
            if (scan != "" && mode == "in")
            {
                matches = TicketController.Rows(repo.FindOpenByScan(scan));
                if (matches.Count == 0)
                {
                    var a = new AssetRepository(Db).FindByNo(scan);
                    if (a != null)
                    {
                        asset = new Row
                        {
                            { "id", a.Int("id") },
                            { "asset_no", a.Get("asset_no") },
                            { "description", a.Get("description") },
                            { "work_center", a.Get("work_center") },
                            { "work_center_name", a.Get("work_center_name") },
                            { "area", a.Get("area") },
                            { "status", a.Get("status") },
                        };
                    }
                }
            }
            else if (scan != "")
            {
                var t = repo.FindInRoomByScan(scan);
                outTicket = t != null ? TicketController.Shape(t) : null;
            }
            Respond(new Row
            {
                { "room", AppConfig.RepairArea },
                { "mode", mode },
                { "scan", scan },
                { "matches", matches },
                { "asset", asset },
                { "out_ticket", outTicket },
                { "in_room", TicketController.Rows(repo.InRepairRoom()) },
            });
        }

        /// <summary>POST admin/receiving/receive — body: id (ticket), note</summary>
        public void Receive()
        {
            var ticket = Load();
            new TicketService(Db).Receive(ticket, Auth, Request.Post("note", "").Trim());
            // Receiving (IN) is what gives the device its place in the repair queue.
            var fresh = new TicketRepository(Db).Find(ticket.Long("id"));
            int queue = fresh != null && fresh.Get("queue_no") != null ? fresh.Int("queue_no") : 0;
            Ok(Lang.T("{asset} received. Queue no. {queue}.",
                new Row { { "asset", ticket.Get("asset_no") }, { "queue", queue }, { "ticket", ticket.Get("ticket_no") } }),
                new Row { { "id", ticket.Int("id") }, { "queue_no", queue } });
        }

        /// <summary>POST admin/receiving/send-out — body: id (ticket), area (default: original area), asset_status (default USE), note, close</summary>
        public void SendOut()
        {
            var ticket = Load();
            string status = Request.Post("asset_status", "USE");
            if (status == "" || !AssetStatus.IsValid(status))
            {
                Fail("Choose a valid asset status.");
            }
            new TicketService(Db).SendOut(
                ticket,
                Auth,
                status,
                Request.Post("area", ""),
                Request.Post("note", "").Trim(),
                Request.Post("close") == "1"
            );
            Ok(ticket.Str("asset_no") + " sent out of the Setting Room.", new Row { { "id", ticket.Int("id") } });
        }

        private Row Load()
        {
            var ticket = new TicketRepository(Db).Find(Request.Int("id"));
            if (ticket == null)
            {
                NotFound("Repair ticket not found.");
            }
            return ticket;
        }
    }
}
