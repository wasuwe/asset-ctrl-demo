using System.Collections.Generic;
using System.Text.RegularExpressions;
using AssetCtrl.Core;
using AssetCtrl.Repositories;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>Global asset change log (admin, history.view_all).</summary>
    public class HistoryController : ApiController
    {
        public override void Before()
        {
            RequireAdmin();
            RequireAbility("history.view_all");
        }

        private static readonly Regex DateRe = new Regex(@"^\d{4}-\d{2}-\d{2}$");

        /// <summary>GET admin/history?field=&amp;source=&amp;q=&amp;from=&amp;to=&amp;page= -> { rows, pager, filters }</summary>
        public void Index()
        {
            var f = new Row
            {
                { "field", Request.Query("field", "") },
                { "source", Request.Query("source", "") },
                { "q", Request.Query("q", "") },
                { "from", Request.Query("from", "") },
                { "to", Request.Query("to", "") },
            };
            foreach (var k in new[] { "from", "to" })
            {
                if (f.Str(k) != "" && !DateRe.IsMatch(f.Str(k)))
                {
                    f[k] = "";
                }
            }
            var result = new HistoryRepository(Db).Search(f, Auth, Request.Int("page", 1));
            var rows = new List<Row>();
            foreach (var h in (List<Row>)result["rows"])
            {
                rows.Add(new Row
                {
                    { "id", h.Int("id") },
                    { "asset_id", h.Int("asset_id") },
                    { "asset_no", h.Get("asset_no") },
                    { "description", h.Get("description") },
                    { "work_center", h.Get("work_center") },
                    { "work_center_name", h.Get("work_center_name") },
                    { "field", h.Get("field") },
                    { "old_value", h.Get("old_value") },
                    { "new_value", h.Get("new_value") },
                    { "source", h.Get("source") },
                    { "ref_id", h.Get("ref_id") != null ? (object)h.Int("ref_id") : null },
                    { "note", h.Get("note") },
                    { "user_name", h.Get("user_name") },
                    { "changed_at", h.Get("changed_at") },
                });
            }
            var o = Paged(rows, (Paginator)result["pager"]);
            o["filters"] = f;
            Respond(o);
        }
    }
}
