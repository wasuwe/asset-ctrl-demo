/*
 * Pages: sign in, forced password change, public overview, admin dashboard,
 * user home. API: session, login, account/password, dashboard,
 * admin/dashboard, user/home.
 */
(function () {
  'use strict';
  var html = AC.html, fmt = AC.fmt, c = AC.c, t = AC.t;

  /* ---------------------------------------------------------------- login */

  /**
   * Sign in is a modal over the public overview:
   *   - the "Sign in" button (data-action="login") opens it;
   *   - #/login?next=... (sent here when a page needs sign-in) shows the overview with the modal open,
   *     and after signing in goes on to "next" if it belongs to the user's area.
   */
  function openLogin(next) {
    if (AC.state.user) { AC.go(AC.home()); return; }
    AC.modal.form({
      title: 'Sign in',
      route: 'login',
      submitLabel: 'Sign in',
      body: html`<div class="vstack gap-3">
        <div><label class="form-label" for="emp_code">Employee code</label>
          <input class="form-control font-monospace text-uppercase" id="emp_code" name="emp_code" autocomplete="username" required autofocus></div>
        <div><label class="form-label" for="password">Password</label>
          <input class="form-control" type="password" id="password" name="password" autocomplete="current-password" required></div>
        <p class="small text-secondary mb-0">Forgot your password? Ask the IT team.</p>
        ${AC.state.demo && window.ACDemo ? ACDemo.loginHint() : ''}
      </div>`,
      onShow: function (el) {
        el.closest('.modal-dialog').classList.replace('modal-xl', 'modal-sm-login');
      },
      onSuccess: function (res) {
        AC.setUser(res.data.user, res.data.csrf);
        AC.modal.close();
        next = next || '';
        var area = res.data.user.is_admin ? 'admin/' : 'user/';
        if (next.indexOf(area) === 0) { AC.go(next.split('?')[0], queryOf(next)); } else { AC.go(AC.home()); }
      },
    });
  }
  AC.on('login', function () { openLogin(''); });

  AC.route('login', {
    area: 'public', title: 'Sign in',
    render: function (ctx) {
      if (AC.state.user) { AC.go(AC.home()); return; }
      return renderOverview(ctx).then(function () { openLogin(ctx.query.next || ''); });
    },
  });

  function queryOf(hashPath) {
    var i = hashPath.indexOf('?'), q = {};
    if (i !== -1) { new URLSearchParams(hashPath.slice(i + 1)).forEach(function (v, k) { q[k] = v; }); }
    return q;
  }

  /* ------------------------------------------------ forced password change */
  AC.route('account/password', {
    area: 'auto', auth: true, title: 'Set a new password',
    render: function (ctx) {
      var forced = AC.state.user.must_change_password;
      ctx.main.innerHTML = html`<div class="mx-auto" style="max-width:440px">
        ${c.pageHead(forced ? 'Set a new password' : 'Change password', forced ? 'Your password was reset. Set a new one.' : '')}
        <div class="card"><div class="card-body"><form id="pw-form">${AC.ui.errorBox()}${c.passwordFields()}
          <button class="btn btn-primary mt-3 w-100" type="submit">Save password</button></form></div></div></div>`.toString();
      var form = AC.$('#pw-form', ctx.main);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        AC.api.post('account/password', AC.formData(form)).then(function (res) {
          AC.setUser(res.data.user);
          AC.toast(res.message);
          AC.go(AC.home());
        }, function (err) { AC.showErrors(form, err.errors); });
      });
    },
  });

  /* ------------------------------------------------------- public overview */
  function renderOverview(ctx) {
      return AC.api.get('dashboard').then(function (d) {
        ctx.main.innerHTML = html`
          ${c.pageHead('IT asset overview', t('Whole organisation · as of {time}', { time: fmt.datetime(d.generated_at) }))}
          ${c.kpis(d.by_status, d.ticket_summary, null)}
          <div class="row g-3">
            <div class="col-xl-8">${c.matrix(d.matrix, null)}</div>
            <div class="col-xl-4 vstack gap-3">${c.locations(d.locations)}${c.workCenters(d.work_centers, null)}</div>
          </div>`.toString();
      });
  }

  AC.route('dashboard', { area: 'public', title: 'Asset overview', render: renderOverview });

  /* ------------------------------------------------------- admin dashboard */
  AC.route('admin/dashboard', {
    area: 'admin', title: 'Dashboard',
    render: function (ctx) {
      return AC.api.get('admin/dashboard').then(function (d) {
        var att = d.attention || {};
        var changes = d.recent_changes.map(function (h) {
          return html`<tr>
            <td class="text-nowrap"><a class="asset-no" href="${AC.link('admin/assets/show', { id: h.asset_id })}">${h.asset_no}</a></td>
            <td class="text-nowrap small text-secondary">${AC.meta.field(h.field)}</td>
            <td>${h.field === '_created' ? html`<span class="text-secondary">Added to the register</span>` : AC.ui.diff(h.old_value, h.new_value, h.field)}</td>
            <td class="small text-secondary text-nowrap d-none d-md-table-cell">${h.user_name || AC.meta.label('history_sources', h.source)}</td>
            <td class="small text-secondary text-nowrap text-end">${fmt.ago(h.changed_at)}</td></tr>`;
        });
        var mine = d.my_tickets.map(function (t) {
          return html`<li class="list-group-item d-flex gap-2">
            <div class="flex-grow-1 overflow-hidden">
              <a class="fw-semibold text-body text-decoration-none d-block text-truncate" href="${AC.link('admin/tickets/show', { id: t.id })}">${t.title}</a>
              <span class="small text-secondary"><span class="font-monospace">${t.ticket_no}</span>${t.asset_no ? ' · ' + t.asset_no : ''} · ${fmt.ago(t.created_at)}</span>
            </div>
            <div class="text-end">${AC.ui.ticketBadge(t.status)}<br>${AC.ui.priorityBadge(t.priority)}</div></li>`;
        });
        ctx.main.innerHTML = html`
          ${c.pageHead('Dashboard', t('All Work Centers · as of {time}', { time: fmt.datetime(d.generated_at) }), html`
            <a class="btn btn-outline-secondary" href="${AC.link('admin/receiving')}"><i class="bi bi-upc-scan me-1"></i>Setting Room${d.in_room ? html` <span class="count">${d.in_room}</span>` : ''}</a>
            <button class="btn btn-primary" data-action="ticket-create"><i class="bi bi-plus-lg me-1"></i>Report a problem</button>`)}
          ${c.attention([
            { n: att.urgent, tone: 'bad', icon: 'bi-lightning-charge-fill', label: t('urgent ticket(s) open'), href: AC.link('admin/tickets', { priority: 'urgent' }) },
            { n: att.unassigned, tone: 'warn', icon: 'bi-person-dash', label: t('ticket(s) nobody has taken'), href: AC.link('admin/tickets', { view: 'unassigned' }) },
            { n: att.ready_out, tone: 'ok', icon: 'bi-box-arrow-right', label: t('repaired device(s) waiting to be sent out'), href: AC.link('admin/receiving', { mode: 'out' }) },
            { n: att.overdue, tone: 'warn', icon: 'bi-hourglass-split', label: t('device(s) in the Setting Room for more than {d} days, not repaired yet', { d: att.overdue_days }), href: AC.link('admin/receiving') },
          ], t('Nothing needs attention right now.'))}
          ${c.kpis(d.by_status, d.ticket_summary, 'admin/assets')}
          <div class="row g-3">
            <div class="col-xl-8 vstack gap-3">
              ${c.matrix(d.matrix, 'admin/assets')}
              <div class="card">
                <div class="card-header"><h2 class="card-title mb-0">Recent changes</h2><a class="small" href="${AC.link('admin/history')}">View all <i class="bi bi-arrow-right"></i></a></div>
                <div class="table-responsive"><table class="table table-sm align-middle"><tbody>
                  ${changes.length ? changes : AC.ui.empty('No changes yet.', 5)}
                </tbody></table></div>
              </div>
            </div>
            <div class="col-xl-4 vstack gap-3">
              <div class="card">
                <div class="card-header"><h2 class="card-title mb-0">My tickets</h2><a class="small" href="${AC.link('admin/tickets', { view: 'mine' })}">All <i class="bi bi-arrow-right"></i></a></div>
                ${mine.length ? html`<ul class="list-group list-group-flush">${mine}</ul>` : html`<div class="text-center text-secondary py-4">Nothing outstanding.</div>`}
              </div>
              ${d.workload.length ? html`<div class="card"><div class="card-header"><h2 class="card-title mb-0">Technician workload</h2></div>
                <div class="table-responsive"><table class="table table-sm table-fit"><thead><tr><th>Technician</th><th class="text-end">Active jobs</th><th class="text-end">Waiting parts</th><th class="text-end">Resolved</th></tr></thead>
                <tbody>${d.workload.map(function (w) {
                  return html`<tr><td><a href="${AC.link('admin/tickets', { view: 'all', assignee: w.id })}">${w.name}</a></td>
                    <td class="text-end font-monospace">${Number(w.active)}</td><td class="text-end font-monospace">${Number(w.waiting)}</td><td class="text-end font-monospace">${Number(w.resolved)}</td></tr>`;
                })}</tbody></table></div></div>` : ''}
              ${c.workCenters(d.work_centers, 'admin/assets')}
              ${c.locations(d.locations)}
            </div>
          </div>`.toString();
      });
    },
  });

  /* ------------------------------------------------------------- user home */
  AC.route('user/home', {
    area: 'user', title: 'Home',
    render: function (ctx) {
      return AC.api.get('user/home').then(function (d) {
        var u = AC.state.user;
        var att = d.attention || {};
        var wcs = u.work_centers.length ? u.work_centers.map(function (w) { return w.code + (w.name ? ' ' + w.name : ''); }).join(', ') : t('No Work Center assigned. Contact the IT team.');
        ctx.main.innerHTML = html`
          ${c.pageHead(t('Hello {name}', { name: u.first_name }), t('Work Centers: {list}', { list: wcs }), html`
            <a class="btn btn-outline-secondary" href="${AC.link('user/assets')}"><i class="bi bi-pc-display me-1"></i>My assets</a>`)}
          ${c.attention([
            { n: att.to_bring, tone: 'warn', icon: 'bi-box-arrow-in-right', label: t('device(s) to bring to the Setting Room'), href: AC.link('user/tickets') },
            { n: att.repaired, tone: 'ok', icon: 'bi-check2-circle', label: t('device(s) repaired: IT will return them or contact you'), href: AC.link('user/tickets', { view: 'resolved' }) },
          ], t('Nothing is waiting on you.'))}
          ${c.kpis(d.by_status, null, 'user/assets')}
          <div class="row g-3">
            <div class="col-lg-5"><div class="card">
              <div class="card-header"><h2 class="card-title mb-0">Open repair tickets</h2><a class="small" href="${AC.link('user/tickets')}">All ${fmt.number(d.open_total)} <i class="bi bi-arrow-right"></i></a></div>
              ${d.open_tickets.length ? html`<ul class="list-group list-group-flush">${d.open_tickets.map(function (t) {
                return html`<li class="list-group-item d-flex gap-2"><div class="flex-grow-1 overflow-hidden">
                  <a class="fw-semibold text-body text-decoration-none d-block text-truncate" href="${AC.link('user/tickets/show', { id: t.id })}">${t.title}</a>
                  <span class="small text-secondary"><span class="font-monospace">${t.ticket_no}</span> · ${t.asset_no || '—'} · ${fmt.ago(t.created_at)}</span></div>
                  <div class="text-end small">${AC.ui.ticketBadge(t.status)} ${c.queueBadge(t)}<span class="d-block text-secondary">${t.assignee_name || AC.t('Waiting for IT')}</span></div></li>`;
              })}</ul>` : html`<div class="text-center text-secondary py-4">Nothing outstanding.</div>`}
            </div></div>
            <div class="col-lg-7">${c.matrix(d.matrix, 'user/assets')}</div>
          </div>`.toString();
      });
    },
  });
})();
