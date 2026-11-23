using System;
using System.IO;
using System.Web.UI;

namespace AssetCtrl
{
    /// <summary>
    /// The single Web Forms page: the browser app shell (same markup as asset_ctrl_v2/public/index.html).
    /// Asset URLs carry the file time as ?v= so browsers reload them after an update.
    /// </summary>
    public class DefaultPage : Page
    {
        protected override void OnLoad(EventArgs e)
        {
            Response.Cache.SetCacheability(System.Web.HttpCacheability.NoCache);
            base.OnLoad(e);
        }

        protected string Asset(string path)
        {
            string file = Server.MapPath("~/assets/" + path);
            long v = File.Exists(file) ? File.GetLastWriteTimeUtc(file).Ticks / TimeSpan.TicksPerSecond : 0;
            return ResolveUrl("~/assets/" + path) + "?v=" + v;
        }
    }
}
