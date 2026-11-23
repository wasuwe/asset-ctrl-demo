using System.Collections.Generic;
using AssetCtrl.Core;
using AssetCtrl.Repositories;

namespace AssetCtrl.Api.Controllers
{
    /// <summary>JSON lookups for autocomplete fields.</summary>
    public class LookupController : ApiController
    {
        public override void Before()
        {
            RequireAbility("assets.view");
        }

        /// <summary>
        /// GET lookup/assets?q= (min. 2 characters, prefix match on the asset number)
        /// -> [{id, asset_no, description, work_center, work_center_name, area, status}], limited to what the user can see.
        /// </summary>
        public void Assets()
        {
            string term = Request.Query("q", "");
            // strlen: bytes, like PHP
            if (System.Text.Encoding.UTF8.GetByteCount(term) < 2)
            {
                Respond(new List<object>());
            }
            Respond(new AssetRepository(Db).Suggest(term, Auth));
        }
    }
}
