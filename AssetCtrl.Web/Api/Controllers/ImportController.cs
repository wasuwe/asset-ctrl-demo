using System.Collections.Generic;
using System.IO;
using System.Web.Configuration;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Two-step spreadsheet import (admin, import.run):
    /// upload -> preview (diff, nothing changed) -> apply or discard.
    /// </summary>
    public class ImportController : ApiController
    {
        public override void Before()
        {
            RequireAdmin();
            RequireAbility("import.run");
        }

        private ImportService Svc()
        {
            return new ImportService(Db);
        }

        /// <summary>GET admin/import -> { batches, legacy_columns, max_upload }</summary>
        public void Index()
        {
            var batches = new List<Row>();
            foreach (var b in Svc().Batches())
            {
                batches.Add(BatchShape(b));
            }
            var cols = new List<Row>();
            foreach (var c in AssetFields.LegacyCsvColumns())
            {
                cols.Add(new Row { { "field", c }, { "label", Lang.T(c == "work_center" ? "Work Center (e.g. 2300-ICS)" : AssetFields.Label(c)) } });
            }
            Respond(new Row
            {
                { "batches", batches },
                { "legacy_columns", cols },
                { "max_upload", MaxMb() + " MB" },
                // The browser sends the file in parts of this size (see UploadChunk), so httpRuntime
                // maxRequestLength only has to fit one part.
                { "chunk_size", ChunkBytes },
                { "max_bytes", MaxMb() * 1024L * 1024L },
            });
        }

        /// <summary>Size of one upload part sent by the browser (1 MB).</summary>
        private const int ChunkBytes = 1048576;

        /// <summary>Largest file accepted by the part-by-part upload (appSetting ImportMaxMb, default 200).</summary>
        private static int MaxMb()
        {
            return System.Math.Max(1, AppConfig.GetInt("ImportMaxMb", 200));
        }

        /// <summary>Single-request upload limit (httpRuntime maxRequestLength), for the old one-shot Upload.</summary>
        private static string MaxUpload()
        {
            var section = WebConfigurationManager.GetSection("system.web/httpRuntime") as HttpRuntimeSection;
            int kb = section != null ? section.MaxRequestLength : 4096;
            return kb % 1024 == 0 ? (kb / 1024) + "M" : kb + "K";
        }

        private static readonly System.Text.RegularExpressions.Regex UploadIdRe =
            new System.Text.RegularExpressions.Regex("^[a-f0-9]{32}$");

        /// <summary>Folder holding the parts of one upload; the user id is part of the name so uploads never mix.</summary>
        private string ChunkDir(string uploadId)
        {
            return Path.Combine(Path.GetTempPath(), "assetctrl-upload", (Auth.Id() ?? 0) + "-" + uploadId);
        }

        private static void RemoveDir(string dir)
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        }

        /// <summary>
        /// POST admin/import/upload-chunk (multipart): upload_id (32 hex, chosen by the browser), index (0-based),
        /// total (number of parts), size (whole file, bytes), name, chunk (the part).
        /// -> { done: false, received } for every part but the last;
        ///    the last part joins the parts, checks the file like Upload() and returns { done: true, id }.
        /// </summary>
        public void UploadChunk()
        {
            string uploadId = Request.Post("upload_id");
            int index = Request.Int("index", -1);
            int total = Request.Int("total", 0);
            long size = Php.ToLong(Request.Post("size", "0"));
            string name = Php.CleanText(Request.Post("name"));
            long maxBytes = MaxMb() * 1024L * 1024L;

            if (!UploadIdRe.IsMatch(uploadId) || total < 1 || index < 0 || index >= total || name == "")
            {
                Fail("The upload failed.");
            }
            if (size > maxBytes || total > System.Math.Ceiling(maxBytes / 65536.0))
            {
                Fail("The file is too large (limit " + MaxMb() + " MB).");
            }
            var file = Request.File("chunk");
            if (file == null)
            {
                Fail("The upload failed.");
            }

            string dir = ChunkDir(uploadId);
            string root = Path.GetDirectoryName(dir);
            if (index == 0 && Directory.Exists(root))
            {
                // Clear parts left behind by uploads that were never finished (older than a day).
                foreach (var old in Directory.GetDirectories(root))
                {
                    if (Directory.GetLastWriteTimeUtc(old) < System.DateTime.UtcNow.AddDays(-1)) RemoveDir(old);
                }
            }
            try
            {
                Directory.CreateDirectory(dir);
                file.SaveAs(Path.Combine(dir, index.ToString("00000") + ".part"));
            }
            catch (IOException)
            {
                Fail("The upload failed.");
            }

            var parts = Directory.GetFiles(dir, "*.part");
            if (parts.Length < total)
            {
                Respond(new Row { { "done", false }, { "received", parts.Length }, { "total", total } });
            }

            // Every part is here: join them in order and check the result.
            System.Array.Sort(parts, System.StringComparer.Ordinal);
            string joined = Path.Combine(dir, "file");
            long id = 0;
            try
            {
                using (var output = File.Create(joined))
                {
                    foreach (var p in parts)
                    {
                        using (var input = File.OpenRead(p)) input.CopyTo(output);
                        File.Delete(p);
                    }
                }
                if (new FileInfo(joined).Length != size || size > maxBytes)
                {
                    Fail("The upload failed.");
                }
                App.Http.Server.ScriptTimeout = 600;
                id = Svc().Stage(joined, name, Auth.Id());
            }
            finally
            {
                RemoveDir(dir);
            }
            Ok("File checked. Review the changes, then import.", new Row { { "done", true }, { "id", (int)id } });
        }

        private static Row BatchShape(Row b)
        {
            var o = new Row
            {
                { "id", b.Int("id") },
                { "filename", b.Get("filename") },
                { "status", b.Get("status") },
                { "uploaded_by_name", b.Get("uploaded_by_name") },
                { "created_at", b.Get("created_at") },
                { "applied_at", b.Get("applied_at") },
            };
            foreach (var k in new[] { "total_rows", "create_count", "update_count", "same_count", "error_count", "missing_count" })
            {
                o[k] = b.Int(k);
            }
            return o;
        }

        /// <summary>POST admin/import/upload (multipart: file) -> { id } of the new preview batch</summary>
        public void Upload()
        {
            var file = Request.File("file");
            // An over-size request is rejected by ASP.NET (maxRequestLength) before it gets here.
            if (file == null || string.IsNullOrEmpty(file.FileName))
            {
                Fail("Please choose a file.");
            }
            App.Http.Server.ScriptTimeout = 300; // @set_time_limit(300)
            string tmp = Path.Combine(Path.GetTempPath(), "imp" + Php.RandomToken(8) + ".tmp");
            long id;
            try
            {
                try
                {
                    file.SaveAs(tmp);
                }
                catch (IOException)
                {
                    Fail("The upload failed.");
                }
                id = Svc().Stage(tmp, file.FileName, Auth.Id());
            }
            finally
            {
                try { File.Delete(tmp); } catch { } // PHP removes the upload's tmp file after the request
            }
            Ok("File checked. Review the changes, then import.", new Row { { "id", (int)id } });
        }

        /// <summary>
        /// GET admin/import/preview?id=&amp;tab=update|create|error|missing&amp;page=
        /// -> { batch, tab, rows, pager, fields_in_file, field_counts }
        /// </summary>
        public void Preview()
        {
            var svc = Svc();
            var batch = svc.Batch(Request.Int("id"));
            if (batch == null)
            {
                NotFound("Import batch not found.");
            }
            string tab = Request.Query("tab", "");
            if (tab != "update" && tab != "create" && tab != "error" && tab != "missing")
            {
                tab = !batch.Empty("update_count") ? "update" : (!batch.Empty("create_count") ? "create" : (!batch.Empty("error_count") ? "error" : "missing"));
            }
            int page = Request.Int("page", 1);
            long batchId = batch.Long("id");
            var list = tab == "missing" ? svc.Missing(batchId, page) : svc.Rows(batchId, tab, page);
            var rows = new List<Row>();
            foreach (var r in (List<Row>)list["rows"])
            {
                if (tab == "missing")
                {
                    rows.Add(r);
                    continue;
                }
                var payload = ImportService.DecodeJson(r.Str("payload"));
                var diff = r.Get("diff") != null ? ImportService.DecodeJson(r.Str("diff")) : null;
                rows.Add(new Row
                {
                    { "line_no", r.Int("line_no") },
                    { "asset_no", r.Get("asset_no") },
                    { "action", r.Get("action") },
                    { "payload", payload is Row pr && pr.Count > 0 ? (object)pr
                        : (payload is List<object> pl && pl.Count > 0 ? (object)pl : new Row()) },
                    { "diff", diff is Row || diff is List<object> ? diff : new Row() },
                    { "message", r.Get("message") != null ? Lang.T(r.Str("message")) : null },
                });
            }
            var fields = new List<Row>();
            foreach (var f in svc.FieldsOf(batch))
            {
                if (f != "asset_no" && f.Length > 0 && f[0] != '_')
                {
                    fields.Add(new Row { { "field", f }, { "label", Lang.T(AssetFields.Label(f)) } });
                }
            }
            var o = Paged(rows, (Paginator)list["pager"]);
            o["batch"] = BatchShape(batch);
            o["tab"] = tab;
            o["fields_in_file"] = fields;
            o["field_counts"] = batch.Str("status") != "discarded" ? svc.FieldChangeCounts(batchId) : new Row();
            Respond(o);
        }

        /// <summary>POST admin/import/apply { id, fields[], create_new: 1|0 }</summary>
        public void Apply()
        {
            App.Http.Server.ScriptTimeout = 600; // @set_time_limit(600)
            var r = Svc().Apply(
                Request.Int("id"),
                Request.Arr("fields"),
                Request.Post("create_new") == "1",
                Auth.Id()
            );
            Ok(string.Format(
                "Import complete: {0} added, {1} updated ({2} field changes).",
                Php.NumberFormat(r.Long("created")),
                Php.NumberFormat(r.Long("updated")),
                Php.NumberFormat(r.Long("changes"))
            ), r);
        }

        /// <summary>POST admin/import/discard { id }</summary>
        public void Discard()
        {
            var svc = Svc();
            var batch = svc.Batch(Request.Int("id"));
            if (batch == null)
            {
                NotFound("Import batch not found.");
            }
            if (batch.Str("status") != "preview")
            {
                Fail("This import batch has already been applied or discarded.");
            }
            svc.Discard(batch.Long("id"));
            Ok("Import batch discarded. Nothing was changed.");
        }
    }
}
