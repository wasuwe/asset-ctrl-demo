using System.Collections.Generic;
using AssetCtrl.Core;
using AssetCtrl.Repositories;
using AssetCtrl.Services;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Master lists for Type PC, Location and Building / floor (admin, users.manage).
    /// Codes never change once added (assets refer to them); names and the active flag can.
    /// Only active values are offered on the asset form and bulk edit.
    /// </summary>
    public class MasterController : ApiController
    {
        public override void Before()
        {
            RequireAdmin();
            RequireAbility("users.manage");
        }

        private string Kind()
        {
            string kind = Request.Input("kind", "pc_type");
            if (!MasterRepository.IsKind(kind))
            {
                Fail("Unknown master list.");
            }
            return kind;
        }

        /// <summary>GET admin/masters?kind=&amp;q=&amp;active=&amp;page= -> { rows, pager, filters, kind, kinds, counts, tabs }</summary>
        public void Index()
        {
            string kind = Kind();
            var f = new Row
            {
                { "q", Request.Query("q", "") },
                { "active", Request.Query("active", "") },
            };
            var repo = new MasterRepository(Db);
            var result = repo.Search(kind, f, Request.Int("page", 1));
            var o = Paged((List<Row>)result["rows"], (Paginator)result["pager"]);
            o["filters"] = f;
            o["kind"] = kind;
            var kinds = new List<Row>();
            foreach (var kv in MasterRepository.Kinds())
            {
                kinds.Add(new Row { { "code", kv.Key }, { "label", kv.Value[0] }, { "max", kv.Value[1] } });
            }
            o["kinds"] = kinds;
            o["counts"] = repo.Counts();
            o["tabs"] = repo.Tabs();
            Respond(o);
        }

        /// <summary>GET admin/masters/show?id=</summary>
        public void Show()
        {
            var row = new MasterRepository(Db).Find(Request.Int("id"));
            if (row == null)
            {
                NotFound("Value not found.");
            }
            Respond(MasterRepository.Shape(row));
        }

        /// <summary>POST admin/masters/save { id?, kind + code (new only), name, is_active }</summary>
        public void Save()
        {
            var repo = new MasterRepository(Db);
            int id = Request.Int("id");
            string name = WorkCenterController.SubstrBytes(Php.CleanText(Request.Post("name", "")), 191);
            bool active = Request.Post("is_active", "0") == "1";
            if (id != 0)
            {
                var row = repo.Find(id);
                if (row == null)
                {
                    NotFound("Value not found.");
                }
                repo.Update(row.Long("id"), name, active);
                Ok("Saved " + row.Str("code") + ".", new Row { { "id", row.Int("id") } });
            }
            string kind = Kind();
            string raw = Request.Post("code", "");
            string code = AssetService.Normalise(kind, raw);
            if (code == "")
            {
                Fail("Please enter a code.");
            }
            // PHP strlen(): byte length of the UTF-8 code.
            if (System.Text.Encoding.UTF8.GetByteCount(Php.CleanCode(raw)) > MasterRepository.MaxLength(kind))
            {
                Fail("The code is too long (up to " + MasterRepository.MaxLength(kind) + " characters).");
            }
            if (repo.FindByCode(kind, code) != null)
            {
                Fail(code + " is already in the list.");
            }
            int newId = repo.Insert(kind, code, name, active);
            Ok("Added " + code + ".", new Row { { "id", newId } });
        }

        /// <summary>POST admin/masters/sync { kind? } — add values already used on assets but missing from the list.</summary>
        public void Sync()
        {
            string kind = Request.Post("kind", "");
            int added = new MasterRepository(Db).SyncFromAssets(MasterRepository.IsKind(kind) ? kind : null);
            Ok(added != 0 ? "Added " + added + " value(s) in use." : "Every value in use is already in the list.", new Row { { "added", added } });
        }
    }
}
