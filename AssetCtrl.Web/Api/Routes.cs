namespace AssetCtrl.Api
{
    /// <summary>
    /// Every API route (port of app/Api/routes/*.php). Action names are the PHP method names;
    /// the kernel calls the C# method with the first letter upper-cased (index -> Index).
    /// Routes whose controller is not ported yet answer 501 (see Kernel).
    /// </summary>
    public static class Routes
    {
        public static Router Build()
        {
            var r = new Router();

            // Session, account and dashboards
            r.Get("session", "SessionController", "show")
             .Post("login", "SessionController", "login")
             .Post("logout", "SessionController", "logout")
             .Post("account/password", "SessionController", "changePassword")
             .Post("account/profile", "SessionController", "updateProfile")
             .Get("nav-counts", "SessionController", "navCounts")
             .Get("dashboard", "DashboardController", "publicView")
             .Get("admin/dashboard", "DashboardController", "admin")
             .Get("user/home", "DashboardController", "userHome");

            // Assets (admin + user areas), bulk edit, export and asset lookup
            r.Get("admin/assets", "AssetController", "index")
             .Get("admin/assets/show", "AssetController", "show")
             .Get("admin/assets/form", "AssetController", "form")
             .Post("admin/assets/save", "AssetController", "save")
             .Post("admin/assets/bulk-preview", "AssetController", "bulkPreview")
             .Post("admin/assets/bulk-apply", "AssetController", "bulkApply")
             .Get("user/assets", "AssetController", "index")
             .Get("user/assets/show", "AssetController", "show")
             .Get("user/assets/form", "AssetController", "form")
             .Post("user/assets/save", "AssetController", "save")
             .Get("export/info", "ExportController", "info")
             .Get("export/download", "ExportController", "download")
             .Get("lookup/assets", "LookupController", "assets")
             .Get("public/assets", "PublicAssetController", "index");

            // Repair tickets and the Setting Room
            r.Get("admin/tickets", "TicketController", "adminIndex")
             .Get("user/tickets", "TicketController", "userIndex")
             .Get("tickets/show", "TicketController", "show")
             .Get("tickets/create-form", "TicketController", "createForm")
             .Post("tickets/store", "TicketController", "store")
             .Post("tickets/status", "TicketController", "status")
             .Post("tickets/note", "TicketController", "note")
             .Post("tickets/assign", "TicketController", "assign")
             .Post("tickets/take", "TicketController", "take")
             .Post("tickets/queue-jump", "TicketController", "queueJump")
             .Post("admin/tickets/bulk", "TicketController", "bulk")
             .Get("admin/receiving/export", "ReceivingController", "export")
             .Get("admin/receiving", "ReceivingController", "index")
             .Post("admin/receiving/receive", "ReceivingController", "receive")
             .Post("admin/receiving/send-out", "ReceivingController", "sendOut");

            // Admin settings and data
            r.Get("admin/users", "UserController", "index")
             .Get("admin/users/form", "UserController", "form")
             .Post("admin/users/save", "UserController", "save")
             .Post("admin/users/active", "UserController", "setActive")
             .Post("admin/users/reset-password", "UserController", "resetPassword")

             .Get("admin/work-centers", "WorkCenterController", "index")
             .Get("admin/work-centers/show", "WorkCenterController", "show")
             .Post("admin/work-centers/save", "WorkCenterController", "save")

             .Get("admin/masters", "MasterController", "index")
             .Get("admin/masters/show", "MasterController", "show")
             .Post("admin/masters/save", "MasterController", "save")
             .Post("admin/masters/sync", "MasterController", "sync")

             .Get("admin/history", "HistoryController", "index")

             .Get("admin/import", "ImportController", "index")
             .Post("admin/import/upload", "ImportController", "upload")
             .Post("admin/import/upload-chunk", "ImportController", "uploadChunk")
             .Get("admin/import/preview", "ImportController", "preview")
             .Post("admin/import/apply", "ImportController", "apply")
             .Post("admin/import/discard", "ImportController", "discard")

             .Get("admin/audit", "AuditController", "index")
             .Post("admin/audit/start", "AuditController", "start")
             .Get("admin/audit/round", "AuditController", "round")
             .Get("admin/audit/scan", "AuditController", "scan")
             .Post("admin/audit/check", "AuditController", "check")
             .Post("admin/audit/close", "AuditController", "close")
             .Post("admin/audit/delete-check", "AuditController", "deleteCheck")
             .Post("admin/audit/delete", "AuditController", "deleteRound")
             .Get("admin/audit/export", "AuditController", "export");

            return r;
        }
    }
}
