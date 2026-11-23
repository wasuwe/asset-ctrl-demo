/*
 * Shared building blocks used by several pages: dashboard widgets, password
 * form, sign out. Exposed as AC.c.*
 */
(function () {
  'use strict';
  var html = AC.html;
  var fmt = AC.fmt;
  var t = AC.t;
  var c = AC.c = {};

  /** Page header: title, subtitle, right-hand buttons. Plain-string title/sub are translated. */
  c.pageHead = function (title, sub, actions) {
    if (typeof title === 'string') { title = t(title); }
    if (typeof sub === 'string') { sub = t(sub); }
    return html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<div class="page-sub">${sub}</div>` : ''}</div>
      ${actions ? html`<div class="page-actions d-flex flex-wrap gap-2">${actions}</div>` : ''}</div>`;
  };

  /** KPI cards. linkBase: assets route to link the cards to (or null). */
  c.kpis = function (byStatus, ticketSummary, linkBase) {
    var s = function (code) { return Number(byStatus[code] || 0); };
    var total = Object.keys(byStatus).reduce(function (a, k) { return a + Number(byStatus[k] || 0); }, 0);
    var items = [
      ['Total assets', total, 'bi-pc-display', 'accent', null],
      ['In use', s('USE'), 'bi-check2-circle', 'ok', { status: 'USE' }],
      ['Spare + stock', s('SPARE') + s('STOCK'), 'bi-box-seam', 'info', null],
      ['In repair / broken', s('REPAIR') + s('FAIL'), 'bi-wrench-adjustable', 'warn', { status: 'REPAIR,FAIL' }],
    ];
    var card = function (href, icon, tone, label, value, meta) {
      var inner = html`<span class="kpi-icon tone-${tone}-soft"><i class="bi ${icon}"></i></span>
        <span class="d-block min-w-0"><span class="kpi-label">${label}</span><span class="kpi-line"><span class="kpi-value">${value}</span><span class="kpi-meta">${meta}</span></span></span>`;
      return href ? html`<a class="kpi has-icon" href="${href}">${inner}</a>` : html`<div class="kpi has-icon">${inner}</div>`;
    };
    var out = items.map(function (k) {
      var href = linkBase && k[4] ? AC.link(linkBase, k[4]) : null;
      return card(href, k[2], k[3], t(k[0]), fmt.number(k[1]), fmt.pct(k[1], total));
    });
    if (ticketSummary) {
      var ts = ticketSummary;
      out.push(card(null, 'bi-tools', ts.urgent ? 'bad' : 'neutral', t('Open repair tickets'), fmt.number(ts.open_count),
        html`${ts.urgent ? html`<span class="text-danger fw-semibold">${t('{n} urgent', { n: fmt.number(ts.urgent) })}</span> · ` : ''}${t('{n} unassigned', { n: fmt.number(ts.new_count) })}`));
      out.push(card(null, 'bi-stopwatch', 'neutral', t('Avg. repair time (90 d)'),
        html`<span style="font-size:1.2rem">${ts.avg_minutes > 0 ? fmt.minutes(ts.avg_minutes) : '—'}</span>`,
        t('Closed in 30 d: {n}', { n: fmt.number(ts.closed_30d) })));
    }
    return html`<div class="kpis mb-3">${out}</div>`;
  };

  /**
   * "Needs attention" strip at the top of a home page: one row per thing waiting on the reader.
   * items: [{ n, label (already translated, may contain {n}), href, tone: 'bad'|'warn'|'info'|'ok', icon }]
   * Items with n = 0 are hidden; when nothing is waiting a single calm line says so.
   */
  c.attention = function (items, calm) {
    var live = items.filter(function (i) { return Number(i.n) > 0; });
    if (!live.length) {
      return html`<div class="attention attention--calm mb-3"><i class="bi bi-check2-circle" aria-hidden="true"></i><span>${calm}</span></div>`;
    }
    return html`<section class="attention mb-3" aria-labelledby="attention-title">
      <h2 class="attention-title" id="attention-title">${t('Needs attention')}</h2>
      <div class="attention-items">${live.map(function (i) {
        return html`<a class="attention-item attention-item--${i.tone}" href="${i.href}">
          <i class="bi ${i.icon}" aria-hidden="true"></i>
          <span class="attention-n">${fmt.number(i.n)}</span>
          <span class="attention-label">${i.label}</span>
          <i class="bi bi-arrow-right attention-go" aria-hidden="true"></i></a>`;
      })}</div></section>`;
  };

  /**
   * Stacked bars: asset type × status, with the count inside each segment (hidden by CSS when
   * the segment is too narrow for it). Bars grow in one after another. Hover or click a legend
   * item to pick out that status in every bar; with linkBase, each segment opens the asset list
   * filtered by that type and status.
   */
  c.matrix = function (matrix, linkBase) {
    var statuses = AC.state.meta.asset_statuses;
    var labels = AC.state.meta.asset_type_labels || {};
    var max = matrix.reduce(function (m, r) { return Math.max(m, r.total); }, 0);
    var used = {}; // legend shows only statuses that appear, with their totals
    matrix.forEach(function (row) { Object.keys(row.by_status).forEach(function (k) { used[k] = (used[k] || 0) + Number(row.by_status[k]); }); });
    function seg(row, code, tone, label, n, href) {
      var pct = n / row.total * 100;
      var tip = label + ': ' + fmt.number(n) + ' (' + Math.round(pct) + '%)';
      var inner = html`<b class="bar-num">${fmt.number(n)}</b>`;
      var style = 'width:' + pct.toFixed(3) + '%';
      return href
        ? html`<a class="bar-seg tone-${tone}" data-st="${code}" style="${style}" href="${href}" title="${tip}" aria-label="${row.type} · ${tip}">${inner}</a>`
        : html`<span class="bar-seg tone-${tone}" data-st="${code}" style="${style}" title="${tip}">${inner}</span>`;
    }
    var rows = matrix.map(function (row, i) {
      var typeHref = linkBase && row.type !== '—' ? AC.link(linkBase, { type: row.type }) : null;
      var segs = statuses.map(function (st) {
        var n = row.by_status[st.code];
        return n ? seg(row, st.code, st.tone, st.label, n, typeHref ? AC.link(linkBase, { type: row.type, status: st.code }) : null) : '';
      });
      var unknown = row.by_status[''];
      if (unknown) { segs.push(seg(row, '', 'muted', t('Unspecified'), unknown, null)); }
      return html`<div class="bar-row" style="--i:${i}">
        <div class="font-monospace fw-semibold text-truncate" title="${labels[row.type] || ''}">${typeHref ? html`<a href="${typeHref}">${row.type}</a>` : row.type}</div>
        <div class="bar-track" style="width:${Math.max(6, max ? row.total / max * 100 : 0).toFixed(2)}%">${segs}</div>
        <div class="bar-total font-monospace">${fmt.number(row.total)}</div></div>`;
    });
    var legend = statuses.filter(function (st) { return used[st.code]; }).map(function (st) {
      return html`<button type="button" class="bar-legend" data-matrix-focus="${st.code}" aria-pressed="false" title="${t('Show only {status}', { status: st.label })}">
        <i class="dot tone-${st.tone}"></i>${st.label} <span class="bar-legend-n font-monospace">${fmt.number(used[st.code])}</span></button>`;
    });
    return html`<div class="card bar-chart" data-matrix><div class="card-header flex-wrap"><h2 class="card-title mb-0">By type and status</h2>
      <div class="d-flex flex-wrap gap-1 small">${legend}</div></div>
      <div class="card-body">${matrix.length ? rows : AC.ui.empty('No asset data yet.')}</div></div>`;
  };

  // Legend focus: hover previews a status, click pins it (click again to clear).
  (function () {
    function apply(chart, code) {
      if (code === null || code === undefined) { chart.removeAttribute('data-focus'); } else { chart.setAttribute('data-focus', code); }
      chart.querySelectorAll('.bar-seg').forEach(function (s) { s.classList.toggle('is-focus', code !== null && code !== undefined && s.getAttribute('data-st') === code); });
      chart.querySelectorAll('[data-matrix-focus]').forEach(function (b) {
        var on = b.getAttribute('data-matrix-focus') === code;
        b.classList.toggle('is-focus', on);
        b.setAttribute('aria-pressed', on && chart.getAttribute('data-pinned') === code ? 'true' : 'false');
      });
    }
    function pinned(chart) { return chart.hasAttribute('data-pinned') ? chart.getAttribute('data-pinned') : null; }
    document.addEventListener('mouseover', function (e) {
      var b = e.target.closest && e.target.closest('[data-matrix-focus]');
      if (b) { apply(b.closest('[data-matrix]'), b.getAttribute('data-matrix-focus')); }
    });
    document.addEventListener('mouseout', function (e) {
      var b = e.target.closest && e.target.closest('[data-matrix-focus]');
      if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) { var ch = b.closest('[data-matrix]'); apply(ch, pinned(ch)); }
    });
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-matrix-focus]');
      if (!b) { return; }
      var ch = b.closest('[data-matrix]'), code = b.getAttribute('data-matrix-focus');
      if (pinned(ch) === code) { ch.removeAttribute('data-pinned'); } else { ch.setAttribute('data-pinned', code); }
      apply(ch, pinned(ch));
    });
  })();

  c.locations = function (locations) {
    return html`<div class="card"><div class="card-header"><h2 class="card-title mb-0">By location</h2></div>
      <div class="card-body vstack gap-3">${locations.length ? locations.map(function (l) {
        var pct = l.total ? l.in_use / l.total * 100 : 0;
        return html`<div><div class="d-flex justify-content-between small">
          <span class="font-monospace fw-semibold">${l.location !== '' ? l.location : t('Unspecified')}</span>
          <span class="text-secondary">${t('{used} / {total} in use', { used: fmt.number(l.in_use), total: fmt.number(l.total) })}</span></div>
          <div class="progress mt-1" style="height:6px"><div class="progress-bar" style="width:${pct.toFixed(1)}%;background:var(--ac-accent)"></div></div></div>`;
      }) : html`<div class="text-secondary">—</div>`}</div></div>`;
  };

  /** Largest Work Centers. linkBase: assets route or null. */
  c.workCenters = function (rows, linkBase) {
    return html`<div class="card"><div class="card-header"><h2 class="card-title mb-0">By Work Center</h2></div>
      <div class="table-responsive"><table class="table table-sm table-fit"><thead><tr><th>Work Center</th><th class="text-end">Total</th><th class="text-end">Broken / repair</th></tr></thead>
      <tbody>${rows.length ? rows.map(function (w) {
        var code = w.wc_code ? html`<span class="font-monospace fw-semibold">${w.wc_code}</span>` : html`<span class="text-secondary">No Work Center</span>`;
        return html`<tr><td class="small">${linkBase && w.wc_id ? html`<a href="${AC.link(linkBase, { wc: w.wc_id })}">${code}</a>` : code}
          <span class="text-secondary text-name" title="${w.wc_name || ''}">${w.wc_name || ''}</span></td>
          <td class="text-end font-monospace">${fmt.number(w.total)}</td>
          <td class="text-end font-monospace ${Number(w.broken) ? 'text-danger' : ''}">${fmt.number(w.broken)}</td></tr>`;
      }) : AC.ui.empty('—', 3)}</tbody></table></div></div>`;
  };

  /* ---------------------------------------------------------- repair queue */

  /**
   * Repair queue of a ticket. A device gets its queue number when it is received (IN)
   * into the Setting Room; the API sends queue_no (1 = next) and queue_ahead.
   *   c.queueBadge(t)  small pill for lists: "Q 3"
   *   c.queuePanel(t)  box for the ticket page: number + how many are ahead, or why there is no number
   */
  c.queueBadge = function (tk) {
    if (tk.queue_no) {
      return html`<span class="queue-badge" title="${t('Queue no. {n} in the Setting Room', { n: tk.queue_no })}"><i class="bi bi-people-fill"></i> ${t('Q {n}', { n: tk.queue_no })}</span>`;
    }
    if (tk.in_room) {
      return html`<span class="badge text-bg-success" title="${t('In the Setting Room')}"><i class="bi bi-box-seam"></i></span>`;
    }
    return '';
  };

  c.queuePanel = function (tk) {
    if (tk.queue_no) {
      return html`<div class="queue-panel">
        <div class="queue-no"><span>${t('Queue no.')}</span><strong>${tk.queue_no}</strong></div>
        <div><div class="fw-semibold">${tk.queue_ahead ? t('{n} device(s) ahead in the queue', { n: tk.queue_ahead }) : t('Next in line')}${tk.queue_jumped ? html` <span class="queue-jump-tag"><i class="bi bi-lightning-charge-fill"></i> ${t('Jumped')}</span>` : ''}</div>
          <div class="small text-secondary">${t('Received {when}', { when: fmt.datetime(tk.received_at) })}</div></div></div>`;
    }
    if (tk.in_room && tk.status === 'resolved') {
      return html`<div class="queue-panel is-done"><i class="bi bi-check2-circle"></i><div><div class="fw-semibold">${t('Repaired, waiting to be sent out')}</div></div></div>`;
    }
    if (tk.is_open && !tk.received_at) {
      return html`<div class="queue-panel is-none"><i class="bi bi-hourglass"></i><div><div class="fw-semibold">${t('No queue number yet')}</div>
        <div class="small text-secondary">${t('Bring the device to the Setting Room to get a queue number.')}</div></div></div>`;
    }
    return '';
  };

  /* ---------------------------------------------------- password + logout */

  c.passwordFields = function () {
    return html`<div class="vstack gap-3">
      <div><label class="form-label" for="cp">Current password / temporary password</label>
        <input class="form-control" type="password" id="cp" name="current_password" autocomplete="current-password" required></div>
      <div><label class="form-label" for="np">New password</label>
        <input class="form-control" type="password" id="np" name="password" minlength="8" autocomplete="new-password" required>
        <div class="form-text">At least 8 characters, and not your employee code.</div></div>
      <div><label class="form-label" for="np2">Confirm new password</label>
        <input class="form-control" type="password" id="np2" name="password_confirm" minlength="8" autocomplete="new-password" required></div></div>`;
  };

  AC.on('change-password', function () {
    AC.modal.form({
      title: 'Change password', route: 'account/password', submitLabel: 'Save password',
      body: c.passwordFields(),
      onSuccess: function (res) {
        AC.modal.close();
        AC.toast(res.message);
        AC.setUser(res.data.user);
      },
    });
  });

  /* Own email + phone (any signed-in user). The phone pre-fills "Contact phone" when reporting a problem. */
  AC.on('edit-profile', function () {
    var u = AC.state.user || {};
    AC.modal.form({
      title: 'Contact details', route: 'account/profile', submitLabel: 'Save',
      body: html`<div class="vstack gap-3">
        <div><label class="form-label" for="pf-email">Email</label>
          <input class="form-control" type="email" id="pf-email" name="email" maxlength="191" autocomplete="email" value="${u.email || ''}"></div>
        <div><label class="form-label" for="pf-phone">Phone</label>
          <input class="form-control" type="tel" id="pf-phone" name="phone" maxlength="32" autocomplete="tel" value="${u.phone || ''}">
          <div class="form-text">Filled in automatically when you report a problem.</div></div></div>`,
      onSuccess: function (res) {
        AC.modal.close();
        AC.toast(res.message);
        AC.setUser(res.data.user);
      },
    });
  });

  AC.on('logout', function () {
    AC.api.post('logout').then(function (res) {
      AC.setUser(null, res.data.csrf);
      AC.toast('Signed out');
      AC.go('dashboard');
    }, function (err) { AC.toast(err.message, 'error'); });
  });
})();
