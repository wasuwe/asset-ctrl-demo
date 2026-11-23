/*
 * Asset pages for both areas.
 *
 * Client routes:
 *   #/admin/assets            list (search, filters, sort, paging, row selection + bulk edit)
 *   #/admin/assets/show?id=   detail (fields, history with field tabs, tickets)
 *   #/user/assets             list limited to the user's Work Centers
 *   #/user/assets/show?id=    detail
 *   #/assets                  front page before sign-in: read-only list of every Work Center (API public/assets)
 *
 * Actions (data-action):
 *   asset-create                         admin: new asset modal
 *   asset-edit   data-id                 edit modal (fields depend on the role)
 *   asset-bulk                           admin: bulk edit of the selected rows (form -> preview -> apply)
 *   asset-export                         export modal for the current list filter
 *
 * API: admin|user/assets, .../assets/show, .../assets/form, .../assets/save,
 *      admin/assets/bulk-preview, admin/assets/bulk-apply, export/info, export/download.
 */
(function () {
  'use strict';
  var html = AC.html, fmt = AC.fmt, c = AC.c;

  /** Query keys that make up the list filter (shared by list, bulk "all matching" and export). */
  var FILTER_KEYS = ['q', 'status', 'wc', 'location', 'building', 'type', 'pc_type', 'os', 'has_ticket', 'checked'];

  function area() { return AC.state.user && AC.state.user.is_admin ? 'admin' : 'user'; }
  function meta() { return AC.state.meta; }
  function pick(obj, keys) {
    var out = {};
    keys.forEach(function (k) { if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') { out[k] = obj[k]; } });
    return out;
  }
  function currentFilter() { return pick(AC.query(), FILTER_KEYS.concat(['sort', 'dir'])); }
  function dash(v) { return v !== null && v !== undefined && String(v) !== '' ? v : html`<span class="text-secondary">—</span>`; }
  function wcLabel(w) { return w.code + (w.name ? ' · ' + w.name : ''); }
  function wcOptions(list) { return (list || []).map(function (w) { return [w.code, wcLabel(w)]; }); }
  /** "3100-PROD-LINE-A" -> code and name that may sit on two lines, but neither is ever cut. */
  function wcCell(dept) {
    var m = /^([^-\s]+)-(.+)$/.exec(dept || '');
    if (!m) { return html`<span class="font-monospace cell-code" title="${dept || ''}">${dept || ''}</span>`; }
    return html`<span class="font-monospace cell-code">${m[1]}</span> <span class="font-monospace cell-code text-secondary" title="${m[2]}">${m[2]}</span>`;
  }

  function statusOptions(withUnknown) {
    var out = meta().asset_statuses.map(function (s) { return [s.code, s.label + ' (' + s.code + ')']; });
    if (withUnknown) { out.push(['UNKNOWN', AC.t('Unspecified')]); }
    return out;
  }
  function typeLabel(t) {
    var l = meta().asset_type_labels || {};
    return l[t] ? t + ' · ' + l[t] : t;
  }
  /**
   * Active master values of one kind as [[code, label]]. A current value that is not
   * (or no longer) active is kept at the top so saving other fields does not clear it.
   */
  function masterOptions(masters, kind, current) {
    var list = ((masters || {})[kind] || []).slice();
    if (current && !list.some(function (o) { return o[0] === current; })) {
      list.unshift([current, current + ' ' + AC.t('(not in master list)')]);
    }
    return list;
  }

  /* ------------------------------------------------------------ filter bar */

  function filterBar(path, f, o) {
    var sel = function (name, label, list, current) {
      label = AC.t(label);
      return html`<select class="form-select form-select-sm" name="${name}" aria-label="${label}" data-autosubmit>
        ${AC.ui.options(list, current, AC.t('{label}: all', { label: label }))}</select>`;
    };
    var plain = function (arr) { return (arr || []).map(function (v) { return [v, v]; }); };
    var wcs = (o.work_centers || []).map(function (w) { return [String(w.id), wcLabel(w)]; });
    if (area() === 'admin') { wcs.push(['none', AC.t('— No Work Center —')]); }
    var empty = !FILTER_KEYS.some(function (k) { return f[k]; });
    return html`<form class="filter-bar d-flex flex-wrap gap-2 align-items-center mb-2" data-filter data-keep="sort dir per" role="search">
      <div class="search-wrap">
        <i class="bi bi-search"></i>
        <input class="form-control form-control-sm" type="search" name="q" value="${f.q}" placeholder="Search asset no., description, area…" data-search>
      </div>
      ${sel('status', AC.t('Status'), statusOptions(true).concat([['REPAIR,FAIL', AC.t('In repair or broken')]]), f.status)}
      ${sel('wc', AC.t('Work Center'), wcs, f.wc)}
      ${sel('location', AC.t('Location'), plain(o.locations), f.location)}
      ${sel('building', AC.t('Building'), plain(o.buildings), f.building)}
      ${sel('type', AC.t('Type'), (o.types || []).map(function (t) { return [t, typeLabel(t)]; }), f.type)}
      ${sel('pc_type', AC.t('Type PC'), plain(o.pc_types), f.pc_type)}
      ${sel('os', AC.t('OS'), plain(o.os), f.os)}
      ${sel('checked', AC.t('This month'), [['done', AC.t('Updated this month')], ['pending', AC.t('Not updated yet')]], f.checked)}
      <div class="form-check align-self-center ms-1">
        <input class="form-check-input" type="checkbox" name="has_ticket" value="1" id="has_ticket" data-autosubmit ${f.has_ticket === '1' ? AC.raw('checked') : ''}>
        <label class="form-check-label small" for="has_ticket">Has an open repair ticket</label>
      </div>
      <button class="d-none" type="submit"></button>
      ${empty ? '' : html`<a class="btn btn-link btn-sm" href="${AC.link(path)}">Clear filters</a>`}
    </form>`;
  }

  /* ------------------------------------------------------------ list table */

  /**
   * Asset list with the same columns, in the same order, as the original register
   * (legacy asset_ctrl): TYPE, IT-ASSET, FIXED-ASSET, DESCRIPTION, OS, OS-VERSION,
   * WORK CENTER (was DEPARTMENT, "2300-ICS"), TYPE-PC, BUILDING, LOCATION, AREA, REMARK,
   * STATUS, MEMBER, LAST USE — one field per column.
   * Always fits the screen: text wraps inside cells; below 1200px each row turns into a card
   * listing every field (see .asset-table in theme.css).
   * firstNo = running number of the first row on this page (pager.from).
   */
  function assetTable(rows, ar, selectable, firstNo) {
    var s = AC.ui.sortLink;
    var pub = ar === 'public';
    var canEdit = !pub && AC.can('assets.edit');
    var cols = [
      // [sort key, header label, cell renderer, extra td class]
      ['asset_type', 'Type', function (a) { return html`<span class="font-monospace cell-code" title="${a.asset_type}">${a.asset_type}</span>`; }],
      ['asset_no', 'IT Asset', function (a) {
        return html`${pub ? html`<span class="asset-no">${a.asset_no}</span>` : html`<a class="asset-no" href="${AC.link(ar + '/assets/show', { id: a.id })}">${a.asset_no}</a>`}${a.open_ticket_no
          ? html`<span class="ticket-tag" title="${AC.t('Has an open repair ticket')}"><i class="bi bi-tools"></i> ${a.open_ticket_no}</span>` : ''}`;
      }, 'col-asset'],
      ['fix_no', 'Fixed Asset', function (a) { return html`<span class="font-monospace cell-code" title="${a.fix_no}">${a.fix_no}</span>`; }],
      ['description', 'Description', function (a) { return a.description; }],
      ['os_name', 'OS', function (a) { return a.os_name; }],
      ['os_version', 'OS Version', function (a) { return a.os_version; }],
      ['work_center', 'Work Center', function (a) { return wcCell(a.department); }],
      ['pc_type', 'Type PC', function (a) { return a.pc_type; }],
      ['building', 'Building', function (a) { return html`<span class="cell-code" title="${a.building}">${a.building}</span>`; }],
      ['location', 'Location', function (a) { return html`<span class="cell-code" title="${a.location}">${a.location}</span>`; }],
      ['area', 'Area', function (a) { return a.area; }],
      ['remark', 'Remark', function (a) { return a.remark; }],
      ['status', 'Status', function (a) { return AC.ui.statusBadge(a.status); }],
      ['editor_note', 'Member', function (a) { return a.editor_note; }],
      ['last_use', 'Last use', function (a) { return a.last_use; }],
    ];
    var body = rows.map(function (a, i) {
      var checkTitle = a.checked_this_month
        ? AC.t('Updated by the department this month ({date})', { date: fmt.datetime(a.user_checked_at) })
        : AC.t('Not updated by the department this month');
      return html`<tr class="${a.checked_this_month ? 'row-checked' : 'row-pending'}" title="${checkTitle}">
        ${selectable ? html`<td class="col-check" data-label=""><input class="form-check-input" type="checkbox" name="ids[]" value="${a.id}" aria-label="${AC.t('Select {no}', { no: a.asset_no })}"></td>` : ''}
        <td class="col-no text-secondary" data-label="${AC.t('No.')}">${fmt.number((firstNo || 1) + i)}</td>
        ${cols.map(function (c) { return html`<td class="f-${c[0]} ${c[3] || ''}" data-label="${AC.t(c[1])}">${c[2](a)}</td>`; })}
        <td class="col-act text-end" data-label="">${canEdit ? html`<button type="button" class="btn btn-sm btn-outline-secondary" data-action="asset-edit" data-id="${a.id}" title="${AC.t('Edit')}"><i class="bi bi-pencil"></i></button>` : ''}</td>
      </tr>`;
    });
    var span = cols.length + (selectable ? 3 : 2);
    return html`<div class="card">
      <table class="table table-hover table-sm align-middle mb-0 asset-table" ${selectable ? AC.raw('data-select-table="#bulk-bar"') : ''}>
        <thead><tr>
          ${selectable ? html`<th class="col-check"><input class="form-check-input" type="checkbox" data-check-all aria-label="Select the whole page"></th>` : ''}
          <th class="col-no">No.</th>
          ${cols.map(function (c) { return html`<th class="${c[3] || ''}">${s(c[0], AC.t(c[1]))}</th>`; })}
          <th class="col-act"></th>
        </tr></thead>
        <tbody>${rows.length ? body : html`<tr><td colspan="${span}" class="text-center text-secondary py-5"><strong class="d-block text-body">No assets found</strong>Try fewer search conditions.</td></tr>`}</tbody>
      </table></div>`;
  }

  /** "Rows per page" choice for the list footer (AC.ui.pager). */
  function perOf(d) { return { options: d.per_page_options, current: d.per_page }; }

  /**
   * Monthly check legend: green rows were saved by a User (department) this month, yellow not yet.
   * The two counts link to the list filtered by checked=done / pending.
   */
  function checkLegend(s) {
    if (!s || !s.total) { return ''; }
    var month = new Date().toLocaleDateString(AC.lang() === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' });
    return html`<div class="check-legend small">
      <span class="text-secondary">${AC.t('Department update · {month}', { month: month })}</span>
      <a class="check-chip is-done" href="${AC.linkWith({ checked: 'done', page: '' })}"><span class="dot"></span>${AC.t('Updated')} <strong>${fmt.number(s.done)}</strong></a>
      <a class="check-chip is-pending" href="${AC.linkWith({ checked: 'pending', page: '' })}"><span class="dot"></span>${AC.t('Not yet')} <strong>${fmt.number(s.total - s.done)}</strong></a>
    </div>`;
  }

  function shownText(p) {
    return html`<strong class="text-body">${fmt.number(p.total)}</strong> found${p.total ? AC.t(' · showing {from}–{to}', { from: fmt.number(p.from), to: fmt.number(p.to) }) : ''}`;
  }

  /* ------------------------------------------------------------ list pages */

  /** Filter options of the last admin list render (Work Centers, datalists) — reused by the bulk edit form. */
  var listOptions = null;

  AC.route('admin/assets', {
    area: 'admin', title: AC.t('IT assets'), ability: 'assets.view',
    render: function (ctx) {
      return AC.api.get('admin/assets', ctx.query).then(function (d) {
        if (ctx.stale()) { return; }
        listOptions = d.options;
        var p = d.pager;
        ctx.main.innerHTML = html`
          ${c.pageHead(AC.t('IT assets'), html`All Work Centers · ${shownText(p)}`, html`
            ${AC.can('assets.export') ? html`<button class="btn btn-outline-secondary" data-action="asset-export"><i class="bi bi-download me-1"></i>Export</button>` : ''}
            ${AC.can('assets.create') ? html`<button class="btn btn-primary" data-action="asset-create"><i class="bi bi-plus-lg me-1"></i>Add asset</button>` : ''}`)}
          ${filterBar('admin/assets', d.filter, d.options)}
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 small text-secondary mb-2">
            ${checkLegend(d.check_summary)}
            <span class="d-none d-xl-inline">Tick rows to edit several at once. Shift-click selects a range. Press <kbd>/</kbd> to search.</span>
          </div>
          ${assetTable(d.rows, 'admin', true, d.pager.from)}
          <div class="bulk-bar d-none d-flex flex-wrap align-items-center gap-3 mt-3" id="bulk-bar">
            <strong><span data-count data-total="${fmt.number(p.total)}">0</span> selected</strong>
            <a href="#" class="small d-none" data-select-all-results>Select all ${fmt.number(p.total)} matching the filter</a>
            <span class="flex-grow-1"></span>
            <button type="button" class="btn btn-light btn-sm" data-action="asset-bulk" data-total="${p.total}"><i class="bi bi-pencil-square me-1"></i>Edit selected</button>
            <button type="button" class="btn btn-outline-light btn-sm" data-clear-selection>Cancel</button>
          </div>
          ${AC.ui.pager(p, perOf(d))}`.toString();
      });
    },
  });

  AC.route('user/assets', {
    area: 'user', title: AC.t('My assets'), ability: 'assets.view',
    render: function (ctx) {
      return AC.api.get('user/assets', ctx.query).then(function (d) {
        if (ctx.stale()) { return; }
        var wcs = AC.state.user.work_centers.map(function (w) { return w.code; }).join(', ') || AC.t('none assigned');
        ctx.main.innerHTML = html`
          ${c.pageHead(AC.t('My assets'), html`Work Centers: ${wcs} · ${shownText(d.pager)}${AC.can('assets.edit') ? AC.t(' · You can edit Area, Remark, Status, Location and Building') : ''}`,
            AC.can('assets.export') ? html`<button class="btn btn-outline-secondary" data-action="asset-export"><i class="bi bi-download me-1"></i>Export</button>` : '')}
          ${filterBar('user/assets', d.filter, d.options)}
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            ${checkLegend(d.check_summary)}
          </div>
          ${AC.can('assets.edit') ? html`<p class="small text-secondary mb-2">Once a month, open each asset with the pencil button, check it and press Save. The row turns green even if nothing changed.</p>` : ''}
          ${assetTable(d.rows, 'user', false, d.pager.from)}
          ${AC.ui.pager(d.pager, perOf(d))}`.toString();
      });
    },
  });

  /**
   * Front page before sign-in: the same list as "My assets", over every Work Center, read-only
   * (no edit, export or detail page). Also the page behind the sign-in modal (#/login).
   */
  function renderPublicAssets(ctx) {
    return AC.api.get('public/assets', ctx.query).then(function (d) {
      if (ctx.stale && ctx.stale()) { return; }
      ctx.main.innerHTML = html`
        ${c.pageHead(AC.t('IT assets'), html`All Work Centers · ${shownText(d.pager)} · Read-only. Sign in to report a problem or edit.`,
          html`<a class="btn btn-outline-secondary" href="${AC.link('dashboard')}"><i class="bi bi-bar-chart me-1"></i>Overview</a>`)}
        ${filterBar('assets', d.filter, d.options)}
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          ${checkLegend(d.check_summary)}
        </div>
        ${assetTable(d.rows, 'public', false, d.pager.from)}
        ${AC.ui.pager(d.pager, perOf(d))}`.toString();
    });
  }
  AC.renderPublicAssets = renderPublicAssets;

  AC.route('assets', { area: 'public', title: AC.t('IT assets'), render: renderPublicAssets });

  /* ----------------------------------------------------------- detail page */

  var HISTORY_TABS = [['', AC.t('All')], ['area', AC.t('Area')], ['remark', AC.t('Remark')], ['status', AC.t('Status')], ['work_center', AC.t('Work Center')], ['building', AC.t('Building / floor')], ['location', AC.t('Location')]];

  function showPage(ar) {
    return function (ctx) {
      var params = pick(ctx.query, ['id', 'no', 'field']);
      return AC.api.get(ar + '/assets/show', params).then(function (d) {
        if (ctx.stale()) { return; }
        var a = d.asset;
        ctx.setTitle(a.asset_no);
        var counts = d.field_counts || {};
        var all = Object.keys(counts).reduce(function (s, k) { return s + Number(counts[k] || 0); }, 0);
        var canTicket = AC.can('tickets.create');
        var canEdit = d.editable && d.editable.length > 0;

        var tabs = HISTORY_TABS.map(function (t) {
          var n = t[0] === '' ? all : Number(counts[t[0]] || 0);
          return html`<li class="nav-item"><a class="nav-link ${d.history_field === t[0] ? 'active' : ''}" href="${AC.link(ar + '/assets/show', { id: a.id, field: t[0] })}">${t[1]} <span class="count">${n}</span></a></li>`;
        });

        var history = d.history.map(function (h) {
          var src;
          if (h.source === 'repair' && h.ticket_no) {
            src = html`<a class="ticket-tag" href="${AC.link(ar + '/tickets/show', { id: h.ref_id })}">${h.ticket_no}</a>`;
          } else if (h.source === 'import' && h.ref_id) {
            src = AC.meta.label('history_sources', h.source) + ' #' + h.ref_id;
          } else {
            src = AC.meta.label('history_sources', h.source);
          }
          return html`<tr>
            <td class="text-nowrap small">${fmt.datetime(h.changed_at)}</td>
            <td class="text-nowrap small">${AC.meta.field(h.field)}</td>
            <td>${h.field === '_created' ? html`<span class="text-secondary">Added to the register</span>` : AC.ui.diff(h.old_value, h.new_value, h.field)}
              ${h.note && h.source !== 'repair' ? html`<span class="cell-sub">“${h.note}”</span>` : ''}</td>
            <td class="small text-nowrap">${h.user_name || '—'}<span class="cell-sub">${src}</span></td>
          </tr>`;
        });

        var tickets = d.tickets.map(function (t) {
          return html`<li class="list-group-item d-flex gap-2 align-items-start">
            <div class="flex-grow-1 overflow-hidden">
              <a class="fw-semibold text-body text-decoration-none d-block text-truncate" href="${AC.link(ar + '/tickets/show', { id: t.id })}">${t.title}</a>
              <span class="small text-secondary"><span class="font-monospace">${t.ticket_no}</span> · ${fmt.date(t.created_at)}${t.assignee_name ? ' · ' + t.assignee_name : ''}</span>
            </div>
            ${AC.ui.ticketBadge(t.status)}
          </li>`;
        });

        ctx.main.innerHTML = html`
          <div class="crumbs"><a href="${AC.link(ar + '/assets')}">Assets</a> / ${a.asset_type ? html`<a href="${AC.link(ar + '/assets', { type: a.asset_type })}">${typeLabel(a.asset_type)}</a>` : '—'}</div>
          ${c.pageHead(html`<span class="font-monospace">${a.asset_no}</span>`, html`${a.description || AC.t('No description')} · ${AC.ui.statusBadge(a.status)}`, html`
            ${canTicket ? html`<button class="btn btn-outline-secondary" data-action="ticket-create" data-asset-no="${a.asset_no}"><i class="bi bi-tools me-1"></i>Report a problem</button>` : ''}
            ${canEdit ? html`<button class="btn btn-primary" data-action="asset-edit" data-id="${a.id}"><i class="bi bi-pencil me-1"></i>Edit</button>` : ''}`)}
          <div class="row g-3">
            <div class="col-xl-8 vstack gap-3">
              <div class="card">
                <div class="card-header"><h2 class="card-title mb-0">Asset details</h2><span class="small text-secondary">Last updated ${fmt.datetime(a.updated_at)}${a.updated_by_name ? AC.t(' by {name}', { name: a.updated_by_name }) : ''}</span></div>
                <div class="card-body row g-0 column-gap-4">
                  <dl class="props col-md">
                    <dt>Fix No.</dt><dd class="font-monospace">${dash(a.fix_no)}</dd>
                    <dt>Work Center</dt><dd>${a.work_center ? html`<span class="font-monospace">${a.work_center}</span>${a.work_center_name ? ' · ' + a.work_center_name : ''}` : dash('')}</dd>
                    <dt>Type</dt><dd>${dash(a.asset_type ? typeLabel(a.asset_type) : '')}</dd>
                    <dt>Type PC</dt><dd>${dash(a.pc_type)}</dd>
                  </dl>
                  <dl class="props col-md">
                    <dt>Location</dt><dd class="font-monospace">${dash(a.location)}</dd>
                    <dt>Building / floor</dt><dd class="font-monospace">${dash(a.building)}</dd>
                    <dt>Area</dt><dd>${dash(a.area)}</dd>
                    <dt>Remark</dt><dd>${dash(a.remark)}</dd>
                  </dl>
                </div>
              </div>

              <div class="card" id="history">
                <div class="card-header"><h2 class="card-title mb-0">Change history</h2><span class="small text-secondary">${fmt.number(all)} change(s)</span></div>
                <div class="px-3 pt-2"><ul class="nav nav-underline small">${tabs}</ul></div>
                ${history.length ? html`<div class="table-responsive"><table class="table table-sm align-top mb-0">
                  <thead><tr><th>When</th><th>Field</th><th>Change</th><th>By</th></tr></thead>
                  <tbody>${history}</tbody></table></div>`
                  : html`<div class="text-center text-secondary py-4">${d.history_field ? AC.t('No history for this field yet.') : AC.t('No history yet.')}</div>`}
              </div>
            </div>

            <div class="col-xl-4 vstack gap-3">
              <div class="card">
                <div class="card-header"><h2 class="card-title mb-0">Repair tickets</h2>
                  ${canTicket ? html`<a href="#" class="small" data-action="ticket-create" data-asset-no="${a.asset_no}">+ Report a problem</a>` : ''}</div>
                ${tickets.length ? html`<ul class="list-group list-group-flush">${tickets}</ul>` : html`<div class="text-center text-secondary py-4">No repair tickets yet.</div>`}
              </div>
              <div class="card">
                <div class="card-header"><h2 class="card-title mb-0">More details</h2></div>
                <div class="card-body">
                  <dl class="props" style="grid-template-columns:110px minmax(0,1fr)">
                    <dt>OS</dt><dd>${dash([a.os_name, a.os_version].filter(Boolean).join(' '))}</dd>
                    <dt>Last use</dt><dd>${dash(a.last_use)}</dd>
                    <dt>Member</dt><dd class="small">${dash(a.editor_note)}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>`.toString();
        if (d.history_field && ctx.query.field !== undefined) {
          var h = AC.$('#history', ctx.main);
          if (h) { setTimeout(function () { h.scrollIntoView({ block: 'start' }); }, 0); }
        }
      });
    };
  }

  AC.route('admin/assets/show', { area: 'admin', title: AC.t('Asset'), ability: 'assets.view', render: showPage('admin') });
  AC.route('user/assets/show', { area: 'user', title: AC.t('Asset'), ability: 'assets.view', render: showPage('user') });

  /* ------------------------------------------------------ create/edit modal */

  function openAssetForm(id) {
    var ar = area();
    AC.modal.loading(id ? AC.t('Edit asset') : AC.t('Add asset'));
    AC.api.get(ar + '/assets/form', id ? { id: id } : {}).then(function (d) {
      var a = d.asset, isNew = d.is_new, editable = d.editable;
      var can = function (f) { return editable.indexOf(f) !== -1; };
      var val = function (f) { return a[f] === undefined || a[f] === null ? '' : a[f]; };
      var input = function (f, label, opts) {
        opts = opts || {};
        var col = opts.col || 'col-md-4';
        if (!can(f)) {
          return html`<div class="${col}"><label class="form-label">${label}</label><input class="form-control-plaintext ${opts.mono ? 'font-monospace' : ''}" value="${val(f)}" readonly tabindex="-1"></div>`;
        }
        return html`<div class="${col}"><label class="form-label" for="f-${f}">${label}</label>
          <input class="form-control ${opts.mono ? 'font-monospace text-uppercase' : ''}" id="f-${f}" name="${f}" value="${val(f)}" ${opts.list ? AC.raw('list="' + opts.list + '"') : ''}></div>`;
      };
      /** Type PC / Location / Building: pick from the active master values (the current value stays selectable). */
      var masterField = function (f, label) {
        if (!can(f)) { return input(f, label, { mono: true }); }
        return html`<div class="col-md-4"><label class="form-label" for="f-${f}">${label}</label>
          <select class="form-select font-monospace" id="f-${f}" name="${f}">${AC.ui.options(masterOptions(d.masters, f, val(f)), val(f), AC.t('— None —'))}</select></div>`;
      };
      var statusField = can('status')
        ? html`<select class="form-select" id="f-status" name="status">${AC.ui.options(statusOptions(false), val('status'), AC.t('Unspecified'))}</select>`
        : html`<input class="form-control-plaintext" value="${AC.meta.label('asset_statuses', val('status'), AC.t('Unspecified'))}" readonly tabindex="-1">`;
      var wcField;
      if (can('work_center')) {
        var wcs = wcOptions(d.work_centers);
        if (val('work_center') && !wcs.some(function (o) { return o[0] === val('work_center'); })) { wcs.unshift([val('work_center'), val('work_center')]); }
        wcField = html`<select class="form-select" id="f-wc" name="work_center">${AC.ui.options(wcs, val('work_center'), AC.t('— None —'))}</select>`;
      } else {
        wcField = html`<input class="form-control-plaintext" value="${(val('work_center') + ' ' + val('work_center_name')).trim()}" readonly tabindex="-1">`;
      }

      var body = html`
        ${!can('fix_no') ? html`<div class="alert alert-secondary py-2 small">You can edit Area, Remark, Status, Location and Building.</div>` : ''}
        <div class="row g-3">
          <div class="col-md-4"><label class="form-label" for="f-asset_no">IT Asset</label>
            ${isNew ? html`<input class="form-control font-monospace text-uppercase" id="f-asset_no" name="asset_no" required autofocus placeholder="PCS123456">`
              : html`<input class="form-control-plaintext font-monospace fw-semibold" value="${a.asset_no}" readonly tabindex="-1">`}</div>
          ${input('fix_no', AC.t('Fix No.'), { mono: true })}
          <div class="col-md-4"><label class="form-label" for="f-status">Status</label>${statusField}</div>
          ${input('description', AC.t('Description'), { col: 'col-md-8' })}
          ${masterField('pc_type', AC.t('Type PC'))}

          <div class="col-12"><hr class="my-1"><span class="small fw-semibold text-secondary">Location</span></div>
          <div class="col-md-4"><label class="form-label" for="f-wc">Work Center</label>${wcField}</div>
          ${masterField('location', AC.t('Location'))}
          ${masterField('building', AC.t('Building / floor'))}
          ${input('area', AC.t('Area'), { col: 'col-md-6' })}
          ${input('remark', AC.t('Remark'), { col: 'col-md-6' })}
          ${!isNew ? html`<div class="col-12"><label class="form-label" for="f-note">Reason for the change <span class="fw-normal text-secondary">(optional)</span></label>
            <input class="form-control" id="f-note" name="change_note" placeholder="e.g. user moved desk / new owner"></div>` : ''}

          ${can('os_name') ? html`
            ${input('os_name', AC.t('OS'), { col: 'col-md-6' })}
            ${input('os_version', AC.t('OS Version'), { col: 'col-md-6' })}` : ''}
        </div>`;

      AC.modal.form({
        title: isNew ? AC.t('Add asset') : html`Edit <span class="font-monospace">${a.asset_no}</span>`,
        body: body,
        route: ar + '/assets/save',
        submitLabel: isNew ? AC.t('Add asset') : AC.t('Save'),
        data: function (obj) { obj.id = a.id || 0; return obj; },
        onSuccess: function (res) {
          AC.modal.close();
          AC.toast(res.message);
          if (isNew && res.data && res.data.id) { AC.go(ar + '/assets/show', { id: res.data.id }); } else { AC.refresh(); }
        },
      });
    }, function (err) { AC.modal.close(); AC.toast(err.message, 'error'); });
  }

  AC.on('asset-create', function () { openAssetForm(0); });
  AC.on('asset-edit', function (el) { openAssetForm(Number(el.getAttribute('data-id'))); });

  /* ------------------------------------------------------------- bulk edit */

  /**
   * Step 1: choose values. sel = { ids, select_all, filter }, prev = values from a previous step (Back).
   * Step 2: preview (POST admin/assets/bulk-preview). Step 3: apply (POST admin/assets/bulk-apply).
   */
  function bulkStep1(sel, count, options, prev) {
    prev = prev || { values: {}, clear: [], note: '' };
    var v = function (f) { return prev.values[f] || ''; };
    var cleared = function (f) { return prev.clear.indexOf(f) !== -1 ? AC.raw('checked') : ''; };
    var wcs = wcOptions(options.work_centers);
    var body = html`
      <p class="small text-secondary">Blank fields stay as they are. You will see the changes before saving.</p>
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label">Status</label>
          <select class="form-select" name="bulk_status">${AC.ui.options(statusOptions(false), v('status'), AC.t('— Keep —'))}</select></div>
        <div class="col-md-8"><label class="form-label">Work Center</label>
          <select class="form-select" name="bulk_work_center">${AC.ui.options(wcs, v('work_center'), AC.t('— Keep —'))}</select></div>
        <div class="col-md-4"><label class="form-label">Location</label>
          <select class="form-select font-monospace" name="bulk_location">${AC.ui.options(masterOptions(options.masters, 'location'), v('location'), AC.t('— Keep —'))}</select></div>
        <div class="col-md-4"><label class="form-label">Building / floor</label>
          <select class="form-select font-monospace" name="bulk_building">${AC.ui.options(masterOptions(options.masters, 'building'), v('building'), AC.t('— Keep —'))}</select></div>
        <div class="col-md-4"><label class="form-label">Type PC</label>
          <select class="form-select font-monospace" name="bulk_pc_type">${AC.ui.options(masterOptions(options.masters, 'pc_type'), v('pc_type'), AC.t('— Keep —'))}</select></div>
        <div class="col-md-6"><label class="form-label">Area</label><input class="form-control" name="bulk_area" value="${v('area')}">
          <div class="form-check mt-1"><input class="form-check-input" type="checkbox" name="bulk_clear[]" value="area" id="clr-area" ${cleared('area')}><label class="form-check-label small" for="clr-area">Clear Area</label></div></div>
        <div class="col-md-6"><label class="form-label">Remark</label><input class="form-control" name="bulk_remark" value="${v('remark')}">
          <div class="form-check mt-1"><input class="form-check-input" type="checkbox" name="bulk_clear[]" value="remark" id="clr-remark" ${cleared('remark')}><label class="form-check-label small" for="clr-remark">Clear Remark</label></div></div>
        <div class="col-12"><label class="form-label">Note</label><input class="form-control" name="bulk_note" value="${prev.note}" placeholder="e.g. moved to Line 6 per PR-2026-118"></div>
      </div>`;

    AC.modal.form({
      title: AC.t('Edit {n} asset(s)', { n: fmt.number(count) }) + (sel.select_all ? AC.t(' (all matching the filter)') : ''),
      body: body,
      route: 'admin/assets/bulk-preview',
      submitLabel: html`Review changes <i class="bi bi-arrow-right"></i>`,
      data: function (obj) {
        var out = Object.assign({}, obj);
        if (!out.bulk_clear) { out.bulk_clear = []; }
        if (sel.select_all) { Object.assign(out, sel.filter, { select_all: '1' }); } else { out.ids = sel.ids; }
        return out;
      },
      onSuccess: function (res) { bulkStep2(sel, count, options, res.data); },
    });
  }

  function bulkStep2(sel, count, options, p) {
    var rows = p.rows.map(function (r) {
      var keys = Object.keys(r.diff || {});
      return html`<tr class="${keys.length ? '' : 'text-secondary'}">
        <td><span class="asset-no">${r.asset_no}</span><span class="cell-sub truncate">${r.description}</span></td>
        <td class="small font-monospace">${r.work_center || '—'}</td>
        <td>${keys.length ? keys.map(function (f) {
          return html`<div><span class="small text-secondary d-inline-block" style="min-width:110px">${AC.meta.field(f)}</span>${AC.ui.diff(r.diff[f][0], r.diff[f][1], f)}</div>`;
        }) : html`<span class="small">No change</span>`}</td></tr>`;
    });
    var body = html`
      <p>${fmt.number(p.rows.length)} selected · <strong>${fmt.number(p.change_count)}</strong> will actually change <span class="text-secondary">(the rest already have these values)</span></p>
      ${p.note ? html`<div class="alert alert-secondary py-2 small">History note: “${p.note}”</div>` : ''}
      <div class="table-responsive border rounded" style="max-height:55vh">
        <table class="table table-sm align-top mb-0"><thead><tr><th>IT Asset</th><th>Work Center</th><th>Changes</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    var prev = { values: p.values, clear: p.clear, note: p.note };
    var el = AC.modal.form({
      title: AC.t('Review before saving'),
      body: body,
      route: 'admin/assets/bulk-apply',
      footer: html`
        <button type="button" class="btn btn-outline-secondary me-auto" data-bulk-back><i class="bi bi-arrow-left me-1"></i>Back</button>
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        <button type="submit" form="modal-form" class="btn btn-primary" ${p.change_count ? '' : AC.raw('disabled')}>Confirm and save ${fmt.number(p.change_count)}</button>`,
      data: function () {
        var out = { ids: p.ids, bulk_clear: p.clear, bulk_note: p.note };
        Object.keys(p.values).forEach(function (f) { out['bulk_' + f] = p.values[f]; });
        return out;
      },
    });
    AC.$('[data-bulk-back]', el).addEventListener('click', function () { bulkStep1(sel, count, options, prev); });
  }

  AC.on('asset-bulk', function (el) {
    var table = AC.$('[data-select-table]');
    if (!table || !table.selection) { return; }
    var s = table.selection();
    var sel = { ids: s.ids, select_all: s.select_all, filter: pick(AC.query(), FILTER_KEYS) };
    var count = s.select_all ? Number(el.getAttribute('data-total') || 0) : s.ids.length;
    if (!count) { AC.toast(AC.t('No assets selected.'), 'error'); return; }
    bulkStep1(sel, count, listOptions || {});
  });

  /* ---------------------------------------------------------------- export */

  AC.on('asset-export', function () {
    var filter = currentFilter();
    AC.modal.loading(AC.t('Export'));
    AC.api.get('export/info', filter).then(function (d) {
      // Two kinds only, and both can be imported again: all columns, or chosen columns (IT Asset always included).
      var body = html`<div class="vstack gap-3">
        <div class="alert alert-info py-2 mb-0 small"><i class="bi bi-arrow-repeat me-1"></i>You can edit the file and import it back on the <strong>Import</strong> page.</div>
        <div class="small text-secondary">Uses the same filter as the list${d.filter_empty ? AC.t(' (every asset you can see)') : ''}.</div>
        <div>
          <div class="form-label">Columns</div>
          <div class="form-check mb-2">
            <input class="form-check-input" type="radio" name="preset" value="full" id="preset-full" checked>
            <label class="form-check-label" for="preset-full"><strong>All columns</strong>
              <span class="d-block small text-secondary">${d.columns.map(function (col) { return col.label; }).join(', ')}</span></label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="preset" value="custom" id="preset-custom">
            <label class="form-check-label" for="preset-custom"><strong>Choose columns</strong>
              <span class="d-block small text-secondary">IT Asset is always included.</span></label>
          </div>
          <div id="custom-columns" class="row row-cols-2 row-cols-md-3 row-cols-xl-4 g-1 ps-4 pt-2 d-none">
            ${d.columns.map(function (col) {
              return html`<div class="form-check small"><input class="form-check-input" type="checkbox" name="cols[]" value="${col.code}" id="col-${col.code}" checked ${col.required ? AC.raw('disabled') : ''}><label class="form-check-label" for="col-${col.code}">${col.label}${col.required ? html` <span class="text-secondary">(${AC.t('required')})</span>` : ''}</label></div>`;
            })}
          </div>
        </div>
        <div>
          <div class="form-label">File format</div>
          <div class="btn-group" role="group">
            ${d.xlsx ? html`<input type="radio" class="btn-check" name="format" value="xlsx" id="fmt-xlsx" checked><label class="btn btn-outline-secondary" for="fmt-xlsx"><i class="bi bi-file-earmark-excel me-1"></i>Excel (.xlsx)</label>` : ''}
            <input type="radio" class="btn-check" name="format" value="csv" id="fmt-csv" ${d.xlsx ? '' : AC.raw('checked')}><label class="btn btn-outline-secondary" for="fmt-csv"><i class="bi bi-filetype-csv me-1"></i>CSV (UTF-8)</label>
          </div>
        </div>
      </div>`;
      var el = AC.modal.open({
        title: AC.t('Export {n} asset(s)', { n: fmt.number(d.count) }),
        body: html`<form id="export-form">${AC.ui.errorBox()}${body}</form>`,
        footer: html`<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
          <button type="submit" form="export-form" class="btn btn-primary" ${d.count ? '' : AC.raw('disabled')}><i class="bi bi-download me-1"></i>Download</button>`,
      });
      var form = AC.$('#export-form', el);
      var custom = AC.$('#custom-columns', el);
      AC.$$('input[name="preset"]', el).forEach(function (r) {
        r.addEventListener('change', function () { custom.classList.toggle('d-none', !AC.$('#preset-custom', el).checked); });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = AC.formData(form);
        var params = Object.assign({}, filter, { preset: f.preset, format: f.format });
        if (f.preset === 'custom') {
          var cols = (f.cols || []).filter(function (x) { return x !== 'asset_no'; });
          if (!cols.length) { AC.showErrors(el, [AC.t('Choose at least one column besides IT Asset.')]); return; }
          params.cols = ['asset_no'].concat(cols);
        }
        var link = document.createElement('a');
        link.href = AC.api.url('export/download', params);
        link.setAttribute('download', '');
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(AC.modal.close, 300);
      });
    }, function (err) { AC.modal.close(); AC.toast(err.message, 'error'); });
  });
})();
