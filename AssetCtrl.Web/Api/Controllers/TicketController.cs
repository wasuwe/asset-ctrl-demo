using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Repair tickets for both areas. Lists, detail, create, status changes,
    /// notes, assignment. What each person may do is enforced by TicketService
    /// (admins manage and close; users report and comment, and may cancel a ticket nobody has taken).
    /// </summary>
    public class TicketController : ApiController
    {
        public override void Before()
        {
            RequireAbility("tickets.create");
        }

        /// <summary>Most tickets one bulk action may change (also the cap for "select all matching the filter").</summary>
        public const int BulkMax = 500;

        /// <summary>
        /// GET admin/tickets ?view=open|mine|unassigned|resolved|done|all &amp;status &amp;priority &amp;assignee &amp;work_center &amp;q
        ///   &amp;period=today|yesterday|7d|30d|month|custom (&amp;from &amp;to for custom, yyyy-MM-dd) &amp;page
        /// </summary>
        public void AdminIndex()
        {
            RequireAdmin();
            var f = AdminFilter(k => Request.Query(k, ""));
            var repo = new TicketRepository(Db);
            var result = repo.Search(f, Auth, System.Math.Max(1, Request.Int("page", 1)));
            var data = Paged(Rows((List<Row>)result["rows"]), (Paginator)result["pager"]);
            data["filters"] = f;
            data["counts"] = repo.ViewCounts(Auth, f);
            data["today"] = repo.TodaySummary();
            data["bulk_max"] = BulkMax;
            data["technicians"] = Technicians(new UserRepository(Db).Technicians());
            data["work_centers"] = Db.All("SELECT id, code, name FROM work_centers ORDER BY code");
            Respond(data);
        }

        /// <summary>
        /// POST admin/tickets/bulk — change many tickets at once.
        /// body: action = assign | priority | close; ids[] or select_all=1 with the list filter (view, status, ...);
        ///       assignee_id (assign, 0 = nobody), priority (priority), note (optional, logged on every ticket).
        /// Each ticket goes through the same rules as the single-ticket forms; one that does not fit is skipped
        /// (with the reason) and the others are still saved.
        /// </summary>
        public void Bulk()
        {
            RequireAdmin();
            string action = Request.Post("action", "");
            if (action != "assign" && action != "priority" && action != "close")
            {
                Fail("Choose what to change.");
            }
            var repo = new TicketRepository(Db);
            List<int> ids;
            if (Request.Post("select_all") == "1")
            {
                ids = repo.SearchIds(AdminFilter(k => Request.Post(k, "")), Auth, BulkMax + 1);
            }
            else
            {
                ids = Request.Arr("ids").Select(Php.ToInt).Where(i => i > 0).Distinct().ToList();
            }
            if (ids.Count == 0)
            {
                Fail("No tickets selected.");
            }
            if (ids.Count > BulkMax)
            {
                Fail(Lang.T("Select at most {n} tickets at a time. Narrow the filter first.", new Row { { "n", BulkMax } }));
            }

            int assigneeId = Request.Int("assignee_id");
            string priority = Request.Post("priority", "");
            string note = Request.Post("note", "");
            if (action == "priority" && !TicketStatus.Priorities().Any(kv => kv.Key == priority))
            {
                Fail("Choose a priority.");
            }

            var svc = new TicketService(Db);
            int done = 0, unchanged = 0;
            var skipped = new List<Row>();
            foreach (int id in ids)
            {
                var ticket = repo.Find(id);
                if (ticket == null) continue;
                try
                {
                    if (action == "assign")
                    {
                        if (ticket.Int("assignee_id") == assigneeId) { unchanged++; continue; }
                        svc.Assign(ticket, assigneeId, Auth, note);
                    }
                    else if (action == "priority")
                    {
                        if (ticket.Str("priority") == priority) { unchanged++; continue; }
                        svc.SetPriority(ticket, Auth, priority);
                    }
                    else
                    {
                        if (ticket.Str("status") == TicketStatus.Closed) { unchanged++; continue; }
                        if (ticket.Str("status") != TicketStatus.Resolved)
                        {
                            throw new ValidationException("Only repaired tickets can be closed here.");
                        }
                        // The device is not sent back here: it stays in the Setting Room until it is sent out.
                        svc.Transition(ticket, TicketStatus.Closed, Auth, note);
                    }
                    done++;
                }
                catch (ValidationException ex)
                {
                    skipped.Add(new Row { { "ticket_no", ticket.Get("ticket_no") }, { "reason", string.Join(" ", Lang.All(ex.Errors)) } });
                }
                catch (HttpException ex)
                {
                    skipped.Add(new Row { { "ticket_no", ticket.Get("ticket_no") }, { "reason", Lang.T(ex.Message) } });
                }
            }
            Ok(Lang.T("{done} tickets updated, {same} already like that, {skipped} skipped.", new Row
                {
                    { "done", done }, { "same", unchanged }, { "skipped", skipped.Count },
                }),
                new Row { { "done", done }, { "unchanged", unchanged }, { "skipped", skipped } });
        }

        /// <summary>List filter of the admin ticket page, from the query string (list) or the POST body (bulk "select all").</summary>
        private static Row AdminFilter(System.Func<string, string> get)
        {
            var views = new[] { "open", "mine", "unassigned", "resolved", "done", "all" };
            string view = get("view").Trim();
            var f = new Row
            {
                { "view", views.Contains(view) ? view : "open" },
                { "status", get("status").Trim() },
                { "priority", get("priority").Trim() },
                { "assignee", get("assignee").Trim() },
                { "work_center", get("work_center").Trim() },
                { "q", get("q").Trim() },
            };
            foreach (var kv in Period(get("period").Trim(), get("from").Trim(), get("to").Trim())) f[kv.Key] = kv.Value;
            return f;
        }

        /// <summary>
        /// Reported-date period -> { period, from, to } (yyyy-MM-dd, inclusive; "" = open-ended).
        /// Presets are counted back from today; custom takes from / to as given (swapped when reversed).
        /// </summary>
        public static Row Period(string period, string from, string to)
        {
            var today = Database.NowDate().Date;
            System.Func<System.DateTime, string> d = x => x.ToString("yyyy-MM-dd", Php.Inv);
            System.Func<string, string> valid = s =>
            {
                System.DateTime parsed;
                return System.Text.RegularExpressions.Regex.IsMatch(s ?? "", @"^\d{4}-\d{2}-\d{2}$")
                    && System.DateTime.TryParseExact(s, "yyyy-MM-dd", Php.Inv, System.Globalization.DateTimeStyles.None, out parsed) ? s : "";
            };
            switch (period)
            {
                case "today":
                    return new Row { { "period", period }, { "from", d(today) }, { "to", d(today) } };
                case "yesterday":
                    return new Row { { "period", period }, { "from", d(today.AddDays(-1)) }, { "to", d(today.AddDays(-1)) } };
                case "7d":
                    return new Row { { "period", period }, { "from", d(today.AddDays(-6)) }, { "to", d(today) } };
                case "30d":
                    return new Row { { "period", period }, { "from", d(today.AddDays(-29)) }, { "to", d(today) } };
                case "month":
                    return new Row { { "period", period }, { "from", d(new System.DateTime(today.Year, today.Month, 1)) }, { "to", d(today) } };
                case "custom":
                    from = valid(from);
                    to = valid(to);
                    if (from != "" && to != "" && string.CompareOrdinal(from, to) > 0)
                    {
                        var tmp = from; from = to; to = tmp;
                    }
                    return new Row { { "period", period }, { "from", from }, { "to", to } };
            }
            return new Row { { "period", "" }, { "from", "" }, { "to", "" } };
        }

        /// <summary>GET user/tickets ?view=open|resolved|reported|done|all &amp;q &amp;page</summary>
        public void UserIndex()
        {
            var f = new Row
            {
                { "view", View(new[] { "open", "resolved", "reported", "done", "all" }) },
                { "q", Request.Query("q", "").Trim() },
            };
            var repo = new TicketRepository(Db);
            var result = repo.Search(f, Auth, System.Math.Max(1, Request.Int("page", 1)));
            var data = Paged(Rows((List<Row>)result["rows"]), (Paginator)result["pager"]);
            data["filters"] = f;
            data["counts"] = repo.ViewCounts(Auth);
            // "My repair queue": the user's open tickets with their place in the Setting Room queue
            data["my_queue"] = Rows(repo.OpenWithQueue(Auth));
            data["queue_length"] = repo.QueueLength();
            Respond(data);
        }

        /// <summary>GET tickets/show?id= -> { ticket, events, transitions, can_manage, technicians }</summary>
        public void Show()
        {
            var ticket = Load();
            var repo = new TicketRepository(Db);
            bool manage = Auth.Can("tickets.manage");
            Respond(new Row
            {
                { "ticket", Shape(ticket) },
                { "events", repo.Events(ticket.Long("id")) },
                { "transitions", new TicketService(Db).AllowedTransitions(ticket, Auth) },
                { "can_manage", manage },
                { "technicians", manage ? Technicians(new UserRepository(Db).Technicians()) : new List<Row>() },
            });
        }

        /// <summary>
        /// GET tickets/create-form ?asset_no= | ?asset= (id)
        /// -> { asset, open_for_asset, defaults: {contact_name, contact_phone, location_note} }
        /// </summary>
        public void CreateForm()
        {
            var assets = new AssetRepository(Db);
            Row asset = null;
            if (!Php.IsEmpty(Request.QueryRaw("asset")))
            {
                asset = assets.Find(Request.Int("asset"));
            }
            else if (Request.Query("asset_no", "").Trim() != "")
            {
                asset = assets.FindByNo(Request.Query("asset_no"));
            }
            if (asset != null && !Auth.CoversWorkCenter(asset.Get("work_center_id")))
            {
                asset = null;
            }
            var user = Auth.User();
            Respond(new Row
            {
                { "asset", asset != null ? new Row
                    {
                        { "id", asset.Int("id") },
                        { "asset_no", asset.Get("asset_no") },
                        { "description", asset.Get("description") },
                        { "work_center", asset.Get("work_center") },
                        { "work_center_name", asset.Get("work_center_name") },
                        { "area", asset.Get("area") },
                        { "status", asset.Get("status") },
                    } : null },
                { "open_for_asset", asset != null ? new TicketRepository(Db).OpenForAsset(asset.Long("id")) : new List<Row>() },
                { "defaults", new Row
                    {
                        { "contact_name", Auth.Name() },
                        { "contact_phone", Php.ToStr(user.Get("phone", "")) },
                        { "location_note", asset != null ? asset.Str("area") : "" },
                    } },
            });
        }

        /// <summary>
        /// POST tickets/store — body: flolites_no*, asset_no, title*, symptom*, priority,
        /// location_note, contact_name, contact_phone, receive_now (admin: also receive into the Setting Room).
        /// </summary>
        public void Store()
        {
            var svc = new TicketService(Db);
            var input = Request.All();
            if (Auth.IsAdmin() && Request.Post("receive_now") == "1")
            {
                long rid = svc.CreateAndReceive(input, Auth);
                var rt = new TicketRepository(Db).Find(rid);
                Ok(Lang.T("{ticket} created and {asset} received. Queue no. {queue}.",
                    new Row { { "ticket", rt.Get("ticket_no") }, { "asset", rt.Get("asset_no") }, { "queue", rt.Int("queue_no") } }),
                    new Row { { "id", (int)rid }, { "ticket_no", rt.Get("ticket_no") }, { "received", true }, { "queue_no", rt.Int("queue_no") } });
            }
            long id = svc.Create(input, Auth);
            var t = new TicketRepository(Db).Find(id);
            Ok("Repair ticket " + t.Str("ticket_no") + " submitted.", new Row { { "id", (int)id }, { "ticket_no", t.Get("ticket_no") }, { "received", false } });
        }

        /// <summary>POST tickets/status — body: id, to, note, resolution, asset_status (admin), return_device (admin)</summary>
        public void Status()
        {
            var ticket = Load();
            string to = Request.Post("to", "");
            bool manage = Auth.Can("tickets.manage");
            new TicketService(Db).Transition(ticket, to, Auth, Request.Post("note", "").Trim(), new Row
            {
                { "resolution", Request.PostRaw("resolution", "") },
                { "asset_status", manage ? Request.Post("asset_status", "") : "" },
                { "return_device", manage && Request.Post("return_device") == "1" },
            });
            Ok(Lang.T("Status changed to \"{status}\".", new Row { { "status", Lang.T(TicketStatus.Label(to)) } }),
                new Row { { "id", ticket.Int("id") }, { "status", to } });
        }

        /// <summary>POST tickets/note — body: id, note, asset_status (admin: also change the asset's status)</summary>
        public void Note()
        {
            var ticket = Load();
            var svc = new TicketService(Db);
            string assetStatus = Request.Post("asset_status", "");
            string note = Request.Post("note", "");
            Db.Transaction(() =>
            {
                svc.AddNote(ticket, Auth, note);
                if (assetStatus != "" && Auth.IsAdmin() && !ticket.Empty("asset_id") && AssetStatus.IsValid(assetStatus))
                {
                    svc.ChangeAssetStatus(ticket, assetStatus, Auth);
                }
            });
            Ok("Note added.");
        }

        /// <summary>POST tickets/assign — body: id, assignee_id (0 = nobody), priority, note</summary>
        public void Assign()
        {
            RequireAdmin();
            var ticket = Load();
            var svc = new TicketService(Db);
            int assignee = Request.Int("assignee_id");
            string priority = Request.Post("priority", "");
            string note = Request.Post("note", "");
            Db.Transaction(() =>
            {
                svc.Assign(ticket, assignee, Auth, note);
                if (priority != "")
                {
                    svc.SetPriority(new TicketRepository(Db).Find(ticket.Long("id")), Auth, priority);
                }
            });
            Ok("Assignment saved.");
        }

        /// <summary>POST tickets/take — body: id. The current admin takes the job and starts the repair.</summary>
        public void Take()
        {
            RequireAdmin();
            var ticket = Load();
            new TicketService(Db).Take(ticket, Auth);
            Ok("You took the job.");
        }

        /// <summary>POST tickets/queue-jump — body: id, note (optional reason). Admin moves the device to the front of the queue.</summary>
        public void QueueJump()
        {
            RequireAdmin();
            var ticket = Load();
            new TicketService(Db).QueueJump(ticket, Auth, Request.Post("note", ""));
            // A jump always lands at queue no. 1 (latest jump first); report the actual place anyway.
            var fresh = new TicketRepository(Db).Find(ticket.Long("id"));
            Ok(Lang.T("{asset} moved up the queue: no. {from} → no. {to}.", new Row
                {
                    { "asset", !"".Equals(ticket.Get("asset_no")) ? ticket.Get("asset_no") : ticket.Get("ticket_no") },
                    { "from", ticket.Int("queue_no") }, { "to", fresh.Int("queue_no") },
                }),
                new Row { { "id", ticket.Int("id") }, { "queue_no", fresh.Int("queue_no") } });
        }

        /* ---------------------------------------------------------------- helpers */

        private string View(string[] allowed)
        {
            string v = Request.Query("view", "open");
            return allowed.Contains(v) ? v : "open";
        }

        private Row Load()
        {
            var repo = new TicketRepository(Db);
            var ticket = repo.Find(Request.Int("id"));
            if (ticket == null)
            {
                NotFound("Repair ticket not found.");
            }
            if (!repo.CanView(ticket, Auth))
            {
                Forbidden("This ticket is not in your Work Centers.");
            }
            return ticket;
        }

        private static readonly string[] IntKeys = { "id", "asset_id", "work_center_id", "reporter_id", "assignee_id" };

        /// <summary>Public shape of a ticket row (drops the unused Dept column).</summary>
        public static Row Shape(Row source)
        {
            // Rebuilt rather than Remove()d so the key order stays the same as the PHP array.
            var t = new Row();
            foreach (var kv in source)
            {
                if (kv.Key == "department_id") continue;
                t[kv.Key] = kv.Value;
            }
            foreach (var k in IntKeys)
            {
                if (t.ContainsKey(k) && t[k] != null)
                {
                    t[k] = Php.ToInt(t[k]);
                }
            }
            t["in_room"] = !t.Empty("received_at") && t.Empty("returned_at");
            // Place in the repair queue (null = not in the queue: not received yet, finished or sent out).
            int? queueNo = t.ContainsKey("queue_no") && t["queue_no"] != null ? Php.ToInt(t["queue_no"]) : (int?)null;
            t["queue_no"] = queueNo;
            t["queue_ahead"] = queueNo.HasValue && queueNo.Value != 0 ? queueNo.Value - 1 : (int?)null;
            t["queue_jumped"] = queueNo.HasValue && queueNo.Value != 0 && !t.Empty("queue_jumped");
            t["is_open"] = TicketStatus.OpenStatuses().Contains(t.Get("status") as string);
            return t;
        }

        public static List<Row> Rows(IEnumerable<Row> rows)
        {
            return rows.Select(Shape).ToList();
        }

        private static List<Row> Technicians(IEnumerable<Row> rows)
        {
            var output = new List<Row>();
            foreach (var u in rows)
            {
                output.Add(new Row
                {
                    { "id", u.Int("id") },
                    { "emp_code", u.Get("emp_code") },
                    { "name", (u.Str("first_name") + " " + u.Str("last_name")).Trim() },
                    { "open_count", u.Int("open_count") },
                });
            }
            return output;
        }
    }
}
