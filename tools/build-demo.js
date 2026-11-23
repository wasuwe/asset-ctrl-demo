/*
 * Builds the static demo that is deployed to Vercel (Vercel cannot run .NET Framework / IIS).
 *
 * - Turns AssetCtrl.Web/Default.aspx into dist/index.html (the <%= Asset("x") %> calls become assets/x?v=<mtime>).
 * - Copies AssetCtrl.Web/assets/ to dist/assets/.
 * - Writes dist/api-demo.json = { code: "db_unavailable" }. vercel.json rewrites api.ashx to that file,
 *   so the browser app switches to Demo mode (assets/js/demo-api.js) and runs on built-in sample data,
 *   exactly as it does when the real server cannot reach PostgreSQL.
 */
'use strict';
var fs = require('fs');
var path = require('path');

var web = path.join(__dirname, '..', 'AssetCtrl.Web');
var out = path.join(__dirname, '..', 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copy(from, to) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(function (name) { copy(path.join(from, name), path.join(to, name)); });
  } else {
    fs.copyFileSync(from, to);
  }
}
copy(path.join(web, 'assets'), path.join(out, 'assets'));

var html = fs.readFileSync(path.join(web, 'Default.aspx'), 'utf8')
  .replace(/^<%@[^%]*%>\s*/, '')
  .replace(/<%=\s*Asset\("([^"]+)"\)\s*%>/g, function (_, p) {
    var v = Math.floor(fs.statSync(path.join(web, 'assets', p)).mtimeMs / 1000);
    return 'assets/' + p + '?v=' + v;
  });
if (/<%/.test(html)) { throw new Error('Default.aspx has server code the demo build does not handle.'); }
fs.writeFileSync(path.join(out, 'index.html'), html);

fs.writeFileSync(path.join(out, 'api-demo.json'), JSON.stringify({
  ok: false,
  code: 'db_unavailable',
  errors: ['No database on this host: running in Demo mode.'],
}));
console.log('Demo built in dist/');
