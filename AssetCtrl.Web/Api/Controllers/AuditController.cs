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
    /// <summary>Physical stock-count rounds (admin, audit.run).</summary>
    public class AuditController : ApiController
    {
        public override void Before()
        {
            RequireAdmin();
            RequireAbility("audit.run");
        }

        private AuditService Svc()
        {
            return new AuditService(Db);
        }

        /// <summary>GET admin/audit -> { rounds, locations }</summary>
        public void Index()
        {
            var rounds = new List<Row>();
            foreach (var r in Svc().Rounds())
            {
                var row = RoundShape(r);
                row["checked"] = r.Int("checked");
                row["total"] = r.Int("total");
                row["started_by_name"] = r.Get("started_by_name");
                rounds.Add(row);
            }
            Respond(new Row
            {
                { "rounds", rounds },
                { "locations", Db.Column("SELECT DISTINCT location FROM assets WHERE location <> '' ORDER BY location") },
            });
        }

        private static Row RoundShape(Row r)
        {
            return new Row
            {
                { "id", r.Int("id") },
                { "name", r.Get("name") },
                { "location", r.Get("location") },
                { "started_at", r.Get("started_at") },
                { "closed_at", r.Get("closed_at") },
                { "is_open", r.Empty("closed_at") },
            };
        }

        /// <summary>POST admin/audit/start { name, location } -> { id }</summary>
        public void Start()
        {
            long id = Svc().Start(Request.Post("name", ""), Request.Post("location", ""), Auth.Id());
            Ok("Audit round started.", new Row { { "id", (int)id } });
        }

        private Row LoadRound()
        {
            var round = Svc().Round(Request.Int("id"));
            if (round == null)
            {
                NotFound("Audit round not found.");
            }
            return round;
        }

        /// <summary>
        /// GET admin/audit/round?id=&amp;wc=&lt;work center code | —&gt;
        /// -> { round, total, checked, progress, recent, wc, unchecked|null, result_labels }
        /// </summary>
        public void Round()
        {
            var round = LoadRound();
            var svc = Svc();
            var progress = new List<Row>();
            int total = 0;
            int checkedCount = 0;
            foreach (var p in svc.Progress(round))
            {
                total += p.Int("total");
                checkedCount += p.Int("checked");
                progress.Add(new Row
                {
                    { "work_center", p.Get("work_center") },
                    { "work_center_name", p.Get("work_center_name") },
                    { "total", p.Int("total") },
                    { "checked", p.Int("checked") },
                });
            }
            var recent = new List<Row>();
            foreach (var c in svc.RecentChecks(round.Long("id")))
            {
                recent.Add(new Row
                {
                    { "id", c.Int("id") },
                    { "asset_id", c.Int("asset_id") },
                    { "asset_no", c.Get("asset_no") },
                    { "description", c.Get("description") },
                    { "result", c.Get("result") },
                    { "network", c.Get("network") },
                    { "area_found", c.Get("area_found") },
                    { "note", c.Get("note") },
                    { "checked_by_name", c.Get("checked_by_name") },
                    { "checked_at", c.Get("checked_at") },
                });
            }
            string wc = Request.Query("wc", "");
            List<Row> uncheckedRows = null;
            if (wc != "")
            {
                uncheckedRows = new List<Row>();
                foreach (var u in svc.Unchecked(round, wc))
                {
                    uncheckedRows.Add(new Row
                    {
                        { "id", u.Int("id") }, { "asset_no", u.Get("asset_no") }, { "description", u.Get("description") },
                        { "area", u.Get("area") }, { "status", u.Get("status") }, { "work_center", u.Get("work_center") },
                    });
                }
            }
            var labels = new Row();
            foreach (var kv in AuditService.ResultLabels())
            {
                labels[kv.Key] = Lang.T(kv.Value);
            }
            Respond(new Row
            {
                { "round", RoundShape(round) },
                { "total", total },
                { "checked", checkedCount },
                { "progress", progress },
                { "recent", recent },
                { "wc", wc },
                { "unchecked", uncheckedRows },
                { "result_labels", labels },
            });
        }

        /// <summary>GET admin/audit/scan?id=&amp;no= -> { asset, existing|null } for the check-in modal</summary>
        public void Scan()
        {
            var round = LoadRound();
            string no = Php.CleanCode(Request.Query("no", ""));
            var asset = no != "" ? new AssetRepository(Db).FindByNo(no) : null;
            if (asset == null)
            {
                Fail("Asset " + (no != "" ? no : Lang.T("(blank)")) + " was not found.", 404);
            }
            var existing = Svc().FindCheck(round.Long("id"), asset.Long("id"));
            Respond(new Row
            {
                { "round", RoundShape(round) },
                {
                    "asset", new Row
                    {
                        { "id", asset.Int("id") },
                        { "asset_no", asset.Get("asset_no") },
                        { "description", asset.Get("description") },
                        { "status", asset.Get("status") },
                        { "work_center", asset.Get("work_center") },
                        { "work_center_name", asset.Get("work_center_name") },
                        { "location", asset.Get("location") },
                        { "building", asset.Get("building") },
                        { "area", asset.Get("area") },
                    }
                },
                {
                    "existing", existing != null ? new Row
                    {
                        { "id", existing.Int("id") },
                        { "result", existing.Get("result") },
                        { "network", existing.Get("network") },
                        { "area_found", existing.Get("area_found") },
                        { "note", existing.Get("note") },
                        { "checked_at", existing.Get("checked_at") },
                    } : null
                },
            });
        }

        /// <summary>POST admin/audit/check { id, asset_id, area_found, result: found|damaged, network: online|offline|'', note }</summary>
        public void Check()
        {
            var round = LoadRound();
            var asset = new AssetRepository(Db).Find(Request.Int("asset_id"));
            if (asset == null)
            {
                NotFound("Asset not found.");
            }
            Svc().Check(round, asset, Request.All(), Auth.Id());
            Ok(asset.Str("asset_no") + " checked.");
        }

        /// <summary>POST admin/audit/delete-check { id (round), check_id } — remove one result while the round is open.</summary>
        public void DeleteCheck()
        {
            var round = LoadRound();
            var check = Svc().DeleteCheck(round, Request.Int("check_id"));
            Ok(Lang.T("Deleted the result for {asset}.", new Row { { "asset", check.Get("asset_no") } }));
        }

        /// <summary>POST admin/audit/delete { id } — delete a round and all of its results.</summary>
        public void DeleteRound()
        {
            var round = LoadRound();
            int n = Svc().DeleteRound(round);
            Ok(Lang.T("Deleted round \"{name}\" ({n} result(s)).", new Row { { "name", round.Get("name") }, { "n", n } }));
        }

        /// <summary>POST admin/audit/close { id }</summary>
        public void Close()
        {
            var round = LoadRound();
            Svc().Close(round.Long("id"));
            Ok("Audit round closed.");
        }

        /// <summary>GET admin/audit/export?id= -> .xlsx (or .csv) file download, not JSON</summary>
        public void Export()
        {
            var round = LoadRound();
            var cols = new List<string> { "asset_no", "description", "work_center", "work_center_name", "location", "building",
                "area", "status", "result", "area_found", "network", "note", "checked_at", "checked_by" };
            // Report mode (raw): every column as listed, headers and result/network values translated.
            var maps = new Dictionary<string, IDictionary<string, string>>
            {
                { "result", AuditService.ResultLabels().ToDictionary(kv => kv.Key, kv => kv.Value) },
                { "network", AuditService.NetworkLabels() },
            };
            new ExportService().Stream(Svc().ExportCursor(round), cols, "xlsx", "audit-" + round.Str("id"), App.Http.Response,
                true, AuditService.ExportLabels(), maps);
        }
    }
}
