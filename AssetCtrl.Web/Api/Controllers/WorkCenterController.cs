using System.Text;
using System.Text.RegularExpressions;
using AssetCtrl.Core;
using AssetCtrl.Repositories;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>
    /// Work Center Master (admin, users.manage): the single place where codes and
    /// names are kept. Imports never overwrite a name set here.
    /// </summary>
    public class WorkCenterController : ApiController
    {
        public override void Before()
        {
            RequireAdmin();
            RequireAbility("users.manage");
        }

        /// <summary>GET admin/work-centers?q=&amp;active=&amp;page= -> { rows, pager, filters, inactive_count }</summary>
        public void Index()
        {
            var f = new Row
            {
                { "q", Request.Query("q", "") },
                { "active", Request.Query("active", "") },
            };
            var result = new WorkCenterRepository(Db).Search(f, Request.Int("page", 1));
            var o = Paged((System.Collections.Generic.List<Row>)result["rows"], (Paginator)result["pager"]);
            o["filters"] = f;
            o["inactive_count"] = Php.ToInt(Db.Value("SELECT COUNT(*) FROM work_centers WHERE is_active = 0"));
            o["tabs"] = new MasterRepository(Db).Tabs(); // shown as a tab of Master data
            Respond(o);
        }

        /// <summary>GET admin/work-centers/show?id= -> Work Center with asset_count, user_count</summary>
        public void Show()
        {
            var wc = new WorkCenterRepository(Db).Find(Request.Int("id"));
            if (wc == null)
            {
                NotFound("Work Center not found.");
            }
            Respond(WorkCenterRepository.Shape(wc));
        }

        private static readonly Regex CodeRe = new Regex(@"^[A-Z0-9]{1,16}$");

        /// <summary>POST admin/work-centers/save { id?, code (new only), name, is_active }</summary>
        public void Save()
        {
            var repo = new WorkCenterRepository(Db);
            int id = Request.Int("id");
            string name = SubstrBytes(Php.CleanCode(Request.Post("name", "")), 191);
            bool active = Request.Post("is_active", "1") == "1";
            if (id != 0)
            {
                var wc = repo.Find(id);
                if (wc == null)
                {
                    NotFound("Work Center not found.");
                }
                repo.Update(wc.Long("id"), name, active);
                Ok("Saved Work Center " + wc.Str("code") + ".", new Row { { "id", wc.Int("id") } });
            }
            string code = Php.CleanCode(Request.Post("code", ""));
            if (!CodeRe.IsMatch(code))
            {
                Fail("The Work Center code may only use A-Z and 0-9 (up to 16 characters, without the name).");
            }
            if (repo.FindByCode(code) != null)
            {
                Fail("Work Center " + code + " already exists.");
            }
            int newId = repo.IdFor(code, name) ?? 0;
            repo.Update(newId, name, active);
            Ok("Added Work Center " + code + ".", new Row { { "id", newId } });
        }

        /// <summary>
        /// PHP substr($s, 0, $n): the first n bytes of the UTF-8 string. A character cut in half
        /// is dropped instead of being written as a broken byte sequence.
        /// </summary>
        internal static string SubstrBytes(string s, int n)
        {
            if (Encoding.UTF8.GetByteCount(s) <= n)
            {
                return s;
            }
            var sb = new StringBuilder();
            int bytes = 0;
            for (int i = 0; i < s.Length; i++)
            {
                int len = char.IsHighSurrogate(s[i]) && i + 1 < s.Length ? 2 : 1;
                int b = Encoding.UTF8.GetByteCount(s.Substring(i, len));
                if (bytes + b > n)
                {
                    break;
                }
                sb.Append(s, i, len);
                bytes += b;
                i += len - 1;
            }
            return sb.ToString();
        }
    }
}
