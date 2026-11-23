using AssetCtrl.Core;
using AssetCtrl.Repositories;

namespace AssetCtrl.Services
{
    /// <summary>Numbers shared by the public dashboard, admin dashboard and user home.</summary>
    public static class DashboardData
    {
        /// <param name="scope">null = whole organisation</param>
        public static Row Build(Database db, Auth scope = null)
        {
            var stats = new StatsRepository(db);
            return new Row
            {
                { "byStatus", stats.ByStatus(scope) },
                { "matrix", stats.TypeStatusMatrix(scope) },
                { "locations", stats.ByLocation(scope) },
                { "workCenters", stats.TopWorkCenters(scope) },
                { "ticketSummary", new TicketRepository(db).Summary() },
            };
        }
    }
}
