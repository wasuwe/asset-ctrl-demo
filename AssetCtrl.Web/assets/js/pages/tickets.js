/*
 * Pages: repair tickets (admin + user lists and detail) and the Setting Room.
 * API: admin/tickets, user/tickets, tickets/show, tickets/create-form,
 *      tickets/store, tickets/status, tickets/note, tickets/assign, tickets/take,
 *      admin/receiving, admin/receiving/receive, admin/receiving/send-out, admin/tickets/bulk.
 *
 * Global click actions (usable from any page):
 *   data-action="ticket-create"   [data-asset-no] [data-receive="1" admin: report + receive into the Setting Room]
 *   data-action="ticket-status"   data-id data-to   (status change modal)
 *   data-action="ticket-assign"   data-id
 *   data-action="ticket-take"     data-id
 *   data-action="ticket-receive"  data-id           (receive into the Setting Room)
 *   data-action="ticket-send-out" data-id           (send out of the Setting Room)
 *   data-action="ticket-bulk"     data-bulk="assign|priority|close"  (admin list: change the ticked tickets at once)
 */
(function () {
  'use strict';
  var html = AC.html, fmt = AC.fmt, c = AC.c;

  /* --------------------------------------------------------------- helpers */

  function meta() { return AC.state.meta; }
  function isAdmin() { return !!(AC.state.user && AC.state.user.is_admin); }
  function area() { return isAdmin() ? 'admin' : 'user'; }
  function statusLabel(code) { return AC.meta.label('ticket_statuses', code); }
  function isClosed(t) { return t.status === 'closed' || t.status === 'cancelled'; }
  function inRoom(t) { return !!(t.received_at && !t.returned_at); }

  /** Verb on the button that moves a ticket from -> to (mirrors TicketStatus::actionLabel). */
  function actionLabel(from, to) {
    if (from === 'resolved' && to === 'in_progress') { return AC.t('Reopen (not fixed)'); }
    var map = {
      assigned: AC.t('Assign'), in_progress: AC.t('Start repair'), waiting_parts: AC.t('Wait for parts / vendor'),
      resolved: AC.t('Mark resolved'), closed: AC.t('Close ticket'), cancelled: AC.t('Cancel ticket'),
    };
    return map[to] || statusLabel(to);
  }


  function assetLink(t, cls) {
    if (t.asset_id) { return html`<a class="${cls || 'asset-no'}" href="${AC.link(area() + '/assets/show', { id: t.asset_id })}">${t.asset_no}</a>`; }
    if (t.asset_no) { return html`<span class="${cls || 'asset-no'}">${t.asset_no}</span>`; }
    return html`<span class="text-secondary">—</span>`;
  }

  function wcText(t) {
    if (!t.work_center) { return ''; }
    return html`<span class="font-monospace">${t.work_center}</span>${t.work_center_name ? ' ' + t.work_center_name : ''}`;
  }

  /** Underline tabs with counts. views: [[key, label, countKey|null]] */
  /** View tabs. keep: extra query kept on every tab (the reported-date range, which the counts follow). */
  function tabs(path, views, current, counts, keep) {
    return html`<ul class="nav nav-underline mb-3">${views.map(function (v) {
      var n = v[2] ? Number(counts[v[2]] || 0) : null;
      var q = { view: v[0] };
      Object.keys(keep || {}).forEach(function (k) { if (keep[k]) { q[k] = keep[k]; } });
      return html`<li class="nav-item"><a class="nav-link ${current === v[0] ? 'active' : ''}" href="${AC.link(path, q)}">${v[1]}${n !== null ? html` <span class="count">${fmt.number(n)}</span>` : ''}</a></li>`;
    })}</ul>`;
  }

  /** Queue cell: number + how many ahead, or why there is no number. */
  function queueCell(t) {
    if (t.queue_no) {
      return html`<span class="queue-no-cell">${t.queue_no}</span><span class="cell-sub">${t.queue_ahead ? AC.t('{n} ahead', { n: t.queue_ahead }) : AC.t('Next in line')}</span>`;
    }
    if (t.in_room && t.status === 'resolved') { return html`<span class="small text-success">${AC.t('Repaired, waiting to go out')}</span>`; }
    if (t.is_open && !t.received_at) { return html`<span class="small text-warning-emphasis">${AC.t('No queue yet')}</span>`; }
    return html`<span class="text-secondary">—</span>`;
  }

  /** "My repair queue" box on the user's tickets page. */
  function myQueueBox(rows, queueLength) {
    var queued = rows.filter(function (t) { return t.queue_no; });
    var waitingIn = rows.filter(function (t) { return !t.queue_no && t.is_open && !t.received_at; });
    var done = rows.filter(function (t) { return t.in_room && t.status === 'resolved'; });
    if (!queued.length && !waitingIn.length && !done.length) { return ''; }
    var item = function (t, right) {
      return html`<a class="my-queue-item" href="${AC.link('user/tickets/show', { id: t.id })}">
        ${right}
        <span class="overflow-hidden"><span class="fw-semibold d-block text-truncate">${t.title}</span>
          <span class="small text-secondary"><span class="font-monospace">${t.ticket_no}</span> · ${t.asset_no || '—'} · ${AC.ui.ticketBadge(t.status)}</span></span></a>`;
    };
    return html`<div class="card mb-3 my-queue">
      <div class="card-header"><h2 class="card-title mb-0"><i class="bi bi-people-fill me-1"></i>My repair queue</h2>
        <span class="small text-secondary">${AC.t('{n} in the queue', { n: fmt.number(queueLength) })}</span></div>
      <div class="card-body vstack gap-2">
        ${queued.map(function (t) {
          return item(t, html`<span class="queue-no"><span>${AC.t('Queue no.')}</span><strong>${t.queue_no}</strong><span>${t.queue_ahead ? AC.t('{n} ahead', { n: t.queue_ahead }) : AC.t('Next in line')}</span></span>`);
        })}
        ${done.map(function (t) {
          return item(t, html`<span class="queue-no is-done"><i class="bi bi-check2-circle"></i><span>${AC.t('Repaired')}</span></span>`);
        })}
        ${waitingIn.length ? html`<div class="small text-secondary mt-1">${AC.t('No queue number yet. Bring these devices to the Setting Room:')}</div>
          ${waitingIn.map(function (t) {
            return item(t, html`<span class="queue-no is-none"><i class="bi bi-hourglass"></i><span>${AC.t('No queue yet')}</span></span>`);
          })}` : ''}
      </div></div>`;
  }

  /** Ticket list table. selectable: row checkboxes + bulk bar #ticket-bulk-bar (admin). */
  function ticketTable(rows, ar, selectable) {
    var body = rows.length ? rows.map(function (t) {
      return html`<tr>
        ${selectable ? html`<td class="col-check"><input class="form-check-input" type="checkbox" name="ids[]" value="${t.id}" aria-label="${AC.t('Select {no}', { no: t.ticket_no })}"></td>` : ''}
        <td class="t-title" style="min-width:260px">
          <a class="fw-semibold text-body text-decoration-none" href="${AC.link(ar + '/tickets/show', { id: t.id })}">${t.title}</a>
          <span class="cell-sub"><span class="font-monospace">${t.ticket_no}</span> · Flowlites <span class="font-monospace">${t.flolites_no || '—'}</span> · ${AC.ui.priorityBadge(t.priority)} · ${t.reporter_name || t.contact_name}</span>
        </td>
        <td class="t-device text-nowrap">
          ${assetLink(t)}
          <span class="cell-sub">${t.work_center ? wcText(t) : html`<span class="text-secondary">No Work Center</span>`}</span>
        </td>
        <td class="t-status">${AC.ui.ticketBadge(t.status)}</td>
        <td class="t-queue text-nowrap">${queueCell(t)}</td>
        <td class="t-assignee text-nowrap" data-label="${AC.t('Assignee')}">${t.assignee_name ? t.assignee_name : html`<span class="text-secondary">Nobody yet</span>`}</td>
        <td class="t-reported d-none d-lg-table-cell small text-nowrap">${fmt.datetime(t.created_at)}${t.is_open ? html`<span class="cell-sub">Open for ${fmt.between(t.created_at)}</span>` : ''}</td>
        <td class="d-none d-xl-table-cell small text-secondary text-nowrap">${fmt.ago(t.updated_at)}</td>
      </tr>`;
    }) : AC.ui.empty(AC.t('No tickets in this view.'), selectable ? 8 : 7);
    return html`<div class="card"><div class="table-responsive"><table class="table table-hover align-middle mb-0 ticket-table" ${selectable ? AC.raw('data-select-table="#ticket-bulk-bar"') : ''}>
      <thead><tr>${selectable ? html`<th class="col-check"><input class="form-check-input" type="checkbox" data-check-all aria-label="${AC.t('Select the whole page')}"></th>` : ''}<th>Ticket</th><th>Device / Work Center</th><th>Status</th><th>Queue</th><th>Assignee</th><th class="d-none d-lg-table-cell">Reported</th><th class="d-none d-xl-table-cell">Last update</th></tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
  }

  function priorityRadios(name, selected, idPrefix) {
    // Compact segmented control; "urgent" is red so it reads differently from "normal".
    return html`<div class="btn-group prio-toggle" role="group" aria-label="${AC.t('Priority')}">${meta().priorities.map(function (p) {
      var urgent = p.code === 'urgent';
      return html`<input type="radio" class="btn-check" name="${name}" value="${p.code}" id="${idPrefix}-${p.code}" ${p.code === selected ? AC.raw('checked') : ''}>
        <label class="btn btn-sm ${urgent ? 'btn-outline-danger' : 'btn-outline-secondary'}" for="${idPrefix}-${p.code}">${urgent ? html`<i class="bi bi-lightning-charge-fill me-1"></i>` : ''}${p.label}</label>`;
    })}</div>`;
  }

  function assetStatusOptions(selected, placeholder) {
    return AC.ui.options(meta().asset_statuses.map(function (s) { return [s.code, s.label + ' (' + s.code + ')']; }), selected, placeholder);
  }

  function apiFail(err) { AC.toast(err.message, 'error'); }

  /** Load a ticket (for the action modals), showing a spinner modal meanwhile. */
  function loadTicket(id, title) {
    AC.modal.loading(title);
    return AC.api.get('tickets/show', { id: id }).catch(function (err) { AC.modal.close(); throw err; });
  }

  /**
   * Last Setting Room action, shown as a strip under the scanner so the technician sees the result
   * where they are already looking: { mode: 'in'|'out', asset, ticket, queue, area, message, at }.
   */
  var lastRoom = null;

  /**
   * After a Setting Room action. On the scan page: remember the result for the "last action" strip,
   * drop ?scan= from the URL and re-render in place (no skeleton, the scanner stays on screen).
   * Elsewhere: toast + re-render.
   */
  function afterRoomAction(res, info) {
    AC.modal.close();
    if (AC.path() === 'admin/receiving') {
      lastRoom = Object.assign({ message: res.message, at: new Date() }, info || {});
      history.replaceState(null, '', AC.link('admin/receiving', { mode: AC.query().mode === 'out' ? 'out' : '' }));
      AC.refresh();
    } else {
      AC.toast(res.message);
      AC.refresh();
    }
  }

  /**
   * Scanner guard for the Setting Room modals. A barcode scanner "types" very fast and ends with Enter
   * (or Tab). If that happens while a modal for device A is open, the next device's number would land in
   * a field of A's form and Enter would save it. Fast bursts are therefore undone and blocked, and a
   * warning tells the technician to finish or cancel this device first. Normal typing is not affected.
   * allow: optional selector of fields where scanning is expected (e.g. the Flowlites number).
   */
  function guardScans(el, assetNo, allow) {
    var MAX_GAP = 35, MIN_KEYS = 4;
    var times = [], startVal = null, field = null;
    el.addEventListener('keydown', function (e) {
      var f = e.target;
      if (!f.matches || !f.matches('input, textarea') || (allow && f.matches(allow))) { times = []; return; }
      var now = Date.now();
      if (e.key === 'Enter' || e.key === 'Tab') {
        var burst = field === f && times.length >= MIN_KEYS && now - times[times.length - 1] < 100;
        times = [];
        if (!burst) { return; }
        e.preventDefault();
        e.stopPropagation();
        var scanned = f.value.indexOf(startVal) === 0 ? f.value.slice(startVal.length) : f.value;
        f.value = startVal;
        var box = AC.$('[data-scan-guard]', el);
        if (box) {
          box.innerHTML = AC.html`<i class="bi bi-exclamation-octagon me-2"></i><span>${AC.t('Scan blocked: {code}. Finish or cancel {asset} first, then scan the next device.', { code: scanned.trim(), asset: assetNo || '' })}</span>`.toString();
          box.classList.remove('d-none');
        }
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) { times = []; return; }
      if (!times.length || field !== f || now - times[times.length - 1] > MAX_GAP) {
        times = [now];
        field = f;
        startVal = f.value;
      } else {
        times.push(now);
      }
    }, true);
  }

  /** Placeholder for the scanner-guard warning, first thing in a Setting Room modal. */
  function scanGuardBox() {
    return html`<div class="alert alert-danger d-none d-flex align-items-start mb-0" role="alert" data-scan-guard></div>`;
  }

  /* ------------------------------------------------------ create a ticket */

  function openCreate(assetNo, receive) {
    receive = !!receive && isAdmin();
    var title = receive ? AC.t('Report and receive into the Setting Room') : AC.t('Report a problem');
    AC.modal.loading(title);
    AC.api.get('tickets/create-form', { asset_no: assetNo || '' }).then(function (d) {
      var a = d.asset, def = d.defaults;
      var info = a ? a.description + ' — ' + (a.work_center ? a.work_center + ' ' + (a.work_center_name || '') : '-') + ' / ' + (a.area || '-')
        : (assetNo ? AC.t('Asset {no} was not found in your Work Centers.', { no: assetNo }) : AC.t('Leave blank if unknown.'));
      AC.modal.form({
        title: title,
        route: 'tickets/store',
        submitLabel: receive ? AC.t('Report and receive') : AC.t('Submit ticket'),
        submitClass: receive ? 'btn-success' : 'btn-primary',
        data: function (o) { if (receive) { o.receive_now = '1'; } return o; },
        onShow: receive ? function (el) { guardScans(el, a ? a.asset_no : assetNo, '[name=flolites_no], [name=asset_no]'); } : undefined,
        body: html`
          ${receive ? html`<div class="mb-3">${scanGuardBox()}</div>` : ''}
          ${receive ? html`<div class="alert alert-success py-2 small"><i class="bi bi-info-circle me-1"></i>No open ticket for this device. Saving creates one and receives the device.</div>` : ''}
          ${d.open_for_asset.length && !receive ? html`<div class="alert alert-warning py-2 small">This device already has open tickets:
            ${d.open_for_asset.map(function (o) { return html`<span class="ticket-tag">${o.ticket_no}</span> (${statusLabel(o.status)}) `; })}
            . If it is the same problem, add a note there instead.</div>` : ''}
          <div class="row g-3">
            <div class="col-md-6">
              <label class="form-label" for="tc-flolites">Flowlites number <span class="text-danger">*</span></label>
              <input class="form-control font-monospace text-uppercase" id="tc-flolites" name="flolites_no" maxlength="64" required autofocus>
            </div>
            <div class="col-md-6">
              <label class="form-label" for="tc-asset">IT asset number${receive ? html` <span class="text-danger">*</span>` : ''}</label>
              <input class="form-control font-monospace text-uppercase" id="tc-asset" name="asset_no" list="tc-dl-assets" autocomplete="off"
                value="${a ? a.asset_no : (assetNo || '')}" ${a ? AC.raw('readonly') : ''} ${receive ? AC.raw('required') : ''}
                data-asset-lookup data-info="#tc-asset-info" placeholder="Type 2+ characters to search">
              <div class="form-text" id="tc-asset-info">${info}</div>
              <datalist id="tc-dl-assets"></datalist>
            </div>
            <div class="col-12">
              <span class="form-label d-block">Priority</span>
              ${priorityRadios('priority', 'normal', 'tc-prio')}
            </div>
            <div class="col-12">
              <label class="form-label" for="tc-title">Title <span class="text-danger">*</span></label>
              <input class="form-control" id="tc-title" name="title" maxlength="191" required placeholder="e.g. Will not start">
            </div>
            <div class="col-12">
              <label class="form-label" for="tc-symptom">What is the problem? <span class="text-danger">*</span></label>
              <textarea class="form-control" id="tc-symptom" name="symptom" rows="4" required minlength="5" placeholder="When it started, any error message, what you tried"></textarea>
            </div>
            <div class="col-md-6"><label class="form-label" for="tc-cname">Contact person</label><input class="form-control" id="tc-cname" name="contact_name" value="${receive ? '' : def.contact_name}"></div>
            <div class="col-md-6"><label class="form-label" for="tc-cphone">Contact phone <span class="text-danger">*</span></label><input class="form-control" id="tc-cphone" name="contact_phone" maxlength="32" required value="${receive ? '' : def.contact_phone}"></div>
          </div>`,
        onSuccess: function (res, form) {
          if (res.data && res.data.received) {
            afterRoomAction(res, { mode: 'in', asset: form.elements.asset_no.value.trim().toUpperCase(), queue: res.data.queue_no || null, area: meta().repair_area });
            return;
          }
          AC.modal.close();
          AC.toast(res.message);
          AC.go(area() + '/tickets/show', { id: res.data.id });
        },
      });
    }, function (err) { AC.modal.close(); apiFail(err); });
  }

  AC.on('ticket-create', function (el) {
    openCreate(el.getAttribute('data-asset-no') || '', el.getAttribute('data-receive') === '1');
  });

  /* ------------------------------------------------------- status change */

  function openStatus(t, to, canManage) {
    var needsNote = to === 'cancelled' || (t.status === 'resolved' && to === 'in_progress');
    var showAssetStatus = canManage && t.asset_id && ['resolved', 'waiting_parts', 'closed'].indexOf(to) !== -1;
    var showReturn = to === 'closed' && inRoom(t) && canManage;
    AC.modal.form({
      title: html`${actionLabel(t.status, to)} <span class="font-monospace text-secondary fs-6">${t.ticket_no}</span>`,
      route: 'tickets/status',
      submitLabel: AC.t('Confirm'),
      submitClass: to === 'cancelled' ? 'btn-danger' : 'btn-primary',
      data: function (o) { o.id = t.id; o.to = to; return o; },
      body: html`<div class="vstack gap-3">
        <div class="small">${AC.ui.ticketBadge(t.status)} <i class="bi bi-arrow-right mx-1"></i> ${AC.ui.ticketBadge(to)}</div>
        ${to === 'resolved' ? html`<div>
          <label class="form-label" for="ts-resolution">What was done / how it was fixed <span class="text-danger">*</span></label>
          <textarea class="form-control" id="ts-resolution" name="resolution" rows="4" required placeholder="e.g. Replaced the PSU"></textarea>
        </div>` : ''}
        ${showAssetStatus ? html`<div>
          <label class="form-label" for="ts-asset-status">Asset status</label>
          <select class="form-select" id="ts-asset-status" name="asset_status">${assetStatusOptions('', AC.t('— No change (now: {status}) —', { status: AC.meta.label('asset_statuses', t.asset_status, t.asset_status || AC.t('unspecified')) }))}</select>
        </div>` : ''}
        ${showReturn ? html`<div class="form-check">
          <input class="form-check-input" type="checkbox" name="return_device" value="1" id="ts-return" checked>
          <label class="form-check-label" for="ts-return">Send the device out of the Setting Room back to its original Area (${t.original_area || '—'})</label>
        </div>` : ''}
        <div>
          <label class="form-label" for="ts-note">Note${needsNote ? html` <span class="text-danger">*</span>` : ''}</label>
          <textarea class="form-control" id="ts-note" name="note" rows="2" ${needsNote ? AC.raw('required') : ''}
            placeholder="${to === 'cancelled' ? AC.t('Reason for cancelling') : (needsNote ? AC.t('What is still wrong?') : '')}"></textarea>
        </div></div>`,
    });
  }

  AC.on('ticket-status', function (el) {
    var id = el.getAttribute('data-id'), to = el.getAttribute('data-to');
    loadTicket(id, actionLabel('', to)).then(function (d) {
      if (d.transitions.indexOf(to) === -1) {
        AC.modal.close();
        AC.toast(AC.t('This ticket cannot be changed to "{to}" (it is now "{now}").', { to: statusLabel(to), now: statusLabel(d.ticket.status) }), 'error');
        return;
      }
      openStatus(d.ticket, to, d.can_manage);
    }, apiFail);
  });

  /* ------------------------------------------------------ assign / take */

  AC.on('ticket-assign', function (el) {
    loadTicket(el.getAttribute('data-id'), AC.t('Assign')).then(function (d) {
      var t = d.ticket;
      AC.modal.form({
        title: html`Assign <span class="font-monospace text-secondary fs-6">${t.ticket_no}</span>`,
        route: 'tickets/assign',
        data: function (o) { o.id = t.id; return o; },
        body: html`<div class="vstack gap-3">
          <div>
            <label class="form-label" for="ta-assignee">Assignee</label>
            <select class="form-select" id="ta-assignee" name="assignee_id">
              <option value="0">— Nobody —</option>
              ${d.technicians.map(function (u) {
                return html`<option value="${u.id}" ${u.id === t.assignee_id ? AC.raw('selected') : ''}>${u.name} · ${AC.t('{n} open', { n: u.open_count })}</option>`;
              })}
            </select>
            ${d.technicians.length ? '' : html`<div class="form-text text-warning">No technicians yet. Turn on "Takes repair jobs" on the Users page.</div>`}
          </div>
          <div><span class="form-label d-block">Priority</span>${priorityRadios('priority', t.priority, 'ta-prio')}</div>
          <div><label class="form-label" for="ta-note">Note to the assignee</label><textarea class="form-control" id="ta-note" name="note" rows="2"></textarea></div>
        </div>`,
      });
    }, apiFail);
  });

  /** Admin "queue jump": move a device in the Setting Room queue to the front (optional reason, logged). */
  AC.on('ticket-queue-jump', function (el) {
    var id = el.getAttribute('data-id');
    AC.modal.form({
      title: AC.t('Queue jump'),
      route: 'tickets/queue-jump',
      submitLabel: AC.t('Move to the front'),
      submitClass: 'btn-warning',
      body: html`<p class="mb-3">${AC.t('Move {asset} from queue {n} to queue 1?', { asset: el.getAttribute('data-asset') || '', n: el.getAttribute('data-queue') })}</p>
        <label class="form-label" for="qj-note">Reason <span class="fw-normal text-secondary">(optional)</span></label>
        <input class="form-control" id="qj-note" name="note" maxlength="255" placeholder="e.g. production line stopped">`,
      data: function (o) { o.id = id; return o; },
    });
  });

  /** Setting Room export: one Excel file — sheet 1 the repair queue, sheet 2 repaired devices waiting to be collected. */
  AC.on('room-export', function () {
    var link = document.createElement('a');
    link.href = AC.api.url('admin/receiving/export', { lang: AC.lang() });
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  AC.on('ticket-take', function (el) {
    el.disabled = true;
    AC.api.post('tickets/take', { id: el.getAttribute('data-id') }).then(function (res) {
      AC.toast(res.message);
      AC.refresh();
    }, function (err) { el.disabled = false; apiFail(err); });
  });

  /* ------------------------------------------------ Setting Room modals */

  function openReceive(t) {
    var room = meta().repair_area;
    AC.modal.form({
      title: html`<i class="bi bi-box-arrow-in-right me-2 text-success"></i>Receive into the Setting Room`,
      route: 'admin/receiving/receive',
      submitLabel: AC.t('Confirm receive'),
      submitClass: 'btn-success',
      data: function (o) { o.id = t.id; return o; },
      onShow: function (el) { guardScans(el, t.asset_no); },
      onSuccess: function (res) {
        afterRoomAction(res, { mode: 'in', asset: t.asset_no, ticket: t.ticket_no, queue: res.data && res.data.queue_no ? res.data.queue_no : null, area: room });
      },
      body: html`<div class="vstack gap-3">
        ${scanGuardBox()}
        <div>
          <div class="asset-no fs-5">${t.asset_no}</div>
          <div class="small text-secondary">${t.asset_description} · <span class="ticket-tag">${t.ticket_no}</span> · Flowlites <span class="font-monospace">${t.flolites_no}</span></div>
        </div>
        <table class="table table-sm mb-0">
          <thead><tr><th></th><th>Now</th><th>After receiving</th></tr></thead>
          <tbody>
            <tr><td class="text-secondary">Area</td><td>${t.asset_area || '—'}</td><td class="fw-semibold">${room}</td></tr>
            <tr><td class="text-secondary">Status</td><td>${AC.ui.statusBadge(t.asset_status)}</td><td>${AC.ui.statusBadge('REPAIR')}</td></tr>
          </tbody>
        </table>
        <div class="small text-secondary">The current Area is remembered on ticket ${t.ticket_no} so the device can be sent back there.</div>
        <div><label class="form-label" for="rv-note">Note</label><input class="form-control" id="rv-note" name="note" placeholder="e.g. Came with power cable + adapter" autofocus></div>
      </div>`,
    });
  }

  function openSendOut(t) {
    var resolved = t.status === 'resolved';
    AC.modal.form({
      title: html`<i class="bi bi-box-arrow-right me-2 text-warning"></i>Send out of the Setting Room`,
      route: 'admin/receiving/send-out',
      submitLabel: AC.t('Confirm send-out'),
      submitClass: 'btn-warning',
      data: function (o) { o.id = t.id; return o; },
      onShow: function (el) { guardScans(el, t.asset_no); },
      onSuccess: function (res, form) {
        afterRoomAction(res, { mode: 'out', asset: t.asset_no, ticket: t.ticket_no, area: form.elements.area.value.trim() || t.original_area });
      },
      body: html`<div class="vstack gap-3">
        ${scanGuardBox()}
        <div>
          <div class="asset-no fs-5">${t.asset_no}</div>
          <div class="small text-secondary">${t.asset_description} · <span class="ticket-tag">${t.ticket_no}</span> · ${AC.ui.ticketBadge(t.status)} · in the room for ${fmt.between(t.received_at)}</div>
        </div>
        <div>
          <label class="form-label" for="so-area">Send back to Area</label>
          <input class="form-control" id="so-area" name="area" value="${t.original_area}" autofocus>
          <div class="form-text">Defaults to the original Area.</div>
        </div>
        <div>
          <label class="form-label" for="so-status">Asset status</label>
          ${resolved ? html`<select class="form-select" id="so-status" name="asset_status">${assetStatusOptions('USE')}</select>`
            : html`<select class="form-select" id="so-status" name="asset_status" required aria-describedby="so-status-help">${assetStatusOptions('', AC.t('— Choose the status —'))}</select>
              <div class="form-text" id="so-status-help">The repair is not resolved, so the device may not be working. Choose its status on purpose.</div>`}
        </div>
        ${t.status === 'resolved' ? html`<div class="form-check"><input class="form-check-input" type="checkbox" name="close" value="1" id="so-close" checked>
            <label class="form-check-label" for="so-close">Also close repair ticket ${t.ticket_no}</label></div>`
          : (!isClosed(t) ? html`<div class="alert alert-secondary py-2 small mb-0">This ticket is not resolved yet. It stays open after the device is sent out.</div>` : '')}
        <div><label class="form-label" for="so-note">Note</label><input class="form-control" id="so-note" name="note" placeholder="e.g. Collected by the user / returned to the desk"></div>
      </div>`,
    });
  }

  AC.on('ticket-receive', function (el) {
    loadTicket(el.getAttribute('data-id'), AC.t('Receive into the Setting Room')).then(function (d) { openReceive(d.ticket); }, apiFail);
  });
  AC.on('ticket-send-out', function (el) {
    loadTicket(el.getAttribute('data-id'), AC.t('Send out of the Setting Room')).then(function (d) {
      if (!inRoom(d.ticket)) { AC.modal.close(); AC.toast(AC.t('This device is not in the Setting Room.'), 'error'); return; }
      openSendOut(d.ticket);
    }, apiFail);
  });

  /* ------------------------------------------------------------- lists */

  var ADMIN_VIEWS = [
    ['open', AC.t('All open'), 'open_count'], ['unassigned', AC.t('Unassigned'), 'unassigned'], ['mine', AC.t('My jobs'), 'mine'],
    ['resolved', AC.t('Resolved'), 'resolved'], ['done', AC.t('Closed'), 'done'], ['all', AC.t('All'), 'all_count'],
  ];
  var USER_VIEWS = [
    ['open', AC.t('In progress'), 'open_count'], ['resolved', AC.t('Repaired'), 'resolved'],
    ['reported', AC.t('Reported by me'), 'reported'], ['done', AC.t('Closed'), 'done'], ['all', AC.t('All'), 'all_count'],
  ];

  /** Reported-date presets of the admin list (value, label). '' = any time. */
  var PERIODS = [
    ['today', AC.t('Today')], ['yesterday', AC.t('Yesterday')], ['7d', AC.t('Last 7 days')],
    ['30d', AC.t('Last 30 days')], ['month', AC.t('This month so far')], ['custom', AC.t('Choose dates…')],
  ];
  /** Query keys of the admin list filter (also sent with bulk "select all matching"). */
  var ADMIN_FILTER_KEYS = ['view', 'status', 'priority', 'assignee', 'work_center', 'q', 'period', 'from', 'to'];

  /** Today at a glance, above the admin list. Tiles link to the matching list where there is one. */
  function todayStrip(d) {
    if (!d) { return ''; }
    var tile = function (label, value, icon, tone, query) {
      var inner = html`<span class="kpi-icon tone-${tone}-soft"><i class="bi ${icon}"></i></span>
        <span class="d-block min-w-0"><span class="kpi-label">${label}</span><span class="kpi-line"><span class="kpi-value">${fmt.number(value || 0)}</span></span></span>`;
      return query ? html`<a class="kpi has-icon" href="${AC.link('admin/tickets', query)}">${inner}</a>` : html`<div class="kpi has-icon">${inner}</div>`;
    };
    return html`<div class="kpis ticket-today mb-3">
      ${tile(AC.t('Reported today'), d.reported_today, 'bi-inbox', 'info', { view: 'all', period: 'today' })}
      ${tile(AC.t('Repaired today'), d.resolved_today, 'bi-check2-circle', 'ok', null)}
      ${tile(AC.t('Closed today'), d.closed_today, 'bi-archive', 'accent', null)}
      ${tile(AC.t('Open now'), d.open_now, 'bi-tools', 'warn', { view: 'open' })}
      ${tile(AC.t('Urgent, open'), d.urgent_open, 'bi-exclamation-triangle', d.urgent_open ? 'bad' : 'ok', { view: 'open', priority: 'urgent' })}
      ${tile(AC.t('Nobody assigned'), d.unassigned, 'bi-person-dash', d.unassigned ? 'warn' : 'ok', { view: 'unassigned' })}
    </div>`;
  }

  /** "Reported 10 Nov – 16 Nov 2026" for the page subtitle, or ''. */
  function rangeText(f) {
    if (!f.from && !f.to) { return ''; }
    if (f.from && f.from === f.to) { return AC.t('Reported on {date}', { date: fmt.date(f.from) }); }
    if (f.from && f.to) { return AC.t('Reported {from} – {to}', { from: fmt.date(f.from), to: fmt.date(f.to) }); }
    return f.from ? AC.t('Reported from {date}', { date: fmt.date(f.from) }) : AC.t('Reported until {date}', { date: fmt.date(f.to) });
  }

  /** Last admin list payload: technicians, filters and limits for the bulk forms. */
  var adminList = null;

  AC.route('admin/tickets', {
    area: 'admin', title: AC.t('Repair tickets'), ability: 'tickets.manage',
    render: function (ctx) {
      var q = ctx.query;
      var params = {};
      ADMIN_FILTER_KEYS.concat(['page']).forEach(function (k) { params[k] = q[k]; });
      return AC.api.get('admin/tickets', params).then(function (d) {
        if (ctx.stale && ctx.stale()) { return; }
        adminList = d;
        var f = d.filters, p = d.pager;
        var range = rangeText(f);
        var filtered = f.q || f.status || f.priority || f.assignee || f.work_center || f.period;
        var order = f.view === 'done' || f.view === 'all' ? AC.t('Latest update first') : AC.t('By priority, then oldest first');
        ctx.main.innerHTML = html`
          ${c.pageHead(AC.t('Repair tickets'), range ? html`${range} · ${order}` : order,
            html`<button class="btn btn-primary" data-action="ticket-create"><i class="bi bi-plus-lg me-1"></i>Report a problem</button>`)}
          ${todayStrip(d.today)}
          ${tabs('admin/tickets', ADMIN_VIEWS, f.view, d.counts, { period: f.period, from: f.period === 'custom' ? f.from : '', to: f.period === 'custom' ? f.to : '' })}
          <form class="filter-bar d-flex flex-wrap gap-2 mb-3" data-filter data-keep="view">
            <div class="search-wrap"><i class="bi bi-search"></i><input class="form-control form-control-sm" type="search" name="q" value="${f.q}" placeholder="Ticket no., Flowlites, asset no., title, problem, contact" data-search></div>
            <select class="form-select form-select-sm w-auto" name="period" data-autosubmit aria-label="${AC.t('Reported')}">${AC.ui.options(PERIODS, f.period, AC.t('Reported: any time'))}</select>
            ${f.period === 'custom' ? html`<span class="d-inline-flex align-items-center gap-1 ticket-dates">
              <input class="form-control form-control-sm" type="date" name="from" value="${f.from}" max="${f.to}" data-autosubmit aria-label="${AC.t('From')}">
              <span class="text-secondary">–</span>
              <input class="form-control form-control-sm" type="date" name="to" value="${f.to}" min="${f.from}" data-autosubmit aria-label="${AC.t('To')}"></span>` : ''}
            <select class="form-select form-select-sm w-auto" name="status" data-autosubmit aria-label="Status">${AC.ui.options(meta().ticket_statuses, f.status, AC.t('Status: all'))}</select>
            <select class="form-select form-select-sm w-auto" name="priority" data-autosubmit aria-label="Priority">${AC.ui.options(meta().priorities, f.priority, AC.t('Priority: all'))}</select>
            <select class="form-select form-select-sm w-auto" name="assignee" data-autosubmit aria-label="Assignee">${AC.ui.options(d.technicians.map(function (u) { return [u.id, u.name]; }), f.assignee, AC.t('Assignee: anyone'))}</select>
            <select class="form-select form-select-sm w-auto" name="work_center" data-autosubmit aria-label="Work Center">${AC.ui.options(d.work_centers.map(function (w) { return [w.id, w.code + (w.name ? ' · ' + w.name : '')]; }), f.work_center, AC.t('Work Center: all'))}</select>
            ${filtered ? html`<a class="btn btn-sm btn-link" href="${AC.link('admin/tickets', { view: f.view })}">Clear filters</a>` : ''}
          </form>
          ${p.total > 1 ? html`<p class="small text-secondary mb-2 d-none d-md-block">Tick tickets to assign, set the priority or close several at once. Shift-click selects a range.</p>` : ''}
          ${ticketTable(d.rows, 'admin', true)}
          <div class="bulk-bar d-none d-flex flex-wrap align-items-center gap-2 mt-3" id="ticket-bulk-bar">
            <strong class="me-2"><span data-count data-total="${fmt.number(p.total)}">0</span> selected</strong>
            <a href="#" class="small d-none" data-select-all-results>${p.total > d.bulk_max
              ? AC.t('Select all {n} matching the filter (up to {max} at a time)', { n: fmt.number(p.total), max: fmt.number(d.bulk_max) })
              : AC.t('Select all {n} matching the filter', { n: fmt.number(p.total) })}</a>
            <span class="flex-grow-1"></span>
            <button type="button" class="btn btn-light btn-sm" data-action="ticket-bulk" data-bulk="assign"><i class="bi bi-person-check me-1"></i>Assign</button>
            <button type="button" class="btn btn-light btn-sm" data-action="ticket-bulk" data-bulk="priority"><i class="bi bi-flag me-1"></i>Priority</button>
            <button type="button" class="btn btn-light btn-sm" data-action="ticket-bulk" data-bulk="close"><i class="bi bi-archive me-1"></i>Close repaired</button>
            <button type="button" class="btn btn-outline-light btn-sm" data-clear-selection>Cancel</button>
          </div>
          ${AC.ui.pager(p)}`.toString();
      });
    },
  });

  /* ------------------------------------------------------------ bulk */

  /**
   * Admin list: change the ticked tickets (or every ticket matching the filter) in one go.
   * Every ticket goes through the same rules as its own form; those that do not fit are skipped and listed.
   */
  AC.on('ticket-bulk', function (el) {
    var table = AC.$('[data-select-table="#ticket-bulk-bar"]');
    if (!table || !table.selection || !adminList) { return; }
    var sel = table.selection();
    var total = adminList.pager.total;
    var count = sel.select_all ? Math.min(total, adminList.bulk_max) : sel.ids.length;
    if (!count) { AC.toast(AC.t('No tickets selected.'), 'error'); return; }
    if (sel.select_all && total > adminList.bulk_max) {
      AC.toast(AC.t('Select at most {n} tickets at a time. Narrow the filter first.', { n: adminList.bulk_max }), 'error');
      return;
    }
    var action = el.getAttribute('data-bulk');
    var n = fmt.number(count);
    var body, title, submit = AC.t('Apply'), cls = 'btn-primary';
    var noteField = function (label, hint) {
      return html`<div><label class="form-label" for="tb-note">${label} <span class="fw-normal text-secondary">(optional)</span></label>
        <input class="form-control" id="tb-note" name="note" maxlength="255" placeholder="${hint}">
        <div class="form-text">Saved on the timeline of every ticket.</div></div>`;
    };
    if (action === 'assign') {
      title = AC.t('Assign {n} tickets', { n: n });
      body = html`<div class="vstack gap-3">
        <div><label class="form-label" for="tb-assignee">Assignee</label>
          <select class="form-select" id="tb-assignee" name="assignee_id">
            <option value="0">— Nobody —</option>
            ${adminList.technicians.map(function (u) { return html`<option value="${u.id}">${u.name} · ${AC.t('{n} open', { n: u.open_count })}</option>`; })}
          </select>
          ${adminList.technicians.length ? '' : html`<div class="form-text text-warning">No technicians yet. Turn on "Takes repair jobs" on the Users page.</div>`}
          <div class="form-text">New tickets move to "Assigned". Closed tickets are skipped.</div></div>
        ${noteField(AC.t('Note to the assignee'), '')}
      </div>`;
    } else if (action === 'priority') {
      title = AC.t('Set the priority of {n} tickets', { n: n });
      body = html`<div class="vstack gap-3">
        <div><span class="form-label d-block">Priority</span>${priorityRadios('priority', '', 'tb-prio')}</div>
      </div>`;
    } else {
      title = AC.t('Close {n} tickets', { n: n });
      submit = AC.t('Close tickets');
      cls = 'btn-success';
      body = html`<div class="vstack gap-3">
        <div class="alert alert-info py-2 mb-0 small"><i class="bi bi-info-circle me-1"></i>Only tickets marked <strong>Resolved</strong> are closed; the others are skipped.
          Devices still in the Setting Room stay there: send them out from the Setting Room page.</div>
        ${noteField(AC.t('Note'), AC.t('e.g. checked with the department'))}
      </div>`;
    }
    AC.modal.form({
      title: title,
      route: 'admin/tickets/bulk',
      submitLabel: submit,
      submitClass: cls,
      body: body,
      data: function (o) {
        o.action = action;
        if (sel.select_all) {
          o.select_all = '1';
          ADMIN_FILTER_KEYS.forEach(function (k) { o[k] = adminList.filters[k] || ''; });
        } else {
          o.ids = sel.ids;
        }
        return o;
      },
      onSuccess: function (res) {
        var skipped = (res.data && res.data.skipped) || [];
        AC.toast(res.message, res.data && res.data.done ? 'success' : 'info');
        if (skipped.length) {
          AC.modal.open({
            title: AC.t('{n} tickets were skipped', { n: fmt.number(skipped.length) }),
            body: html`<p class="small text-secondary">The other tickets were saved. These did not fit the rules:</p>
              <ul class="list-group list-group-flush small">${skipped.map(function (x) {
                return html`<li class="list-group-item px-0"><span class="font-monospace fw-semibold">${x.ticket_no}</span> — ${x.reason}</li>`;
              })}</ul>`,
          });
        } else {
          AC.modal.close();
        }
        AC.refresh();
      },
    });
  });

  AC.route('user/tickets', {
    area: 'user', title: AC.t('Repair tickets'), ability: 'tickets.create',
    render: function (ctx) {
      var q = ctx.query;
      return AC.api.get('user/tickets', { view: q.view, q: q.q, page: q.page }).then(function (d) {
        var f = d.filters;
        ctx.main.innerHTML = html`
          ${c.pageHead(AC.t('Repair tickets'), AC.t('Tickets you reported and tickets in your Work Centers'),
            html`<button class="btn btn-primary" data-action="ticket-create"><i class="bi bi-plus-lg me-1"></i>Report a problem</button>`)}
          ${myQueueBox(d.my_queue || [], d.queue_length || 0)}
          ${tabs('user/tickets', USER_VIEWS, f.view, d.counts)}
          <form class="filter-bar d-flex gap-2 mb-3" data-filter data-keep="view">
            <div class="search-wrap"><i class="bi bi-search"></i><input class="form-control form-control-sm" type="search" name="q" value="${f.q}" placeholder="Ticket no., Flowlites, asset no., title" data-search></div>
          </form>
          ${ticketTable(d.rows, 'user')}
          ${AC.ui.pager(d.pager)}`.toString();
      });
    },
  });

  /* -------------------------------------------------------------- detail */

  function eventText(ev) {
    switch (ev.event_type) {
      case 'created': return AC.t('reported the problem');
      case 'assigned':
        if (!ev.to_value) { return AC.t('removed the assignee'); }
        return ev.from_value ? html`changed the assignee <span class="text-secondary">${ev.from_value}</span> → <strong>${ev.to_value}</strong>`
          : html`assigned it to <strong>${ev.to_value}</strong>`;
      case 'status': return html`changed the status ${AC.ui.ticketBadge(ev.from_value)} → ${AC.ui.ticketBadge(ev.to_value)}`;
      case 'note': return AC.t('added a note');
      case 'asset': return html`changed the asset status ${AC.ui.statusBadge(ev.from_value)} → ${AC.ui.statusBadge(ev.to_value)}`;
      case 'priority': return html`changed the priority ${AC.ui.priorityBadge(ev.from_value)} → ${AC.ui.priorityBadge(ev.to_value)}`;
      case 'received': return html`<span class="badge text-bg-success">Received into the Setting Room</span> Area <span class="text-secondary">${ev.from_value}</span> → <strong>${ev.to_value}</strong>`;
      case 'returned': return html`<span class="badge text-bg-warning">Sent out of the Setting Room</span> Area → <strong>${ev.to_value}</strong>`;
      case 'queue_jump': return html`<span class="queue-jump-tag"><i class="bi bi-lightning-charge-fill"></i> ${AC.t('Queue jump')}</span> ${AC.t('moved it to the front of the queue (was queue no. {n})', { n: ev.from_value })}`;
    }
    return ev.event_type;
  }

  function stepper(t) {
    if (t.status === 'cancelled') {
      return html`<div class="alert alert-secondary">This ticket was cancelled on ${fmt.datetime(t.closed_at)}.</div>`;
    }
    var steps = meta().ticket_steps;
    var times = { new: t.created_at, assigned: t.assigned_at, in_progress: t.started_at, resolved: t.resolved_at, closed: t.status === 'closed' ? t.closed_at : null };
    var current = t.status === 'waiting_parts' ? 'in_progress' : t.status;
    var idx = steps.indexOf(current);
    return html`<ol class="stepper mb-3" aria-label="Progress">${steps.map(function (st, i) {
      var cls = idx !== -1 && i < idx ? 'done' : (i === idx ? 'current' : '');
      var label = st === 'in_progress' && t.status === 'waiting_parts' ? statusLabel('waiting_parts') : statusLabel(st);
      return html`<li class="${cls}">${label}<small>${times[st] ? fmt.datetime(times[st]) : AC.raw('&nbsp;')}</small></li>`;
    })}</ol>`;
  }

  /**
   * Staff side: what happens next, in plain words. IT resolves and closes tickets; staff never close
   * them, so after "Repaired" they need to know who moves next and what to do if it still does not work.
   */
  function nextStep(t, admin) {
    if (admin || isClosed(t)) { return ''; }
    if (t.status === 'resolved') {
      return html`<div class="next-step next-step--ok mb-3" role="status">
        <i class="bi bi-check2-circle" aria-hidden="true"></i>
        <div><div class="fw-semibold">The repair is done.</div>
          <div class="small">The IT team will return the device or contact you to collect it, then close this ticket. Still not working? Add a note below so the technician can follow up.</div></div>
      </div>`;
    }
    // Before the repair, the queue panel in the header already says "bring the device to the Setting Room".
    return '';
  }

  var BTN_CLASS = { in_progress: 'btn-primary', resolved: 'btn-primary', closed: 'btn-primary', waiting_parts: 'btn-outline-secondary', cancelled: 'btn-outline-danger' };

  function renderShow(ctx, ar) {
    return AC.api.get('tickets/show', { id: ctx.query.id }).then(function (d) {
      var t = d.ticket, admin = ar === 'admin' && d.can_manage, closed = isClosed(t), room = inRoom(t);
      ctx.setTitle(t.ticket_no + ' · ' + t.title);

      var buttons = [];
      if (admin && !closed) {
        if (!t.assignee_id || t.status === 'new' || t.status === 'assigned') {
          buttons.push(html`<button class="btn btn-primary" data-action="ticket-take" data-id="${t.id}"><i class="bi bi-hand-index me-1"></i>Take the job and start</button>`);
        }
        buttons.push(html`<button class="btn btn-outline-secondary" data-action="ticket-assign" data-id="${t.id}"><i class="bi bi-person-gear me-1"></i>Assign / priority</button>`);
        if (t.asset_id && !room) {
          buttons.push(html`<button class="btn btn-outline-success" data-action="ticket-receive" data-id="${t.id}"><i class="bi bi-box-arrow-in-right me-1"></i>Receive into the Setting Room</button>`);
        }
      }
      if (admin && t.queue_no > 1) {
        buttons.push(html`<button class="btn btn-outline-warning" data-action="ticket-queue-jump" data-id="${t.id}" data-asset="${t.asset_no}" data-queue="${t.queue_no}"><i class="bi bi-lightning-charge-fill me-1"></i>Queue jump</button>`);
      }
      if (admin && room) {
        buttons.push(html`<button class="btn btn-outline-warning" data-action="ticket-send-out" data-id="${t.id}"><i class="bi bi-box-arrow-right me-1"></i>Send out of the Setting Room</button>`);
      }
      d.transitions.forEach(function (to) {
        var cls = t.status === 'resolved' && to === 'in_progress' ? 'btn-outline-secondary' : (BTN_CLASS[to] || 'btn-outline-secondary');
        buttons.push(html`<button class="btn ${cls}" data-action="ticket-status" data-id="${t.id}" data-to="${to}">${actionLabel(t.status, to)}</button>`);
      });

      var events = d.events.map(function (ev) {
        return html`<li class="t-${ev.event_type}">
          <div class="d-flex flex-wrap gap-2 align-items-baseline">
            <strong>${ev.user_name || AC.t('System')}</strong>
            <span>${eventText(ev)}</span>
            <span class="ms-auto small text-secondary text-nowrap">${fmt.datetime(ev.created_at)}</span>
          </div>
          ${ev.note ? html`<div class="timeline-note">${ev.note}</div>` : ''}
        </li>`;
      });

      var waitText = t.assigned_at ? fmt.between(t.created_at, t.assigned_at) : (closed ? '—' : AC.t('{d} (still waiting)', { d: fmt.between(t.created_at) }));
      var repairText = t.started_at ? fmt.between(t.started_at, t.resolved_at || null) + (t.resolved_at ? '' : AC.t(' (in progress)')) : '—';

      ctx.main.innerHTML = html`
        <div class="crumbs"><a href="${AC.link(ar + '/tickets')}">Repair tickets</a> / <span class="font-monospace">${t.ticket_no}</span></div>
        <div class="page-head">
          <div>
            <h1 class="mb-1">${t.title}</h1>
            <div class="page-sub d-flex flex-wrap gap-2 align-items-center">
              <span class="font-monospace">${t.ticket_no}</span>
              <span class="badge text-bg-light border font-monospace" title="Flowlites number">Flowlites ${t.flolites_no || '—'}</span>
              ${AC.ui.ticketBadge(t.status)} ${AC.ui.priorityBadge(t.priority)}
              <span>Reported ${fmt.datetime(t.created_at)}${closed ? '' : AC.t(' · {d} ago', { d: fmt.between(t.created_at) })}</span>
              ${room ? html`<span class="badge text-bg-success"><i class="bi bi-box-seam me-1"></i>In the Setting Room</span>` : ''}
            </div>
            ${c.queuePanel(t)}
          </div>
          <div class="page-actions d-flex flex-wrap gap-2">${buttons}</div>
        </div>
        ${stepper(t)}
        ${nextStep(t, admin)}
        <div class="row g-3">
          <div class="col-xl-8 vstack gap-3">
            <div class="card">
              <div class="card-header"><h2 class="card-title mb-0">Reported problem</h2></div>
              <div class="card-body" style="white-space:pre-wrap;overflow-wrap:anywhere">${t.symptom}</div>
              <div class="card-footer bg-transparent small row g-2 mx-0">
                <div class="col-md-4 px-0"><span class="text-secondary">Reported by</span> ${t.reporter_name || '—'}</div>
                <div class="col-md-4 px-0"><span class="text-secondary">Contact</span> ${t.contact_name}${t.contact_phone ? html` · <span class="font-monospace">${t.contact_phone}</span>` : ''}</div>
                <div class="col-md-4 px-0"><span class="text-secondary">Device location</span> ${t.location_note || '—'}</div>
              </div>
            </div>
            ${t.resolution ? html`<div class="card border-success">
              <div class="card-header"><h2 class="card-title mb-0">What was done / fix</h2><span class="small text-secondary">${fmt.datetime(t.resolved_at)}</span></div>
              <div class="card-body" style="white-space:pre-wrap">${t.resolution}</div>
            </div>` : ''}
            <div class="card">
              <div class="card-header"><h2 class="card-title mb-0">Activity</h2><span class="small text-secondary">${d.events.length} item(s)</span></div>
              <div class="card-body">
                <ul class="timeline">${events}</ul>
                ${closed ? '' : html`<form id="ticket-note-form" class="vstack gap-2 mt-2" novalidate>
                  ${AC.ui.errorBox()}
                  <label class="form-label mb-0" for="tn-note">Add a note</label>
                  <textarea class="form-control" id="tn-note" name="note" rows="3" required placeholder="${admin ? AC.t('Findings, parts ordered, next visit') : AC.t('More information for the technician')}"></textarea>
                  <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center">
                    ${admin && t.asset_id ? html`<div class="d-flex align-items-center gap-2 small text-secondary">Also set the asset status to
                      <select class="form-select form-select-sm w-auto" name="asset_status">${assetStatusOptions('', AC.t('— No change —'))}</select></div>` : html`<span></span>`}
                    <button class="btn btn-outline-secondary btn-sm" type="submit">Save note</button>
                  </div>
                </form>`}
              </div>
            </div>
          </div>
          <div class="col-xl-4 vstack gap-3">
            <div class="card">
              <div class="card-header"><h2 class="card-title mb-0">Assignee</h2></div>
              <div class="card-body d-flex gap-2 align-items-center">
                ${t.assignee_name ? html`<span class="avatar">${fmt.initials(t.assignee_name)}</span>
                  <div><strong>${t.assignee_name}</strong><div class="small text-secondary">Assigned ${fmt.datetime(t.assigned_at)}</div></div>`
                  : html`<span class="text-secondary">Nobody has taken this job yet</span>`}
              </div>
            </div>
            <div class="card">
              <div class="card-header"><h2 class="card-title mb-0">Device</h2></div>
              <div class="card-body">
                ${t.asset_id ? html`
                  ${assetLink(t)}
                  <div class="small my-1">${t.asset_description}</div>
                  <div class="small text-secondary">${t.work_center ? wcText(t) : AC.t('No Work Center')}</div>
                  <div class="small text-secondary">Area: ${t.asset_area || '—'}</div>
                  <div class="mt-2">${AC.ui.statusBadge(t.asset_status)}</div>
                  ${t.received_at ? html`<hr><dl class="props small" style="grid-template-columns:120px minmax(0,1fr)">
                    <dt>Received</dt><dd>${fmt.datetime(t.received_at)}</dd>
                    <dt>Original Area</dt><dd>${t.original_area || '—'}</dd>
                    <dt>Sent out</dt><dd>${t.returned_at ? fmt.datetime(t.returned_at) : html`<span class="text-success">Still in the room · ${fmt.between(t.received_at)}</span>`}</dd>
                  </dl>` : ''}`
                : (t.asset_no ? html`<span class="asset-no">${t.asset_no}</span><div class="small text-secondary">This number is not in the register.</div>`
                  : html`<span class="text-secondary">No device given</span>`)}
              </div>
            </div>
            <div class="card">
              <div class="card-header"><h2 class="card-title mb-0">Timing</h2></div>
              <div class="card-body">
                <dl class="props" style="grid-template-columns:120px minmax(0,1fr)">
                  <dt>Waiting to be taken</dt><dd>${waitText}</dd>
                  <dt>Repair time</dt><dd>${repairText}</dd>
                  <dt>Total</dt><dd>${fmt.between(t.created_at, t.closed_at || t.resolved_at || null)}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>`.toString();

      var form = AC.$('#ticket-note-form', ctx.main);
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          if (!form.reportValidity()) { return; }
          var btn = AC.$('[type=submit]', form);
          btn.disabled = true;
          AC.$('[data-errors]', form).classList.add('d-none');
          var body = AC.formData(form);
          body.id = t.id;
          AC.api.post('tickets/note', body).then(function (res) {
            AC.toast(res.message);
            AC.refresh();
          }, function (err) {
            AC.showErrors(form, err.errors);
            btn.disabled = false;
          });
        });
      }
    });
  }

  AC.route('admin/tickets/show', {
    area: 'admin', title: AC.t('Repair ticket'), ability: 'tickets.manage',
    render: function (ctx) { return renderShow(ctx, 'admin'); },
  });
  AC.route('user/tickets/show', {
    area: 'user', title: AC.t('Repair ticket'), ability: 'tickets.create',
    render: function (ctx) { return renderShow(ctx, 'user'); },
  });

  /* -------------------------------------------------------- Setting Room */

  AC.route('admin/receiving', {
    area: 'admin', title: AC.t('Setting Room'), ability: 'tickets.manage',
    render: function (ctx) {
      var mode = ctx.query.mode === 'out' ? 'out' : 'in';
      // Keep anything typed into the scanner while the page re-renders (it is put back after rendering).
      var oldScanner = AC.$('[data-scanner]', ctx.main);
      var pending = oldScanner ? oldScanner.value : '';
      return AC.api.get('admin/receiving', { mode: mode, scan: ctx.query.scan }).then(function (d) {
        var isIn = mode === 'in', tone = isIn ? 'success' : 'warning', auto = null;
        /** Link that re-runs the same scan in the other mode. */
        var other = function (label, scan) {
          return html`<a class="btn btn-sm btn-outline-${isIn ? 'warning' : 'success'} text-nowrap" href="${AC.link('admin/receiving', { mode: isIn ? 'out' : '', scan: scan })}">
            <i class="bi ${isIn ? 'bi-box-arrow-right' : 'bi-box-arrow-in-right'} me-1"></i>${label}</a>`;
        };

        var result = '';
        if (d.scan) {
          var inner;
          if (isIn && d.matches.length) {
            var receivable = d.matches.filter(function (t) { return t.asset_id && !t.in_room; });
            if (d.matches.length === 1 && receivable.length === 1) { auto = function () { openReceive(receivable[0]); }; }
            inner = html`<div class="list-group">${d.matches.map(function (t) {
              return html`<div class="list-group-item d-flex flex-wrap gap-3 align-items-center">
                <div class="flex-grow-1">
                  ${assetLink(t)} · <a class="ticket-tag" href="${AC.link('admin/tickets/show', { id: t.id })}">${t.ticket_no}</a> · Flowlites <span class="font-monospace">${t.flolites_no}</span>
                  <div class="small">${t.title} · ${AC.ui.ticketBadge(t.status)} · Current Area: ${t.asset_area || '—'}</div>
                </div>
                ${t.in_room ? html`<span class="status status--info">${AC.t('Already in the room since {when}', { when: fmt.datetime(t.received_at) })}</span>
                    ${other(AC.t('Switch to Send out'), t.asset_no)}`
                  : (!t.asset_id ? html`<span class="text-secondary small">This ticket is not linked to a registered device. Open the ticket and add the IT asset number first.</span>`
                    : html`<button class="btn btn-success" data-action="ticket-receive" data-id="${t.id}"><i class="bi bi-box-arrow-in-right me-1"></i>Receive</button>`)}
              </div>`;
            })}</div>`;
          } else if (isIn && d.asset) {
            auto = function () { openCreate(d.asset.asset_no, true); };
            inner = html`<div class="alert alert-warning d-flex flex-wrap align-items-center gap-2 mb-0" role="alert">
              <i class="bi bi-exclamation-triangle"></i>
              <span><span class="asset-no">${d.asset.asset_no}</span> has no open ticket. Report the problem first.</span>
              <button class="btn btn-success ms-auto" data-action="ticket-create" data-asset-no="${d.asset.asset_no}" data-receive="1"><i class="bi bi-plus-lg me-1"></i>Report and receive</button>
            </div>`;
          } else if (isIn) {
            inner = html`<div class="alert alert-danger d-flex flex-wrap align-items-center gap-2 mb-0" role="alert">
              <i class="bi bi-question-octagon"></i>
              <span>${AC.t('{code} is not an IT asset number, open ticket number or Flowlites number in the register. Check the label and scan again.', { code: d.scan })}</span>
              <a class="btn btn-sm btn-outline-secondary ms-auto" href="${AC.link('admin/assets', { q: d.scan })}"><i class="bi bi-search me-1"></i>Search the register</a>
            </div>`;
          } else if (d.out_ticket) {
            var o = d.out_ticket;
            auto = function () { openSendOut(o); };
            inner = html`<div class="list-group"><div class="list-group-item d-flex flex-wrap gap-3 align-items-center">
              <div class="flex-grow-1">
                ${assetLink(o)} · <a class="ticket-tag" href="${AC.link('admin/tickets/show', { id: o.id })}">${o.ticket_no}</a> · ${AC.ui.ticketBadge(o.status)}
                <div class="small">In the room since ${fmt.datetime(o.received_at)} · Original Area: <strong>${o.original_area || '—'}</strong></div>
              </div>
              <button class="btn btn-warning" data-action="ticket-send-out" data-id="${o.id}"><i class="bi bi-box-arrow-right me-1"></i>Send out</button>
            </div></div>`;
          } else {
            inner = html`<div class="alert alert-danger d-flex flex-wrap align-items-center gap-2 mb-0" role="alert">
              <i class="bi bi-exclamation-triangle"></i>
              <span>${AC.t('{code} is not in the Setting Room, so it cannot be sent out. Did you mean to receive it?', { code: d.scan })}</span>
              <span class="ms-auto">${other(AC.t('Switch to Receive'), d.scan)}</span>
            </div>`;
          }
          result = html`<div class="mt-3"><div class="small text-secondary mb-2">Scan result <span class="font-monospace fw-semibold text-body">${d.scan}</span></div>${inner}</div>`;
        }

        // Result of the last receive / send-out, where the technician is already looking.
        var last = '';
        if (lastRoom) {
          var lin = lastRoom.mode === 'in';
          last = html`<div class="room-last room-last--${lin ? 'in' : 'out'} mt-3" role="status">
            <i class="bi ${lin ? 'bi-check2-circle' : 'bi-box-arrow-right'}" aria-hidden="true"></i>
            <div class="min-w-0">
              <div class="room-last-title"><span class="asset-no">${lastRoom.asset}</span> ${lin ? AC.t('received') : AC.t('sent out')}${lastRoom.ticket ? html` · <span class="font-monospace">${lastRoom.ticket}</span>` : ''}</div>
              <div class="small">Area → <span class="font-monospace">${lastRoom.area || '—'}</span> · ${fmt.datetime(lastRoom.at.toISOString())}</div>
            </div>
            ${lin && lastRoom.queue ? html`<div class="queue-no ms-auto"><span>${AC.t('Queue no.')}</span><strong>${lastRoom.queue}</strong></div>` : ''}
          </div>`;
        }

        var rows = d.in_room.length ? d.in_room.map(function (t) {
          var fresh = lastRoom && lastRoom.mode === 'in' && lastRoom.ticket === t.ticket_no;
          return html`<tr class="${fresh ? 'row-flash' : ''}">
            <td class="text-center">${t.queue_no ? html`<span class="queue-no-cell">${t.queue_no}</span>${t.queue_jumped ? html`<span class="queue-jump-tag d-block mt-1"><i class="bi bi-lightning-charge-fill"></i> ${AC.t('Jumped')}</span>` : ''}` : html`<span class="small text-success">${AC.t('Repaired')}</span>`}</td>
            <td>${assetLink(t)}<span class="cell-sub">${t.asset_description}</span></td>
            <td><a class="ticket-tag" href="${AC.link('admin/tickets/show', { id: t.id })}">${t.ticket_no}</a><span class="cell-sub">${t.title}</span></td>
            <td>${AC.ui.ticketBadge(t.status)}<span class="cell-sub">${t.assignee_name || AC.t('Nobody yet')}</span></td>
            <td class="small">${t.original_area || '—'}<span class="cell-sub">${t.work_center ? wcText(t) : ''}</span></td>
            <td class="small text-nowrap">${fmt.datetime(t.received_at)}<span class="cell-sub">${fmt.between(t.received_at)}</span></td>
          </tr>`;
        }) : AC.ui.empty(AC.t('No devices in the room.'), 6);

        ctx.main.innerHTML = html`
          ${c.pageHead(AC.t('Setting Room'), html`Repair room · Area in the register: <span class="font-monospace">${d.room}</span>`,
            html`<div class="btn-group btn-group-lg" role="group" aria-label="Mode">
              <a class="btn ${isIn ? 'btn-success' : 'btn-outline-success'} px-4" href="${AC.link('admin/receiving')}" ${isIn ? AC.raw('aria-current="page"') : ''}><i class="bi bi-box-arrow-in-right me-2"></i>Receive</a>
              <a class="btn ${!isIn ? 'btn-warning' : 'btn-outline-warning'} px-4" href="${AC.link('admin/receiving', { mode: 'out' })}" ${!isIn ? AC.raw('aria-current="page"') : ''}><i class="bi bi-box-arrow-right me-2"></i>Send out</a>
            </div>`)}
          <div class="card border-${tone} border-2 mb-3">
            <div class="card-body text-bg-${tone} rounded-top py-3 d-flex align-items-center gap-3">
              <i class="bi ${isIn ? 'bi-box-arrow-in-right' : 'bi-box-arrow-right'} mode-banner-icon" aria-hidden="true"></i>
              <div>
                <div class="mode-banner-title">${isIn ? AC.t('Mode: receive devices into the room') : AC.t('Mode: send devices out of the room')}</div>
                <div>${isIn ? AC.t('Scan to receive a device. Its Area becomes {room} and its status REPAIR.', { room: d.room })
                  : AC.t('Scan to send a device back to its original Area.')}</div>
              </div>
            </div>
            <div class="card-body">
              <form class="d-flex gap-2" data-filter data-keep="mode" autocomplete="off">
                <label class="visually-hidden" for="room-scan">${isIn ? AC.t('Scan to receive') : AC.t('Scan to send out')}</label>
                <input class="form-control form-control-lg scan-input" id="room-scan" name="scan" value="" placeholder="Scan / type an IT asset number, repair ticket number or Flowlites number" autocomplete="off" data-scanner>
                <button class="btn btn-lg btn-${tone} px-4" type="submit" aria-label="Look up"><i class="bi bi-upc-scan"></i></button>
              </form>
              ${last}
              ${result}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h2 class="card-title mb-0">Repair queue <span class="count">${d.in_room.length}</span></h2>
              <button class="btn btn-sm btn-outline-secondary" data-action="room-export" title="${AC.t('Excel: repair queue + repaired, waiting for pickup')}"><i class="bi bi-file-earmark-excel me-1"></i>Export</button></div>
            <div class="table-responsive"><table class="table table-hover align-middle mb-0">
              <thead><tr><th class="text-center">Queue</th><th>Device</th><th>Repair ticket</th><th>Ticket status</th><th>Original Area / Work Center</th><th>Received</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>
          </div>`.toString();

        if (auto) {
          auto();
        } else {
          var s = AC.$('[data-scanner]', ctx.main);
          if (s) {
            if (pending && !d.scan) { s.value = pending; }
            setTimeout(function () { s.focus(); }, 0);
          }
        }
      });
    },
  });
})();
