<%@ Page Language="C#" AutoEventWireup="true" Inherits="AssetCtrl.DefaultPage" EnableViewState="false" EnableSessionState="false" %>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Asset Ctrl</title>
<script>
  // Light/dark: the user's choice (localStorage ac_theme, set by the header toggle) or else the OS setting.
  // Also restore the collapsed sidebar. Runs before first paint so the page never flashes the wrong theme.
  (function () {
    var saved = null;
    try { saved = localStorage.getItem('ac_theme'); } catch (e) {}
    var dark = saved === 'dark' || saved === 'light' ? saved === 'dark'
      : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    try { if (localStorage.getItem('ac_sidebar') === 'collapsed') { document.documentElement.classList.add('sidebar-collapsed'); } } catch (e) {}
  })();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="<%= Asset("vendor/bootstrap/bootstrap.min.css") %>">
<link rel="stylesheet" href="<%= Asset("vendor/bootstrap-icons/bootstrap-icons.min.css") %>">
<link rel="stylesheet" href="<%= Asset("theme.css") %>">
<link rel="icon" href="<%= Asset("favicon.svg") %>" type="image/svg+xml">
</head>
<body>
<!-- Shell page (Web Forms). Everything inside #app is rendered by assets/js from the JSON API (api.ashx). -->
<div id="app"><div class="py-5 text-center text-secondary"><div class="spinner-border spinner-border-sm me-2"></div>Loading…</div></div>

<div class="modal fade" id="app-modal" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-dialog-scrollable modal-xl" id="app-modal-dialog"></div>
</div>
<div class="toast-container position-fixed bottom-0 end-0 p-3" id="toasts"></div>
<noscript><div class="container py-5">This application needs JavaScript enabled.</div></noscript>

<script src="<%= Asset("vendor/bootstrap/bootstrap.bundle.min.js") %>"></script>
<script src="<%= Asset("js/i18n.js") %>"></script>
<!-- Thai dictionaries (English text -> Thai), one per area -->
<script src="<%= Asset("js/lang/th-core.js") %>"></script>
<script src="<%= Asset("js/lang/th-assets.js") %>"></script>
<script src="<%= Asset("js/lang/th-tickets.js") %>"></script>
<script src="<%= Asset("js/lang/th-admin.js") %>"></script>
<!-- Demo mode: built-in sample data used when the database cannot be connected -->
<script src="<%= Asset("js/demo-api.js") %>"></script>
<script src="<%= Asset("js/core.js") %>"></script>
<script src="<%= Asset("js/components.js") %>"></script>
<script src="<%= Asset("js/mascot.js") %>"></script>
<!-- Camera button on IT asset fields (barcode / QR / text); libraries load on first use -->
<script src="<%= Asset("js/scanner.js") %>"></script>
<!-- Page modules: each registers its routes with AC.route() -->
<script src="<%= Asset("js/pages/core-pages.js") %>"></script>
<script src="<%= Asset("js/pages/assets.js") %>"></script>
<script src="<%= Asset("js/pages/tickets.js") %>"></script>
<script src="<%= Asset("js/pages/admin.js") %>"></script>
<script>AC.boot();</script>
</body>
</html>
