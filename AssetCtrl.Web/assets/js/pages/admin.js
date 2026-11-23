/*
 * Admin settings and data pages: users, master data (tabs: Work Center,
 * Type PC, Location, Building), change history,
 * import, stock audit.
 *
 * API: admin/users[/form|/save|/active|/reset-password], admin/work-centers[/show|/save],
 *      admin/masters[/show|/save|/sync],
 *      admin/history, admin/import[/upload|/preview|/apply|/discard],
 *      admin/audit[/start|/round|/scan|/check|/close|/export]
 */
(function () {
  'use strict';
  var html = AC.html, fmt = AC.fmt, c = AC.c, $ = AC.$, t = AC.t;

  /* --------------------------------------------------------------- helpers */

  function wcText(w) {
    return w.code + (w.name ? ' · ' + w.name : '') + (w.is_active === false ? ' ' + t('(inactive)') : '');
  }

  /** [{id, code, name, is_active}] -> [[id, label]] for AC.ui.options */
  function wcOptions(list) {
    return (list || []).map(function (w) { return [w.id, wcText(w)]; });
  }

  /** POST, then toast + refresh (or show the error). */
  function postAndRefresh(route, body) {
    return AC.api.post(route, body).then(function (res) {
      AC.toast(res.message);
      AC.refresh();
      return res;
    }, function (err) { AC.toast(err.message, 'error'); throw err; });
  }

  function progressBar(pct) {
    return html`<div class="progress" style="height:6px"><div class="progress-bar" style="width:${pct.toFixed(1)}%;background:var(--ac-accent)"></div></div>`;
  }

  function searchBox(name, value, placeholder) {
    return html`<div class="search-wrap"><i class="bi bi-search"></i><input class="form-control form-control-sm" type="search" name="${name}" value="${value || ''}" placeholder="${placeholder}" data-search></div>`;
  }

  /* ---------------------------------------------------- Work Center picker */

  /**
   * Work Centers of a user, made for long lists:
   *   - the user's Work Centers are shown as tags (x removes one);
   *   - one search box adds more: type a code or name, pick from up to 8 suggestions
   *     (click, or arrow keys + Enter).
   * Each tag carries a hidden input name="work_centers[]" for the form.
   */
  var WC_SUGGEST = 8;

  function wcPicker() {
    return html`<div class="wc-tags">
      <div class="wc-tags-list" data-wc-tags></div>
      <div class="wc-add">
        <div class="search-wrap"><i class="bi bi-plus-lg"></i>
          <input class="form-control" type="search" autocomplete="off" placeholder="${t('Type a Work Center code or name to add…')}" data-wc-search
            role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="${t('Add a Work Center')}"></div>
        <div class="wc-suggest shadow-sm" data-wc-suggest role="listbox" hidden></div>
      </div>
    </div>`;
  }

  function initWcPicker(root, all, pickedIds) {
    var byId = {};
    all.forEach(function (w) { byId[String(w.id)] = w; });
    var chosen = [];                       // ids in the order they were added
    (pickedIds || []).forEach(function (id) { if (byId[String(id)] && chosen.indexOf(String(id)) === -1) { chosen.push(String(id)); } });
    chosen.sort(function (a, b) { return String(byId[a].code).localeCompare(String(byId[b].code)); });

    var tags = $('[data-wc-tags]', root);
    var search = $('[data-wc-search]', root);
    var sug = $('[data-wc-suggest]', root);
    var disabled = false, matches = [], active = 0;

    function drawTags() {
      tags.innerHTML = (chosen.length
        ? html`${chosen.map(function (id) {
            var w = byId[id];
            return html`<span class="wc-tag"><span class="font-monospace fw-semibold">${w.code}</span>${w.name ? html`<span class="wc-tag-name">${w.name}</span>` : ''}
              <button type="button" data-remove="${id}" title="${t('Remove')}" aria-label="${t('Remove')} ${w.code}"><i class="bi bi-x"></i></button>
              <input type="hidden" name="work_centers[]" value="${id}" ${disabled ? AC.raw('disabled') : ''}></span>`;
          })}${chosen.length > 1 ? html`<button type="button" class="btn btn-link btn-sm p-0 text-danger ms-1" data-remove-all>${t('Remove all')}</button>` : ''}`
        : html`<span class="text-secondary small">${t('No Work Centers yet.')}</span>`).toString();
    }

    function findMatches() {
      var q = search.value.trim().toLowerCase();
      if (!q) { return []; }
      var starts = [], contains = [];
      all.forEach(function (w) {
        if (chosen.indexOf(String(w.id)) !== -1) { return; }
        var code = String(w.code).toLowerCase(), text = code + ' ' + String(w.name || '').toLowerCase();
        if (code.indexOf(q) === 0) { starts.push(w); } else if (text.indexOf(q) !== -1) { contains.push(w); }
      });
      return starts.concat(contains);   // code-prefix matches first
    }

    function drawSuggest() {
      matches = findMatches();
      var q = search.value.trim();
      if (!q) { sug.hidden = true; search.setAttribute('aria-expanded', 'false'); return; }
      active = Math.min(active, Math.max(0, Math.min(matches.length, WC_SUGGEST) - 1));
      var shown = matches.slice(0, WC_SUGGEST);
      sug.innerHTML = (shown.length
        ? html`${shown.map(function (w, i) {
            return html`<button type="button" class="wc-suggest-item ${i === active ? 'active' : ''}" role="option" data-add="${w.id}">
              <span class="font-monospace fw-semibold">${w.code}</span><span class="text-secondary text-truncate">${w.name || ''}</span></button>`;
          })}${matches.length > WC_SUGGEST ? html`<div class="wc-suggest-more">${t('{n} more. Keep typing to narrow it down.', { n: matches.length - WC_SUGGEST })}</div>` : ''}`
        : html`<div class="wc-suggest-more">${t('No matches.')}</div>`).toString();
      var wasHidden = sug.hidden;
      sug.hidden = false;
      search.setAttribute('aria-expanded', 'true');
      if (wasHidden) { sug.scrollIntoView({ block: 'nearest' }); }
    }

    function add(id) {
      id = String(id);
      if (byId[id] && chosen.indexOf(id) === -1) { chosen.push(id); }
      search.value = '';
      active = 0;
      drawTags();
      drawSuggest();
      search.focus();
    }

    root.addEventListener('click', function (e) {
      if (disabled) { return; }
      var b = e.target.closest('[data-add],[data-remove],[data-remove-all]');
      if (!b) { return; }
      if (b.hasAttribute('data-add')) { add(b.getAttribute('data-add')); return; }
      if (b.hasAttribute('data-remove')) { chosen.splice(chosen.indexOf(b.getAttribute('data-remove')), 1); }
      if (b.hasAttribute('data-remove-all')) { chosen = []; }
      drawTags();
      drawSuggest();
    });
    // Keep the suggestion click from blurring the input first.
    sug.addEventListener('mousedown', function (e) { e.preventDefault(); });
    search.addEventListener('input', function () { active = 0; drawSuggest(); });
    search.addEventListener('focus', drawSuggest);
    search.addEventListener('blur', function () { sug.hidden = true; search.setAttribute('aria-expanded', 'false'); });
    search.addEventListener('keydown', function (e) {
      var n = Math.min(matches.length, WC_SUGGEST);
      if (e.key === 'ArrowDown' && n) { e.preventDefault(); active = (active + 1) % n; drawSuggest(); }
      else if (e.key === 'ArrowUp' && n) { e.preventDefault(); active = (active - 1 + n) % n; drawSuggest(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (n) { add(matches[active].id); } }
      else if (e.key === 'Escape' && !sug.hidden) { e.preventDefault(); e.stopPropagation(); search.value = ''; drawSuggest(); }
    });

    drawTags();
    return {
      setDisabled: function (v) {
        disabled = v;
        root.classList.toggle('is-disabled', v);
        search.disabled = v;
        drawTags();
      },
    };
  }

  /* ================================================================= USERS */

  AC.route('admin/users', {
    area: 'admin', title: 'Users', ability: 'users.manage',
    render: function (ctx) {
      var q = ctx.query;
      return AC.api.get('admin/users', { q: q.q, role: q.role, wc: q.wc, active: q.active, page: q.page }).then(function (d) {
        var f = d.filters;
        var offset = (d.pager.page - 1) * d.pager.per_page;
        var rows = d.rows.map(function (u, i) {
          var wcs = u.role === 'admin' ? html`<span class="text-secondary">All Work Centers</span>`
            : (u.work_centers.length
              ? html`<span class="font-monospace d-inline-block text-truncate" style="max-width:320px" title="${u.work_centers.map(wcText).join(', ')}">${u.work_centers.map(function (w) { return w.code; }).join(', ')}</span>`
              : html`<span class="text-warning">— none assigned —</span>`);
          return html`<tr class="${u.is_active ? '' : 'text-secondary'}">
            <td class="small text-secondary">${offset + i + 1}</td>
            <td class="font-monospace fw-semibold">${u.emp_code}</td>
            <td>${u.name}${u.phone ? html`<span class="cell-sub">${u.phone}</span>` : ''}</td>
            <td class="text-nowrap">
              <span class="badge ${u.role === 'admin' ? 'text-bg-dark' : 'text-bg-light border'}">${u.role === 'admin' ? t('Admin') : t('User')}</span>
              ${u.can_repair ? html`<span class="badge text-bg-light border" title="Takes repair jobs"><i class="bi bi-tools"></i></span>` : ''}
              ${!u.is_active ? html`<span class="badge text-bg-secondary">Inactive</span>` : ''}
              ${u.must_change_password ? html`<span class="cell-sub">Must change password</span>` : ''}
              ${u.locked ? html`<span class="cell-sub text-danger">Temporarily locked</span>` : ''}
            </td>
            <td class="small">${wcs}</td>
            <td class="small">${u.email}</td>
            <td class="d-none d-xl-table-cell small text-secondary text-nowrap">${u.last_login_at ? fmt.ago(u.last_login_at) : t('Never')}</td>
            <td class="text-end text-nowrap">
              <button class="btn btn-sm btn-outline-secondary" data-action="user-edit" data-id="${u.id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button class="btn btn-sm btn-outline-secondary" data-action="user-reset-pw" data-id="${u.id}" data-code="${u.emp_code}" title="Reset password"><i class="bi bi-key"></i></button>
              ${u.is_active
                ? html`<button class="btn btn-sm btn-outline-danger" data-action="user-active" data-id="${u.id}" data-code="${u.emp_code}" data-active="0" title="Deactivate"><i class="bi bi-person-slash"></i></button>`
                : html`<button class="btn btn-sm btn-outline-success" data-action="user-active" data-id="${u.id}" data-code="${u.emp_code}" data-active="1" title="Activate"><i class="bi bi-person-check"></i></button>`}
            </td></tr>`;
        });
        ctx.main.innerHTML = html`
          ${c.pageHead(t('Users'), t('Users see assets in their own Work Centers. Admins see all.'),
            html`<button class="btn btn-primary" data-action="user-edit" data-id="0"><i class="bi bi-person-plus me-1"></i>Add user</button>`)}
          <form class="filter-bar d-flex flex-wrap gap-2 mb-3" data-filter>
            ${searchBox('q', f.q, t('Employee code, name, email or Work Center'))}
            <select class="form-select form-select-sm" name="role" data-autosubmit aria-label="Role">${AC.ui.options(AC.state.meta.roles, f.role, 'Role: all')}</select>
            <select class="form-select form-select-sm" name="wc" data-autosubmit aria-label="Work Center">${AC.ui.options(wcOptions(d.work_centers), f.wc, 'Work Center: all')}</select>
            <select class="form-select form-select-sm" name="active" data-autosubmit aria-label="Account status">${AC.ui.options([['1', t('Active')], ['0', t('Inactive')], ['all', t('All accounts')]], f.active)}</select>
            <span class="ms-auto align-self-center small text-secondary">${fmt.number(d.pager.total)} account(s)</span>
          </form>
          <div class="card"><div class="table-responsive"><table class="table table-hover align-middle">
            <thead><tr><th>#</th><th>Employee code</th><th>Name</th><th>Role</th><th>Work Centers</th><th>Email</th><th class="d-none d-xl-table-cell">Last sign-in</th><th class="text-end"></th></tr></thead>
            <tbody>${rows.length ? rows : AC.ui.empty('No users found.', 8)}</tbody>
          </table></div></div>
          ${AC.ui.pager(d.pager)}`.toString();
      });
    },
  });

  function userForm(d) {
    var u = d.user || { id: 0, emp_code: '', first_name: '', last_name: '', email: '', phone: '', role: 'user', can_repair: false, is_active: true };
    var isNew = !u.id;
    var picked = d.work_center_ids.length ? d.work_center_ids : (isNew && AC.query().wc ? [AC.query().wc] : []);
    var body = html`<div class="row g-3">
      <div class="col-md-4"><label class="form-label" for="u-code">Employee code (sign-in ID)</label><input class="form-control font-monospace text-uppercase" id="u-code" name="emp_code" value="${u.emp_code}" required></div>
      <div class="col-md-4"><label class="form-label" for="u-fn">First name</label><input class="form-control" id="u-fn" name="first_name" value="${u.first_name}" required></div>
      <div class="col-md-4"><label class="form-label" for="u-ln">Last name</label><input class="form-control" id="u-ln" name="last_name" value="${u.last_name}"></div>
      <div class="col-md-6"><label class="form-label" for="u-email">Email</label><input class="form-control" type="email" id="u-email" name="email" value="${u.email}"></div>
      <div class="col-md-6"><label class="form-label" for="u-phone">Phone</label><input class="form-control" id="u-phone" name="phone" value="${u.phone}"></div>
      ${isNew ? html`<div class="col-12"><label class="form-label" for="u-pw">Initial password</label><input class="form-control" id="u-pw" name="password" minlength="8" required autocomplete="off">
        <div class="form-text">The user must change it at first sign-in.</div></div>` : ''}
      <div class="col-12"><hr class="my-1"></div>
      <div class="col-md-6">
        <span class="form-label d-block">Role</span>
        <div class="btn-group w-100" role="group">
          <input type="radio" class="btn-check" name="role" value="user" id="role-user" ${u.role !== 'admin' ? AC.raw('checked') : ''}><label class="btn btn-outline-secondary" for="role-user">User</label>
          <input type="radio" class="btn-check" name="role" value="admin" id="role-admin" ${u.role === 'admin' ? AC.raw('checked') : ''}><label class="btn btn-outline-secondary" for="role-admin">Admin</label>
        </div>
        <div class="form-text">Users see only the Work Centers below. Admins see all.</div>
      </div>
      <div class="col-md-6 d-flex flex-column justify-content-center gap-2">
        <div class="form-check form-switch" id="u-repair-box"><input class="form-check-input" type="checkbox" role="switch" name="can_repair" value="1" id="u-repair" ${u.can_repair ? AC.raw('checked') : ''}><label class="form-check-label" for="u-repair">Takes repair jobs</label></div>
        <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" name="is_active" value="1" id="u-active" ${u.is_active ? AC.raw('checked') : ''}><label class="form-check-label" for="u-active">Account active</label></div>
      </div>
      <div class="col-12" id="u-wc-box">
        <span class="form-label d-block">Work Centers this user can see <span class="fw-normal text-secondary">(at least one)</span></span>
        ${wcPicker()}
        <div class="form-text" id="u-wc-admin-note" hidden>Not needed for admins.</div>
      </div>
    </div>`;
    var footer = html`
      ${!isNew ? html`<button type="button" class="btn btn-outline-danger btn-sm me-auto" data-action="user-reset-pw" data-id="${u.id}" data-code="${u.emp_code}"><i class="bi bi-key me-1"></i>Reset password</button>` : ''}
      <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
      <button type="submit" form="modal-form" class="btn btn-primary">${isNew ? t('Add user') : t('Save')}</button>`;
    AC.modal.form({
      title: isNew ? 'Add user' : html`Edit <span class="font-monospace">${u.emp_code}</span>`,
      body: body, footer: footer, route: 'admin/users/save',
      data: function (o) { o.id = u.id; if (!o.work_centers) { o.work_centers = []; } return o; },
      onShow: function (el) {
        var picker = initWcPicker($('.wc-tags', el), d.work_centers, picked);
        var sync = function () {
          var admin = $('#role-admin', el).checked;
          picker.setDisabled(admin);
          $('#u-wc-admin-note', el).hidden = !admin;
          // Only admins take repair jobs: the switch is shown for the Admin role only.
          $('#u-repair-box', el).hidden = !admin;
        };
        Array.prototype.forEach.call(el.querySelectorAll('[name=role]'), function (r) { r.addEventListener('change', sync); });
        sync();
      },
    });
  }

  AC.on('user-edit', function (el) {
    var id = Number(el.getAttribute('data-id')) || 0;
    AC.modal.loading(id ? 'Edit user' : 'Add user');
    AC.api.get('admin/users/form', { id: id || '' }).then(userForm, function (err) { AC.modal.close(); AC.toast(err.message, 'error'); });
  });

  AC.on('user-reset-pw', function (el) {
    var id = el.getAttribute('data-id'), code = el.getAttribute('data-code');
    AC.confirm(t('Reset the password for {code}? This also unlocks the account.', { code: code }), 'Reset password', true).then(function (yes) {
      if (!yes) { return; }
      AC.api.post('admin/users/reset-password', { id: id }).then(function (res) {
        var r = res.data;
        AC.modal.open({
          title: 'Temporary password',
          body: html`<div class="text-center py-3">
            <div class="text-secondary small mb-2">${r.emp_code} · ${r.name}</div>
            <div class="font-monospace fs-2 fw-semibold user-select-all border rounded py-2">${r.temp_password}</div>
            <p class="small text-secondary mt-3 mb-0">Shown only once. The user must change it at the next sign-in.</p></div>`,
          footer: html`<button type="button" class="btn btn-primary" data-bs-dismiss="modal">Done</button>`,
        });
        AC.refresh();
      }, function (err) { AC.toast(err.message, 'error'); });
    });
  });

  AC.on('user-active', function (el) {
    var id = el.getAttribute('data-id'), code = el.getAttribute('data-code'), active = el.getAttribute('data-active');
    var go = active === '1' ? Promise.resolve(true)
      : AC.confirm(t('Deactivate {code}? They will not be able to sign in.', { code: code }), 'Deactivate', true);
    go.then(function (yes) { if (yes) { postAndRefresh('admin/users/active', { id: id, active: active }).catch(function () {}); } });
  });

  /* ========================================================== WORK CENTERS */

  /** Tab bar of the Master data page. Work Center has its own page (admin/work-centers); the rest share admin/masters. */
  function masterTabs(tabs, active) {
    return html`<ul class="nav nav-underline mb-3">${(tabs || []).map(function (k) {
      var href = k.code === 'work_center' ? AC.link('admin/work-centers') : AC.link('admin/masters', { kind: k.code });
      return html`<li class="nav-item"><a class="nav-link ${k.code === active ? 'active' : ''}" href="${href}">${t(k.label)} <span class="badge text-bg-light font-monospace">${fmt.number(k.total)}</span></a></li>`;
    })}</ul>`;
  }

  AC.route('admin/work-centers', {
    area: 'admin', title: 'Master data', ability: 'users.manage',
    render: function (ctx) {
      var q = ctx.query;
      return AC.api.get('admin/work-centers', { q: q.q, active: q.active, page: q.page }).then(function (d) {
        var f = d.filters;
        var rows = d.rows.map(function (w) {
          return html`<tr class="${w.is_active ? '' : 'text-secondary'}">
            <td class="font-monospace fw-semibold">${w.code}</td>
            <td>${w.name !== '' ? w.name : html`<span class="text-secondary">— no name yet —</span>`}</td>
            <td>${w.is_active ? html`<span class="status status--ok">Active</span>` : html`<span class="status status--muted">Inactive</span>`}</td>
            <td class="text-end"><a class="font-monospace" href="${AC.link('admin/assets', { wc: w.id })}">${fmt.number(w.asset_count)}</a></td>
            <td class="text-end"><a class="font-monospace" href="${AC.link('admin/users', { wc: w.id, active: 'all' })}">${fmt.number(w.user_count)}</a></td>
            <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-action="wc-edit" data-id="${w.id}" title="Edit"><i class="bi bi-pencil"></i></button></td></tr>`;
        });
        ctx.main.innerHTML = html`
          ${c.pageHead(t('Master data'), t('Work Center names set here are used on every page. Imports do not overwrite them.'),
            html`<button class="btn btn-primary" data-action="wc-edit" data-id="0"><i class="bi bi-plus-lg me-1"></i>Add Work Center</button>`)}
          ${masterTabs(d.tabs, 'work_center')}
          <form class="filter-bar d-flex flex-wrap gap-2 mb-3" data-filter>
            ${searchBox('q', f.q, t('Work Center code or name'))}
            <select class="form-select form-select-sm" name="active" data-autosubmit aria-label="Status">${AC.ui.options([['1', t('Active')], ['0', t('Inactive')]], f.active, 'Status: all')}</select>
            ${d.inactive_count && f.active !== '0' ? html`<a class="btn btn-sm btn-outline-secondary" href="${AC.link('admin/work-centers', { active: '0' })}">Inactive ${fmt.number(d.inactive_count)}</a>` : ''}
            <span class="ms-auto align-self-center small text-secondary">${fmt.number(d.pager.total)} Work Center(s)</span>
          </form>
          <div class="card"><div class="table-responsive"><table class="table table-hover align-middle">
            <thead><tr><th>Code</th><th>Work Center Name</th><th>Status</th><th class="text-end">Assets</th><th class="text-end">Users</th><th class="text-end"></th></tr></thead>
            <tbody>${rows.length ? rows : AC.ui.empty('No Work Centers found.', 6)}</tbody>
          </table></div></div>
          ${AC.ui.pager(d.pager)}`.toString();
      });
    },
  });

  function wcForm(w) {
    var isNew = !w.id;
    AC.modal.form({
      title: isNew ? 'Add Work Center' : html`Work Center <span class="font-monospace">${w.code}</span>`,
      route: 'admin/work-centers/save',
      body: html`<div class="vstack gap-3">
        ${isNew ? html`<div><label class="form-label" for="wcode">Work Center code</label>
          <input class="form-control font-monospace text-uppercase" id="wcode" name="code" maxlength="16" required placeholder="e.g. 2300"></div>` : ''}
        <div><label class="form-label" for="wname">Work Center Name</label>
          <input class="form-control text-uppercase" id="wname" name="name" value="${w.name}" maxlength="191" placeholder="e.g. ICS">
          ${!isNew ? html`<div class="form-text">Shown on every page.</div>` : ''}</div>
        <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" name="is_active" value="1" id="wactive" ${w.is_active ? AC.raw('checked') : ''}>
          <label class="form-check-label" for="wactive">Active</label></div>
        ${!isNew ? html`<div class="small text-secondary">${fmt.number(w.asset_count)} asset(s) · ${fmt.number(w.user_count)} user(s) granted</div>` : ''}
      </div>`,
      data: function (o) { o.id = w.id; return o; },
    });
  }

  AC.on('wc-edit', function (el) {
    var id = Number(el.getAttribute('data-id')) || 0;
    if (!id) { wcForm({ id: 0, code: '', name: '', is_active: true }); return; }
    AC.modal.loading('Work Center');
    AC.api.get('admin/work-centers/show', { id: id }).then(wcForm, function (err) { AC.modal.close(); AC.toast(err.message, 'error'); });
  });

  /* ============================================ MASTER DATA (Type PC / Location / Building; Work Center tab above) */

  AC.route('admin/masters', {
    area: 'admin', title: 'Master data', ability: 'users.manage',
    render: function (ctx) {
      var q = ctx.query;
      return AC.api.get('admin/masters', { kind: q.kind || 'pc_type', q: q.q, active: q.active, page: q.page }).then(function (d) {
        var f = d.filters, kind = d.kind, counts = d.counts[kind];
        var kindDef = d.kinds.filter(function (k) { return k.code === kind; })[0];
        var rows = d.rows.map(function (m) {
          var filter = {}; filter[kind] = m.code; // the kind is also the asset list filter key
          return html`<tr class="${m.is_active ? '' : 'text-secondary'}">
            <td class="font-monospace fw-semibold">${m.code}</td>
            <td>${m.name !== '' ? m.name : html`<span class="text-secondary">—</span>`}</td>
            <td>${m.is_active ? html`<span class="status status--ok">Active</span>` : html`<span class="status status--muted">Inactive</span>`}</td>
            <td class="text-end"><a class="font-monospace" href="${AC.link('admin/assets', filter)}">${fmt.number(m.asset_count)}</a></td>
            <td class="text-end"><button class="btn btn-sm btn-outline-secondary" data-action="master-edit" data-id="${m.id}" title="Edit"><i class="bi bi-pencil"></i></button></td></tr>`;
        });
        ctx.main.innerHTML = html`
          ${c.pageHead(t('Master data'), t('Values offered on the asset form and bulk edit. Import adds new values automatically.'),
            html`<button class="btn btn-primary" data-action="master-edit" data-id="0" data-kind="${kind}" data-max="${kindDef.max}"><i class="bi bi-plus-lg me-1"></i>${t('Add {what}', { what: t(kindDef.label) })}</button>`)}
          ${masterTabs(d.tabs, kind)}
          ${counts.missing ? html`<div class="alert alert-warning d-flex flex-wrap align-items-center gap-2 py-2">
            <i class="bi bi-exclamation-triangle"></i>
            <span>${t('{n} value(s) used on assets are not in this list yet.', { n: fmt.number(counts.missing) })}</span>
            <button class="btn btn-sm btn-outline-secondary ms-auto" data-action="master-sync" data-kind="${kind}">${t('Add values in use')}</button></div>` : ''}
          <form class="filter-bar d-flex flex-wrap gap-2 mb-3" data-filter data-keep="kind">
            ${searchBox('q', f.q, t('Code or description'))}
            <select class="form-select form-select-sm" name="active" data-autosubmit aria-label="Status">${AC.ui.options([['1', t('Active')], ['0', t('Inactive')]], f.active, 'Status: all')}</select>
            <span class="ms-auto align-self-center small text-secondary">${t('{n} value(s)', { n: fmt.number(d.pager.total) })}</span>
          </form>
          <div class="card"><div class="table-responsive"><table class="table table-hover align-middle">
            <thead><tr><th>Code</th><th>Description</th><th>Status</th><th class="text-end">Assets</th><th class="text-end"></th></tr></thead>
            <tbody>${rows.length ? rows : AC.ui.empty('No values yet.', 5)}</tbody>
          </table></div></div>
          ${AC.ui.pager(d.pager)}`.toString();
      });
    },
  });

  function masterForm(m, max) {
    var isNew = !m.id;
    var label = t(AC.meta.field(m.kind));
    AC.modal.form({
      title: isNew ? t('Add {what}', { what: label }) : html`${label} <span class="font-monospace">${m.code}</span>`,
      route: 'admin/masters/save',
      body: html`<div class="vstack gap-3">
        ${isNew ? html`<div><label class="form-label" for="mcode">Code</label>
          <input class="form-control font-monospace text-uppercase" id="mcode" name="code" maxlength="${max || 64}" required>
          <div class="form-text">Stored on the asset. It cannot be changed later.</div></div>` : ''}
        <div><label class="form-label" for="mname">Description <span class="fw-normal text-secondary">(optional)</span></label>
          <input class="form-control" id="mname" name="name" value="${m.name}" maxlength="191"></div>
        <div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" name="is_active" value="1" id="mactive" ${m.is_active ? AC.raw('checked') : ''}>
          <label class="form-check-label" for="mactive">Active</label>
          <div class="form-text">Inactive values are no longer offered for new choices. Assets that already have them keep them.</div></div>
        ${!isNew ? html`<div class="small text-secondary">${fmt.number(m.asset_count)} asset(s)</div>` : ''}
      </div>`,
      data: function (o) { o.id = m.id; o.kind = m.kind; return o; },
    });
  }

  AC.on('master-edit', function (el) {
    var id = Number(el.getAttribute('data-id')) || 0;
    if (!id) { masterForm({ id: 0, kind: el.getAttribute('data-kind'), code: '', name: '', is_active: true }, Number(el.getAttribute('data-max'))); return; }
    AC.modal.loading(t('Master data'));
    AC.api.get('admin/masters/show', { id: id }).then(function (m) { masterForm(m); }, function (err) { AC.modal.close(); AC.toast(err.message, 'error'); });
  });

  AC.on('master-sync', function (el) {
    postAndRefresh('admin/masters/sync', { kind: el.getAttribute('data-kind') }).catch(function () {});
  });

  /* =============================================================== HISTORY */

  AC.route('admin/history', {
    area: 'admin', title: 'Change history', ability: 'history.view_all',
    render: function (ctx) {
      var q = ctx.query;
      return AC.api.get('admin/history', { field: q.field, source: q.source, q: q.q, from: q.from, to: q.to, page: q.page }).then(function (d) {
        var f = d.filters;
        var tabs = [['', t('All')], ['area', t('Area moves')], ['remark', t('Remark edits')], ['status', t('Status changes')], ['work_center', t('Work Center moves')]];
        var rows = d.rows.map(function (h) {
          return html`<tr>
            <td class="text-nowrap small">${fmt.datetime(h.changed_at)}</td>
            <td><a class="asset-no" href="${AC.link('admin/assets/show', { id: h.asset_id })}">${h.asset_no}</a><span class="cell-sub font-monospace">${h.work_center || ''}</span></td>
            <td class="text-nowrap small">${AC.meta.field(h.field)}</td>
            <td>${h.field === '_created' ? html`<span class="text-secondary">Added to the register</span>` : AC.ui.diff(h.old_value, h.new_value, h.field)}
              ${h.note ? html`<span class="cell-sub">${h.source === 'repair' ? html`<span class="ticket-tag">${h.note}</span>` : '“' + h.note + '”'}</span>` : ''}</td>
            <td class="small text-nowrap">${h.user_name || '—'}</td>
            <td class="small text-secondary text-nowrap d-none d-md-table-cell">${AC.meta.label('history_sources', h.source)}</td></tr>`;
        });
        ctx.main.innerHTML = html`
          ${c.pageHead(t('Change history'), t('All changes to assets'))}
          <ul class="nav nav-underline mb-3">${tabs.map(function (t) {
            return html`<li class="nav-item"><a class="nav-link ${f.field === t[0] ? 'active' : ''}" href="${AC.linkWith({ field: t[0], page: '' })}">${t[1]}</a></li>`;
          })}</ul>
          <form class="filter-bar d-flex flex-wrap gap-2 align-items-center mb-3" data-filter data-keep="field">
            ${searchBox('q', f.q, t('Asset number or changed value'))}
            <select class="form-select form-select-sm" name="source" data-autosubmit aria-label="Source">${AC.ui.options(AC.state.meta.history_sources, f.source, 'Source: all')}</select>
            <div class="input-group input-group-sm w-auto"><span class="input-group-text">From</span><input class="form-control" type="date" name="from" value="${f.from}"></div>
            <div class="input-group input-group-sm w-auto"><span class="input-group-text">To</span><input class="form-control" type="date" name="to" value="${f.to}"></div>
            <button class="btn btn-outline-secondary btn-sm" type="submit">Filter</button>
            <span class="ms-auto small text-secondary">${fmt.number(d.pager.total)} change(s)</span>
          </form>
          <div class="card"><div class="table-responsive"><table class="table table-sm align-top">
            <thead><tr><th>When</th><th>IT Asset</th><th>Field</th><th>Change</th><th>By</th><th class="d-none d-md-table-cell">Source</th></tr></thead>
            <tbody>${rows.length ? rows : AC.ui.empty('No history found.', 6)}</tbody>
          </table></div></div>
          ${AC.ui.pager(d.pager)}`.toString();
      });
    },
  });

  /* ================================================================ IMPORT */

  var BATCH_STATUS = { preview: ['Waiting for review', 'warn'], applied: ['Imported', 'ok'], discarded: ['Discarded', 'muted'] };
  function batchBadge(status) {
    var s = BATCH_STATUS[status] || [status, 'muted'];
    return html`<span class="status status--${s[1]}">${t(s[0])}</span>`;
  }

  AC.route('admin/import', {
    area: 'admin', title: 'Import', ability: 'import.run',
    render: function (ctx) {
      return AC.api.get('admin/import').then(function (d) {
        var rows = d.batches.map(function (b) {
          return html`<tr>
            <td class="font-monospace small">${b.id}</td>
            <td><a href="${AC.link('admin/import/preview', { id: b.id })}">${b.filename}</a><span class="cell-sub">${fmt.number(b.total_rows)} row(s)</span></td>
            <td>${batchBadge(b.status)}</td>
            <td class="text-end font-monospace">${fmt.number(b.create_count)}</td>
            <td class="text-end font-monospace">${fmt.number(b.update_count)}</td>
            <td class="text-end font-monospace ${b.error_count ? 'text-danger' : ''}">${fmt.number(b.error_count)}</td>
            <td class="small text-nowrap">${b.uploaded_by_name || '—'}</td>
            <td class="small text-nowrap text-secondary">${fmt.datetime(b.applied_at || b.created_at)}</td></tr>`;
        });
        ctx.main.innerHTML = html`
          ${c.pageHead(t('Import from the master sheet'), t('Upload a file, check the changes, then confirm.'))}
          <div class="row g-3">
            <div class="col-xl-8 vstack gap-3">
              <form class="card" id="import-upload" novalidate>
                <div class="card-header"><h2 class="card-title mb-0">1. Choose a file</h2><span class="small text-secondary">.xlsx or .csv · up to ${d.max_upload}</span></div>
                <div class="card-body">
                  ${AC.ui.errorBox()}
                  <div class="input-group">
                    <input class="form-control" type="file" name="file" accept=".csv,.xlsx,.txt" required>
                    <button class="btn btn-primary" type="submit">Upload and compare <i class="bi bi-arrow-right"></i></button>
                  </div>
                  <div class="upload-progress d-none mt-3" data-upload-progress aria-live="polite">
                    <ol class="upload-steps">
                      <li data-step="send"><span class="dot"></span>Upload the file</li>
                      <li data-step="check"><span class="dot"></span>Check and compare</li>
                    </ol>
                    <div class="progress" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                      <div class="progress-bar" style="width:0%"></div>
                    </div>
                    <div class="d-flex justify-content-between small text-secondary mt-1">
                      <span data-progress-text></span><span data-progress-pct class="font-monospace"></span>
                    </div>
                  </div>
                </div>
              </form>
              <div class="card">
                <div class="card-header"><h2 class="card-title mb-0">Import history</h2></div>
                <div class="table-responsive"><table class="table table-sm align-middle">
                  <thead><tr><th>#</th><th>File</th><th>Status</th><th class="text-end">New</th><th class="text-end">Changed</th><th class="text-end">Errors</th><th>By</th><th>When</th></tr></thead>
                  <tbody>${rows.length ? rows : AC.ui.empty('Nothing imported yet.', 8)}</tbody>
                </table></div>
              </div>
            </div>
            <div class="col-xl-4"><div class="card">
              <div class="card-header"><h2 class="card-title mb-0">Supported file layouts</h2></div>
              <div class="card-body small vstack gap-2">
                <p class="mb-0"><strong>With a header row</strong>: column names in the first row, any order. A file exported from this system works as is.</p>
                <p class="mb-0"><strong>Legacy master sheet</strong>: no header, 14 columns in this order:</p>
                <ol class="mb-0 ps-3" style="columns:2">${d.legacy_columns.map(function (col) { return html`<li>${col.label}</li>`; })}</ol>
                <p class="mb-0 text-secondary"><code>2300-ICS</code> is read as code <code>2300</code>, name <code>ICS</code>. New Work Centers are added automatically.</p>
              </div></div></div>
          </div>`.toString();

        var form = $('#import-upload', ctx.main);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var input = form.querySelector('[name=file]');
          if (!input.files.length) { AC.showErrors(form, [t('Please choose a file.')]); return; }
          var file = input.files[0];
          if (d.max_bytes && file.size > d.max_bytes) {
            AC.showErrors(form, [t('The file is too large (limit {max}).', { max: d.max_upload })]);
            return;
          }
          var btn = form.querySelector('[type=submit]');
          btn.disabled = true;
          input.disabled = true;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>' + AC.esc(t('Uploading…'));
          $('[data-errors]', form).classList.add('d-none');
          uploadInParts(file, d.chunk_size || 1048576, $('[data-upload-progress]', form)).then(function (res) {
            AC.toast(res.message);
            AC.go('admin/import/preview', { id: res.data.id });
          }, function (err) {
            AC.showErrors(form, err.errors || [t('The upload failed.')]);
            btn.disabled = false;
            input.disabled = false;
            btn.innerHTML = AC.esc(t('Upload and compare')) + ' <i class="bi bi-arrow-right"></i>';
          });
        });
      });
    },
  });

  /**
   * Upload a file in parts (admin/import/upload-chunk), so files larger than the server's single-request
   * limit go through, with a two-step progress display:
   *   1. "Upload the file": the bar fills as parts arrive (part i of n, MB sent);
   *   2. "Check and compare": the last part makes the server join and read the file (bar full, striped).
   * A part that fails because of the network is sent again (3 tries). Resolves with the last part's response.
   */
  function uploadInParts(file, chunkSize, box) {
    var total = Math.max(1, Math.ceil(file.size / chunkSize));
    var rnd = new Uint8Array(16);
    window.crypto.getRandomValues(rnd);
    var uploadId = Array.prototype.map.call(rnd, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    var bar = box.querySelector('.progress-bar'), track = box.querySelector('.progress');
    var text = box.querySelector('[data-progress-text]'), pct = box.querySelector('[data-progress-pct]');
    var mb = function (n) { return (n / 1048576).toFixed(n < 10485760 ? 1 : 0); };
    var order = ['send', 'check'];

    function step(name) {
      Array.prototype.forEach.call(box.querySelectorAll('[data-step]'), function (li) {
        var i = order.indexOf(li.getAttribute('data-step')), cur = order.indexOf(name);
        li.classList.toggle('is-done', i < cur);
        li.classList.toggle('is-active', i === cur);
      });
    }
    function show(done) {
      var p = file.size ? Math.round(done / file.size * 100) : 100;
      bar.style.width = p + '%';
      track.setAttribute('aria-valuenow', String(p));
      pct.textContent = p + '%';
    }

    box.classList.remove('d-none');
    bar.classList.remove('progress-bar-striped', 'progress-bar-animated');
    step('send');
    show(0);

    function send(index, attempt) {
      var start = index * chunkSize, end = Math.min(file.size, start + chunkSize);
      text.textContent = t('Part {i} of {n} · {sent} / {size} MB', { i: index + 1, n: total, sent: mb(start), size: mb(file.size) });
      var fd = new FormData();
      fd.append('upload_id', uploadId);
      fd.append('index', String(index));
      fd.append('total', String(total));
      fd.append('size', String(file.size));
      fd.append('name', file.name);
      fd.append('chunk', file.slice(start, end), file.name);
      if (index === total - 1) {
        // The server checks the whole file after this part: show the second step while it works.
        show(file.size);
        step('check');
        bar.classList.add('progress-bar-striped', 'progress-bar-animated');
        text.textContent = t('Checking the file and comparing it with the register…');
      }
      return AC.api.post('admin/import/upload-chunk', fd).then(function (res) {
        if (res.data && res.data.done) { return res; }
        show(end);
        return send(index + 1, 1);
      }, function (err) {
        if (err.code === 'network' && attempt < 3) { return send(index, attempt + 1); }
        box.classList.add('d-none');
        throw err;
      });
    }
    return send(0, 1);
  }

  AC.route('admin/import/preview', {
    area: 'admin', title: 'Import preview', ability: 'import.run',
    render: function (ctx) {
      var q = ctx.query;
      return AC.api.get('admin/import/preview', { id: q.id, tab: q.tab, page: q.page }).then(function (d) {
        var b = d.batch, tab = d.tab;
        ctx.setTitle(t('Import · {file}', { file: b.filename }));
        var tabs = [['update', t('Will update'), b.update_count], ['create', t('New'), b.create_count],
          ['error', t('Errors'), b.error_count], ['missing', t('In the system but not in the file'), b.missing_count]];
        var head, body;
        if (tab === 'update') {
          head = html`<tr><th>Line</th><th>IT Asset</th><th>Changes</th></tr>`;
          body = d.rows.map(function (r) {
            return html`<tr><td class="font-monospace small text-secondary">${r.line_no}</td>
              <td class="text-nowrap"><span class="asset-no">${r.asset_no}</span></td>
              <td>${Object.keys(r.diff).map(function (fld) {
                return html`<div><span class="small text-secondary d-inline-block" style="min-width:130px">${AC.meta.field(fld)}</span>${AC.ui.diff(r.diff[fld][0], r.diff[fld][1], fld)}</div>`;
              })}</td></tr>`;
          });
        } else if (tab === 'create') {
          head = html`<tr><th>Line</th><th>IT Asset</th><th>Description</th><th>Work Center</th><th>Area</th><th>Status</th></tr>`;
          body = d.rows.map(function (r) {
            var p = r.payload || {};
            return html`<tr><td class="font-monospace small text-secondary">${r.line_no}</td>
              <td><span class="asset-no">${r.asset_no}</span></td><td>${p.description || ''}</td>
              <td class="small"><span class="font-monospace">${p.work_center || ''}</span> <span class="text-nowrap">${p._wc_name || ''}</span></td>
              <td>${p.area || ''}</td><td>${p.status !== undefined ? AC.ui.statusBadge(p.status) : ''}</td></tr>`;
          });
        } else if (tab === 'error') {
          head = html`<tr><th>Line</th><th>IT Asset</th><th>Problem</th></tr>`;
          body = d.rows.map(function (r) {
            return html`<tr><td class="font-monospace small text-secondary">${r.line_no}</td>
              <td class="font-monospace">${r.asset_no || t('(blank)')}</td><td class="text-danger">${r.message}</td></tr>`;
          });
        } else {
          head = html`<tr><th>IT Asset</th><th>Description</th><th>Work Center</th><th>Area</th><th>Status</th></tr>`;
          body = d.rows.map(function (r) {
            return html`<tr><td><span class="asset-no">${r.asset_no}</span></td><td>${r.description}</td>
              <td class="font-monospace small">${r.work_center || ''}</td><td>${r.area}</td><td>${AC.ui.statusBadge(r.status)}</td></tr>`;
          });
        }
        var kpi = function (tone, label, n) {
          return html`<div class="kpi"><div class="kpi-label">${tone ? html`<span class="dot tone-${tone}"></span> ` : ''}${label}</div><div class="kpi-value">${fmt.number(n)}</div></div>`;
        };
        ctx.main.innerHTML = html`
          <div class="crumbs"><a href="${AC.link('admin/import')}">Import</a> / Batch #${b.id}</div>
          ${c.pageHead(b.filename, html`${fmt.number(b.total_rows)} row(s) · uploaded by ${b.uploaded_by_name || '—'} ${fmt.datetime(b.created_at)}
              ${b.status === 'applied' ? html` · <span class="status status--ok">Imported ${fmt.datetime(b.applied_at)}</span>` : ''}
              ${b.status === 'discarded' ? html` · <span class="status status--muted">Discarded</span>` : ''}`,
            b.status === 'preview' ? html`
              <button class="btn btn-outline-danger" data-action="import-discard" data-id="${b.id}">Discard this batch</button>
              <button class="btn btn-primary" data-action="import-apply">2. Choose what to import <i class="bi bi-arrow-right"></i></button>` : '')}
          <div class="kpis mb-3">
            ${kpi('ok', t('New'), b.create_count)}${kpi('warn', t('Changed'), b.update_count)}${kpi('muted', t('Unchanged'), b.same_count)}
            ${kpi('bad', t('Errors (skipped)'), b.error_count)}${kpi('', t('Not in the file (left alone)'), b.missing_count)}
          </div>
          <ul class="nav nav-underline mb-3">${tabs.map(function (t) {
            return html`<li class="nav-item"><a class="nav-link ${tab === t[0] ? 'active' : ''}" href="${AC.link('admin/import/preview', { id: b.id, tab: t[0] })}">${t[1]} <span class="count">${fmt.number(t[2])}</span></a></li>`;
          })}</ul>
          <div class="card"><div class="table-responsive"><table class="table table-sm align-top">
            <thead>${head}</thead><tbody>${body.length ? body : AC.ui.empty('Nothing here.', 6)}</tbody>
          </table></div></div>
          ${AC.ui.pager(d.pager)}`.toString();
        currentBatch = d;
      });
    },
  });

  var currentBatch = null;

  AC.on('import-apply', function () {
    var d = currentBatch;
    if (!d) { return; }
    var b = d.batch;
    // Area and Remark are corrected on the web by staff and IT; the master sheet usually has older values.
    // They are therefore off by default, so one Enter cannot wipe on-site corrections.
    var OFF_BY_DEFAULT = ['area', 'remark', 'editor_note'];
    var count = function (field) { return Number(d.field_counts[field] || 0); };
    var labelOf = function (field) {
      var f = d.fields_in_file.filter(function (x) { return x.field === field; })[0];
      return f ? f.label : field;
    };
    AC.modal.form({
      title: t('Import {file}', { file: b.filename }),
      route: 'admin/import/apply', submitLabel: 'Import',
      confirm: function (form) {
        var o = AC.formData(form);
        var fields = (o.fields || []).filter(function (f) { return count(f) > 0; });
        var adds = o.create_new === '1' ? Number(b.create_count) : 0;
        var overwritesWebFields = fields.filter(function (f) { return f === 'area' || f === 'remark'; });
        return html`<div class="vstack gap-2">
          <div class="fw-semibold">Import these changes?</div>
          <ul class="mb-0 ps-3 small">
            ${adds ? html`<li>${t('Add {n} new asset(s)', { n: fmt.number(adds) })}</li>` : ''}
            ${fields.map(function (f) { return html`<li>${t('{field}: {n} asset(s) change', { field: labelOf(f), n: fmt.number(count(f)) })}</li>`; })}
            ${!adds && !fields.length ? html`<li>Nothing will change.</li>` : ''}
          </ul>
          ${overwritesWebFields.length ? html`<div class="small text-danger"><i class="bi bi-exclamation-triangle me-1"></i>${t('{fields} will be overwritten with the values in the file, including corrections made on the web.', { fields: overwritesWebFields.map(labelOf).join(', ') })}</div>` : ''}
          <div class="small text-secondary">This cannot be undone with one click. Every change is recorded in the change history.</div>
        </div>`;
      },
      body: html`<div class="vstack gap-3">
        <div class="form-check"><input class="form-check-input" type="checkbox" name="create_new" value="1" id="create_new" checked>
          <label class="form-check-label" for="create_new">Add ${fmt.number(b.create_count)} new asset(s)</label></div>
        <div>
          <div class="form-label">Let the file overwrite these fields <span class="fw-normal text-secondary">(number of assets that will change)</span></div>
          <div class="row row-cols-2 row-cols-md-3 g-2">${d.fields_in_file.map(function (f) {
            return html`<div class="form-check"><input class="form-check-input" type="checkbox" name="fields[]" value="${f.field}" id="if-${f.field}" ${OFF_BY_DEFAULT.indexOf(f.field) !== -1 ? '' : AC.raw('checked')}>
              <label class="form-check-label small" for="if-${f.field}">${f.label} <span class="count">${fmt.number(count(f.field))}</span></label></div>`;
          })}</div>
          <div class="form-text">Area and Remark are off by default: they are often corrected on the web and the file may have older values. Tick them only if the file is the newer source.</div>
        </div></div>`,
      data: function (o) { o.id = b.id; if (!o.fields) { o.fields = []; } return o; },
    });
  });

  AC.on('import-discard', function (el) {
    AC.confirm('Discard this import batch? Nothing will be changed.', 'Discard', true).then(function (yes) {
      if (!yes) { return; }
      AC.api.post('admin/import/discard', { id: el.getAttribute('data-id') }).then(function (res) {
        AC.toast(res.message);
        AC.go('admin/import');
      }, function (err) { AC.toast(err.message, 'error'); });
    });
  });

  /* ================================================================= AUDIT */

  var auditLocations = [];

  AC.route('admin/audit', {
    area: 'admin', title: 'Stock audit', ability: 'audit.run',
    render: function (ctx) {
      return AC.api.get('admin/audit').then(function (d) {
        auditLocations = d.locations;
        var rows = d.rounds.map(function (r) {
          var pct = r.total ? r.checked / r.total * 100 : 0;
          return html`<tr>
            <td><a class="fw-semibold" href="${AC.link('admin/audit/round', { id: r.id })}">${r.name}</a><span class="cell-sub">${fmt.date(r.started_at)}</span></td>
            <td class="font-monospace small">${r.location || t('All locations')}</td>
            <td><div class="small">${fmt.number(r.checked)} / ${fmt.number(r.total)} <span class="text-secondary">(${pct.toFixed(1)}%)</span></div>${progressBar(pct)}</td>
            <td class="small">${r.started_by_name || '—'}</td>
            <td>${r.is_open ? html`<span class="status status--ok">In progress</span>` : html`<span class="status status--muted">Closed</span>`}</td>
            <td class="text-end"><button class="btn btn-sm btn-outline-danger" data-action="audit-delete-round" data-id="${r.id}" data-name="${r.name}" data-count="${r.checked}" title="${t('Delete round')}" aria-label="${t('Delete round')}"><i class="bi bi-trash"></i></button></td></tr>`;
        });
        ctx.main.innerHTML = html`
          ${c.pageHead(t('Stock audit'), t('Scan each asset. If it is found somewhere else, its Area is updated.'),
            html`<button class="btn btn-primary" data-action="audit-start"><i class="bi bi-plus-lg me-1"></i>Start a new round</button>`)}
          <div class="card"><div class="table-responsive"><table class="table table-hover align-middle">
            <thead><tr><th>Round</th><th>Scope</th><th style="min-width:200px">Progress</th><th>Started by</th><th>Status</th><th></th></tr></thead>
            <tbody>${rows.length ? rows : AC.ui.empty('No audit rounds yet.', 6)}</tbody>
          </table></div></div>`.toString();
      });
    },
  });

  AC.on('audit-start', function () {
    AC.modal.form({
      title: 'Start an audit round', route: 'admin/audit/start', submitLabel: 'Start audit',
      body: html`<div class="vstack gap-3">
        <div><label class="form-label" for="aname">Round name</label><input class="form-control" id="aname" name="name" required placeholder="${t('Annual stock count {year}', { year: new Date().getFullYear() })}"></div>
        <div><label class="form-label" for="aloc">Scope</label>
          <select class="form-select" id="aloc" name="location">${AC.ui.options(auditLocations.map(function (l) { return [l, l]; }), '', 'All locations')}</select>
          <div class="form-text">Counts every asset except those disposed of or lost.</div></div></div>`,
      onSuccess: function (res) {
        AC.modal.close();
        AC.toast(res.message);
        AC.go('admin/audit/round', { id: res.data.id });
      },
    });
  });

  var auditRound = null;

  AC.route('admin/audit/round', {
    area: 'admin', title: 'Audit round', ability: 'audit.run',
    render: function (ctx) {
      var q = ctx.query;
      return AC.api.get('admin/audit/round', { id: q.id, wc: q.wc }).then(function (d) {
        var r = d.round, open = r.is_open, labels = d.result_labels;
        auditRound = d;
        ctx.setTitle(r.name);
        var pct = d.total ? d.checked / d.total * 100 : 0;
        var recent = d.recent.map(function (x) {
          return html`<tr><td class="asset-no">${x.asset_no}</td>
            <td>${labels[x.result] || x.result}${x.network ? ' · ' + x.network : ''}<span class="cell-sub">${x.area_found}${x.note ? ' · ' + x.note : ''}</span></td>
            <td class="small text-secondary text-end text-nowrap">${x.checked_by_name || '—'}<span class="cell-sub">${fmt.ago(x.checked_at)}</span></td>
            ${open ? html`<td class="text-end" style="width:1%"><button class="btn btn-sm btn-outline-danger" data-action="audit-delete-check" data-round="${r.id}" data-id="${x.id}" data-asset="${x.asset_no}" title="${t('Delete result')}" aria-label="${t('Delete result')}"><i class="bi bi-trash"></i></button></td>` : ''}</tr>`;
        });
        var progress = d.progress.map(function (p) {
          var pp = p.total ? p.checked / p.total * 100 : 0;
          return html`<tr class="${d.wc === p.work_center ? 'table-active' : ''}">
            <td class="small"><a href="${AC.link('admin/audit/round', { id: r.id, wc: p.work_center })}"><span class="font-monospace">${p.work_center}</span></a> ${p.work_center_name}</td>
            <td class="text-end small font-monospace">${fmt.number(p.checked)}/${fmt.number(p.total)}</td>
            <td>${progressBar(pp)}</td></tr>`;
        });
        var unchecked = '';
        if (d.unchecked) {
          unchecked = html`<div class="card mt-3" id="unchecked">
            <div class="card-header"><h2 class="card-title mb-0">Not checked yet · <span class="font-monospace">${d.wc}</span></h2><span class="small text-secondary">${fmt.number(d.unchecked.length)} asset(s)</span></div>
            ${d.unchecked.length ? html`<div class="table-responsive"><table class="table table-sm align-middle">
              <thead><tr><th>IT Asset</th><th>Description</th><th>Area</th><th>Status</th><th></th></tr></thead>
              <tbody>${d.unchecked.map(function (u) {
                return html`<tr><td class="asset-no">${u.asset_no}</td><td>${u.description}</td><td>${u.area}</td><td>${AC.ui.statusBadge(u.status)}</td>
                  <td class="text-end">${open ? html`<button class="btn btn-sm btn-outline-secondary" data-action="audit-check" data-no="${u.asset_no}">Check</button>` : ''}</td></tr>`;
              })}</tbody></table></div>` : html`<div class="text-center text-secondary py-4">All checked.</div>`}
          </div>`;
        }
        ctx.main.innerHTML = html`
          <div class="crumbs"><a href="${AC.link('admin/audit')}">Stock audit</a> / Round #${r.id}</div>
          ${c.pageHead(r.name, (r.location || t('All locations')) + ' · ' + t('started {when}', { when: fmt.datetime(r.started_at) }) + (open ? '' : ' · ' + t('closed {when}', { when: fmt.datetime(r.closed_at) })), html`
            <a class="btn btn-outline-secondary" href="${AC.api.url('admin/audit/export', { id: r.id })}"><i class="bi bi-download me-1"></i>Export results</a>
            ${open ? html`<button class="btn btn-outline-danger" data-action="audit-close" data-id="${r.id}">Close round</button>` : ''}
            <button class="btn btn-outline-danger" data-action="audit-delete-round" data-id="${r.id}" data-name="${r.name}" data-count="${d.checked}" data-back="1"><i class="bi bi-trash me-1"></i>Delete round</button>`)}
          <div class="kpis mb-3">
            <div class="kpi"><div class="kpi-label">Checked</div><div class="kpi-value">${fmt.number(d.checked)}</div><div class="kpi-meta">of ${fmt.number(d.total)} asset(s)</div></div>
            <div class="kpi"><div class="kpi-label">Progress</div><div class="kpi-value">${pct.toFixed(1)}%</div>${progressBar(pct)}</div>
            <div class="kpi"><div class="kpi-label">Remaining</div><div class="kpi-value">${fmt.number(d.total - d.checked)}</div></div>
          </div>
          <div class="row g-3">
            <div class="col-xl-7 vstack gap-3">
              ${open ? html`<div class="card">
                <div class="card-header"><h2 class="card-title mb-0">Scan</h2><span class="small text-secondary">Barcode scanner, or type and press Enter</span></div>
                <div class="card-body"><form class="d-flex gap-2" id="audit-scan">
                  <input class="form-control form-control-lg scan-input" name="no" placeholder="IT Asset number" autocomplete="off" data-scanner>
                  <button class="btn btn-primary btn-lg px-4" type="submit" aria-label="Check in"><i class="bi bi-upc-scan"></i></button>
                </form></div></div>` : ''}
              <div class="card">
                <div class="card-header"><h2 class="card-title mb-0">Latest checks</h2></div>
                ${recent.length ? html`<table class="table table-sm align-middle"><tbody>${recent}</tbody></table>` : html`<div class="text-center text-secondary py-4">Nothing checked yet.</div>`}
              </div>
            </div>
            <div class="col-xl-5"><div class="card">
              <div class="card-header"><h2 class="card-title mb-0">By Work Center</h2><span class="small text-secondary">${d.progress.length} Work Center(s)</span></div>
              <div class="table-responsive" style="max-height:520px"><table class="table table-sm align-middle">
                <thead><tr><th>Work Center</th><th class="text-end">Checked</th><th style="width:90px"></th></tr></thead>
                <tbody>${progress.length ? progress : AC.ui.empty('No assets in scope.', 3)}</tbody>
              </table></div></div></div>
          </div>
          ${unchecked}`.toString();

        var scan = $('#audit-scan', ctx.main);
        if (scan) {
          scan.addEventListener('submit', function (e) {
            e.preventDefault();
            var input = scan.querySelector('[name=no]');
            var no = input.value.trim();
            if (!no) { return; }
            openCheck(no, input);
          });
          setTimeout(function () { var s = $('[data-scanner]'); if (s && !document.body.classList.contains('modal-open')) { s.focus(); } }, 50);
        }
      });
    },
  });

  function openCheck(no, input) {
    var d = auditRound;
    if (!d) { return; }
    var roundId = d.round.id;
    AC.api.get('admin/audit/scan', { id: roundId, no: no }).then(function (s) {
      if (input) { input.value = ''; }
      var a = s.asset, ex = s.existing;
      var net = ex ? ex.network : '';
      var res = ex && ex.result === 'damaged' ? 'damaged' : 'found';
      var radio = function (name, value, id, label, checked) {
        return html`<input type="radio" class="btn-check" name="${name}" value="${value}" id="${id}" ${checked ? AC.raw('checked') : ''}><label class="btn btn-outline-secondary btn-sm" for="${id}">${label}</label>`;
      };
      AC.modal.form({
        title: html`<span class="asset-no">${a.asset_no}</span> ${AC.ui.statusBadge(a.status)}`,
        route: 'admin/audit/check', submitLabel: 'Save and scan next',
        footer: html`<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Skip</button>
          <button type="submit" form="modal-form" class="btn btn-primary">Save and scan next</button>`,
        body: html`<div class="vstack gap-3">
          ${ex ? html`<div class="alert alert-warning py-2 small mb-0 d-flex align-items-center gap-2">
            <span class="flex-grow-1">Already checked ${fmt.datetime(ex.checked_at)}. Saving again replaces it.</span>
            <button type="button" class="btn btn-sm btn-outline-danger" data-action="audit-delete-check" data-round="${roundId}" data-id="${ex.id}" data-asset="${a.asset_no}"><i class="bi bi-trash me-1"></i>Delete result</button></div>` : ''}
          <div class="small text-secondary">${a.description} · <span class="font-monospace">${a.work_center || '—'}</span> ${a.work_center_name || ''} · ${(a.location + ' ' + a.building).trim()}</div>
          <div><label class="form-label" for="area_found">Area where it was found</label>
            <input class="form-control" id="area_found" name="area_found" value="${ex ? ex.area_found : a.area}" autofocus>
            <div class="form-text">In the system: ${a.area || '—'}</div></div>
          <div class="row g-3">
            <div class="col-6"><span class="form-label d-block">Condition</span><div class="btn-group w-100">
              ${radio('result', 'found', 'r-ok', t('OK'), res === 'found')}${radio('result', 'damaged', 'r-bad', t('Damaged'), res === 'damaged')}</div></div>
            <div class="col-6"><span class="form-label d-block">Network</span><div class="btn-group w-100">
              ${radio('network', 'online', 'n-on', t('Online'), net === 'online')}${radio('network', 'offline', 'n-off', t('Offline'), net === 'offline')}${radio('network', '', 'n-na', t('Not checked'), !net)}</div></div>
          </div>
          <div><label class="form-label" for="cnote">Note</label><input class="form-control" id="cnote" name="note" value="${ex ? ex.note : ''}"></div>
        </div>`,
        data: function (o) { o.id = roundId; o.asset_id = a.id; return o; },
        onSuccess: function (r) {
          AC.modal.close();
          AC.toast(r.message);
          AC.refresh();
        },
      });
    }, function (err) {
      AC.toast(err.message, 'error');
      if (input) { input.select(); }
    });
  }

  AC.on('audit-check', function (el) { openCheck(el.getAttribute('data-no'), null); });

  /** Delete one check result: the asset goes back to "not checked" (open rounds only). */
  AC.on('audit-delete-check', function (el) {
    var asset = el.getAttribute('data-asset');
    AC.confirm(t('Delete the result for {asset}? It goes back to not checked.', { asset: asset }), t('Delete'), true).then(function (yes) {
      if (!yes) { return; }
      AC.api.post('admin/audit/delete-check', { id: el.getAttribute('data-round'), check_id: el.getAttribute('data-id') }).then(function (res) {
        AC.modal.close();
        AC.toast(res.message);
        AC.refresh();
      }, function (err) { AC.toast(err.message, 'error'); });
    });
  });

  /** Delete a whole round with its results. */
  AC.on('audit-delete-round', function (el) {
    var msg = t('Delete round "{name}" and its {n} result(s)? This cannot be undone.', { name: el.getAttribute('data-name'), n: el.getAttribute('data-count') || 0 });
    AC.confirm(msg, t('Delete round'), true).then(function (yes) {
      if (!yes) { return; }
      AC.api.post('admin/audit/delete', { id: el.getAttribute('data-id') }).then(function (res) {
        AC.toast(res.message);
        if (el.getAttribute('data-back')) { AC.go('admin/audit'); } else { AC.refresh(); }
      }, function (err) { AC.toast(err.message, 'error'); });
    });
  });

  AC.on('audit-close', function (el) {
    AC.confirm('Close this round? Scanning will stop.', 'Close round', true).then(function (yes) {
      if (yes) { postAndRefresh('admin/audit/close', { id: el.getAttribute('data-id') }).catch(function () {}); }
    });
  });
})();
