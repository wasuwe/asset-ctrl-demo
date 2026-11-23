using System;
using System.Collections.Generic;
using System.Linq;
using AssetCtrl.Core;
using AssetCtrl.Models;
using AssetCtrl.Repositories;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Asset list / detail / edit for both areas, plus admin bulk edit.
    ///
    /// The area comes from the route prefix: "admin/assets..." requires an admin,
    /// "user/assets..." is for signed-in non-admin users. Users only ever see
    /// assets of the Work Centers granted to them (AssetFilter / loadVisible).
    /// </summary>
    public class AssetController : ApiController
    {
        public override void Before()
        {
            if (IsAdminArea())
            {
                RequireAdmin();
            }
            else
            {
                RequireLogin();
                if (Auth.IsAdmin())
                {
                    Forbidden("Admins use the admin asset pages.");
                }
            }
            RequireAbility("assets.view");
        }

        private bool IsAdminArea()
        {
            return (Route ?? "").StartsWith("admin/", StringComparison.Ordinal);
        }

        private AssetRepository AssetRepo()
        {
            return new AssetRepository(Db);
        }

        private List<string> EditableFields()
        {
            return Auth.IsAdmin() ? AssetFields.AdminEditable() : AssetFields.UserEditable();
        }

        private Row LoadVisible(long id)
        {
            var asset = id != 0 ? AssetRepo().Find(id) : null;
            if (asset == null)
            {
                NotFound("Asset not found.");
            }
            if (!Auth.CoversWorkCenter(asset.Get("work_center_id")))
            {
                Forbidden("This asset is not in one of your Work Centers.");
            }
            return asset;
        }

        /// <summary>GET admin/assets | user/assets — filters: q, status, wc (id), location, building, type, pc_type, os, has_ticket, sort, dir, page, per</summary>
        public void Index()
        {
            var filter = AssetFilter.FromRequest(Request);
            var allowed = IsAdminArea() ? new List<int> { 25, 50, 100, 200 } : new List<int> { 25, 50, 100 };
            int per = Request.Int("per", 50);
            int perPage = allowed.Contains(per) ? per : 50;
            var result = AssetRepo().Search(filter, Auth, Request.Int("page", 1), perPage);
            string monthStart = AssetService.CheckMonthStart();
            var rows = (List<Row>)result["rows"];
            foreach (var row in rows)
            {
                // Green = a User saved this asset this month, yellow = not yet.
                row["checked_this_month"] = !row.Empty("user_checked_at") && string.CompareOrdinal(row.Str("user_checked_at"), monthStart) >= 0;
            }
            var data = Paged(rows, (Paginator)result["pager"]);
            data["check_summary"] = AssetRepo().CheckSummary(filter, Auth, monthStart);
            data["per_page"] = perPage;
            data["per_page_options"] = allowed;
            var f = filter.ToArray();
            f["sort"] = filter.Sort;
            f["dir"] = filter.Dir;
            data["filter"] = f;
            var options = AssetRepo().FilterOptions(Auth);
            if (IsAdminArea())
            {
                // Active master values for the bulk edit form.
                options["masters"] = new MasterRepository(Db).ActiveOptions();
            }
            data["options"] = options;
            Respond(data);
        }

        /// <summary>GET .../assets/show?id= (or ?no=asset_no) [&amp;field=] — asset, history, field counts, tickets.</summary>
        public void Show()
        {
            string no = Request.Query("no", "");
            var found = no != "" ? AssetRepo().FindByNo(no) : null;
            var asset = LoadVisible(found != null ? found.Long("id") : Request.Int("id"));
            var history = new HistoryRepository(Db);
            string field = Request.Query("field", "");
            var counts = new Row();
            foreach (var kv in history.FieldCounts(asset.Long("id")))
            {
                counts[kv.Key] = Php.ToInt(kv.Value);
            }
            Respond(new Row
            {
                { "asset", asset },
                { "history", history.ForAsset(asset.Long("id"), field) },
                { "history_field", field },
                { "field_counts", counts },
                { "tickets", new TicketRepository(Db).ForAsset(asset.Long("id")) },
                { "editable", Auth.Can("assets.edit") ? EditableFields() : new List<string>() },
            });
        }

        /// <summary>GET .../assets/form[?id=] — data for the create/edit modal.</summary>
        public void Form()
        {
            int id = Request.Int("id");
            Row asset;
            List<string> editable;
            if (id != 0)
            {
                asset = LoadVisible(id);
                editable = EditableFields();
            }
            else
            {
                if (!Auth.Can("assets.create"))
                {
                    Forbidden("You do not have permission to add assets.");
                }
                asset = new Row { { "id", 0 }, { "asset_no", "" }, { "work_center", "" }, { "status", "STOCK" } };
                editable = AssetFields.AdminEditable();
            }
            var options = AssetRepo().FilterOptions(Auth);
            Respond(new Row
            {
                { "asset", asset },
                { "is_new", id == 0 },
                { "editable", editable },
                { "options", new Row
                    {
                        { "locations", options["locations"] },
                        { "buildings", options["buildings"] },
                        { "pc_types", options["pc_types"] },
                    }
                },
                // Active values of Type PC / Location / Building: the form offers only these.
                { "masters", new MasterRepository(Db).ActiveOptions() },
                { "work_centers", Auth.IsAdmin() ? options["work_centers"] : new List<Row>() },
            });
        }

        /// <summary>POST .../assets/save — id = 0 creates (admin with assets.create).</summary>
        public void Save()
        {
            int id = Request.Int("id");
            var input = Request.All();
            var svc = new AssetService(Db);

            if (id == 0)
            {
                if (!IsAdminArea() || !Auth.Can("assets.create"))
                {
                    Forbidden("You do not have permission to add assets.");
                }
                long newId = svc.Create(input, Auth.Id());
                Ok("Asset added.", new Row { { "id", (int)newId } });
            }

            if (!Auth.Can("assets.edit"))
            {
                Forbidden("You do not have permission to edit assets.");
            }
            var asset = LoadVisible(id);
            string note = Php.CleanText(input.Get("change_note", ""));
            var changes = svc.Update(asset, input, EditableFields(), Auth.Id(), "edit", null, note != "" ? note : null);
            if (!IsAdminArea())
            {
                // A User saving the form = the department has checked this asset (even with no change): green for this month.
                svc.MarkUserChecked(asset.Long("id"), Auth.Id());
            }
            if (changes.Count == 0)
            {
                string message = IsAdminArea() ? "Nothing changed." : "Checked for this month. Nothing changed.";
                Ok(message, new Row { { "id", asset.Int("id") }, { "changed", new List<string>() } });
            }
            var labels = new List<string>();
            foreach (var f in changes.Keys)
            {
                labels.Add(Lang.T(AssetFields.Label(f)));
            }
            Ok(asset.Str("asset_no") + " saved: " + string.Join(", ", labels), new Row { { "id", asset.Int("id") }, { "changed", changes.Keys.ToList() } });
        }

        /* ------------------------------------------------------------ bulk edit */

        /// <summary>Selection posted from the list: explicit ids[] or select_all=1 + the list's filter fields.</summary>
        private List<int> Selection()
        {
            if (Request.Post("select_all") == "1")
            {
                return AssetRepo().IdsMatching(AssetFilter.FromRequest(Request), Auth);
            }
            return Request.Arr("ids").Select(Php.ToInt).Distinct().ToList();
        }

        /// <summary>bulk_&lt;field&gt; values for every bulk-editable field.</summary>
        private Row BulkValues()
        {
            var values = new Row();
            foreach (var f in AssetFields.BulkEditable())
            {
                values[f] = Request.Post("bulk_" + f, "");
            }
            return values;
        }

        /// <summary>
        /// POST admin/assets/bulk-preview — body: ids[] | select_all=1 (+ filter), bulk_&lt;field&gt;, bulk_clear[], bulk_note.
        /// Returns exactly what would change; nothing is written.
        /// </summary>
        public void BulkPreview()
        {
            var ids = Selection();
            if (ids.Count == 0)
            {
                Fail("No assets selected.");
            }
            var assets = AssetRepo().FindMany(ids);
            var values = BulkValues();
            var bulkEditable = AssetFields.BulkEditable();
            var clear = Request.Arr("bulk_clear").Where(bulkEditable.Contains).ToList();
            var proposed = new Row();
            foreach (var kv in values)
            {
                string nv = AssetService.Normalise(kv.Key, kv.Value);
                if (nv != "" || clear.Contains(kv.Key))
                {
                    proposed[kv.Key] = nv;
                }
            }
            if (proposed.Count == 0)
            {
                Fail("Enter at least one value to change.");
            }
            var errors = AssetService.Validate(proposed).Concat(new AssetService(Db).MasterErrors(proposed)).ToList();
            if (errors.Count > 0)
            {
                Fail(errors);
            }
            var rows = new List<Row>();
            int changeCount = 0;
            foreach (var a in assets)
            {
                var d = AssetService.Diff(a, proposed);
                if (d.Count > 0)
                {
                    changeCount++;
                }
                rows.Add(new Row
                {
                    { "id", a.Int("id") },
                    { "asset_no", a.Get("asset_no") },
                    { "description", a.Get("description") },
                    { "work_center", a.Get("work_center") },
                    { "work_center_name", a.Get("work_center_name") },
                    { "diff", d },
                });
            }
            Respond(new Row
            {
                { "ids", assets.Select(a => a.Int("id")).ToList() },
                { "rows", rows },
                { "change_count", changeCount },
                { "proposed", proposed },
                { "values", values },
                { "clear", clear },
                { "note", Php.CleanText(Request.Post("bulk_note", "")) },
            });
        }

        /// <summary>POST admin/assets/bulk-apply — body: ids[], bulk_&lt;field&gt;, bulk_clear[], bulk_note.</summary>
        public void BulkApply()
        {
            var ids = Request.Arr("ids").Select(Php.ToInt).ToList();
            if (ids.Count == 0)
            {
                Fail("No assets selected.");
            }
            var assets = AssetRepo().FindMany(ids);
            string note = Php.CleanText(Request.Post("bulk_note", ""));
            var r = new AssetService(Db).BulkUpdate(
                assets,
                BulkValues(),
                Request.Arr("bulk_clear"),
                Auth.Id(),
                note != "" ? note : null);
            Ok("Updated " + Php.NumberFormat(r.Long("assets")) + " asset(s).", r);
        }
    }
}
