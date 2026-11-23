using System.Collections.Generic;
using AssetCtrl.Core;
using AssetCtrl.Repositories;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Read-only asset list for the front page before sign-in (#/assets).
    ///
    /// Same search, filters, sort and paging as user/assets, over every Work Center.
    /// No sign-in, no edit, no export, no detail page. Each row carries only the
    /// columns the list shows (PublicColumns); ids and audit fields stay on the server.
    /// </summary>
    public class PublicAssetController : ApiController
    {
        private static readonly string[] PublicColumns =
        {
            "asset_type", "asset_no", "fix_no", "description", "os_name", "os_version",
            "department", "pc_type", "building", "location", "area", "remark",
            "status", "editor_note", "last_use", "open_ticket_no",
        };

        public override void Before()
        {
            // Open to everyone.
        }

        /// <summary>GET public/assets — filters: q, status, wc (id), location, building, type, pc_type, os, has_ticket, checked, sort, dir, page, per</summary>
        public void Index()
        {
            var repo = new AssetRepository(Db);
            var filter = AssetFilter.FromRequest(Request);
            var allowed = new List<int> { 25, 50, 100 };
            int per = Request.Int("per", 50);
            int perPage = allowed.Contains(per) ? per : 50;
            var result = repo.Search(filter, null, Request.Int("page", 1), perPage);
            string monthStart = AssetService.CheckMonthStart();

            var rows = new List<Row>();
            foreach (var full in (List<Row>)result["rows"])
            {
                var row = new Row();
                foreach (var col in PublicColumns)
                {
                    row[col] = full.Get(col);
                }
                row["checked_this_month"] = !full.Empty("user_checked_at") && string.CompareOrdinal(full.Str("user_checked_at"), monthStart) >= 0;
                rows.Add(row);
            }

            var data = Paged(rows, (Paginator)result["pager"]);
            data["check_summary"] = repo.CheckSummary(filter, null, monthStart);
            data["per_page"] = perPage;
            data["per_page_options"] = allowed;
            var f = filter.ToArray();
            f["sort"] = filter.Sort;
            f["dir"] = filter.Dir;
            data["filter"] = f;
            data["options"] = repo.FilterOptions(null);
            Respond(data);
        }
    }
}
