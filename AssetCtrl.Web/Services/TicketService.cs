using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;

namespace AssetCtrl.Services
{
    /// <summary>
    /// Repair ticket workflow: create, assign, move through statuses, notes.
    /// Every action writes a repair_events row so the timeline shows who did what.
    /// </summary>
    public class TicketService
    {
        private readonly Database _db;
        private readonly TicketRepository _tickets;
        private readonly AssetRepository _assets;
        private readonly UserRepository _users;

        public TicketService(Database db)
        {
            _db = db;
            _tickets = new TicketRepository(db);
            _assets = new AssetRepository(db);
            _users = new UserRepository(db);
        }

        private void Event(object ticketId, int? userId, string type, string from = null, string to = null, string note = null)
        {
            _db.Insert("repair_events", new Row
            {
                { "ticket_id", Php.ToInt(ticketId) },
                { "user_id", userId },
                { "event_type", type },
                { "from_value", from },
                { "to_value", to },
                { "note", note == "" ? null : note },
                { "created_at", Database.Now() },
            });
            _db.Update("repair_tickets", new Row { { "updated_at", Database.Now() } }, "id = :id", new Row { { "id", Php.ToInt(ticketId) } });
        }

        /// <summary>strlen(): byte length of the UTF-8 string (Thai characters count 3, like PHP).</summary>
        private static int StrLen(string s)
        {
            return Encoding.UTF8.GetByteCount(s ?? "");
        }

        /// <summary>fmt_datetime(): "12 Nov 2026 14:05" ("—" when empty).</summary>
        private static string FmtDatetime(string value)
        {
            if (string.IsNullOrEmpty(value) || value == "0000-00-00 00:00:00")
            {
                return "—";
            }
            DateTime d;
            if (!DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out d))
            {
                return value;
            }
            return d.ToString("d MMM yyyy HH:mm", CultureInfo.InvariantCulture);
        }

        /// <summary>
        /// Returns the ticket id.
        /// Throws ValidationException.
        /// </summary>
        public long Create(Row input, Auth auth)
        {
            var errors = new List<string>();
            string assetNo = Php.CleanCode(input.Get("asset_no", ""));
            string flolites = Php.CleanCode(input.Get("flolites_no", ""));
            string title = Php.CleanText(input.Get("title", ""));
            string symptom = Php.ToStr(input.Get("symptom", "")).Trim();
            string priority = Php.ToStr(input.Get("priority", "normal"));
            string category = Php.ToStr(input.Get("category", "other")); // the report form no longer asks for a category
            // Contact phone is required but free text (any format: 081-234-5678, ext. 1234, ...).
            string phone = Php.CleanText(input.Get("contact_phone", ""));

            Row asset = null;
            if (assetNo != "")
            {
                asset = _assets.FindByNo(assetNo);
                if (asset != null && !auth.CoversWorkCenter(asset.Get("work_center_id")))
                {
                    errors.Add("Asset " + assetNo + " is not in your Work Centers.");
                }
            }
            if (flolites == "")
            {
                errors.Add("Enter the Flowlites number.");
            }
            else if (StrLen(flolites) > 64)
            {
                errors.Add("The Flowlites number is longer than 64 characters.");
            }
            if (phone == "")
            {
                errors.Add("Enter a contact phone number.");
            }
            else if (StrLen(phone) > 32)
            {
                errors.Add("The contact phone is longer than 32 characters.");
            }
            if (title == "")
            {
                errors.Add("Enter a short title for the problem.");
            }
            if (StrLen(symptom) < 5)
            {
                errors.Add("Describe the problem (at least 5 characters).");
            }
            if (!TicketStatus.Priorities().Any(kv => kv.Key == priority))
            {
                priority = "normal";
            }
            if (!TicketStatus.Categories().ContainsKey(category))
            {
                category = "other";
            }
            if (errors.Count > 0)
            {
                throw new ValidationException(errors);
            }

            var user = auth.User();
            string now = Database.Now();

            return _db.Transaction(() =>
            {
                long id = _db.Insert("repair_tickets", new Row
                {
                    { "asset_id", asset != null ? asset.Int("id") : (int?)null },
                    { "asset_no", assetNo },
                    { "flolites_no", flolites },
                    // The ticket belongs to its asset's Work Center; without an asset only the reporter and admins see it.
                    { "work_center_id", asset != null && !asset.Empty("work_center_id") ? asset.Int("work_center_id") : (int?)null },
                    { "reporter_id", user.Int("id") },
                    { "contact_name", Php.CleanText(input.Get("contact_name", (user.Str("first_name") + " " + user.Str("last_name")).Trim())) },
                    { "contact_phone", phone },
                    { "location_note", Php.CleanText(input.Get("location_note", asset != null ? asset.Get("area") : "")) },
                    { "title", title },
                    { "symptom", symptom },
                    { "category", category },
                    { "priority", priority },
                    { "status", TicketStatus.New },
                    { "created_at", now },
                    { "updated_at", now },
                });
                string no = "RP" + Database.NowDate().ToString("yyMM", CultureInfo.InvariantCulture) + "-" + id.ToString(CultureInfo.InvariantCulture).PadLeft(4, '0');
                _db.Update("repair_tickets", new Row { { "ticket_no", no } }, "id = :id", new Row { { "id", (int)id } });
                LogEvent(id, user.Int("id"), "created", null, TicketStatus.New, null);
                return id;
            });
        }

        /// <summary>
        /// Admin "queue jump": move a device in the Setting Room queue to the front.
        /// Only for tickets currently in the queue and not already first. Logged on the timeline
        /// (event queue_jump, from = old queue number, to = 1) with an optional reason.
        /// </summary>
        public void QueueJump(Row ticket, Auth auth, string note = "")
        {
            if (!auth.IsAdmin())
            {
                throw new ValidationException("Only admins can move a device up the queue.");
            }
            if (ticket.Empty("queue_no"))
            {
                throw new ValidationException("This device is not in the Setting Room queue (it must be received IN first).");
            }
            if (ticket.Int("queue_no") == 1)
            {
                throw new ValidationException("This device is already first in the queue.");
            }
            note = note ?? "";
            Event(ticket.Get("id"), auth.Id(), "queue_jump", ticket.Int("queue_no").ToString(CultureInfo.InvariantCulture), "1",
                Php.CleanText(note) != "" ? note.Trim() : null);
            _db.Update("repair_tickets", new Row { { "updated_at", Database.Now() } }, "id = :id", new Row { { "id", ticket.Int("id") } });
        }

        public void LogEvent(object ticketId, int? userId, string type, string from = null, string to = null, string note = null)
        {
            Event(ticketId, userId, type, from, to, note);
        }

        /// <summary>Assign (or re-assign) a technician. Moves a new ticket to "assigned".</summary>
        public void Assign(Row ticket, int? assigneeIdRaw, Auth auth, string note = "")
        {
            GuardManage(auth);
            int assigneeId = assigneeIdRaw ?? 0;
            var assignee = assigneeId != 0 ? _users.Find(assigneeId) : null;
            if (assigneeId != 0 && (assignee == null || assignee.Empty("is_active") || assignee.Str("role") != "admin"))
            {
                throw new ValidationException("The assignee must be an active admin.");
            }
            string status = ticket.Str("status");
            if (status == TicketStatus.Closed || status == TicketStatus.Cancelled)
            {
                throw new ValidationException("This ticket is already closed.");
            }
            _db.Transaction(() =>
            {
                string now = Database.Now();
                var data = new Row
                {
                    { "assignee_id", assigneeId != 0 ? assigneeId : (int?)null },
                    { "assigned_at", assigneeId != 0 ? now : null },
                };
                string newName = assignee != null ? (assignee.Str("first_name") + " " + assignee.Str("last_name")).Trim() : "";
                LogEvent(ticket.Get("id"), auth.Id(), "assigned", ticket.Empty("assignee_name") ? null : ticket.Str("assignee_name"),
                    Php.IsEmpty(newName) ? null : newName, note);
                if (assigneeId != 0 && status == TicketStatus.New)
                {
                    data["status"] = TicketStatus.Assigned;
                    LogEvent(ticket.Get("id"), auth.Id(), "status", TicketStatus.New, TicketStatus.Assigned, null);
                }
                _db.Update("repair_tickets", data, "id = :id", new Row { { "id", ticket.Int("id") } });
            });
        }

        /// <summary>The current technician takes the job and starts working on it.</summary>
        public void Take(Row ticket, Auth auth)
        {
            GuardManage(auth);
            if (ticket.Int("assignee_id") != (auth.Id() ?? 0))
            {
                Assign(ticket, auth.Id(), auth);
                ticket = _tickets.Find(ticket.Long("id"));
            }
            string status = ticket.Str("status");
            if (status == TicketStatus.New || status == TicketStatus.Assigned || status == TicketStatus.Waiting)
            {
                Transition(ticket, TicketStatus.InProgress, auth, "");
            }
        }

        /// <summary>Which target statuses may the current user move this ticket to?</summary>
        public List<string> AllowedTransitions(Row ticket, Auth auth)
        {
            var all = TicketStatus.Transitions();
            string status = ticket.Str("status");
            var targets = all.ContainsKey(status) ? (List<string>)all[status] : new List<string>();
            var output = new List<string>();
            bool isReporter = ticket.Int("reporter_id") == (auth.Id() ?? 0);
            foreach (var to in targets)
            {
                if (auth.Can("tickets.manage"))
                {
                    if (to == TicketStatus.Assigned)
                    {
                        continue; // handled by the assign form
                    }
                    output.Add(to);
                }
                else if (isReporter || auth.CoversWorkCenter(ticket.Get("work_center_id")))
                {
                    // Users do not confirm or close tickets (IT closes them); they may only cancel a ticket nobody has taken yet.
                    if (status == TicketStatus.New && to == TicketStatus.Cancelled)
                    {
                        output.Add(to);
                    }
                }
            }
            return output;
        }

        /// <summary>
        /// Move a ticket to a new status.
        /// opts: resolution (required for resolved), asset_status (optional asset status change), return_device
        /// </summary>
        public void Transition(Row ticket, string to, Auth auth, string note, Row opts = null)
        {
            opts = opts ?? new Row();
            note = note ?? "";
            string from = ticket.Str("status");
            if (!TicketStatus.CanTransition(from, to))
            {
                throw new ValidationException(Lang.T("Cannot change the status from \"{from}\" to \"{to}\".", new Row
                {
                    { "from", Lang.T(TicketStatus.Label(from)) },
                    { "to", Lang.T(TicketStatus.Label(to)) },
                }));
            }
            if (!AllowedTransitions(ticket, auth).Contains(to) && !(to == TicketStatus.InProgress && auth.Can("tickets.manage")))
            {
                throw new HttpException(403, "You are not allowed to change this ticket to that status.");
            }
            string resolution = Php.ToStr(opts.Get("resolution", "")).Trim();
            if (to == TicketStatus.Resolved && resolution == "")
            {
                throw new ValidationException("Describe what was done / how it was fixed before resolving the ticket.");
            }
            if (from == TicketStatus.Resolved && to == TicketStatus.InProgress && note.Trim() == "")
            {
                throw new ValidationException("Describe what is still wrong so the technician can follow up.");
            }
            if (to == TicketStatus.Cancelled && note.Trim() == "")
            {
                throw new ValidationException("Enter the reason for cancelling.");
            }
            string assetStatus = Php.ToStr(opts.Get("asset_status", ""));
            bool returnDevice = !Php.IsEmpty(opts.Get("return_device", false));
            if (assetStatus != "" && !AssetStatus.IsValid(assetStatus))
            {
                assetStatus = "";
            }

            _db.Transaction(() =>
            {
                string now = Database.Now();
                var data = new Row { { "status", to } };
                if (to == TicketStatus.InProgress && ticket.Empty("started_at"))
                {
                    data["started_at"] = now;
                }
                if (to == TicketStatus.Resolved)
                {
                    data["resolved_at"] = now;
                    data["resolution"] = resolution;
                }
                if (to == TicketStatus.Closed || to == TicketStatus.Cancelled)
                {
                    data["closed_at"] = now;
                }
                if (from == TicketStatus.Resolved && to == TicketStatus.InProgress)
                {
                    data["resolved_at"] = null;
                }
                _db.Update("repair_tickets", data, "id = :id", new Row { { "id", ticket.Int("id") } });
                string eventNote = to == TicketStatus.Resolved ? resolution + (note != "" ? "\n\n" + note : "") : note;
                LogEvent(ticket.Get("id"), auth.Id(), "status", from, to, eventNote);

                bool returning = to == TicketStatus.Closed && returnDevice && !ticket.Empty("received_at") && ticket.Empty("returned_at");
                if (returning)
                {
                    ReturnDevice(ticket, auth, assetStatus != "" ? assetStatus : "USE");
                }
                else if (assetStatus != "" && !ticket.Empty("asset_id"))
                {
                    ChangeAssetStatus(ticket, assetStatus, auth);
                }
            });
        }

        /// <summary>@internal Update the linked asset's status and log it on both sides.</summary>
        public void ChangeAssetStatus(Row ticket, string status, Auth auth)
        {
            var asset = _assets.Find(ticket.Long("asset_id"));
            if (asset == null || asset.Str("status") == status)
            {
                return;
            }
            var svc = new AssetService(_db);
            svc.Update(asset, new Row { { "status", status } }, new[] { "status" }, auth.Id(), "repair", ticket.Long("id"), ticket.Get("ticket_no") as string);
            Event(ticket.Get("id"), auth.Id(), "asset", asset.Get("status") as string, status, null);
        }

        /// <summary>
        /// IT receives the device into the repair room: the asset's Area becomes the
        /// configured repair area and its status REPAIR. The history rows carry the
        /// ticket number, and the original Area is kept on the ticket for the return.
        /// </summary>
        public void Receive(Row ticket, Auth auth, string note = "")
        {
            GuardManage(auth);
            if (ticket.Empty("asset_id"))
            {
                throw new ValidationException("This ticket has no registered asset, so it cannot be received.");
            }
            if (!ticket.Empty("received_at") && ticket.Empty("returned_at"))
            {
                throw new ValidationException("This device was already received into the room on " + FmtDatetime(ticket.Str("received_at")) + ".");
            }
            string status = ticket.Str("status");
            if (status == TicketStatus.Closed || status == TicketStatus.Cancelled)
            {
                throw new ValidationException("This ticket is already closed.");
            }
            var asset = _assets.Find(ticket.Long("asset_id"));
            string room = AssetService.Normalise("area", AppConfig.RepairArea);
            _db.Transaction(() =>
            {
                _db.Update("repair_tickets", new Row
                {
                    { "original_area", asset.Get("area") },
                    { "received_at", Database.Now() },
                    { "returned_at", null },
                }, "id = :id", new Row { { "id", ticket.Int("id") } });
                var svc = new AssetService(_db);
                svc.Update(asset, new Row { { "area", room }, { "status", "REPAIR" } }, new[] { "area", "status" }, auth.Id(),
                    "repair", ticket.Long("id"), ticket.Get("ticket_no") as string);
                LogEvent(ticket.Get("id"), auth.Id(), "received", asset.Get("area") as string, room, note);
            });
        }

        /// <summary>Send the device out of the repair room, by default back to the Area it came from.</summary>
        public void ReturnDevice(Row ticket, Auth auth, string assetStatus = "USE", string area = null, string note = "")
        {
            if (ticket.Empty("asset_id") || ticket.Empty("received_at") || !ticket.Empty("returned_at"))
            {
                throw new ValidationException("This device is not in the Setting Room.");
            }
            var asset = _assets.Find(ticket.Long("asset_id"));
            object target = area == null || area.Trim() == "" ? ticket.Get("original_area") : area;
            var values = new Row { { "area", target } };
            if (assetStatus != "" && AssetStatus.IsValid(assetStatus))
            {
                values["status"] = assetStatus;
            }
            var svc = new AssetService(_db);
            svc.Update(asset, values, values.Keys.ToList(), auth.Id(), "repair", ticket.Long("id"), ticket.Get("ticket_no") as string);
            _db.Update("repair_tickets", new Row { { "returned_at", Database.Now() } }, "id = :id", new Row { { "id", ticket.Int("id") } });
            Event(ticket.Get("id"), auth.Id(), "returned", asset.Get("area") as string, AssetService.Normalise("area", target), note);
        }

        /// <summary>
        /// Setting Room, asset scanned without an open ticket: report the problem and
        /// receive the device into the room in one step.
        /// Returns the ticket id.
        /// </summary>
        public long CreateAndReceive(Row input, Auth auth)
        {
            GuardManage(auth);
            if (Php.CleanCode(input.Get("asset_no", "")) == "")
            {
                throw new ValidationException("Enter the asset number of the device to receive.");
            }
            return _db.Transaction(() =>
            {
                long id = Create(input, auth);
                var ticket = _tickets.Find(id);
                if (ticket.Empty("asset_id"))
                {
                    throw new ValidationException("Asset " + ticket.Str("asset_no") + " is not in the register, so it cannot be received into the room.");
                }
                Receive(ticket, auth, "Reported and received into the Setting Room in one step.");
                return id;
            });
        }

        /// <summary>
        /// Setting Room send-out: return the device (to area, default its original
        /// Area) with the chosen asset status, and optionally close a resolved ticket.
        /// </summary>
        public void SendOut(Row ticket, Auth auth, string assetStatus, string area, string note, bool close)
        {
            GuardManage(auth);
            _db.Transaction(() =>
            {
                ReturnDevice(ticket, auth, assetStatus ?? "", area ?? "", note ?? "");
                if (close)
                {
                    var fresh = _tickets.Find(ticket.Long("id"));
                    if (fresh.Str("status") == TicketStatus.Resolved)
                    {
                        Transition(fresh, TicketStatus.Closed, auth, "Device returned.");
                    }
                }
            });
        }

        public void AddNote(Row ticket, Auth auth, string note)
        {
            note = (note ?? "").Trim();
            if (note == "")
            {
                throw new ValidationException("Type a note first.");
            }
            Event(ticket.Get("id"), auth.Id(), "note", null, null, note);
        }

        public void SetPriority(Row ticket, Auth auth, string priority)
        {
            GuardManage(auth);
            if (!TicketStatus.Priorities().Any(kv => kv.Key == priority) || priority == ticket.Str("priority"))
            {
                return;
            }
            _db.Update("repair_tickets", new Row { { "priority", priority } }, "id = :id", new Row { { "id", ticket.Int("id") } });
            Event(ticket.Get("id"), auth.Id(), "priority", ticket.Get("priority") as string, priority, null);
        }

        private void GuardManage(Auth auth)
        {
            if (!auth.Can("tickets.manage"))
            {
                throw new HttpException(403, "Only technicians / admins can do this.");
            }
        }
    }
}
