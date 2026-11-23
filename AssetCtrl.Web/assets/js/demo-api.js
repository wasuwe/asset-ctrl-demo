/*
 * Asset Ctrl — Demo mode.
 *
 * When the backend answers { code: 'db_unavailable' } (HTTP 503: the database cannot be reached),
 * core.js switches AC.state.demo on and sends every API call here instead of to the server, so the
 * whole app keeps working in the browser with built-in sample data:
 *
 *   ACDemo.handle(method, route, params, body) -> Promise of the same envelope the server returns:
 *       { ok: true, data } | { ok: true, message, data } | { ok: false, errors, status, code }
 *   ACDemo.start()       shows the "Demo mode" strip (once) and blocks file downloads
 *   ACDemo.loginHint()   demo sign-in codes for the sign-in modal
 *
 * Only made-up demo data (Work Centers D100/D200/D300, assets DEMO-*, users DEMO01 / EMP00xx).
 * Dates are relative to "now". Simple changes (asset save, tickets, Setting Room, bulk edit) are kept
 * in memory until the page is reloaded; other writes answer "Demo mode: nothing was saved.".
 * A full page load always starts in real mode again, so the app returns to the database by itself.
 *
 * Loaded before core.js; uses window.ACI18N for messages and window.AC only at call time.
 */
(function (root) {
  'use strict';

  function T(s, vars) { return root.ACI18N ? root.ACI18N.t(s, vars) : s; }
  function lang() { return root.ACI18N ? root.ACI18N.lang() : 'en'; }

  /* ------------------------------------------------------------- dates */

  var NOW = new Date();
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function stamp(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function now() { return stamp(new Date()); }
  /** ago({ days, hours, minutes }) -> 'YYYY-MM-DD HH:MM:SS' that long before the page loaded. */
  function ago(o) {
    var ms = ((o.days || 0) * 1440 + (o.hours || 0) * 60 + (o.minutes || 0)) * 60000;
    return stamp(new Date(NOW.getTime() - ms));
  }
  var MONTH_START = new Date(NOW.getFullYear(), NOW.getMonth(), 1);
  /** A moment this month, about `hours` ago (never before the 1st). */
  function thisMonth(hours) {
    var t = NOW.getTime() - hours * 3600000;
    if (t < MONTH_START.getTime()) { t = MONTH_START.getTime() + (NOW.getTime() - MONTH_START.getTime()) / 2; }
    return stamp(new Date(t));
  }
  function lastMonth(days) { return stamp(new Date(MONTH_START.getTime() - days * 86400000)); }
  function isThisMonth(v) { return !!v && v >= stamp(MONTH_START); }
  var YYMM = String(NOW.getFullYear()).slice(2) + pad(NOW.getMonth() + 1);

  /* ------------------------------------------------------- small helpers */

  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function sum(arr, fn) { return arr.reduce(function (s, x) { return s + (fn(x) ? 1 : 0); }, 0); }
  function uniq(arr) { return arr.filter(function (v, i) { return v && arr.indexOf(v) === i; }).sort(); }
  function up(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase(); }
  function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }
  /** Read a field from a plain object or FormData body. */
  function field(body, k) {
    if (!body) { return undefined; }
    if (typeof FormData !== 'undefined' && body instanceof FormData) { return body.get(k); }
    return body[k];
  }
  function list(v) { return v === undefined || v === null || v === '' ? [] : (Array.isArray(v) ? v : [v]); }

  /* ---------------------------------------------------------------- meta */

  var ASSET_STATUSES = [['USE', 'In use', 'ok'], ['SPARE', 'Spare', 'info'], ['STOCK', 'In stock', 'neutral'],
    ['REPAIR', 'In repair', 'warn'], ['FAIL', 'Broken', 'bad'], ['DISPOSE', 'Disposed', 'muted'], ['LOST', 'Lost', 'lost']];
  var TICKET_STATUSES = [['new', 'New', 'info'], ['assigned', 'Assigned', 'neutral'], ['in_progress', 'In progress', 'warn'],
    ['waiting_parts', 'Waiting for parts', 'warn'], ['resolved', 'Resolved', 'ok'], ['closed', 'Closed', 'muted'], ['cancelled', 'Cancelled', 'muted']];
  var OPEN = ['new', 'assigned', 'in_progress', 'waiting_parts'];
  var TRANSITIONS = {
    'new': ['assigned', 'in_progress', 'cancelled'],
    assigned: ['in_progress', 'waiting_parts', 'resolved', 'cancelled'],
    in_progress: ['waiting_parts', 'resolved'],
    waiting_parts: ['in_progress', 'resolved'],
    resolved: ['closed', 'in_progress'],
    closed: [], cancelled: [],
  };
  var FIELD_LABELS = {
    asset_no: 'IT Asset', fix_no: 'Fix No.', asset_type: 'Type', description: 'Description',
    work_center: 'Work Center', work_center_name: 'Work Center Name', pc_type: 'Type PC',
    location: 'Location', building: 'Building / floor', area: 'Area', remark: 'Remark',
    status: 'Status', os_name: 'OS', os_version: 'OS Version', brand: 'Brand', model: 'Model',
    cpu: 'CPU', ram: 'RAM', mac_address: 'MAC Address', last_use: 'Last Use', editor_note: 'Member',
    updated_at: 'Last updated', updated_by_name: 'Updated by', department: 'Work Center (master sheet)',
  };
  var USER_EDITABLE = ['area', 'remark', 'status', 'building', 'location'];
  var ADMIN_EDITABLE = ['fix_no', 'description', 'work_center', 'pc_type', 'location', 'building', 'area', 'remark', 'status', 'os_name', 'os_version'];
  var BULK_EDITABLE = ['status', 'work_center', 'location', 'building', 'area', 'remark', 'pc_type'];
  var EXPORT_COLUMNS = ['asset_no', 'fix_no', 'description', 'os_name', 'os_version', 'work_center', 'pc_type', 'building', 'location', 'area', 'remark', 'status', 'editor_note', 'last_use'];
  var REPAIR_AREA = 'ICS-SETTING-ROOM';

  function meta() {
    var pairs = function (arr) { return arr.map(function (s) { return { code: s[0], label: T(s[1]), tone: s[2] }; }); };
    var labels = {};
    Object.keys(FIELD_LABELS).forEach(function (k) { labels[k] = T(FIELD_LABELS[k]); });
    return {
      lang: lang(), app_name: 'Asset Ctrl', org_name: 'IT Section', repair_area: REPAIR_AREA,
      asset_type_labels: {},
      asset_statuses: pairs(ASSET_STATUSES),
      ticket_statuses: pairs(TICKET_STATUSES),
      ticket_steps: ['new', 'assigned', 'in_progress', 'resolved', 'closed'],
      ticket_open_statuses: OPEN,
      ticket_transitions: TRANSITIONS,
      priorities: [{ code: 'normal', label: T('Normal'), tone: 'neutral' }, { code: 'urgent', label: T('Urgent'), tone: 'bad' }],
      roles: [{ code: 'admin', label: T('Admin (IT team)') }, { code: 'user', label: T('User (department staff)') }],
      field_labels: labels,
      user_editable: USER_EDITABLE,
      admin_editable: ADMIN_EDITABLE,
      bulk_editable: BULK_EDITABLE,
      history_sources: [['edit', 'Web edit'], ['bulk', 'Bulk edit'], ['import', 'File import'], ['repair', 'Repair'], ['audit', 'Audit'], ['migration', 'Legacy migration']]
        .map(function (s) { return { code: s[0], label: T(s[1]) }; }),
      export_presets: [{ code: 'full', label: T('All columns (re-importable)'), columns: EXPORT_COLUMNS }],
    };
  }
  function statusLabel(code) {
    for (var i = 0; i < TICKET_STATUSES.length; i++) { if (TICKET_STATUSES[i][0] === code) { return T(TICKET_STATUSES[i][1]); } }
    return code;
  }
  function isAssetStatus(code) { return ASSET_STATUSES.some(function (s) { return s[0] === code; }); }

  /* ----------------------------------------------------------- demo data */

  var D = null; // built on first use, so labels use the language chosen by core.js

  function build() {
    var WCS = [
      { id: 1, code: 'D100', name: 'DEMO-A', is_active: true },
      { id: 2, code: 'D200', name: 'DEMO-B', is_active: true },
      { id: 3, code: 'D300', name: 'DEMO-C', is_active: true },
    ];
    var USERS = [
      { id: 1, emp_code: 'DEMO01', first_name: 'สมชาย', last_name: 'ใจดี', email: 'demo01@example.com', phone: '02-000-1234',
        role: 'user', can_repair: false, is_active: true, must_change_password: false, wcs: ['D100', 'D200'], last_login_at: ago({ minutes: 12 }) },
      { id: 2, emp_code: 'EMP0007', first_name: 'Admin', last_name: 'เอ', email: 'admin.a@example.com', phone: '02-000-0007',
        role: 'admin', can_repair: true, is_active: true, must_change_password: false, wcs: [], last_login_at: ago({ minutes: 3 }) },
      { id: 3, emp_code: 'EMP0008', first_name: 'Admin', last_name: 'บี', email: 'admin.b@example.com', phone: '02-000-0008',
        role: 'admin', can_repair: true, is_active: true, must_change_password: false, wcs: [], last_login_at: ago({ hours: 5 }) },
      { id: 4, emp_code: 'EMP1311', first_name: 'วิไล', last_name: '', email: '', phone: '',
        role: 'user', can_repair: false, is_active: true, must_change_password: false, wcs: ['D300'], last_login_at: null },
      { id: 5, emp_code: 'EMP0950', first_name: 'มานพ', last_name: '', email: '', phone: '',
        role: 'user', can_repair: false, is_active: false, must_change_password: false, wcs: ['D100'], last_login_at: ago({ days: 95 }) },
    ];
    var wcBy = {};
    WCS.forEach(function (w) { wcBy[w.code] = w; });

    var assets = [];
    function A(id, no, type, desc, wc, area, status, pcType, loc, bld, opt) {
      opt = opt || {};
      var w = wcBy[wc];
      assets.push({
        id: id, asset_no: no, asset_type: type, fix_no: 'DEMO-FA-' + ('000' + id).slice(-4), description: desc,
        os_name: opt.os === undefined ? 'Windows 11 Pro' : opt.os, os_version: opt.osv === undefined ? '23H2' : opt.osv,
        work_center: wc, work_center_name: w.name, work_center_id: w.id, department: wc + '-' + w.name,
        pc_type: pcType, location: loc, building: bld, area: area, remark: opt.remark || '', status: status,
        editor_note: 'DEMO01', last_use: ago({ days: 3 }).slice(0, 10),
        updated_at: ago({ days: 2 }), updated_by_name: 'Admin เอ',
        // Monthly department check: about half were saved by a User this month (green rows).
        user_checked_at: opt.checked ? thisMonth(opt.checked) : (opt.unchecked ? lastMonth(opt.unchecked) : null),
      });
    }
    A(1, 'DEMO-PC-001', 'PC', 'Desktop PC', 'D100', 'LINE-A3', 'USE', 'DESKTOP', 'BLDG-A', 'A-1F', { checked: 30 });
    A(2, 'DEMO-PC-002', 'PC', 'Desktop PC', 'D100', 'LINE-A4', 'USE', 'DESKTOP', 'BLDG-A', 'A-1F', { checked: 50 });
    A(3, 'DEMO-PC-003', 'PC', 'Desktop PC', 'D100', 'LINE-A3', 'USE', 'DESKTOP', 'BLDG-A', 'A-1F', { unchecked: 4 });
    A(4, 'DEMO-PC-004', 'PC', 'Desktop PC', 'D300', REPAIR_AREA, 'REPAIR', 'DESKTOP', 'BLDG-C', 'C-1F', { checked: 70 });
    A(5, 'DEMO-NB-001', 'NB', 'Notebook', 'D100', REPAIR_AREA, 'REPAIR', 'NOTEBOOK', 'BLDG-A', 'A-2F', { remark: 'ใช้ที่ห้องประชุม', checked: 26 });
    A(6, 'DEMO-NB-002', 'NB', 'Notebook', 'D200', 'OFFICE-2F', 'STOCK', 'NOTEBOOK', 'BLDG-B', 'B-2F', {});
    A(7, 'DEMO-MN-001', 'MN', 'Monitor 24"', 'D200', 'QC-ROOM', 'SPARE', '', 'BLDG-B', 'B-1F', { os: '', osv: '', checked: 75 });
    A(8, 'DEMO-PR-001', 'PR', 'Printer', 'D200', REPAIR_AREA, 'FAIL', '', 'BLDG-B', 'B-1F', { os: '', osv: '', unchecked: 9 });
    A(9, 'DEMO-PC-005', 'PC', 'Desktop PC', 'D200', 'LINE-B2', 'USE', 'DESKTOP', 'BLDG-B', 'B-1F', { checked: 5 });
    A(10, 'DEMO-PC-006', 'PC', 'Desktop PC', 'D300', 'LINE-C2', 'USE', 'DESKTOP', 'BLDG-C', 'C-1F', { unchecked: 12 });
    A(11, 'DEMO-NB-003', 'NB', 'Notebook', 'D300', 'OFFICE-1F', 'USE', 'NOTEBOOK', 'BLDG-C', 'C-1F', { checked: 2 });
    A(12, 'DEMO-MN-002', 'MN', 'Monitor 22"', 'D100', 'LINE-A3', 'USE', '', 'BLDG-A', 'A-1F', { os: '', osv: '' });

    var tickets = [];
    function Tk(id, no, assetNo, flo, status, title, symptom, reporterId, o) {
      var a = assets.filter(function (x) { return x.asset_no === assetNo; })[0];
      var t = {
        id: id, ticket_no: 'RP' + YYMM + '-' + no, flolites_no: flo, title: title, symptom: symptom,
        priority: o.priority || 'normal', category: 'hardware', status: status,
        asset_id: a.id, asset_no_raw: a.asset_no, reporter_id: reporterId,
        contact_name: null, contact_phone: null, location_note: o.original_area || a.area,
        assignee_id: o.assignee || null,
        created_at: ago({ hours: o.created }), updated_at: ago({ hours: Math.max(0.2, (o.received || o.created) - 0.5) }),
        assigned_at: o.assignee ? ago({ hours: o.created - 0.5 }) : null,
        started_at: o.started ? ago({ hours: o.started }) : null,
        resolved_at: o.resolved ? ago({ hours: o.resolved }) : null, closed_at: null,
        resolution: o.resolution || null,
        received_at: o.received ? ago({ hours: o.received }) : null, returned_at: null,
        original_area: o.original_area || null, queue_pos: o.received ? -o.received : null, queue_jumped: false,
        events: [],
      };
      var rep = USERS.filter(function (u) { return u.id === reporterId; })[0];
      t.contact_name = uname(rep);
      t.contact_phone = rep.phone || '02-000-1234';
      t.events.push(ev('created', rep, null, null, null, t.created_at));
      if (t.assignee_id) {
        var asg = USERS.filter(function (u) { return u.id === t.assignee_id; })[0];
        t.events.push(ev('assigned', asg, null, uname(asg), null, t.assigned_at));
        if (t.received_at) { t.events.push(ev('received', asg, t.original_area, REPAIR_AREA, null, t.received_at)); }
        if (t.started_at) { t.events.push(ev('status', asg, 'assigned', 'in_progress', null, t.started_at)); }
        if (status === 'waiting_parts') { t.events.push(ev('status', asg, 'in_progress', 'waiting_parts', 'สั่งชุดลูกกลิ้งดึงกระดาษแล้ว', ago({ hours: 90 }))); }
        if (t.resolved_at) { t.events.push(ev('status', asg, 'in_progress', 'resolved', null, t.resolved_at)); }
      }
      tickets.push(t);
    }
    Tk(42, '0042', 'DEMO-PC-002', 'DEMO-0153', 'new', 'เปิดเครื่องไม่ติด', 'เปิดเครื่องไม่ติด มีเสียงบี๊บ 3 ครั้ง', 1, { created: 1.5 });
    Tk(39, '0039', 'DEMO-NB-001', 'DEMO-0149', 'in_progress', 'จอกระพริบ เปิดโปรแกรมช้า', 'จอกระพริบเป็นช่วง ๆ และเปิดโปรแกรมช้ามาก', 1,
      { created: 30, assignee: 2, received: 28, original_area: 'OFFICE-2F', started: 27 });
    Tk(36, '0036', 'DEMO-PR-001', 'DEMO-0141', 'waiting_parts', 'พิมพ์ไม่ออก กระดาษติด', 'พิมพ์ไม่ออก ไฟ error กระพริบ กระดาษติดบ่อย', 1,
      { created: 100, assignee: 3, received: 96, original_area: 'QC-ROOM', started: 95 });
    Tk(31, '0031', 'DEMO-PC-004', 'DEMO-0128', 'resolved', 'Windows Update ค้าง', 'Windows Update ค้างที่ 35% เปิดเครื่องแล้วรีสตาร์ทวนไปมา', 4,
      { created: 150, assignee: 2, received: 148, original_area: 'LINE-C1', started: 147, resolved: 20, resolution: 'ล้าง update cache และติดตั้ง update ใหม่ ทดสอบผ่าน' });

    // A busy month: 64 more sample tickets spread over the last 5 weeks (several today), so the date filter,
    // paging, the today strip and bulk actions have something to show. Not in the Setting Room.
    (function () {
      var problems = [
        ['เปิดเครื่องไม่ติด', 'กดปุ่มเปิดแล้วไม่มีไฟ'], ['เครื่องช้ามาก', 'เปิดโปรแกรมช้า ค้างบ่อย'], ['เข้าระบบไม่ได้', 'ใส่รหัสผ่านแล้วขึ้น error'],
        ['เมาส์ไม่ทำงาน', 'ขยับเมาส์แล้วเคอร์เซอร์ไม่ขยับ'], ['พิมพ์ไม่ออก', 'สั่งพิมพ์แล้วงานค้างในคิว'], ['จอดับเป็นช่วง ๆ', 'จอดับเองแล้วกลับมาติด'],
        ['ต่อเน็ตไม่ได้', 'ไอคอนเครือข่ายขึ้นเครื่องหมายตกใจ'], ['คีย์บอร์ดบางปุ่มไม่ติด', 'ปุ่ม Enter กดไม่ติด'], ['สแกนเนอร์อ่านบาร์โค้ดไม่ได้', 'ยิงบาร์โค้ดแล้วไม่ขึ้นข้อมูล'],
      ];
      var seed = 7;
      var rnd = function (n) { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * n); };
      var nos = assets.filter(function (a) { return a.status !== 'LOST'; }).map(function (a) { return a.asset_no; });
      for (var i = 0; i < 64; i++) {
        var h = i < 9 ? 0.3 + i * 0.6 : 6 + (i - 9) * 15 + rnd(10);
        var pr = problems[rnd(problems.length)];
        var tech = rnd(2) ? 2 : 3;
        var status, o = { created: h, priority: rnd(9) === 0 ? 'urgent' : 'normal' };
        if (h < 24) {
          status = ['new', 'new', 'assigned', 'in_progress', 'resolved', 'closed'][rnd(6)];
        } else if (h < 120) {
          status = ['assigned', 'in_progress', 'resolved', 'resolved', 'closed', 'closed', 'cancelled'][rnd(7)];
        } else {
          status = ['closed', 'closed', 'closed', 'closed', 'resolved', 'cancelled'][rnd(6)];
        }
        if (status !== 'new' && status !== 'cancelled') { o.assignee = tech; }
        if (o.assignee && status !== 'assigned') { o.started = h * 0.8; }
        if (status === 'resolved' || status === 'closed') { o.resolved = h * 0.5; o.resolution = 'แก้ไขแล้ว ทดสอบใช้งานได้'; }
        Tk(101 + i, String(5001 + i), nos[rnd(nos.length)], 'DEMO-' + (2001 + i), status, pr[0], pr[1], rnd(3) ? 1 : 4, o);
        var t = tickets[tickets.length - 1];
        if (status === 'closed' || status === 'cancelled') {
          t.closed_at = ago({ hours: h * 0.4 });
          t.updated_at = t.closed_at;
          t.events.push(ev('status', USERS[tech - 1], status === 'closed' ? 'resolved' : 'new', status, status === 'cancelled' ? 'แจ้งซ้ำ' : null, t.closed_at));
        }
      }
    })();

    var history = [
      { id: 105, asset_id: 5, field: 'area', old_value: 'OFFICE-2F', new_value: REPAIR_AREA, source: 'repair', note: tickets[1].ticket_no, ref_id: 39, user_name: 'Admin เอ', changed_at: ago({ hours: 28 }) },
      { id: 104, asset_id: 5, field: 'status', old_value: 'USE', new_value: 'REPAIR', source: 'repair', note: tickets[1].ticket_no, ref_id: 39, user_name: 'Admin เอ', changed_at: ago({ hours: 28 }) },
      { id: 103, asset_id: 5, field: 'remark', old_value: '', new_value: 'ใช้ที่ห้องประชุม', source: 'edit', note: '', ref_id: null, user_name: 'สมชาย ใจดี', changed_at: ago({ hours: 30 }) },
      { id: 102, asset_id: 8, field: 'area', old_value: 'QC-ROOM', new_value: REPAIR_AREA, source: 'repair', note: tickets[2].ticket_no, ref_id: 36, user_name: 'Admin บี', changed_at: ago({ hours: 96 }) },
      { id: 101, asset_id: 7, field: 'status', old_value: 'USE', new_value: 'SPARE', source: 'edit', note: '', ref_id: null, user_name: 'Admin บี', changed_at: ago({ days: 3, hours: 2 }) },
      { id: 100, asset_id: 6, field: 'building', old_value: 'B-1F', new_value: 'B-2F', source: 'import', note: '', ref_id: 7, user_name: 'Admin เอ', changed_at: ago({ days: 12 }) },
    ];

    var masters = {
      pc_type: [
        { id: 11, kind: 'pc_type', code: 'DESKTOP', name: 'Desktop PC', is_active: true, asset_count: 694 },
        { id: 12, kind: 'pc_type', code: 'NOTEBOOK', name: 'Notebook', is_active: true, asset_count: 345 },
        { id: 13, kind: 'pc_type', code: 'AIO', name: 'All-in-one PC', is_active: true, asset_count: 0 },
        { id: 14, kind: 'pc_type', code: 'THIN', name: 'Thin client', is_active: false, asset_count: 0 },
      ],
      location: [
        { id: 21, kind: 'location', code: 'BLDG-A', name: '', is_active: true, asset_count: 352 },
        { id: 22, kind: 'location', code: 'BLDG-B', name: '', is_active: true, asset_count: 486 },
        { id: 23, kind: 'location', code: 'BLDG-C', name: '', is_active: true, asset_count: 410 },
      ],
      building: [
        { id: 31, kind: 'building', code: 'A-1F', name: '', is_active: true, asset_count: 210 },
        { id: 32, kind: 'building', code: 'A-2F', name: '', is_active: true, asset_count: 142 },
        { id: 33, kind: 'building', code: 'B-1F', name: '', is_active: true, asset_count: 260 },
        { id: 34, kind: 'building', code: 'B-2F', name: '', is_active: true, asset_count: 226 },
        { id: 35, kind: 'building', code: 'C-1F', name: '', is_active: true, asset_count: 410 },
      ],
    };

    var batch = {
      id: 7, filename: 'master-sheet-demo.csv', status: 'preview', total_rows: 1248,
      create_count: 6, update_count: 5, same_count: 1232, error_count: 2, missing_count: 3,
      uploaded_by_name: 'Admin เอ', created_at: ago({ minutes: 8 }), applied_at: null,
    };
    var older = { id: 6, filename: 'master-sheet-demo-old.xlsx', status: 'applied', total_rows: 1240,
      create_count: 3, update_count: 18, same_count: 1219, error_count: 0, missing_count: 0,
      uploaded_by_name: 'Admin บี', created_at: ago({ days: 12, minutes: 20 }), applied_at: ago({ days: 12 }) };

    D = {
      wcs: WCS, users: USERS, assets: assets, tickets: tickets, history: history, masters: masters,
      batches: [batch, older],
      batchRows: {
        update: [
          { line_no: 14, asset_no: 'DEMO-NB-002', diff: { status: ['SPARE', 'STOCK'], building: ['B-1F', 'B-2F'] } },
          { line_no: 27, asset_no: 'DEMO-MN-001', diff: { area: ['LINE-B2', 'QC-ROOM'] } },
          { line_no: 31, asset_no: 'DEMO-PC-003', diff: { os_version: ['22H2', '23H2'] } },
          { line_no: 52, asset_no: 'DEMO-PC-006', diff: { remark: ['', 'เครื่องสำรองไลน์ C'], os_version: ['22H2', '23H2'] } },
          { line_no: 88, asset_no: 'DEMO-PR-001', diff: { fix_no: ['', 'DEMO-FA-0008'] } },
        ],
        create: [1, 2, 3, 4, 5, 6].map(function (i) {
          return { line_no: 1200 + i, asset_no: 'DEMO-PC-1' + pad(i), payload: { description: 'Desktop PC', work_center: 'D300', _wc_name: 'DEMO-C', area: 'LINE-C2', status: 'STOCK' } };
        }),
        error: [
          { line_no: 640, asset_no: '', message: T('IT Asset is blank.') },
          { line_no: 977, asset_no: 'DEMO-PC-0X9', message: T('Unknown status "{status}".', { status: 'BROKE' }) },
        ],
      },
      rounds: [
        { id: 2, name: 'ตรวจนับประจำปี ' + NOW.getFullYear(), location: '', checked: 812, total: 1210, started_by_name: 'Admin เอ', is_open: true, started_at: ago({ days: 6 }), closed_at: null },
        { id: 1, name: 'ตรวจอาคาร A', location: 'BLDG-A', checked: 340, total: 340, started_by_name: 'Admin บี', is_open: false, started_at: ago({ days: 40 }), closed_at: ago({ days: 37 }) },
      ],
      checks: [
        { id: 903, round_id: 2, asset_id: 1, result: 'found', network: 'online', area_found: 'LINE-A3', note: '', checked_by_name: 'Admin เอ', checked_at: ago({ minutes: 40 }) },
        { id: 902, round_id: 2, asset_id: 7, result: 'moved', network: '', area_found: 'QC-ROOM', note: 'ย้ายมาจาก LINE-B2', checked_by_name: 'Admin เอ', checked_at: ago({ hours: 2 }) },
        { id: 901, round_id: 2, asset_id: 10, result: 'damaged', network: 'offline', area_found: 'LINE-C2', note: 'ฝาเคสแตก', checked_by_name: 'Admin บี', checked_at: ago({ hours: 26 }) },
      ],
      nextId: 1000,
      nextTicketNo: 43,
      queueSeq: 1,
    };
    return D;
  }
  function data() { return D || build(); }

  function uname(u) { return (u.first_name + ' ' + u.last_name).trim(); }
  function ev(type, user, from, to, note, at) {
    return { event_type: type, user_name: user ? uname(user) : null, from_value: from, to_value: to, note: note, created_at: at };
  }
  function userById(id) { return data().users.filter(function (u) { return u.id === Number(id); })[0] || null; }
  function wcByCode(code) { return data().wcs.filter(function (w) { return w.code === code; })[0] || null; }
  function wcById(id) { return data().wcs.filter(function (w) { return String(w.id) === String(id); })[0] || null; }
  function assetById(id) { return data().assets.filter(function (a) { return a.id === Number(id); })[0] || null; }
  function assetByNo(no) { no = up(no); return data().assets.filter(function (a) { return a.asset_no === no; })[0] || null; }
  function ticketById(id) { return data().tickets.filter(function (t) { return t.id === Number(id); })[0] || null; }
  function wcObj(w) { return { id: w.id, code: w.code, name: w.name }; }

  /* ------------------------------------------------------------- session */

  var KEY = 'ac_demo_uid'; // demo sign-in survives the language switch (it reloads the page)
  var uid = null;
  try { uid = Number(sessionStorage.getItem(KEY)) || null; } catch (e) { /* ignore */ }
  function setUid(id) {
    uid = id;
    try { if (id) { sessionStorage.setItem(KEY, String(id)); } else { sessionStorage.removeItem(KEY); } } catch (e) { /* ignore */ }
  }
  function me() { return uid ? userById(uid) : null; }
  function isAdmin() { var u = me(); return !!(u && u.role === 'admin'); }

  function sessionUser() {
    var u = me();
    if (!u) { return null; }
    var admin = u.role === 'admin';
    return {
      id: u.id, emp_code: u.emp_code, first_name: u.first_name, last_name: u.last_name, name: uname(u),
      email: u.email, phone: u.phone, role: u.role, is_admin: admin, can_repair: u.can_repair,
      must_change_password: !!u.must_change_password,
      work_centers: admin ? [] : u.wcs.map(function (c) { return wcObj(wcByCode(c)); }),
      abilities: admin
        ? ['assets.view', 'assets.edit', 'assets.create', 'assets.export', 'tickets.create', 'tickets.manage', 'history.view_all', 'audit.run', 'import.run', 'users.manage']
        : ['assets.view', 'assets.edit', 'assets.export', 'tickets.create'],
    };
  }

  /* --------------------------------------------------------------- views */

  function visibleAssets() {
    var u = me();
    return isAdmin() ? data().assets : data().assets.filter(function (a) { return u.wcs.indexOf(a.work_center) !== -1; });
  }
  function canSeeTicket(t) {
    var u = me();
    if (isAdmin()) { return true; }
    var a = assetById(t.asset_id);
    return t.reporter_id === u.id || (a && u.wcs.indexOf(a.work_center) !== -1);
  }

  /** Setting Room queue: open tickets in the room, in the order they were received (queue jumps go first). */
  function queueOrder() {
    return data().tickets.filter(function (t) { return t.received_at && !t.returned_at && OPEN.indexOf(t.status) !== -1; })
      .sort(function (a, b) { return a.queue_pos - b.queue_pos; });
  }

  /** Ticket as the API sends it (joined with asset, people and the live queue position). */
  function tv(t) {
    var a = assetById(t.asset_id), rep = userById(t.reporter_id), asg = t.assignee_id ? userById(t.assignee_id) : null;
    var q = queueOrder(), pos = q.indexOf(t);
    var out = {};
    Object.keys(t).forEach(function (k) { if (k !== 'events' && k !== 'asset_no_raw' && k !== 'queue_pos') { out[k] = t[k]; } });
    out.asset_no = a ? a.asset_no : t.asset_no_raw;
    out.asset_description = a ? a.description : null;
    out.asset_area = a ? a.area : null;
    out.asset_status = a ? a.status : null;
    out.work_center_id = a ? a.work_center_id : null;
    out.work_center = a ? a.work_center : null;
    out.work_center_name = a ? a.work_center_name : null;
    out.reporter_name = rep ? uname(rep) : null;
    out.assignee_name = asg ? uname(asg) : null;
    out.in_room = !!(t.received_at && !t.returned_at);
    out.queue_no = pos === -1 ? null : pos + 1;
    out.queue_ahead = pos === -1 ? null : pos;
    out.is_open = OPEN.indexOf(t.status) !== -1;
    return out;
  }

  function av(a) {
    var out = copy(a);
    var open = data().tickets.filter(function (t) { return t.asset_id === a.id && OPEN.indexOf(t.status) !== -1; })[0];
    out.open_ticket_no = open ? open.ticket_no : null;
    out.checked_this_month = isThisMonth(a.user_checked_at);
    return out;
  }

  function hv(h) {
    var a = assetById(h.asset_id);
    var out = copy(h);
    out.asset_no = a ? a.asset_no : '';
    out.work_center = a ? a.work_center : '';
    out.ticket_no = h.source === 'repair' ? h.note : null;
    return out;
  }

  function pager(n, page, per) {
    per = per || 25;
    var pages = Math.max(1, Math.ceil(n / per));
    page = Math.min(Math.max(1, Number(page) || 1), pages);
    return { total: n, page: page, pages: pages, per_page: per, from: n ? (page - 1) * per + 1 : 0, to: Math.min(n, page * per) };
  }
  function paged(rows, q, per) {
    var p = pager(rows.length, q && q.page, per);
    return { rows: rows.slice(p.from ? p.from - 1 : 0, p.to), pager: p };
  }

  /* --------------------------------------------------------------- assets */

  function assetOptions(rows) {
    var wcs = isAdmin() ? data().wcs : data().wcs.filter(function (w) { return me().wcs.indexOf(w.code) !== -1; });
    var col = function (k) { return uniq(rows.map(function (a) { return a[k]; })); };
    var masters = {};
    Object.keys(data().masters).forEach(function (k) {
      masters[k] = data().masters[k].filter(function (m) { return m.is_active; }).map(function (m) { return [m.code, m.code]; });
    });
    return {
      work_centers: wcs.map(wcObj), locations: col('location'), buildings: col('building'), types: col('asset_type'),
      pc_types: col('pc_type'), os: col('os_name'), masters: masters,
    };
  }

  function filterAssets(rows, q) {
    var s = up(q.q);
    if (s) { rows = rows.filter(function (a) { return up([a.asset_no, a.fix_no, a.description, a.area, a.remark].join(' ')).indexOf(s) !== -1; }); }
    if (q.status) {
      var codes = String(q.status).split(',');
      rows = rows.filter(function (a) { return codes.indexOf(a.status || 'UNKNOWN') !== -1; });
    }
    [['type', 'asset_type'], ['pc_type', 'pc_type'], ['location', 'location'], ['building', 'building'], ['os', 'os_name']].forEach(function (p) {
      if (q[p[0]]) { rows = rows.filter(function (a) { return a[p[1]] === q[p[0]]; }); }
    });
    if (q.wc) { rows = rows.filter(function (a) { return q.wc === 'none' ? !a.work_center : String(a.work_center_id) === String(q.wc); }); }
    if (q.has_ticket === '1') { rows = rows.filter(function (a) { return av(a).open_ticket_no; }); }
    if (q.checked === 'done') { rows = rows.filter(function (a) { return isThisMonth(a.user_checked_at); }); }
    if (q.checked === 'pending') { rows = rows.filter(function (a) { return !isThisMonth(a.user_checked_at); }); }
    return rows;
  }

  function sortRows(rows, key, dir) {
    if (!key) { return rows; }
    var k = key === 'work_center' ? 'department' : key;
    var m = dir === 'desc' ? -1 : 1;
    return rows.slice().sort(function (a, b) { return String(a[k] || '').localeCompare(String(b[k] || '')) * m; });
  }

  function assetList(q) {
    var base = visibleAssets();
    var rows = sortRows(filterAssets(base, q), q.sort, q.dir);
    var per = [25, 50, 100].indexOf(Number(q.per)) !== -1 ? Number(q.per) : 25;
    var out = paged(rows.map(av), q, per);
    var f = {};
    ['q', 'status', 'wc', 'location', 'building', 'type', 'pc_type', 'os', 'has_ticket', 'checked'].forEach(function (k) { f[k] = q[k] || ''; });
    var summaryRows = filterAssets(base, Object.assign({}, q, { checked: '' }));
    out.filter = f;
    out.options = assetOptions(base);
    out.per_page = per;
    out.per_page_options = [25, 50, 100];
    out.check_summary = { done: sum(summaryRows, function (a) { return isThisMonth(a.user_checked_at); }), total: summaryRows.length };
    return out;
  }

  function assetShow(q) {
    var a = q.id ? assetById(q.id) : assetByNo(q.no);
    if (!a || visibleAssets().indexOf(a) === -1) { return fail(T('Asset not found.'), 404); }
    var hist = data().history.filter(function (h) { return h.asset_id === a.id; });
    var counts = {};
    hist.forEach(function (h) { counts[h.field] = (counts[h.field] || 0) + 1; });
    if (q.field) { hist = hist.filter(function (h) { return h.field === q.field; }); }
    return {
      asset: av(a), history: hist.map(hv), history_field: q.field || '', field_counts: counts,
      tickets: data().tickets.filter(function (t) { return t.asset_id === a.id; }).map(tv),
      editable: isAdmin() ? ADMIN_EDITABLE : USER_EDITABLE,
    };
  }

  function assetForm(q) {
    var a = q.id ? assetById(q.id) : null;
    if (q.id && (!a || visibleAssets().indexOf(a) === -1)) { return fail(T('Asset not found.'), 404); }
    return {
      asset: a ? av(a) : {}, is_new: !a, editable: isAdmin() ? ADMIN_EDITABLE : USER_EDITABLE,
      work_centers: data().wcs.map(wcObj), masters: assetOptions(data().assets).masters,
    };
  }

  function addHistory(a, fld, oldV, newV, source, note, refId) {
    var u = me();
    data().history.unshift({ id: data().nextId++, asset_id: a.id, field: fld, old_value: oldV, new_value: newV,
      source: source, note: note || '', ref_id: refId || null, user_name: u ? uname(u) : null, changed_at: now() });
  }

  /** Apply { field: value } to an asset, recording history. Returns the changed field names. */
  function applyChanges(a, values, source, note, refId) {
    var changed = [];
    Object.keys(values).forEach(function (f) {
      var v = values[f] === null || values[f] === undefined ? '' : String(values[f]).trim();
      if (['fix_no', 'location', 'building', 'pc_type', 'status', 'work_center'].indexOf(f) !== -1) { v = v.toUpperCase(); }
      var old = a[f] === null || a[f] === undefined ? '' : String(a[f]);
      if (old === v) { return; }
      if (f === 'work_center') {
        var w = wcByCode(v);
        a.work_center = w ? w.code : '';
        a.work_center_name = w ? w.name : '';
        a.work_center_id = w ? w.id : null;
        a.department = w ? w.code + '-' + w.name : '';
      } else {
        a[f] = v;
      }
      addHistory(a, f, old, v, source, note, refId);
      changed.push(f);
    });
    if (changed.length) { a.updated_at = now(); a.updated_by_name = me() ? uname(me()) : null; }
    return changed;
  }

  function assetSave(body) {
    var id = Number(field(body, 'id')) || 0;
    var editable = isAdmin() ? ADMIN_EDITABLE : USER_EDITABLE;
    var values = {};
    editable.forEach(function (f) { var v = field(body, f); if (v !== undefined) { values[f] = v; } });
    if (values.status !== undefined && values.status !== '' && !isAssetStatus(values.status)) { return fail(T('Choose a valid asset status.')); }
    if (!id) {
      if (!isAdmin()) { return fail(T('You do not have permission to edit assets.'), 403); }
      var no = up(field(body, 'asset_no'));
      if (!no) { return fail(T('IT Asset is blank.')); }
      if (assetByNo(no)) { return fail(T('{no} is already in the register.', { no: no })); }
      var w = wcByCode(up(values.work_center));
      var a = { id: data().nextId++, asset_no: no, asset_type: no.split('-')[1] || '', fix_no: '', description: '', os_name: '', os_version: '',
        work_center: w ? w.code : '', work_center_name: w ? w.name : '', work_center_id: w ? w.id : null, department: w ? w.code + '-' + w.name : '',
        pc_type: '', location: '', building: '', area: '', remark: '', status: '', editor_note: '', last_use: '',
        updated_at: now(), updated_by_name: uname(me()), user_checked_at: null };
      delete values.work_center;
      Object.keys(values).forEach(function (f) { a[f] = ['description', 'area', 'remark', 'os_name', 'os_version'].indexOf(f) !== -1 ? str(values[f]) : up(values[f]); });
      data().assets.push(a);
      addHistory(a, '_created', null, null, 'edit', '', null);
      return ok(T('Asset added.') + demoNote(), { id: a.id });
    }
    var asset = assetById(id);
    if (!asset || visibleAssets().indexOf(asset) === -1) { return fail(T('Asset not found.'), 404); }
    var changed = applyChanges(asset, values, 'edit', str(field(body, 'change_note')), null);
    if (!isAdmin()) { asset.user_checked_at = now(); } // a User save = checked for this month (green row)
    if (!changed.length) {
      return ok(T(isAdmin() ? 'Nothing changed.' : 'Checked for this month. Nothing changed.') + demoNote(), { id: asset.id, changed: [] });
    }
    return ok(T('{no} saved: {fields}', { no: asset.asset_no, fields: changed.map(function (f) { return T(FIELD_LABELS[f] || f); }).join(', ') }) + demoNote(),
      { id: asset.id, changed: changed });
  }

  function bulkValues(body) {
    var values = {};
    BULK_EDITABLE.forEach(function (f) { var v = str(field(body, 'bulk_' + f)); if (v !== '') { values[f] = v; } });
    return values;
  }
  function bulkTargets(body) {
    if (field(body, 'select_all') === '1') { return filterAssets(visibleAssets(), body); }
    var ids = list(field(body, 'ids')).map(Number);
    return data().assets.filter(function (a) { return ids.indexOf(a.id) !== -1; });
  }
  function bulkProposed(values, clear) {
    var p = Object.assign({}, values);
    clear.forEach(function (f) { p[f] = ''; });
    return p;
  }
  function bulkPreview(body) {
    var assets = bulkTargets(body);
    if (!assets.length) { return fail(T('No assets selected.')); }
    var values = bulkValues(body), clear = list(field(body, 'bulk_clear'));
    var proposed = bulkProposed(values, clear);
    if (!Object.keys(proposed).length) { return fail(T('Enter at least one value to change.')); }
    var changeCount = 0;
    var rows = assets.map(function (a) {
      var diff = {};
      Object.keys(proposed).forEach(function (f) {
        var old = String(a[f] || ''), nv = f === 'remark' || f === 'area' ? proposed[f] : up(proposed[f]);
        if (old !== nv) { diff[f] = [old, nv]; }
      });
      if (Object.keys(diff).length) { changeCount++; }
      return { id: a.id, asset_no: a.asset_no, description: a.description, work_center: a.work_center, work_center_name: a.work_center_name, diff: diff };
    });
    return { ok: true, data: { ids: assets.map(function (a) { return a.id; }), rows: rows, change_count: changeCount, proposed: proposed,
      values: values, clear: clear, note: str(field(body, 'bulk_note')) } };
  }
  function bulkApply(body) {
    var ids = list(field(body, 'ids')).map(Number);
    var assets = data().assets.filter(function (a) { return ids.indexOf(a.id) !== -1; });
    if (!assets.length) { return fail(T('No assets selected.')); }
    var proposed = bulkProposed(bulkValues(body), list(field(body, 'bulk_clear')));
    var n = 0;
    assets.forEach(function (a) { if (applyChanges(a, proposed, 'bulk', str(field(body, 'bulk_note')), null).length) { n++; } });
    return ok(T('Updated {assets} asset(s).', { assets: n }) + demoNote(), { assets: n });
  }

  /* -------------------------------------------------------------- tickets */

  function ticketCounts(rows) {
    var u = me();
    return {
      open_count: sum(rows, function (t) { return OPEN.indexOf(t.status) !== -1; }),
      unassigned: sum(rows, function (t) { return OPEN.indexOf(t.status) !== -1 && !t.assignee_id; }),
      mine: sum(rows, function (t) { return t.assignee_id === u.id && (OPEN.indexOf(t.status) !== -1 || t.status === 'resolved'); }),
      resolved: sum(rows, function (t) { return t.status === 'resolved'; }),
      done: sum(rows, function (t) { return t.status === 'closed' || t.status === 'cancelled'; }),
      all_count: rows.length,
      reported: sum(rows, function (t) { return t.reporter_id === u.id; }),
    };
  }
  function ticketView(rows, view) {
    var u = me();
    var keep = {
      open: function (t) { return OPEN.indexOf(t.status) !== -1; },
      unassigned: function (t) { return OPEN.indexOf(t.status) !== -1 && !t.assignee_id; },
      mine: function (t) { return t.assignee_id === u.id && (OPEN.indexOf(t.status) !== -1 || t.status === 'resolved'); },
      resolved: function (t) { return t.status === 'resolved'; },
      done: function (t) { return t.status === 'closed' || t.status === 'cancelled'; },
      reported: function (t) { return t.reporter_id === u.id; },
    }[view];
    if (keep) { rows = rows.filter(keep); }
    // by priority, then oldest first
    return rows.slice().sort(function (a, b) {
      return ((a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1)) || a.created_at.localeCompare(b.created_at);
    });
  }
  function technicians() {
    return data().users.filter(function (u) { return u.role === 'admin' && u.can_repair && u.is_active; }).map(function (u) {
      return { id: u.id, emp_code: u.emp_code, name: uname(u),
        open_count: sum(data().tickets, function (t) { return t.assignee_id === u.id && OPEN.indexOf(t.status) !== -1; }) };
    });
  }

  /** Reported-date period -> { period, from, to } (YYYY-MM-DD, inclusive), like TicketController::period(). */
  function ticketPeriod(period, from, to) {
    var day = function (offset) { return stamp(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset)).slice(0, 10); };
    var valid = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : ''; };
    var today = day(0);
    switch (period) {
      case 'today': return { period: period, from: today, to: today };
      case 'yesterday': return { period: period, from: day(-1), to: day(-1) };
      case '7d': return { period: period, from: day(-6), to: today };
      case '30d': return { period: period, from: day(-29), to: today };
      case 'month': return { period: period, from: stamp(MONTH_START).slice(0, 10), to: today };
      case 'custom':
        from = valid(from); to = valid(to);
        if (from && to && from > to) { var x = from; from = to; to = x; }
        return { period: period, from: from, to: to };
    }
    return { period: '', from: '', to: '' };
  }
  function inRange(t, f) {
    var d = t.created_at.slice(0, 10);
    return (!f.from || d >= f.from) && (!f.to || d <= f.to);
  }

  /** Admin list filter from a query / bulk body (same keys as the server). */
  function adminTicketFilter(q) {
    var views = ['open', 'mine', 'unassigned', 'resolved', 'done', 'all'];
    var f = {
      view: views.indexOf(q.view) !== -1 ? q.view : 'open', status: str(q.status), priority: str(q.priority),
      assignee: str(q.assignee), work_center: str(q.work_center), q: str(q.q),
    };
    var r = ticketPeriod(str(q.period), str(q.from), str(q.to));
    f.period = r.period; f.from = r.from; f.to = r.to;
    return f;
  }

  /** Tickets matching a list filter (admin: every filter; user: view + q), plus the base set the tab counts use. */
  function ticketRows(f, admin) {
    var base = data().tickets.filter(canSeeTicket);
    if (admin) { base = base.filter(function (t) { return inRange(t, f); }); }
    var rows = ticketView(base, f.view);
    if (admin) {
      if (f.status) { rows = rows.filter(function (t) { return t.status === f.status; }); }
      if (f.priority) { rows = rows.filter(function (t) { return t.priority === f.priority; }); }
      if (f.assignee) { rows = rows.filter(function (t) { return String(t.assignee_id) === String(f.assignee); }); }
      if (f.work_center) { rows = rows.filter(function (t) { var a = assetById(t.asset_id); return a && String(a.work_center_id) === String(f.work_center); }); }
    }
    if (f.q) {
      var s = up(f.q);
      rows = rows.filter(function (t) { var v = tv(t); return up([v.ticket_no, v.flolites_no, v.asset_no, v.title, v.symptom, v.contact_name].join(' ')).indexOf(s) !== -1; });
    }
    if (f.view === 'done' || f.view === 'all') { rows = rows.slice().sort(function (a, b) { return b.updated_at.localeCompare(a.updated_at); }); }
    return { base: base, rows: rows };
  }

  /** Numbers for the strip above the admin ticket list. */
  function ticketToday() {
    var ts = data().tickets, today = now().slice(0, 10);
    var isOpen = function (t) { return OPEN.indexOf(t.status) !== -1; };
    var on = function (v) { return !!v && v.slice(0, 10) === today; };
    return {
      reported_today: sum(ts, function (t) { return on(t.created_at); }),
      resolved_today: sum(ts, function (t) { return on(t.resolved_at); }),
      closed_today: sum(ts, function (t) { return t.status === 'closed' && on(t.closed_at); }),
      open_now: sum(ts, isOpen),
      urgent_open: sum(ts, function (t) { return isOpen(t) && t.priority === 'urgent'; }),
      unassigned: sum(ts, function (t) { return isOpen(t) && !t.assignee_id; }),
    };
  }

  var BULK_MAX = 500;

  function ticketList(q, admin) {
    var f = admin ? adminTicketFilter(q) : { view: q.view || 'open', q: str(q.q) };
    var r = ticketRows(f, admin);
    var out = paged(r.rows.map(tv), q, admin ? 30 : 25);
    out.counts = ticketCounts(r.base);
    out.filters = f;
    if (admin) {
      out.technicians = technicians();
      out.work_centers = data().wcs.map(wcObj);
      out.today = ticketToday();
      out.bulk_max = BULK_MAX;
    } else {
      out.my_queue = r.base.map(tv).filter(function (t) { return t.is_open || (t.in_room && t.status === 'resolved'); })
        .sort(function (a, b) { return (a.queue_no === null) - (b.queue_no === null) || (a.queue_no || 0) - (b.queue_no || 0); });
      out.queue_length = queueOrder().length;
    }
    return out;
  }

  /** POST admin/tickets/bulk: assign / priority / close for the ticked tickets (or all matching the filter). */
  function ticketBulk(body) {
    if (!isAdmin()) { return fail(T('You do not have permission to do this.'), 403); }
    var action = field(body, 'action');
    if (['assign', 'priority', 'close'].indexOf(action) === -1) { return fail(T('Choose what to change.')); }
    var ids;
    if (field(body, 'select_all') === '1') {
      var q = {};
      ['view', 'status', 'priority', 'assignee', 'work_center', 'q', 'period', 'from', 'to'].forEach(function (k) { q[k] = field(body, k); });
      ids = ticketRows(adminTicketFilter(q), true).rows.map(function (t) { return t.id; });
    } else {
      var raw = field(body, 'ids');
      ids = (Array.isArray(raw) ? raw : (raw ? [raw] : [])).map(Number).filter(Boolean);
    }
    if (!ids.length) { return fail(T('No tickets selected.')); }
    if (ids.length > BULK_MAX) { return fail(T('Select at most {n} tickets at a time. Narrow the filter first.', { n: BULK_MAX })); }
    var to = Number(field(body, 'assignee_id')) || null;
    var prio = str(field(body, 'priority'));
    if (action === 'priority' && ['low', 'normal', 'high', 'urgent'].indexOf(prio) === -1) { return fail(T('Choose a priority.')); }
    var note = str(field(body, 'note'));
    var done = 0, same = 0, skipped = [];
    ids.forEach(function (id) {
      var t = ticketById(id);
      if (!t) { return; }
      if (action === 'assign') {
        if ((t.assignee_id || null) === to) { same++; return; }
        if (t.status === 'closed' || t.status === 'cancelled') { skipped.push({ ticket_no: t.ticket_no, reason: T('This ticket is already closed.') }); return; }
        var oldU = t.assignee_id ? userById(t.assignee_id) : null, newU = to ? userById(to) : null;
        addEvent(t, 'assigned', oldU ? uname(oldU) : null, newU ? uname(newU) : null, note);
        t.assignee_id = to;
        t.assigned_at = to ? now() : null;
        if (to && t.status === 'new') { addEvent(t, 'status', 'new', 'assigned', null); t.status = 'assigned'; }
      } else if (action === 'priority') {
        if (t.priority === prio) { same++; return; }
        addEvent(t, 'priority', t.priority, prio, null);
        t.priority = prio;
      } else {
        if (t.status === 'closed') { same++; return; }
        if (t.status !== 'resolved') { skipped.push({ ticket_no: t.ticket_no, reason: T('Only repaired tickets can be closed here.') }); return; }
        addEvent(t, 'status', 'resolved', 'closed', note);
        t.status = 'closed';
        t.closed_at = now();
      }
      done++;
    });
    return ok(T('{done} tickets updated, {same} already like that, {skipped} skipped.', { done: done, same: same, skipped: skipped.length }) + demoNote(),
      { done: done, unchanged: same, skipped: skipped });
  }

  function ticketShow(q) {
    var t = ticketById(q.id);
    if (!t || !canSeeTicket(t)) { return fail(T('Repair ticket not found.'), 404); }
    var admin = isAdmin();
    return { ticket: tv(t), events: t.events.slice(), transitions: admin ? TRANSITIONS[t.status] : [], can_manage: admin, technicians: admin ? technicians() : [] };
  }

  function createForm(q) {
    var a = assetByNo(q.asset_no);
    if (a && visibleAssets().indexOf(a) === -1) { a = null; }
    var u = me();
    return {
      asset: a ? { id: a.id, asset_no: a.asset_no, description: a.description, work_center: a.work_center, work_center_name: a.work_center_name, area: a.area, status: a.status } : null,
      open_for_asset: a ? data().tickets.filter(function (t) { return t.asset_id === a.id && OPEN.indexOf(t.status) !== -1; })
        .map(function (t) { return { id: t.id, ticket_no: t.ticket_no, status: t.status }; }) : [],
      defaults: { contact_name: uname(u), contact_phone: u.phone, location_note: a ? a.area : '' },
    };
  }

  function addEvent(t, type, from, to, note) {
    t.events.push(ev(type, me(), from, to, note || null, now()));
    t.updated_at = now();
  }

  function receive(t, note) {
    var a = assetById(t.asset_id);
    t.original_area = a.area;
    t.received_at = now();
    t.returned_at = null;
    t.queue_pos = data().queueSeq++ + 1e6; // after everyone already waiting
    applyChanges(a, { area: REPAIR_AREA, status: 'REPAIR' }, 'repair', t.ticket_no, t.id);
    addEvent(t, 'received', t.original_area, REPAIR_AREA, note);
    return tv(t).queue_no;
  }

  function ticketStore(body) {
    var flo = up(field(body, 'flolites_no')), title = str(field(body, 'title')), symptom = str(field(body, 'symptom'));
    var errors = [];
    if (!flo) { errors.push(T('Please enter the Flowlites number.')); }
    if (!title) { errors.push(T('Please enter a title.')); }
    if (symptom.length < 5) { errors.push(T('Describe the problem (at least 5 characters).')); }
    var a = assetByNo(field(body, 'asset_no'));
    if (up(field(body, 'asset_no')) && (!a || visibleAssets().indexOf(a) === -1)) {
      errors.push(T('Asset {no} is not in the register, so it cannot be received into the room.', { no: up(field(body, 'asset_no')) }));
    }
    if (errors.length) { return fail(errors); }
    var u = me();
    var t = {
      id: data().nextId++, ticket_no: 'RP' + YYMM + '-' + ('000' + data().nextTicketNo++).slice(-4), flolites_no: flo, title: title, symptom: symptom,
      priority: field(body, 'priority') === 'urgent' ? 'urgent' : 'normal', category: 'hardware', status: 'new',
      asset_id: a ? a.id : null, asset_no_raw: up(field(body, 'asset_no')) || null, reporter_id: u.id,
      contact_name: str(field(body, 'contact_name')) || uname(u), contact_phone: str(field(body, 'contact_phone')),
      location_note: a ? a.area : '', assignee_id: null, created_at: now(), updated_at: now(), assigned_at: null, started_at: null,
      resolved_at: null, closed_at: null, resolution: null, received_at: null, returned_at: null, original_area: null,
      queue_pos: null, queue_jumped: false, events: [],
    };
    t.events.push(ev('created', u, null, null, null, t.created_at));
    data().tickets.push(t);
    if (field(body, 'receive_now') === '1' && isAdmin() && a) {
      var qn = receive(t, '');
      return ok(T('{ticket} created and {asset} received. Queue no. {queue}.', { ticket: t.ticket_no, asset: a.asset_no, queue: qn }) + demoNote(),
        { id: t.id, ticket_no: t.ticket_no, received: true, queue_no: qn });
    }
    return ok(T('Repair ticket {no} submitted.', { no: t.ticket_no }) + demoNote(), { id: t.id, ticket_no: t.ticket_no, received: false });
  }

  function ticketStatus(body) {
    var t = ticketById(field(body, 'id'));
    if (!t) { return fail(T('Repair ticket not found.'), 404); }
    var to = field(body, 'to');
    if (TRANSITIONS[t.status].indexOf(to) === -1) {
      return fail(T('Cannot change the status from "{from}" to "{to}".', { from: statusLabel(t.status), to: statusLabel(to) }));
    }
    var note = str(field(body, 'note'));
    if (to === 'resolved' && !str(field(body, 'resolution'))) { return fail(T('Describe what was done.')); }
    var from = t.status;
    t.status = to;
    var stampNow = now();
    if (to === 'in_progress' && !t.started_at) { t.started_at = stampNow; }
    if (to === 'resolved') { t.resolved_at = stampNow; t.resolution = str(field(body, 'resolution')); }
    if (from === 'resolved' && to === 'in_progress') { t.resolved_at = null; }
    if (to === 'closed' || to === 'cancelled') { t.closed_at = stampNow; }
    if (to === 'assigned' && !t.assignee_id) { t.assignee_id = me().id; t.assigned_at = stampNow; }
    addEvent(t, 'status', from, to, note);
    var a = assetById(t.asset_id);
    var as = up(field(body, 'asset_status'));
    if (a && as && isAssetStatus(as) && as !== a.status) { addEvent(t, 'asset', a.status, as, null); applyChanges(a, { status: as }, 'repair', t.ticket_no, t.id); }
    if (to === 'closed' && field(body, 'return_device') === '1' && t.received_at && !t.returned_at && a) {
      t.returned_at = stampNow;
      applyChanges(a, { area: t.original_area || '' }, 'repair', t.ticket_no, t.id);
      addEvent(t, 'returned', REPAIR_AREA, t.original_area, null);
    }
    return ok(T('Status changed to "{status}".', { status: statusLabel(to) }) + demoNote(), { id: t.id, status: to });
  }

  function ticketNote(body) {
    var t = ticketById(field(body, 'id'));
    if (!t || !canSeeTicket(t)) { return fail(T('Repair ticket not found.'), 404); }
    var note = str(field(body, 'note'));
    if (!note) { return fail(T('Please write a note.')); }
    addEvent(t, 'note', null, null, note);
    var a = assetById(t.asset_id), as = up(field(body, 'asset_status'));
    if (isAdmin() && a && as && isAssetStatus(as) && as !== a.status) { addEvent(t, 'asset', a.status, as, null); applyChanges(a, { status: as }, 'repair', t.ticket_no, t.id); }
    return ok(T('Note added.') + demoNote());
  }

  function ticketAssign(body) {
    var t = ticketById(field(body, 'id'));
    if (!t) { return fail(T('Repair ticket not found.'), 404); }
    var to = Number(field(body, 'assignee_id')) || null;
    if (to !== t.assignee_id) {
      var oldU = t.assignee_id ? userById(t.assignee_id) : null, newU = to ? userById(to) : null;
      t.assignee_id = to;
      t.assigned_at = to ? now() : null;
      if (to && t.status === 'new') { t.status = 'assigned'; }
      addEvent(t, 'assigned', oldU ? uname(oldU) : null, newU ? uname(newU) : null, str(field(body, 'note')));
    }
    var prio = field(body, 'priority');
    if ((prio === 'urgent' || prio === 'normal') && prio !== t.priority) { addEvent(t, 'priority', t.priority, prio, null); t.priority = prio; }
    return ok(T('Assignment saved.') + demoNote());
  }

  function ticketTake(body) {
    var t = ticketById(field(body, 'id'));
    if (!t) { return fail(T('Repair ticket not found.'), 404); }
    var u = me();
    if (t.assignee_id !== u.id) {
      var oldU = t.assignee_id ? userById(t.assignee_id) : null;
      t.assignee_id = u.id;
      t.assigned_at = now();
      addEvent(t, 'assigned', oldU ? uname(oldU) : null, uname(u), null);
    }
    if (t.status === 'new' || t.status === 'assigned') {
      addEvent(t, 'status', t.status, 'in_progress', null);
      t.status = 'in_progress';
      if (!t.started_at) { t.started_at = now(); }
    }
    return ok(T('You took the job.') + demoNote());
  }

  function queueJump(body) {
    var t = ticketById(field(body, 'id'));
    var q = queueOrder(), from = q.indexOf(t) + 1;
    if (!t || !from) { return fail(T('This device is not in the Setting Room queue (it must be received IN first).')); }
    t.queue_pos = Math.min.apply(null, q.map(function (x) { return x.queue_pos; })) - 1;
    t.queue_jumped = true;
    addEvent(t, 'queue_jump', String(from), '1', str(field(body, 'note')));
    return ok(T('{asset} moved up the queue: no. {from} → no. {to}.', { asset: tv(t).asset_no, from: from, to: 1 }) + demoNote());
  }

  function roomReceive(body) {
    var t = ticketById(field(body, 'id'));
    if (!t) { return fail(T('Repair ticket not found.'), 404); }
    if (!t.asset_id) { return fail(T('This ticket has no registered asset, so it cannot be received.')); }
    if (t.received_at && !t.returned_at) { return fail(T('This device was already received into the room on {date}.', { date: t.received_at })); }
    var qn = receive(t, str(field(body, 'note')));
    return ok(T('{asset} received. Queue no. {queue}.', { asset: tv(t).asset_no, queue: qn }) + demoNote(), { id: t.id, queue_no: qn });
  }

  function roomSendOut(body) {
    var t = ticketById(field(body, 'id'));
    if (!t || !t.received_at || t.returned_at) { return fail(T('This device is not in the Setting Room.')); }
    var as = up(field(body, 'asset_status'));
    if (!isAssetStatus(as)) { return fail(T('Choose a valid asset status.')); }
    var a = assetById(t.asset_id);
    var area = str(field(body, 'area')) || t.original_area || '';
    t.returned_at = now();
    applyChanges(a, { area: area, status: as }, 'repair', t.ticket_no, t.id);
    addEvent(t, 'returned', REPAIR_AREA, area, str(field(body, 'note')));
    if (field(body, 'close') === '1' && t.status === 'resolved') {
      addEvent(t, 'status', 'resolved', 'closed', null);
      t.status = 'closed';
      t.closed_at = now();
    }
    return ok(T('{asset} sent out of the Setting Room.', { asset: a.asset_no }) + demoNote(), { id: t.id });
  }

  function receiving(q) {
    var mode = q.mode === 'out' ? 'out' : 'in';
    var scan = up(q.scan);
    var matches = [], asset = null, outTicket = null;
    var hit = function (t) { var v = tv(t); return [v.asset_no, v.ticket_no, v.flolites_no].indexOf(scan) !== -1; };
    if (scan) {
      if (mode === 'in') {
        matches = data().tickets.filter(function (t) { return OPEN.indexOf(t.status) !== -1 && hit(t); }).map(tv);
        var a = assetByNo(scan);
        if (!matches.length && a) {
          asset = { id: a.id, asset_no: a.asset_no, description: a.description, work_center: a.work_center, work_center_name: a.work_center_name, area: a.area, status: a.status };
        }
      } else {
        data().tickets.forEach(function (t) { if (t.received_at && !t.returned_at && hit(t)) { outTicket = tv(t); } });
      }
    }
    var room = data().tickets.filter(function (t) { return t.received_at && !t.returned_at; }).map(tv)
      .sort(function (a, b) { return (a.queue_no === null) - (b.queue_no === null) || (a.queue_no || 0) - (b.queue_no || 0); });
    return { room: REPAIR_AREA, mode: mode, scan: scan, matches: matches, asset: asset, out_ticket: outTicket, in_room: room };
  }

  /* ----------------------------------------------------------- dashboards */

  var ADMIN_BY_STATUS = { USE: 1032, SPARE: 80, STOCK: 62, REPAIR: 24, FAIL: 14, DISPOSE: 30, LOST: 6 };
  var ADMIN_MATRIX = [
    { type: 'PC', by_status: { USE: 610, SPARE: 30, STOCK: 20, REPAIR: 12, FAIL: 6, DISPOSE: 15, LOST: 1 } },
    { type: 'NB', by_status: { USE: 280, SPARE: 20, STOCK: 22, REPAIR: 8, FAIL: 3, DISPOSE: 8, LOST: 4 } },
    { type: 'MN', by_status: { USE: 110, SPARE: 25, STOCK: 15, REPAIR: 1, FAIL: 2, DISPOSE: 4, LOST: 1 } },
    { type: 'PR', by_status: { USE: 32, SPARE: 5, STOCK: 5, REPAIR: 3, FAIL: 3, DISPOSE: 3 } },
  ];
  var USER_BY_STATUS = { USE: 214, SPARE: 12, STOCK: 9, REPAIR: 4, FAIL: 2, DISPOSE: 5, LOST: 1 };
  var USER_MATRIX = [
    { type: 'PC', by_status: { USE: 130, SPARE: 5, STOCK: 4, REPAIR: 2, FAIL: 1, DISPOSE: 3 } },
    { type: 'NB', by_status: { USE: 60, SPARE: 4, STOCK: 3, REPAIR: 1, DISPOSE: 1, LOST: 1 } },
    { type: 'MN', by_status: { USE: 20, SPARE: 3, STOCK: 2, DISPOSE: 1 } },
    { type: 'PR', by_status: { USE: 4, REPAIR: 1, FAIL: 1 } },
  ];
  ADMIN_MATRIX.concat(USER_MATRIX).forEach(function (m) {
    m.total = Object.keys(m.by_status).reduce(function (s, k) { return s + m.by_status[k]; }, 0);
  });
  var LOCATIONS = [{ location: 'BLDG-A', total: 352, in_use: 298 }, { location: 'BLDG-B', total: 486, in_use: 410 }, { location: 'BLDG-C', total: 410, in_use: 324 }];
  var WC_TOTALS = [
    { wc_id: 1, wc_code: 'D100', wc_name: 'DEMO-A', total: 512, broken: 16 },
    { wc_id: 2, wc_code: 'D200', wc_name: 'DEMO-B', total: 398, broken: 12 },
    { wc_id: 3, wc_code: 'D300', wc_name: 'DEMO-C', total: 338, broken: 10 },
  ];

  function ticketSummary() {
    var ts = data().tickets;
    return {
      open_count: sum(ts, function (t) { return OPEN.indexOf(t.status) !== -1; }),
      new_count: sum(ts, function (t) { return OPEN.indexOf(t.status) !== -1 && !t.assignee_id; }),
      urgent: sum(ts, function (t) { return OPEN.indexOf(t.status) !== -1 && t.priority === 'urgent'; }),
      closed_30d: 18 + sum(ts, function (t) { return t.status === 'closed'; }), avg_minutes: 1260,
    };
  }

  function dashboard(admin) {
    var d = { generated_at: now(), by_status: ADMIN_BY_STATUS, matrix: ADMIN_MATRIX, locations: LOCATIONS, work_centers: WC_TOTALS, ticket_summary: ticketSummary() };
    if (!admin) { return d; }
    var u = me(), ts = data().tickets;
    var inRoom = ts.filter(function (t) { return t.received_at && !t.returned_at; });
    var limit = stamp(new Date(Date.now() - 3 * 86400000));
    d.my_tickets = ts.filter(function (t) { return t.assignee_id === u.id && (OPEN.indexOf(t.status) !== -1 || t.status === 'resolved'); }).map(tv);
    d.workload = technicians().map(function (x) {
      return { id: x.id, name: x.name,
        active: sum(ts, function (t) { return t.assignee_id === x.id && ['assigned', 'in_progress'].indexOf(t.status) !== -1; }),
        waiting: sum(ts, function (t) { return t.assignee_id === x.id && t.status === 'waiting_parts'; }),
        resolved: sum(ts, function (t) { return t.assignee_id === x.id && t.status === 'resolved'; }) };
    });
    d.in_room = inRoom.length;
    d.attention = {
      urgent: d.ticket_summary.urgent, unassigned: d.ticket_summary.new_count,
      ready_out: sum(inRoom, function (t) { return t.status === 'resolved'; }),
      overdue: sum(inRoom, function (t) { return OPEN.indexOf(t.status) !== -1 && t.received_at < limit; }), overdue_days: 3,
    };
    d.recent_changes = data().history.slice(0, 8).map(hv);
    return d;
  }

  function userHome() {
    var rows = data().tickets.filter(canSeeTicket).map(tv);
    var open = rows.filter(function (t) { return t.is_open; }).sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
    return {
      by_status: USER_BY_STATUS, matrix: USER_MATRIX, open_tickets: open, open_total: open.length,
      attention: { to_bring: sum(open, function (t) { return !t.received_at; }), repaired: sum(rows, function (t) { return t.in_room && t.status === 'resolved'; }) },
    };
  }

  /* ---------------------------------------------------------- admin pages */

  var MASTER_KINDS = [['pc_type', 'Type PC', 64], ['location', 'Location', 32], ['building', 'Building / floor', 64]];
  function masterTabs() {
    return [{ code: 'work_center', label: 'Work Center', total: data().wcs.length }].concat(MASTER_KINDS.map(function (k) {
      return { code: k[0], label: k[1], total: data().masters[k[0]].length };
    }));
  }
  function matchQ(text, q) { return !q || up(text).indexOf(up(q)) !== -1; }
  function activeFilter(rows, active) {
    return active === '1' || active === '0' ? rows.filter(function (r) { return !!r.is_active === (active === '1'); }) : rows;
  }

  function masters(q) {
    var kind = data().masters[q.kind] ? q.kind : 'pc_type';
    var rows = activeFilter(data().masters[kind], q.active).filter(function (m) { return matchQ(m.code + ' ' + m.name, q.q); });
    var out = paged(rows, q);
    var counts = {};
    MASTER_KINDS.forEach(function (k) {
      var all = data().masters[k[0]];
      counts[k[0]] = { total: all.length, active: sum(all, function (m) { return m.is_active; }), missing: 0 };
    });
    out.filters = { q: q.q || '', active: q.active || '' };
    out.kind = kind;
    out.kinds = MASTER_KINDS.map(function (k) { return { code: k[0], label: k[1], max: k[2] }; });
    out.counts = counts;
    out.tabs = masterTabs();
    return out;
  }
  function masterShow(q) {
    var m = null;
    Object.keys(data().masters).forEach(function (k) { data().masters[k].forEach(function (x) { if (x.id === Number(q.id)) { m = x; } }); });
    return m ? copy(m) : fail(T('Not found.'), 404);
  }

  function wcRow(w) {
    var tot = WC_TOTALS.filter(function (x) { return x.wc_id === w.id; })[0];
    return Object.assign({}, w, { asset_count: tot ? tot.total : sum(data().assets, function (a) { return a.work_center_id === w.id; }),
      user_count: sum(data().users, function (u) { return u.wcs.indexOf(w.code) !== -1; }) });
  }
  function workCenters(q) {
    var rows = activeFilter(data().wcs, q.active).filter(function (w) { return matchQ(w.code + ' ' + w.name, q.q); }).map(wcRow);
    var out = paged(rows, q);
    out.filters = { q: q.q || '', active: q.active || '' };
    out.inactive_count = sum(data().wcs, function (w) { return !w.is_active; });
    out.tabs = masterTabs();
    return out;
  }

  function userRow(u) {
    return { id: u.id, emp_code: u.emp_code, name: uname(u), first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone,
      role: u.role, can_repair: u.can_repair, is_active: u.is_active, must_change_password: u.must_change_password, locked: false,
      last_login_at: u.last_login_at, work_centers: u.wcs.map(function (c) { return Object.assign(wcObj(wcByCode(c)), { is_active: true }); }) };
  }
  function users(q) {
    var act = q.active || '1';
    var rows = data().users.filter(function (u) {
      if (act !== 'all' && u.is_active !== (act === '1')) { return false; }
      if (q.role && u.role !== q.role) { return false; }
      if (q.wc && u.wcs.indexOf((wcById(q.wc) || {}).code) === -1) { return false; }
      return matchQ([u.emp_code, uname(u), u.email, u.wcs.join(' ')].join(' '), q.q);
    }).map(userRow);
    var out = paged(rows, q);
    out.filters = { q: q.q || '', role: q.role || '', wc: q.wc || '', active: act };
    out.work_centers = data().wcs;
    return out;
  }
  function userForm(q) {
    var u = q.id ? userById(q.id) : null;
    return { user: u ? userRow(u) : null, work_center_ids: u ? u.wcs.map(function (c) { return wcByCode(c).id; }) : [], work_centers: data().wcs };
  }

  function historyList(q) {
    var rows = data().history.map(hv).filter(function (h) {
      if (q.field && h.field !== q.field) { return false; }
      if (q.source && h.source !== q.source) { return false; }
      if (q.from && h.changed_at.slice(0, 10) < q.from) { return false; }
      if (q.to && h.changed_at.slice(0, 10) > q.to) { return false; }
      return matchQ([h.asset_no, h.old_value, h.new_value].join(' '), q.q);
    });
    var out = paged(rows, q, 50);
    out.filters = { field: q.field || '', source: q.source || '', q: q.q || '', from: q.from || '', to: q.to || '' };
    return out;
  }

  var RESULT_LABELS = { found: 'Found, in place', moved: 'Found, moved', damaged: 'Found, damaged', not_checked: 'Not checked' };

  function auditRound(q) {
    var r = data().rounds.filter(function (x) { return x.id === Number(q.id); })[0];
    if (!r) { return fail(T('Audit round not found.'), 404); }
    var checks = data().checks.filter(function (c) { return c.round_id === r.id; });
    var labels = {};
    Object.keys(RESULT_LABELS).forEach(function (k) { labels[k] = T(RESULT_LABELS[k]); });
    var progress = WC_TOTALS.map(function (w) {
      var total = Math.round(r.total * w.total / 1248);
      return { work_center: w.wc_code, work_center_name: w.wc_name, total: total, checked: Math.min(total, Math.round(r.checked * w.total / 1248)) };
    });
    var wc = q.wc || '';
    return {
      round: copy(r), total: r.total, checked: r.checked, progress: progress,
      recent: checks.map(function (c) { var a = assetById(c.asset_id); return Object.assign(copy(c), { asset_no: a.asset_no, description: a.description }); }),
      wc: wc,
      unchecked: wc ? data().assets.filter(function (a) {
        return a.work_center === wc && !checks.some(function (c) { return c.asset_id === a.id; });
      }).map(function (a) { return { id: a.id, asset_no: a.asset_no, description: a.description, area: a.area, status: a.status, work_center: a.work_center }; }) : null,
      result_labels: labels,
    };
  }
  function auditScan(q) {
    var a = assetByNo(q.no);
    if (!a) { return fail(T('Asset {no} was not found.', { no: up(q.no) || T('(blank)') }), 404); }
    var ex = data().checks.filter(function (c) { return c.round_id === Number(q.id) && c.asset_id === a.id; })[0];
    return { asset: { id: a.id, asset_no: a.asset_no, description: a.description, status: a.status, work_center: a.work_center,
      work_center_name: a.work_center_name, location: a.location, building: a.building, area: a.area },
      existing: ex ? { id: ex.id, result: ex.result, network: ex.network, area_found: ex.area_found, note: ex.note, checked_at: ex.checked_at } : null };
  }

  function importPage() {
    var cols = ['asset_no', 'fix_no', 'description', 'os_name', 'os_version', 'work_center', 'pc_type', 'location', 'building', 'area', 'remark', 'status', 'editor_note', 'last_use'];
    return {
      batches: copy(data().batches), max_upload: '20 MB', chunk_size: 1048576, max_bytes: 20 * 1048576,
      legacy_columns: cols.map(function (c) { return { field: c, code: c, label: T(c === 'work_center' ? 'Work Center (e.g. 2300-ICS)' : FIELD_LABELS[c]) }; }),
    };
  }
  function importPreview(q) {
    var b = data().batches.filter(function (x) { return x.id === Number(q.id); })[0] || data().batches[0];
    var tab = ['update', 'create', 'error', 'missing'].indexOf(q.tab) !== -1 ? q.tab : 'update';
    var rows = tab === 'missing'
      ? data().assets.slice(5, 8).map(function (a) { return { asset_no: a.asset_no, description: a.description, work_center: a.work_center, area: a.area, status: a.status }; })
      : data().batchRows[tab];
    if (b.id !== 7) { rows = []; }
    var out = paged(rows, q, 50);
    var fields = ['fix_no', 'description', 'os_name', 'os_version', 'work_center', 'pc_type', 'location', 'building', 'area', 'remark', 'status'];
    out.batch = copy(b);
    out.tab = tab;
    out.fields_in_file = fields.map(function (f) { return { field: f, label: T(FIELD_LABELS[f]) }; });
    out.field_counts = { status: 1, building: 1, area: 1, os_version: 2, remark: 1, fix_no: 1 };
    return out;
  }

  function exportInfo(q) {
    return { count: filterAssets(visibleAssets(), q).length, filter_empty: !Object.keys(q).length, xlsx: true,
      columns: EXPORT_COLUMNS.map(function (c) { return { code: c, label: T(FIELD_LABELS[c]), required: c === 'asset_no' }; }) };
  }

  function lookupAssets(q) {
    var s = up(q.q);
    return visibleAssets().filter(function (a) { return a.asset_no.indexOf(s) !== -1; }).slice(0, 10).map(function (a) {
      return { id: a.id, asset_no: a.asset_no, description: a.description, work_center: a.work_center, work_center_name: a.work_center_name, area: a.area, status: a.status };
    });
  }

  /* --------------------------------------------------------------- routes */

  function ok(message, d) { return { ok: true, message: message, data: d === undefined ? {} : d }; }
  function fail(errors, status, code) { return { ok: false, errors: Array.isArray(errors) ? errors : [errors], status: status || 422, code: code || null }; }
  /** Added to messages of writes that are kept only in this browser tab. */
  function demoNote() { return ' ' + T('(Demo mode: kept until the page is reloaded.)'); }
  function noop() { return ok(T('Demo mode: nothing was saved.')); }

  var PUBLIC_GET = ['session', 'dashboard'];

  var GET = {
    'session': function () { return { user: sessionUser(), csrf: 'demo-csrf-token', meta: meta(), demo: true }; },
    'nav-counts': function () { return { tickets: isAdmin() ? ticketSummary().new_count : 0 }; },
    'dashboard': function () { return dashboard(false); },
    'admin/dashboard': function () { return dashboard(true); },
    'user/home': userHome,
    'admin/assets': assetList, 'user/assets': assetList,
    'admin/assets/show': assetShow, 'user/assets/show': assetShow,
    'admin/assets/form': assetForm, 'user/assets/form': assetForm,
    'lookup/assets': lookupAssets,
    'tickets/create-form': createForm,
    'admin/tickets': function (q) { return ticketList(q, true); },
    'user/tickets': function (q) { return ticketList(q, false); },
    'tickets/show': ticketShow,
    'admin/receiving': receiving,
    'admin/history': historyList,
    'admin/audit': function () { return { rounds: copy(data().rounds), locations: LOCATIONS.map(function (l) { return l.location; }) }; },
    'admin/audit/round': auditRound,
    'admin/audit/scan': auditScan,
    'admin/import': importPage,
    'admin/import/preview': importPreview,
    'admin/masters': masters,
    'admin/masters/show': masterShow,
    'admin/work-centers': workCenters,
    'admin/work-centers/show': function (q) { var w = wcById(q.id); return w ? wcRow(w) : fail(T('Not found.'), 404); },
    'admin/users': users,
    'admin/users/form': userForm,
    'export/info': exportInfo,
  };

  var uploads = {};

  var POST = {
    'login': function (b) {
      var code = up(field(b, 'emp_code'));
      var u = data().users.filter(function (x) { return x.emp_code === code; })[0];
      if (!u) { return fail(T('Demo mode: use one of the demo employee codes shown below (any password).'), 401); }
      if (!u.is_active) { return fail(T('This account is inactive. Ask the IT team.'), 401); }
      setUid(u.id);
      u.last_login_at = now();
      return ok(T('Signed in'), { user: sessionUser(), csrf: 'demo-csrf-token' });
    },
    'logout': function () { setUid(null); return ok(T('Signed out'), { csrf: 'demo-csrf-token' }); },
    'account/password': function (b) {
      var pw = str(field(b, 'password'));
      if (pw.length < 8) { return fail(T('The new password must be at least 8 characters.')); }
      if (pw !== str(field(b, 'password_confirm'))) { return fail(T('The password confirmation does not match.')); }
      me().must_change_password = false;
      return ok(T('Demo mode: nothing was saved.'), { user: sessionUser() });
    },
    'account/profile': function (b) {
      var u = me();
      u.email = str(field(b, 'email'));
      u.phone = str(field(b, 'phone'));
      return ok(T('Contact details saved') + demoNote(), { user: sessionUser() });
    },
    'admin/assets/save': assetSave, 'user/assets/save': assetSave,
    'admin/assets/bulk-preview': bulkPreview,
    'admin/assets/bulk-apply': bulkApply,
    'tickets/store': ticketStore,
    'tickets/status': ticketStatus,
    'tickets/note': ticketNote,
    'tickets/assign': ticketAssign,
    'admin/tickets/bulk': ticketBulk,
    'tickets/take': ticketTake,
    'tickets/queue-jump': queueJump,
    'admin/receiving/receive': roomReceive,
    'admin/receiving/send-out': roomSendOut,
    'admin/import/upload-chunk': function (b) {
      var id = String(field(b, 'upload_id') || ''), index = Number(field(b, 'index')), total = Number(field(b, 'total')) || 1;
      uploads[id] = (uploads[id] || 0) + 1;
      if (index < total - 1) { return ok('', { done: false }); }
      delete uploads[id];
      return ok(T('File checked. Review the changes, then import.'), { done: true, id: 7 });
    },
    'admin/import/apply': noop,
    'admin/import/discard': noop,
    'admin/audit/start': function () { return ok(T('Demo mode: nothing was saved.'), { id: 2 }); },
    'admin/users/reset-password': function (b) {
      var u = userById(field(b, 'id'));
      if (!u) { return fail(T('Not found.'), 404); }
      return ok(T('Demo mode: nothing was saved.'), { emp_code: u.emp_code, name: uname(u), temp_password: 'DEMO-' + u.emp_code.slice(-4) });
    },
  };

  /** Answer one API call from the demo data. Always resolves (failures are { ok:false, status, errors }). */
  function handle(method, route, params, body) {
    data();
    var q = {};
    Object.keys(params || {}).forEach(function (k) { var v = params[k]; if (v !== null && v !== undefined && v !== '') { q[k] = Array.isArray(v) ? v.join(',') : String(v); } });
    var res;
    try {
      if (!me() && PUBLIC_GET.indexOf(route) === -1 && !(method === 'POST' && (route === 'login' || route === 'logout'))) {
        res = fail(T('Please sign in first.'), 401, 'auth');
      } else if (/^admin\//.test(route) && !isAdmin()) {
        res = fail(T('You do not have permission to open this page.'), 403);
      } else if (method === 'GET') {
        var fn = GET[route];
        if (!fn) { res = fail(T('Not available in demo mode.'), 404); } else {
          var d = fn(q);
          res = d && d.ok === false ? d : { ok: true, data: d };
        }
      } else {
        var p = POST[route];
        res = p ? p(body || {}) : noop();
      }
    } catch (e) {
      if (root.console) { console.error(e); }
      res = fail(T('Something went wrong.'), 500);
    }
    // A copy, so pages never hold references into the demo data; a short delay so loading states still show.
    var out = JSON.parse(JSON.stringify(res));
    return new Promise(function (resolve) { setTimeout(function () { resolve(out); }, 60); });
  }

  /* --------------------------------------------------------------- UI bits */

  var started = false;

  /** Show the "Demo mode" strip and start blocking file downloads (once per page load). */
  function start() {
    if (started) { return; }
    started = true;
    var doc = document.documentElement;
    doc.classList.add('is-demo');
    var bar = document.createElement('div');
    bar.className = 'demo-banner';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<i class="bi bi-database-slash" aria-hidden="true"></i><span><strong></strong> <span></span></span>';
    bar.querySelector('strong').textContent = T('Demo mode');
    bar.querySelector('strong + span').textContent = T('The database is not connected. Everything shown is sample data; changes are not saved.');
    document.body.insertBefore(bar, document.body.firstChild);
    // Sticky bars (sidebar, top nav) sit below the strip: share its height as --ac-demo-h.
    var measure = function () { doc.style.setProperty('--ac-demo-h', bar.offsetHeight + 'px'); };
    measure();
    if (root.ResizeObserver) { new ResizeObserver(measure).observe(bar); } else { root.addEventListener('resize', measure); }

    // Files (asset export, audit export, Setting Room export) come straight from the server: not in demo mode.
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || !/(^|\/)api\.(php|ashx)\?/.test(a.getAttribute('href'))) { return; }
      e.preventDefault();
      e.stopPropagation();
      if (root.AC && root.AC.toast) { root.AC.toast(T('Not available in demo mode.'), 'error'); }
    }, true);

    // Sign-in modal: clicking a demo code fills the form.
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-demo-login]') : null;
      if (!b) { return; }
      e.preventDefault();
      var form = b.closest('form') || document;
      var code = form.querySelector('[name=emp_code]'), pw = form.querySelector('[name=password]');
      if (code) { code.value = b.getAttribute('data-demo-login'); }
      if (pw) { pw.value = 'demo'; }
      var submit = document.querySelector('#app-modal [type=submit][form=modal-form]');
      if (submit) { submit.focus(); } else if (pw) { pw.focus(); }
    });
  }

  /** Demo sign-in codes for the sign-in modal (AC.html). */
  function loginHint() {
    var html = root.AC.html;
    return html`<div class="demo-login small" role="group" aria-label="${T('Demo accounts')}">
      <div class="fw-semibold"><i class="bi bi-database-slash me-1" aria-hidden="true"></i>${T('Demo accounts')}</div>
      <div class="demo-login-sub">${T('Click one to fill in the form. Any password works.')}</div>
      <div class="demo-login-list">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-demo-login="EMP0007"><span>${T('Admin')}:</span> <span class="font-monospace fw-semibold">EMP0007</span></button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-demo-login="DEMO01"><span>${T('User')}:</span> <span class="font-monospace fw-semibold">DEMO01</span></button>
      </div></div>`;
  }

  root.ACDemo = { handle: handle, start: start, loginHint: loginHint };
})(window);
