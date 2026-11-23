using System.Collections.Generic;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Asset export for both areas. Non-admins are limited to their Work Centers
    /// by AssetFilter. The download is a plain GET link (session cookie), so the
    /// browser saves the file directly.
    /// </summary>
    public class ExportController : ApiController
    {
        public override void Before()
        {
            RequireAbility("assets.export");
        }

        /// <summary>GET export/info?&lt;list filters&gt; — what the export modal needs.</summary>
        public void Info()
        {
            var filter = AssetFilter.FromRequest(Request);
            var columns = new List<Row>();
            foreach (var key in AssetFields.Exportable())
            {
                // screen only; file headers stay English so Import recognises them
                columns.Add(new Row { { "code", key }, { "label", Lang.T(AssetFields.Label(key)) }, { "required", key == "asset_no" } });
            }
            Respond(new Row
            {
                { "count", new AssetRepository(Db).CountMatching(filter, Auth) },
                { "filter_empty", filter.IsEmpty() },
                { "xlsx", XlsxWriter.Available() },
                { "columns", columns },
            });
        }

        /// <summary>
        /// GET export/download?&lt;list filters&gt;&amp;preset=full|custom&amp;cols[]=..&amp;format=xlsx|csv
        /// Streams the file (not JSON). Both kinds can be imported again.
        /// </summary>
        public void Download()
        {
            var filter = AssetFilter.FromRequest(Request);
            List<string> columns = Request.Query("preset", "full") == "custom"
                ? Request.Arr("cols")
                : AssetFields.Exportable();
            columns = ExportService.KnownColumns(columns);
            string format = Request.Query("format") == "xlsx" ? "xlsx" : "csv";
            App.Http.Server.ScriptTimeout = 300; // @set_time_limit(300)
            new ExportService().Stream(
                new AssetRepository(Db).Cursor(filter, Auth),
                columns,
                format,
                "assets",
                App.Http.Response
            );
        }
    }
}
