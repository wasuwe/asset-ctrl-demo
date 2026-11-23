using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Models;

namespace AssetCtrl.Repositories
{
    public class TicketRepository
    {
        private readonly Database _db;

        public TicketRepository(Database db)
        {
            _db = db;
        }

        /// <summary>
        /// Repair queue: a device gets its place when it is received (IN) into the Setting Room.
        /// The queue holds devices still in the room whose repair is not finished, in IN order.
        /// queue_no = 1-based position (null when not in the queue).
        /// </summary>
        public const string QueueStatuses = "'new','assigned','in_progress','waiting_parts'";

        /// <summary>
        /// Sort key in the queue (smaller = earlier): the id of the latest "received" event, or after an
        /// admin "queue jump" minus the jump event id, so the latest jump is queue no. 1.
        /// </summary>
        private static string QueueKeySql(string alias)
        {
            string recv = "(SELECT MAX(e.id) FROM repair_events e WHERE e.ticket_id = " + alias + ".id AND e.event_type = 'received')";
            string jump = "(SELECT MAX(j.id) FROM repair_events j WHERE j.ticket_id = " + alias + ".id AND j.event_type = 'queue_jump'"
                + " AND j.id > COALESCE(" + recv + ", 0))";
            return "COALESCE(0 - CAST(" + jump + " AS BIGINT), CAST(" + recv + " AS BIGINT), 0)";
        }

        /// <summary>
        /// The whole repair queue in one query: ticket id -> (no, jumped).
        /// Only devices in the Setting Room are in it, so it stays small however many tickets exist.
        /// (It used to be a COUNT subquery per listed row, which grew with rows x queue length.)
        /// </summary>
        public Dictionary<int, KeyValuePair<int, bool>> QueuePositions()
        {
            string key = QueueKeySql("q");
            var rows = _db.All(
                "SELECT q.id, " + key + " AS qk FROM repair_tickets q"
                + " WHERE q.received_at IS NOT NULL AND q.returned_at IS NULL AND q.status IN (" + QueueStatuses + ")"
                + " ORDER BY qk, q.id");
            var o = new Dictionary<int, KeyValuePair<int, bool>>();
            for (int i = 0; i < rows.Count; i++)
            {
                o[rows[i].Int("id")] = new KeyValuePair<int, bool>(i + 1, Php.ToLong(rows[i].Get("qk")) < 0);
            }
            return o;
        }

        /// <summary>Add queue_no / queue_jumped to ticket rows (null / false when not in the queue).</summary>
        private List<Row> WithQueue(List<Row> rows)
        {
            if (rows.Count == 0) return rows;
            var queue = QueuePositions();
            foreach (var t in rows)
            {
                KeyValuePair<int, bool> q;
                bool inQueue = queue.TryGetValue(t.Int("id"), out q);
                t["queue_no"] = inQueue ? (object)q.Key : null;
                t["queue_jumped"] = inQueue && q.Value;
            }
            return rows;
        }

        /// <summary>Sort by queue number (not in the queue last), then by the column "then" ascending.</summary>
        private static List<Row> SortByQueue(List<Row> rows, string then)
        {
            return rows
                .OrderBy(t => t.Get("queue_no") == null ? 1 : 0)
                .ThenBy(t => t.Get("queue_no") == null ? 0 : t.Int("queue_no"))
                .ThenBy(t => t.Str(then), System.StringComparer.Ordinal)
                .ToList();
        }

        /// <summary>Open tickets the user can see, those already in the queue first (by queue number).</summary>
        public List<Row> OpenWithQueue(Auth auth, int limit = 20)
        {
            var p = new Row();
            string vis = Visibility(auth, p);
            string inSql = Database.InClause("t.status", TicketStatus.OpenStatuses(), p, "oq");
            var rows = WithQueue(_db.All(Select() + " WHERE " + vis + " AND " + inSql, p));
            return SortByQueue(rows, "created_at").Take(limit).ToList();
        }

        /// <summary>Number of devices waiting in the repair queue right now.</summary>
        public int QueueLength()
        {
            return Php.ToInt(_db.Value(
                "SELECT COUNT(*) FROM repair_tickets WHERE received_at IS NOT NULL AND returned_at IS NULL AND status IN (" + QueueStatuses + ")"));
        }

        /// <param name="extra">extra columns, starting with a comma</param>
        private string Select(string extra = "")
        {
            return @"SELECT t.*, wc.code AS work_center, wc.name AS work_center_name,
                    TRIM(CONCAT(COALESCE(r.first_name,''), ' ', COALESCE(r.last_name,''))) AS reporter_name,
                    TRIM(CONCAT(COALESCE(s.first_name,''), ' ', COALESCE(s.last_name,''))) AS assignee_name,
                    a.description AS asset_description, a.area AS asset_area, a.status AS asset_status" + extra + @"
                FROM " + From() + @"
                LEFT JOIN users r ON r.id = t.reporter_id
                LEFT JOIN users s ON s.id = t.assignee_id
                LEFT JOIN assets a ON a.id = t.asset_id";
        }

        /// <summary>Tickets belong to the Work Center of their asset (work_center_id).</summary>
        public static string From()
        {
            return "repair_tickets t LEFT JOIN work_centers wc ON wc.id = t.work_center_id";
        }

        /// <summary>Admins see everything; users see tickets they reported and those of their Work Centers.</summary>
        private string Visibility(Auth auth, Row p)
        {
            if (auth.IsAdmin()) return "1 = 1";
            p["me"] = auth.Id() ?? 0;
            string scope = auth.ScopeSql(p, "wc.id");
            return "(t.reporter_id = :me OR " + scope + ")";
        }

        /// <summary>
        /// WHERE clause of the ticket list. Filters: view (open|mine|reported|unassigned|resolved|done|all), status,
        /// priority, q, work_center (id), assignee, from / to (reported date, yyyy-MM-dd, both inclusive).
        /// </summary>
        private string Where(Row f, Auth auth, Row p)
        {
            var w = new List<string> { Visibility(auth, p) };
            string view = f.ContainsKey("view") ? f.Str("view") : "open";

            if (view == "open")
            {
                w.Add(Database.InClause("t.status", TicketStatus.OpenStatuses(), p, "open"));
            }
            else if (view == "mine")
            {
                w.Add("t.assignee_id = :mine");
                p["mine"] = auth.Id() ?? 0;
                w.Add(Database.InClause("t.status", TicketStatus.ActiveStatuses(), p, "act"));
            }
            else if (view == "reported")
            {
                w.Add("t.reporter_id = :rep");
                p["rep"] = auth.Id() ?? 0;
            }
            else if (view == "unassigned")
            {
                w.Add("t.assignee_id IS NULL");
                w.Add(Database.InClause("t.status", TicketStatus.OpenStatuses(), p, "open"));
            }
            else if (view == "resolved")
            {
                w.Add("t.status = 'resolved'");
            }
            else if (view == "done")
            {
                w.Add("t.status IN ('closed','cancelled')");
            }

            if (!f.Empty("status"))
            {
                w.Add("t.status = :status");
                p["status"] = f.Str("status");
            }
            if (!f.Empty("priority"))
            {
                w.Add("t.priority = :priority");
                p["priority"] = f.Str("priority");
            }
            if (!f.Empty("assignee"))
            {
                w.Add("t.assignee_id = :assignee");
                p["assignee"] = f.Int("assignee");
            }
            if (!f.Empty("work_center"))
            {
                w.Add("wc.id = :wcid");
                p["wcid"] = f.Int("work_center");
            }
            DateRange(f, w, p);
            if (!f.Empty("q"))
            {
                w.Add("(t.ticket_no ILIKE :q OR t.flolites_no ILIKE :q OR t.asset_no ILIKE :q OR t.title ILIKE :q OR t.symptom ILIKE :q OR t.contact_name ILIKE :q)");
                p["q"] = "%" + Database.LikeEscape(f.Str("q")) + "%";
            }
            return string.Join(" AND ", w);
        }

        /// <summary>Reported-date range (uses the created_at index). from / to are yyyy-MM-dd, already checked by the controller.</summary>
        private static void DateRange(Row f, List<string> w, Row p)
        {
            if (!f.Empty("from"))
            {
                w.Add("t.created_at >= :date_from");
                p["date_from"] = f.Str("from") + " 00:00:00";
            }
            if (!f.Empty("to"))
            {
                w.Add("t.created_at < :date_to");
                p["date_to"] = System.DateTime.ParseExact(f.Str("to"), "yyyy-MM-dd", Php.Inv).AddDays(1).ToString("yyyy-MM-dd", Php.Inv) + " 00:00:00";
            }
        }

        /// <summary>One page of the ticket list (filters: see Where()). -> { rows, pager }</summary>
        public Row Search(Row f, Auth auth, int page, int perPage = 30)
        {
            var p = new Row();
            string where = Where(f, auth, p);
            string view = f.ContainsKey("view") ? f.Str("view") : "open";
            long total = Php.ToLong(_db.Value("SELECT COUNT(*) FROM " + From() + " WHERE " + where, p));
            var pager = new Paginator(total, perPage, page);
            string order = "(t.priority = 'urgent') DESC, t.created_at ASC, t.id ASC";
            if (view == "done" || view == "all" || view == "reported")
            {
                order = "t.updated_at DESC, t.id DESC";
            }
            var rows = _db.All(
                Select() + " WHERE " + where + " ORDER BY " + order + " LIMIT " + pager.PerPage + " OFFSET " + pager.Offset(),
                p);
            return new Row { { "rows", WithQueue(rows) }, { "pager", pager } };
        }

        /// <summary>Ids of every ticket matching the list filter (bulk "select all matching"), at most limit.</summary>
        public List<int> SearchIds(Row f, Auth auth, int limit)
        {
            var p = new Row();
            string where = Where(f, auth, p);
            return _db.All("SELECT t.id FROM " + From() + " WHERE " + where + " ORDER BY t.id LIMIT " + limit, p)
                .Select(r => r.Int("id")).ToList();
        }

        /// <summary>Counts per tab for the current user, within the reported-date range when one is set (all values int).</summary>
        public Row ViewCounts(Auth auth, Row f = null)
        {
            var p = new Row();
            var w = new List<string> { Visibility(auth, p) };
            if (f != null) DateRange(f, w, p);
            p["me_a"] = auth.Id() ?? 0;
            p["me_r"] = auth.Id() ?? 0;
            var row = _db.One(
                @"SELECT
                    SUM(CASE WHEN t.status IN ('new','assigned','in_progress','waiting_parts') THEN 1 ELSE 0 END) AS open_count,
                    SUM(CASE WHEN t.assignee_id = :me_a AND t.status IN ('new','assigned','in_progress','waiting_parts','resolved') THEN 1 ELSE 0 END) AS mine,
                    SUM(CASE WHEN t.reporter_id = :me_r THEN 1 ELSE 0 END) AS reported,
                    SUM(CASE WHEN t.assignee_id IS NULL AND t.status IN ('new','assigned','in_progress','waiting_parts') THEN 1 ELSE 0 END) AS unassigned,
                    SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
                    SUM(CASE WHEN t.status IN ('closed','cancelled') THEN 1 ELSE 0 END) AS done,
                    COUNT(*) AS all_count
                  FROM " + From() + @"
                  WHERE " + string.Join(" AND ", w),
                p);
            var o = new Row();
            if (row != null)
            {
                foreach (var kv in row) o[kv.Key] = Php.ToInt(kv.Value);
            }
            return o;
        }

        /// <summary>
        /// Numbers for the strip above the admin ticket list. Each is a small indexed count
        /// (created_at / resolved_at / closed_at / status), so it stays fast with many tickets.
        /// </summary>
        public Row TodaySummary()
        {
            string today = Database.NowDate().ToString("yyyy-MM-dd", Php.Inv) + " 00:00:00";
            var row = _db.One(
                @"SELECT
                    (SELECT COUNT(*) FROM repair_tickets WHERE created_at >= :d1) AS reported_today,
                    (SELECT COUNT(*) FROM repair_tickets WHERE resolved_at >= :d2) AS resolved_today,
                    (SELECT COUNT(*) FROM repair_tickets WHERE closed_at >= :d3 AND status = 'closed') AS closed_today,
                    (SELECT COUNT(*) FROM repair_tickets WHERE status IN (" + QueueStatuses + @")) AS open_now,
                    (SELECT COUNT(*) FROM repair_tickets WHERE status IN (" + QueueStatuses + @") AND priority = 'urgent') AS urgent_open,
                    (SELECT COUNT(*) FROM repair_tickets WHERE status IN (" + QueueStatuses + @") AND assignee_id IS NULL) AS unassigned",
                new Row { { "d1", today }, { "d2", today }, { "d3", today } });
            var o = new Row();
            if (row != null)
            {
                foreach (var kv in row) o[kv.Key] = Php.ToInt(kv.Value);
            }
            return o;
        }

        public Row Find(long id)
        {
            var rows = WithQueue(_db.All(Select() + " WHERE t.id = :id", new Row { { "id", (int)id } }));
            return rows.Count > 0 ? rows[0] : null;
        }

        public bool CanView(Row ticket, Auth auth)
        {
            if (auth.IsAdmin()) return true;
            return ticket.Int("reporter_id") == (auth.Id() ?? 0) || auth.CoversWorkCenter(ticket.Get("work_center_id"));
        }

        public List<Row> Events(long ticketId)
        {
            return _db.All(
                @"SELECT e.*, TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS user_name, u.role AS user_role
                  FROM repair_events e LEFT JOIN users u ON u.id = e.user_id
                  WHERE e.ticket_id = :id ORDER BY e.created_at ASC, e.id ASC",
                new Row { { "id", (int)ticketId } });
        }

        /// <summary>Devices still in the Setting Room whose repair is finished, waiting to be collected (oldest first).</summary>
        public List<Row> RepairedWaiting()
        {
            return WithQueue(_db.All(Select()
                + " WHERE t.received_at IS NOT NULL AND t.returned_at IS NULL AND t.status IN ('resolved','closed')"
                + " ORDER BY COALESCE(t.resolved_at, t.closed_at) ASC, t.id ASC"));
        }

        /// <summary>Devices currently in the repair room (received, not yet returned).</summary>
        public List<Row> InRepairRoom()
        {
            var rows = WithQueue(_db.All(Select() + " WHERE t.received_at IS NOT NULL AND t.returned_at IS NULL"));
            return SortByQueue(rows, "received_at");
        }

        /// <summary>Active tickets matching a scanned value: asset number, ticket number or Flowlites number.</summary>
        public List<Row> FindOpenByScan(string value)
        {
            value = Php.CleanCode(value);
            if (value == "") return new List<Row>();
            var p = new Row { { "v1", value }, { "v2", value }, { "v3", value } };
            string inSql = Database.InClause("t.status", TicketStatus.ActiveStatuses(), p, "st");
            return WithQueue(_db.All(
                Select() + " WHERE (t.asset_no = :v1 OR t.ticket_no = :v2 OR t.flolites_no = :v3) AND " + inSql + " ORDER BY t.created_at DESC",
                p));
        }

        /// <summary>Received-and-not-returned ticket matching a scanned asset / ticket / Flowlites number.</summary>
        public Row FindInRoomByScan(string value)
        {
            value = Php.CleanCode(value);
            if (value == "") return null;
            var rows = WithQueue(_db.All(
                Select() + @" WHERE (t.asset_no = :v1 OR t.ticket_no = :v2 OR t.flolites_no = :v3)
                    AND t.received_at IS NOT NULL AND t.returned_at IS NULL ORDER BY t.received_at DESC LIMIT 1",
                new Row { { "v1", value }, { "v2", value }, { "v3", value } }));
            return rows.Count > 0 ? rows[0] : null;
        }

        public List<Row> ForAsset(long assetId)
        {
            return WithQueue(_db.All(
                Select() + " WHERE t.asset_id = :id ORDER BY t.created_at DESC LIMIT 50",
                new Row { { "id", (int)assetId } }));
        }

        public List<Row> OpenForAsset(long assetId)
        {
            var p = new Row { { "id", (int)assetId } };
            string inSql = Database.InClause("status", TicketStatus.OpenStatuses(), p, "st");
            return _db.All("SELECT id, ticket_no, title, status FROM repair_tickets WHERE asset_id = :id AND " + inSql, p);
        }

        /// <summary>Aggregate numbers for dashboards.</summary>
        public Row Summary()
        {
            var now = Database.NowDate();
            var row = _db.One(
                @"SELECT
                    SUM(CASE WHEN status IN ('new','assigned','in_progress','waiting_parts') THEN 1 ELSE 0 END) AS open_count,
                    SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
                    SUM(CASE WHEN status IN ('in_progress','waiting_parts') THEN 1 ELSE 0 END) AS working,
                    SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
                    SUM(CASE WHEN status IN ('new','assigned','in_progress','waiting_parts') AND priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
                    SUM(CASE WHEN closed_at >= :d30 THEN 1 ELSE 0 END) AS closed_30d,
                    AVG(CASE WHEN resolved_at IS NOT NULL AND resolved_at >= :d90
                        THEN FLOOR(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60) END) AS avg_minutes
                  FROM repair_tickets",
                new Row { { "d30", now.AddDays(-30) }, { "d90", now.AddDays(-90) } });
            return row ?? new Row();
        }

        public List<Row> Workload()
        {
            return _db.All(
                @"SELECT u.id, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS name,
                         SUM(CASE WHEN t.status IN ('assigned','in_progress') THEN 1 ELSE 0 END) AS active,
                         SUM(CASE WHEN t.status = 'waiting_parts' THEN 1 ELSE 0 END) AS waiting,
                         SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved
                  FROM repair_tickets t JOIN users u ON u.id = t.assignee_id
                  WHERE t.status IN ('assigned','in_progress','waiting_parts','resolved')
                  GROUP BY u.id ORDER BY active DESC");
        }
    }
}
