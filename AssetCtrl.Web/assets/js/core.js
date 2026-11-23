/*
 * Asset Ctrl — browser app core.
 *
 * The page is a single HTML shell (index.html). Everything it shows comes from
 * the JSON API (api.ashx?r=<route>). This file provides:
 *
 *   AC.api        get/post/upload to the API (session cookie + CSRF header)
 *   AC.route      register a page:  AC.route('admin/assets', { area, title, ability, render })
 *   AC.go / link  hash navigation:  #/admin/assets?status=USE
 *   AC.html       safe HTML template tag (escapes ${values}; nest html`` or AC.raw() for markup)
 *   AC.modal      modal dialogs, incl. AC.modal.form() for create/edit forms
 *   AC.toast      notifications
 *   AC.fmt        dates, numbers, durations
 *   AC.ui         badges, pager, sort links, empty states, select helpers
 *   AC.on         delegated click actions: <button data-action="x" data-id="3">
 *
 * Page modules live in assets/js/pages/*.js and only call these helpers.
 */
(function () {
  'use strict';

  var AC = window.AC = {};
  var state = AC.state = { user: null, meta: null, csrf: '', area: null, page: null, demo: false };

  /* ------------------------------------------------------------- language */

  // 'en' (default) or 'th'; remembered per browser. Switching reloads the app so the
  // API (labels, messages) and every page are rebuilt in the new language.
  var LANG = 'en';
  try { LANG = localStorage.getItem('ac_lang') === 'th' ? 'th' : 'en'; } catch (e) { /* ignore */ }
  ACI18N.setLang(LANG);
  document.documentElement.lang = LANG;
  AC.lang = function () { return LANG; };
  /** Translate a plain string: AC.t('Saved {code}.', { code: 'A1' }). See assets/js/i18n.js. */
  AC.t = ACI18N.t;
  var t = AC.t;
  AC.setLang = function (code) {
    try { localStorage.setItem('ac_lang', code === 'th' ? 'th' : 'en'); } catch (e) { /* ignore */ }
    location.reload();
  };

  /* ----------------------------------------------------------------- theme */

  // 'light' or 'dark'. The user's choice is remembered per browser (ac_theme); without one the
  // OS setting is followed, also when it changes. Default.aspx applies it before first paint.
  function savedTheme() {
    try { var v = localStorage.getItem('ac_theme'); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; }
  }
  var osDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  AC.theme = function () { return document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light'; };
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    // Repaint every toggle on the page (menu item and header button) without re-rendering the page.
    Array.prototype.forEach.call(document.querySelectorAll('[data-action="toggle-theme"]'), function (el) {
      el.outerHTML = toHtml(el.classList.contains('theme-btn') ? AC.themeButton() : themeMenuItem());
    });
  }
  AC.setTheme = function (theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem('ac_theme', theme); } catch (e) { /* ignore */ }
    applyTheme(theme);
  };
  if (osDark) {
    var onOs = function () { if (!savedTheme()) { applyTheme(osDark.matches ? 'dark' : 'light'); } };
    if (osDark.addEventListener) { osDark.addEventListener('change', onOs); } else if (osDark.addListener) { osDark.addListener(onOs); }
  }

  /* ------------------------------------------------------------------ html */

  function SafeHtml(s) { this.s = s; }
  SafeHtml.prototype.toString = function () { return this.s; };

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toHtml(v) {
    if (v === null || v === undefined || v === false) { return ''; }
    if (v instanceof SafeHtml) { return v.s; }
    if (Array.isArray(v)) { return v.map(toHtml).join(''); }
    return esc(v);
  }

  /** html`<td>${value}</td>` — values are escaped; nested html`` / AC.raw() are not. */
  AC.html = function (strings) {
    strings = ACI18N.templateStrings(strings);
    var out = strings[0];
    for (var i = 1; i < strings.length; i++) { out += toHtml(arguments[i]) + strings[i]; }
    return new SafeHtml(out);
  };
  AC.raw = function (s) { return new SafeHtml(String(s)); };
  AC.esc = esc;
  var html = AC.html;

  var $ = AC.$ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = AC.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------- api */

  function ApiError(status, errors, code) {
    this.status = status; this.errors = errors || [t('Something went wrong.')]; this.code = code || null;
    this.message = this.errors.join(' ');
  }
  ApiError.prototype = Object.create(Error.prototype);
  AC.ApiError = ApiError;

  function apiUrl(route, params) {
    var q = new URLSearchParams();
    q.set('r', route);
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === '') { return; }
      if (Array.isArray(v)) { v.forEach(function (x) { q.append(k + '[]', x); }); } else { q.set(k, v); }
    });
    return 'api.ashx?' + q.toString();
  }

  /** Server JSON -> resolved envelope, or ApiError (auth / password_change also navigate). */
  function settle(status, json) {
    if (json && json.ok) { return json; }
    var err = new ApiError(status, json && json.errors, json && json.code);
    if (err.code === 'auth') { state.user = null; AC.go('login', { next: currentHash() }); }
    if (err.code === 'password_change') { AC.go('account/password'); }
    throw err;
  }

  /*
   * Demo mode (assets/js/demo-api.js): when the server says the database is unavailable,
   * every call from then on is answered in the browser with sample data. A page reload tries the server again.
   */
  function demoRequest(method, route, params, body) {
    window.ACDemo.start();
    return window.ACDemo.handle(method, route, params, body).then(function (json) { return settle(json.status || 200, json); });
  }

  function request(method, route, params, body) {
    if (state.demo) { return demoRequest(method, route, params, body); }
    var opts = { method: method, credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-Lang': LANG } };
    if (method === 'POST') {
      opts.headers['X-CSRF-Token'] = state.csrf;
      if (body instanceof FormData) {
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body || {});
      }
    }
    return fetch(apiUrl(route, params), opts).then(function (res) {
      return res.json().catch(function () { return { ok: false, errors: [t('The server returned an invalid response (HTTP {status}).', { status: res.status })] }; })
        .then(function (json) {
          if (json && json.code === 'db_unavailable' && window.ACDemo) {
            state.demo = true; // switch to Demo mode and answer this same call from the demo data
            return demoRequest(method, route, params, body);
          }
          return settle(res.status, json);
        });
    }, function () {
      throw new ApiError(0, [t('Cannot reach the server. Check your connection and try again.')], 'network');
    });
  }

  AC.api = {
    url: apiUrl,
    /** GET -> data */
    get: function (route, params) { return request('GET', route, params).then(function (j) { return j.data; }); },
    /** POST -> { ok, message, data } (body: plain object or FormData) */
    post: function (route, body, params) { return request('POST', route, params, body); },
  };

  /* ---------------------------------------------------------------- format */

  var MONTHS = LANG === 'th'
    ? ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function parseDate(v) {
    if (!v || v === '0000-00-00 00:00:00') { return null; }
    var d = new Date(String(v).replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  AC.fmt = {
    date: function (v) {
      var d = parseDate(v);
      return d ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : '—';
    },
    datetime: function (v) {
      var d = parseDate(v);
      return d ? AC.fmt.date(v) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '—';
    },
    ago: function (v) {
      var d = parseDate(v);
      if (!d) { return '—'; }
      var s = (Date.now() - d.getTime()) / 1000;
      if (s < 60) { return t('just now'); }
      if (s < 3600) { return t('{n} min ago', { n: Math.floor(s / 60) }); }
      if (s < 86400) { return t('{n} h ago', { n: Math.floor(s / 3600) }); }
      if (s < 86400 * 7) { return t('{n} d ago', { n: Math.floor(s / 86400) }); }
      return AC.fmt.date(v);
    },
    /** minutes -> "2 d 4 h" / "3 h 10 min" / "25 min" */
    minutes: function (m) {
      m = Math.max(0, Math.round(m || 0));
      var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
      if (d) { return t('{n} d', { n: d }) + (h ? ' ' + t('{n} h', { n: h }) : ''); }
      if (h) { return t('{n} h', { n: h }) + (mm ? ' ' + t('{n} min', { n: mm }) : ''); }
      return t('{n} min', { n: mm });
    },
    between: function (from, to) {
      var a = parseDate(from), b = to ? parseDate(to) : new Date();
      return a && b ? AC.fmt.minutes((b - a) / 60000) : '—';
    },
    number: function (n) { return Number(n || 0).toLocaleString('en-US'); },
    pct: function (n, total) { return total ? (n / total * 100).toFixed(1) + '%' : '—'; },
    initials: function (name) {
      var p = String(name || '').trim().split(/\s+/);
      return ((p[0] || '?').charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
    },
  };

  /* ------------------------------------------------------------------ meta */

  function findMeta(list, code) {
    var arr = (state.meta && state.meta[list]) || [];
    for (var i = 0; i < arr.length; i++) { if (arr[i].code === code) { return arr[i]; } }
    return null;
  }
  AC.meta = {
    find: findMeta,
    label: function (list, code, fallback) { var m = findMeta(list, code); return m ? m.label : (fallback !== undefined ? fallback : code); },
    field: function (f) { return f === '_created' ? t('Created') : ((state.meta.field_labels || {})[f] || f); },
  };

  /* -------------------------------------------------------------------- ui */

  AC.ui = {
    statusBadge: function (code) {
      var m = findMeta('asset_statuses', code);
      return html`<span class="status status--${m ? m.tone : 'muted'}">${m ? m.label : t('Unspecified')}</span>`;
    },
    ticketBadge: function (code) {
      var m = findMeta('ticket_statuses', code);
      return html`<span class="status status--${m ? m.tone : 'muted'}">${m ? m.label : code}</span>`;
    },
    priorityBadge: function (code) {
      var m = findMeta('priorities', code);
      return m ? html`<span class="prio prio--${code}">${m.label}</span>` : '';
    },
    /** <option>s from [{code,label}] or [[value,label]] */
    options: function (list, selected, placeholder) {
      var sel = Array.isArray(selected) ? selected.map(String) : [String(selected === undefined || selected === null ? '' : selected)];
      var out = placeholder !== undefined ? [html`<option value="">${t(placeholder)}</option>`] : [];
      (list || []).forEach(function (o) {
        var v = Array.isArray(o) ? o[0] : (o.code !== undefined ? o.code : o.id);
        var l = Array.isArray(o) ? o[1] : (o.label !== undefined ? o.label : o.name);
        out.push(html`<option value="${v}" ${sel.indexOf(String(v)) !== -1 ? AC.raw('selected') : ''}>${l}</option>`);
      });
      return out;
    },
    empty: function (text, cols) {
      text = typeof text === 'string' ? t(text) : text;
      return cols ? html`<tr><td colspan="${cols}" class="text-center text-secondary py-5">${text}</td></tr>`
        : html`<div class="text-center text-secondary py-5">${text}</div>`;
    },
    /**
     * Skeleton placeholder shaped like the content that is loading:
     *   'list' (default: header, filters, table), 'dashboard', 'detail', 'form' (modals).
     */
    loading: function (kind) {
      var bar = function (w, h, cls) { return html`<span class="sk ${cls || ''}" style="width:${w};height:${h || '.8rem'}"></span>`; };
      var rows = function (n, cols) {
        var out = [];
        for (var i = 0; i < n; i++) {
          out.push(html`<div class="sk-row">${cols.map(function (w, j) { return bar(j === 0 ? w : (parseInt(w, 10) - (i * 7 + j * 3) % 18) + '%'); })}</div>`);
        }
        return out;
      };
      var head = html`<div class="sk-head">${bar('16rem', '1.6rem')}${bar('24rem', '.8rem', 'mt-2')}</div>`;
      var body;
      if (kind === 'form') {
        body = html`<div class="vstack gap-3 py-1">${[1, 2, 3, 4].map(function (i) {
          return html`<div>${bar('7rem', '.7rem')}${bar('100%', '2.3rem', 'mt-2')}</div>`;
        })}</div>`;
      } else if (kind === 'dashboard') {
        body = html`${head}<div class="kpis mb-3">${[1, 2, 3, 4, 5, 6].map(function () {
          return html`<div class="kpi has-icon">${bar('1.9rem', '1.9rem')}<span class="d-block flex-grow-1">${bar('60%', '.65rem')}${bar('40%', '1.2rem', 'mt-2')}</span></div>`;
        })}</div>
          <div class="row g-3"><div class="col-xl-8"><div class="card"><div class="card-body vstack gap-3">${rows(6, ['3rem', '80%'])}</div></div></div>
          <div class="col-xl-4"><div class="card"><div class="card-body vstack gap-3">${rows(6, ['50%', '20%'])}</div></div></div></div>`;
      } else if (kind === 'detail') {
        body = html`${head}<div class="row g-3"><div class="col-xl-8"><div class="card"><div class="card-body vstack gap-3">${rows(8, ['8rem', '70%'])}</div></div></div>
          <div class="col-xl-4"><div class="card"><div class="card-body vstack gap-3">${rows(5, ['40%', '45%'])}</div></div></div></div>`;
      } else {
        body = html`${head}<div class="d-flex gap-2 mb-3">${bar('18rem', '2rem')}${bar('8rem', '2rem')}${bar('8rem', '2rem')}</div>
          <div class="card"><div class="card-body vstack gap-3">${rows(10, ['6rem', '30%', '20%', '15%', '12%'])}</div></div>`;
      }
      return html`<div class="skeleton" role="status" aria-busy="true"><span class="visually-hidden">${t('Loading…')}</span>${body}</div>`;
    },
    /** Pagination for a { pager } payload; keeps current query params. */
    /**
     * Footer under a list: "1–25 of 68", page buttons with ‹ ›, and (per = { options, current })
     * a "Rows per page" choice. Pages two away from the current one (.page-far) are hidden on
     * phones so the row always fits: ‹ 1 … 4 5 6 … 10 ›.
     */
    pager: function (p, per) {
      if (!p) { return ''; }
      var perCtl = per && per.options && per.options.length && p.total > Math.min.apply(null, per.options)
        ? html`<div class="per-page"><span class="per-page-label">Rows per page</span><div class="per-page-seg" role="group" aria-label="${t('Rows per page')}">${per.options.map(function (n) {
            return html`<a class="${n === per.current ? 'active' : ''}" href="${AC.linkWith({ per: n, page: '' })}" ${n === per.current ? AC.raw('aria-current="true"') : ''}>${n}</a>`;
          })}</div></div>` : '';
      if (p.pages <= 1) {
        return html`<div class="pager-bar is-single"><div class="pager-info">${t('{n} item(s)', { n: AC.fmt.number(p.total) })}</div>${perCtl}</div>`;
      }
      var items = [], last = 0;
      for (var i = 1; i <= p.pages; i++) {
        var dist = Math.abs(i - p.page);
        if (i === 1 || i === p.pages || dist <= 2) {
          if (last && i - last > 1) { items.push(html`<li class="page-item page-gap"><span class="page-link">…</span></li>`); }
          items.push(html`<li class="page-item ${i === p.page ? 'active' : ''} ${dist === 2 && i !== 1 && i !== p.pages ? 'page-far' : ''}"><a class="page-link" href="${AC.linkWith({ page: i })}" ${i === p.page ? AC.raw('aria-current="page"') : ''}>${i}</a></li>`);
          last = i;
        }
      }
      var step = function (page, icon, label, off) {
        return off ? html`<li class="page-item page-step disabled"><span class="page-link" aria-hidden="true"><i class="bi ${icon}"></i></span></li>`
          : html`<li class="page-item page-step"><a class="page-link" href="${AC.linkWith({ page: page })}" aria-label="${t(label)}" title="${t(label)}"><i class="bi ${icon}"></i></a></li>`;
      };
      return html`<nav class="pager-bar" aria-label="${t('Pages')}">
        <div class="pager-info">${t('{from}–{to} of {total}', { from: AC.fmt.number(p.from), to: AC.fmt.number(p.to), total: AC.fmt.number(p.total) })}</div>
        <ul class="pagination mb-0">${step(p.page - 1, 'bi-chevron-left', 'Previous page', p.page <= 1)}${items}${step(p.page + 1, 'bi-chevron-right', 'Next page', p.page >= p.pages)}</ul>
        ${perCtl}</nav>`;
    },
    /** Column header that toggles ?sort=key&dir=asc|desc */
    sortLink: function (key, label) {
      var q = AC.query();
      var active = q.sort === key;
      var dir = active && q.dir !== 'desc' ? 'desc' : 'asc';
      var icon = active ? (q.dir === 'desc' ? 'bi-caret-down-fill' : 'bi-caret-up-fill') : '';
      return html`<a class="sort-link" href="${AC.linkWith({ sort: key, dir: dir, page: '' })}">${typeof label === 'string' ? t(label) : label}${icon ? html` <i class="bi ${icon} small"></i>` : ''}</a>`;
    },
    /** Old → new value pair used in history lists. */
    diff: function (oldV, newV, field) {
      var show = function (v) {
        if (v === null || v === '' || v === undefined) { return html`<span class="diff-empty">empty</span>`; }
        if (field === 'status') { return AC.ui.statusBadge(v); }
        return v;
      };
      return html`<span class="diff"><span class="diff-old">${show(oldV)}</span><i class="bi bi-arrow-right small text-secondary"></i><span class="diff-new">${show(newV)}</span></span>`;
    },
    errorBox: function () { return html`<div class="alert alert-danger py-2 d-none" data-errors></div>`; },
  };

  /* ----------------------------------------------------------------- toast */

  AC.toast = function (message, type) {
    if (!message) { return; }
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast align-items-center border-0 text-bg-' + (type === 'error' ? 'danger' : 'dark');
    el.setAttribute('role', 'status');
    // The little PC comes along: happy for news, sad for errors (AC.mascot.badge, mascot.js).
    var pc = AC.mascot ? '<span class="toast-mascot">' + AC.mascot.badge(type === 'error' ? 'sad' : 'happy', 38) + '</span>' : '';
    el.innerHTML = '<div class="d-flex align-items-center">' + pc + '<div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>';
    el.querySelector('.toast-body').textContent = typeof message === 'string' ? t(message) : String(message);
    box.appendChild(el);
    var bsToast = new bootstrap.Toast(el, { delay: type === 'error' ? 7000 : 4000 });
    el.addEventListener('hidden.bs.toast', function () { el.remove(); });
    bsToast.show();
  };

  /* ----------------------------------------------------------------- forms */

  /** Form -> plain object. Multi-selects and name[] fields become arrays; unchecked checkboxes are "0" when data-bool. */
  AC.formData = function (form) {
    var out = {};
    $$('input, select, textarea', form).forEach(function (el) {
      if (!el.name || el.disabled) { return; }
      var name = el.name.replace(/\[\]$/, '');
      var isList = /\[\]$/.test(el.name) || (el.tagName === 'SELECT' && el.multiple);
      if (el.type === 'file') { return; }
      if (el.type === 'checkbox' && !isList) { out[name] = el.checked ? (el.value && el.value !== 'on' ? el.value : '1') : '0'; return; }
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) { if (isList && !out[name]) { out[name] = []; } return; }
      if (el.tagName === 'SELECT' && el.multiple) {
        out[name] = Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
        return;
      }
      if (isList) { (out[name] = out[name] || []).push(el.value); return; }
      out[name] = el.value;
    });
    return out;
  };

  function showErrors(container, errors) {
    var box = container && $('[data-errors]', container);
    if (!box) { AC.toast(errors.join(' '), 'error'); return; }
    box.innerHTML = '';
    errors.forEach(function (m) { var d = document.createElement('div'); d.textContent = m; box.appendChild(d); });
    box.classList.remove('d-none');
    box.scrollIntoView({ block: 'nearest' });
  }
  AC.showErrors = showErrors;

  /* ----------------------------------------------------------------- modal */

  var modalEl, dialog, bsModal, modalCleanup = null;

  function modalSetup() {
    modalEl = document.getElementById('app-modal');
    dialog = document.getElementById('app-modal-dialog');
    bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalEl.addEventListener('hidden.bs.modal', function () {
      dialog.innerHTML = '';
      if (modalCleanup) { var f = modalCleanup; modalCleanup = null; f(); }
      var s = $('[data-scanner]');
      if (s) { s.focus(); }
    });
  }

  AC.modal = {
    /**
     * Open a modal. opts: { title, size, body, footer, onShow(el), onHide(), mascot }
     * mascot: the little PC's mood in the header ('happy' default, 'thinking', 'sad', 'worried'; false = none).
     * Every modal opens extra-wide (modal-xl) to use the screen width; size 'fullscreen' fills the screen.
     * body/footer: html`` or string. Default footer: a Close button.
     */
    open: function (opts) {
      dialog.className = 'modal-dialog modal-dialog-scrollable ' + (opts.size === 'fullscreen' ? 'modal-fullscreen' : 'modal-xl');
      var footer = opts.footer !== undefined ? opts.footer
        : html`<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>`;
      var opening = !modalEl.classList.contains('show');
      var mood = opts.mascot === undefined ? 'happy' : opts.mascot;
      // The little PC comes along with every modal. It only pops in when the modal opens,
      // not when the content is swapped (e.g. loading -> form), so nothing jumps.
      var pc = mood && AC.mascot ? AC.raw('<span class="modal-mascot' + (opening ? '' : ' no-pop') + '" data-modal-mascot data-mood="' + mood + '">' + AC.mascot.badge(mood, 40) + '</span>') : '';
      var say = pc ? AC.raw('<span class="modal-mascot-say" data-modal-say aria-live="polite" hidden></span>') : '';
      dialog.innerHTML = toHtml(html`<div class="modal-content">
        <div class="modal-header">${pc}<h5 class="modal-title">${typeof opts.title === 'string' ? t(opts.title) : (opts.title || '')}</h5>${say}
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
        <div class="modal-body">${opts.body || ''}</div>
        ${footer ? html`<div class="modal-footer">${footer}</div>` : ''}</div>`);
      modalCleanup = opts.onHide || null;
      initWidgets(dialog);
      if (opts.onShow) { opts.onShow(dialog); }
      // Focus the first field once the modal is fully shown (Bootstrap focuses the dialog itself at "shown").
      var f = $('[autofocus], .modal-body input:not([type=hidden]):not([readonly]):not([type=checkbox]):not([type=radio]), .modal-body select, .modal-body textarea', dialog);
      if (f) {
        if (opening) { modalEl.addEventListener('shown.bs.modal', function () { f.focus(); }, { once: true }); } else { f.focus(); }
      }
      if (opening) { bsModal.show(); }
      return dialog;
    },
    /** Show a spinner while data for a modal loads. */
    loading: function (title) { return AC.modal.open({ title: title || '', body: AC.ui.loading('form'), footer: '', mascot: 'thinking' }); },
    /**
     * Change the mood of the little PC in the open modal's header (see opts.mascot),
     * optionally with a short line next to the title (say; empty hides it).
     */
    mood: function (mood, say) {
      var holder = $('[data-modal-mascot]', dialog);
      if (!holder || !AC.mascot) { return; }
      if (holder.getAttribute('data-mood') !== mood) { // same mood: leave it, so its motion keeps going
        holder.classList.add('no-pop');
        holder.classList.remove('is-nodding');
        holder.setAttribute('data-mood', mood);
        holder.innerHTML = AC.mascot.badge(mood, 40);
      }
      var bubble = $('[data-modal-say]', dialog);
      if (bubble) {
        var text = say ? t(say) : '';
        if (bubble.textContent !== text) { bubble.textContent = text; bubble.hidden = !text; }
      }
    },
    /** A small nod from the little PC (e.g. on each keystroke while the user fills a form). */
    nod: function () {
      var holder = $('[data-modal-mascot]', dialog);
      if (holder) { holder.classList.add('is-nodding'); }
    },
    close: function () { if (modalEl.classList.contains('show')) { bsModal.hide(); } },
    el: function () { return dialog; },

    /**
     * A form in a modal that posts to the API.
     * opts: { title, size, body (form fields), submitLabel, submitClass, route, params,
     *         data(formObj) -> body to send (default: formObj),
     *         confirm: 'Are you sure?' (optional),
     *         onSuccess(result) (default: toast + close + AC.refresh()),
     *         onShow(el) }
     */
    form: function (opts) {
      var body = html`<form id="modal-form" novalidate>${AC.ui.errorBox()}${opts.body}<button type="submit" class="d-none"></button></form>`;
      var footer = opts.footer !== undefined ? opts.footer : html`
        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        <button type="submit" form="modal-form" class="btn ${opts.submitClass || 'btn-primary'}">${t(opts.submitLabel || 'Save')}</button>`;
      var el = AC.modal.open({ title: opts.title, size: opts.size, body: body, footer: footer, onShow: opts.onShow, onHide: opts.onHide, mascot: opts.mascot });
      var form = $('#modal-form', el);
      // The little PC follows along while the user fills the form:
      //   a field has focus -> 'typing' (pencil in hand, a nod on each keystroke)
      //   something changed and every field is valid -> 'ready' + "Ready to save"
      //   invalid submit / API error -> 'sad' until the user edits again; waiting for the server -> 'thinking'
      var dirty = false, busy = false, sad = false;
      var holder = $('[data-modal-mascot]', el);
      if (holder) {
        holder.addEventListener('animationend', function (e) {
          if (e.animationName === 'ac-mini-nod') { holder.classList.remove('is-nodding'); }
        });
      }
      function follow(focused) {
        if (busy || sad) { return; }
        if (dirty && form.checkValidity()) { AC.modal.mood('ready', 'Ready to save'); return; }
        AC.modal.mood(focused ? 'typing' : 'happy');
      }
      function edited() { dirty = true; sad = false; follow(form.contains(document.activeElement)); }
      form.addEventListener('focusin', function () { follow(true); });
      form.addEventListener('focusout', function (e) { follow(!!(e.relatedTarget && form.contains(e.relatedTarget))); });
      form.addEventListener('input', function () { edited(); if (!busy) { AC.modal.nod(); } });
      form.addEventListener('change', edited);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.reportValidity()) { sad = true; AC.modal.mood('sad'); return; }
        var go = opts.confirm ? AC.confirm(typeof opts.confirm === 'function' ? opts.confirm(form) : opts.confirm) : Promise.resolve(true);
        go.then(function (yes) {
          if (!yes) { return; }
          var btns = $$('[type=submit]', el);
          btns.forEach(function (b) { b.disabled = true; });
          $('[data-errors]', el).classList.add('d-none');
          busy = true;
          AC.modal.mood('thinking'); // waiting for the server
          var payload = opts.data ? opts.data(AC.formData(form), form) : AC.formData(form);
          AC.api.post(opts.route, payload, opts.params).then(function (res) {
            busy = false;
            if (opts.onSuccess) { opts.onSuccess(res, form); return; }
            AC.modal.close();
            AC.toast(res.message);
            AC.refresh();
          }, function (err) {
            busy = false; sad = true;
            AC.modal.mood('sad');
            showErrors(el, err.errors);
          }).then(function () { btns.forEach(function (b) { b.disabled = false; }); });
        });
      });
      return el;
    },
  };

  /** Confirmation dialog (stacked over any open modal). Resolves true/false. */
  AC.confirm = function (message, okLabel, danger) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal fade';
      wrap.tabIndex = -1;
      wrap.style.zIndex = 1070;
      wrap.innerHTML = toHtml(html`<div class="modal-dialog modal-sm modal-dialog-centered"><div class="modal-content">
        <div class="modal-body py-4 d-flex align-items-center gap-3">
          ${AC.mascot ? AC.raw('<span class="confirm-mascot">' + AC.mascot.badge(danger ? 'worried' : 'thinking', 64) + '</span>') : ''}
          <div class="flex-grow-1">${typeof message === 'string' ? t(message) : message}</div></div>
        <div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${t(okLabel || 'Continue')}</button></div></div></div>`);
      document.body.appendChild(wrap);
      var m = new bootstrap.Modal(wrap);
      var answer = false;
      wrap.querySelector('[data-ok]').addEventListener('click', function () { answer = true; m.hide(); });
      wrap.addEventListener('hidden.bs.modal', function () { m.dispose(); wrap.remove(); resolve(answer); });
      wrap.addEventListener('shown.bs.modal', function () {
        var b = document.querySelectorAll('.modal-backdrop'); if (b.length > 1) { b[b.length - 1].style.zIndex = 1065; }
        wrap.querySelector('[data-ok]').focus();
      });
      m.show();
    });
  };

  /* ---------------------------------------------------------------- router */

  var routes = {};

  /**
   * Register a page.
   *   path     'admin/assets'  (exact match; ids go in the query: #/admin/assets/show?id=3)
   *   area     'admin' | 'user' | 'public' | 'bare'  (which layout; admin/user also enforce role)
   *   title    page title (string or fn(query))
   *   ability  optional ability required (e.g. 'import.run')
   *   render   function(ctx) -> Promise|void. ctx = { query, main, setTitle(t) }.
   *            Render into ctx.main. Re-run by AC.refresh() after successful saves.
   */
  AC.route = function (path, def) { routes[path] = def; };

  function currentHash() { return location.hash.replace(/^#\/?/, ''); }
  function parseHash() {
    var h = currentHash();
    var i = h.indexOf('?');
    var path = i === -1 ? h : h.slice(0, i);
    var query = {};
    new URLSearchParams(i === -1 ? '' : h.slice(i + 1)).forEach(function (v, k) {
      if (/\[\]$/.test(k)) { k = k.slice(0, -2); (query[k] = query[k] || []).push(v); } else { query[k] = v; }
    });
    return { path: path.replace(/\/+$/, ''), query: query };
  }
  AC.query = function () { return parseHash().query; };
  AC.path = function () { return parseHash().path; };

  /** '#/path?a=1' */
  AC.link = function (path, params) {
    var q = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === null || v === undefined || v === '') { return; }
      if (Array.isArray(v)) { v.forEach(function (x) { q.append(k + '[]', x); }); } else { q.set(k, v); }
    });
    var s = q.toString();
    return '#/' + path + (s ? '?' + s : '');
  };
  /** Current page with some query params replaced. */
  AC.linkWith = function (overrides) {
    var q = Object.assign({}, AC.query(), overrides);
    return AC.link(AC.path(), q);
  };
  AC.go = function (path, params) {
    var target = AC.link(path, params);
    if (location.hash === target) { AC.refresh(); } else { location.hash = target; }
  };

  function homeFor(user) { return !user ? 'assets' : (user.is_admin ? 'admin/dashboard' : 'user/home'); }
  AC.home = function () { return homeFor(state.user); };
  AC.can = function (ability) { return !!(state.user && state.user.abilities.indexOf(ability) !== -1); };

  var renderSeq = 0;

  function render(keepScroll) {
    var loc = parseHash();
    var path = loc.path || homeFor(state.user);
    var def = routes[path];
    var u = state.user;

    if (!def) { return showError(404, t('Page not found.')); }
    if (u && u.must_change_password && path !== 'account/password') { return AC.go('account/password'); }
    if ((def.area === 'admin' || def.area === 'user' || def.auth) && !u) { return AC.go('login', { next: currentHash() }); }
    if (def.area === 'admin' && !u.is_admin) { return AC.go(homeFor(u)); }
    if (def.area === 'user' && u.is_admin) { return AC.go(homeFor(u)); }
    if (def.ability && !AC.can(def.ability)) { return showError(403, t('You do not have permission to open this page.')); }

    var area = def.area === 'auto' ? (u ? (u.is_admin ? 'admin' : 'user') : 'public') : def.area;
    layout(area, path);
    setTimeout(clearStrayBackdrops, 450);
    var main = document.getElementById('main');
    var y = window.scrollY;
    var seq = ++renderSeq;
    // The error page's full-area style (.main--error) stays until other content replaces it,
    // so "Try again" (a keep-scroll refresh) does not make the page jump while it loads.
    if (!keepScroll) { main.classList.remove('main--error'); main.innerHTML = toHtml(AC.ui.loading(def.skeleton || skeletonFor(path))); }
    var ctx = {
      query: loc.query,
      path: path,
      main: main,
      setTitle: function (title) { document.title = (title ? t(String(title)) + ' · ' : '') + (state.meta.app_name || 'Asset Ctrl'); },
      /** true if the user navigated away while this page was loading */
      stale: function () { return seq !== renderSeq; },
    };
    ctx.setTitle(typeof def.title === 'function' ? def.title(loc.query) : def.title);
    state.page = { path: path, def: def };
    Promise.resolve().then(function () { return def.render(ctx); }).then(function () {
      if (seq !== renderSeq) { return; }
      main.classList.remove('main--error');
      initWidgets(main);
      if (keepScroll) { window.scrollTo(0, y); } else { window.scrollTo(0, 0); }
    }, function (err) {
      if (seq !== renderSeq) { return; }
      if (err && (err.code === 'auth' || err.code === 'password_change')) { return; }
      console.error(err);
      paintError(main, err && err.status ? err.status : 500, err && err.message ? err.message : t('Something went wrong.'));
    });
    refreshNavCounts();
  }

  /** Which skeleton fits a page: dashboards, detail pages (".../show", audit round) or lists. */
  function skeletonFor(path) {
    if (/(^|\/)(dashboard|home)$/.test(path)) { return 'dashboard'; }
    if (/\/(show|round|preview)$/.test(path)) { return 'detail'; }
    return 'list';
  }

  /** Re-render the current page in place (keeps scroll), e.g. after a save. */
  AC.refresh = function () { render(true); };

  /** Error page: the little PC (AC.mascot, looping illustration) next to the message. */
  /**
   * "Try again" state of the error page that is showing. Every failed retry adds smoke to the
   * little PC; after MAX_RETRIES failures the button goes away and the page says to call ICS.
   */
  var MAX_RETRIES = 3;
  var retry = { startedAt: 0, failed: 0, scene: null, pending: false };

  function errorView(status, message) {
    return html`<section class="error-page">
      <div class="error-page__art"><div data-error-scene></div>
        <div class="error-page__speech" data-error-speech role="status" aria-live="polite" hidden></div></div>
      <div class="error-page__body">${errorBody(status, message)}</div>
    </section>`;
  }
  function errorBody(status, message) {
    status = status || 500;
    var title = status === 404 ? 'Oops! We could not find this page.'
      : status === 403 ? 'Oops! This page is not open to you.'
      : 'Oops! Something went a bit wrong.';
    var retryable = status >= 500 || status === 0;
    var canRetry = retryable && retry.failed < MAX_RETRIES;
    var hint = !retryable ? ''
      : canRetry ? t('Try again. If it still does not work, call the ICS team.')
      : t('Still not working after {n} tries. Please call the ICS team.', { n: retry.failed });
    return html`
        <div class="error-page__code font-monospace">ERROR ${status}</div>
        <h1 class="error-page__title">${t(title)}</h1>
        <p class="error-page__msg">${message}</p>
        ${hint ? html`<p class="error-page__hint">${hint}</p>` : ''}
        <div class="page-actions error-actions d-flex flex-wrap gap-2 mt-2">
          ${canRetry ? html`<button type="button" class="btn btn-primary" data-action="error-retry"><i class="bi bi-arrow-clockwise me-1"></i>Try again</button>`
            : retryable ? html`<button type="button" class="btn btn-secondary" disabled title="${t('Locked: please call the ICS team.')}"><i class="bi bi-lock-fill me-1"></i>Try again</button>` : ''}
          <a class="btn ${canRetry ? 'btn-outline-secondary' : 'btn-primary'}" href="${AC.link(AC.home())}">Back to start</a>
        </div>`;
  }
  /**
   * Put the error page into main and start its illustration. If the error page is already
   * showing (e.g. "Try again" failed again), only the text is replaced: the animation keeps running.
   */
  function paintError(main, status, message) {
    main.classList.add('main--error'); // fill the content area edge to edge (theme.css)
    var body = $('.error-page__body', main);
    if (body && $('[data-error-scene] svg', main)) {
      if (retry.pending) { retry.pending = false; retry.failed++; }
      // Keep the "Trying again…" spinner up for a moment so a fast failure still reads as a retry.
      var wait = Math.max(0, retry.startedAt + 600 - Date.now());
      window.setTimeout(function () {
        if (!body.isConnected) { return; }
        body.innerHTML = toHtml(errorBody(status, message));
        if (retry.scene) { retry.scene.setSmoke(retry.failed); }
        speak(main, retry.failed);
      }, wait);
      return;
    }
    // A fresh error page: start counting retries again.
    retry.failed = 0;
    retry.pending = false;
    main.innerHTML = toHtml(errorView(status, message));
    retry.scene = AC.mascot ? AC.mascot.errorScene($('[data-error-scene]', main)) : null;
  }
  /** What the little PC says after each failed "Try again" (the last one is said when the button locks). */
  var SPEECH = [
    '',
    'Ouch… that stings a little. Try once more?',
    'My head is spinning… one last try, OK?',
    'I can’t do it anymore… please call the ICS doctor for me!',
  ];
  function speak(main, level) {
    var bubble = $('[data-error-speech]', main);
    if (!bubble) { return; }
    var text = SPEECH[Math.min(level, SPEECH.length - 1)];
    bubble.hidden = !text;
    bubble.textContent = text ? t(text) : '';
    bubble.classList.remove('is-new');
    void bubble.offsetWidth; // restart the pop-in animation
    bubble.classList.add('is-new');
  }
  function showError(status, message) {
    var u = state.user;
    layout(u ? (u.is_admin ? 'admin' : 'user') : 'public', '');
    paintError(document.getElementById('main'), status, message);
  }

  /* ---------------------------------------------------------------- layout */

  var NAV_ADMIN = [
    ['admin/dashboard', 'bi-grid-1x2', 'Dashboard'],
    ['admin/assets', 'bi-pc-display', 'Assets', 'assets.view'],
    ['admin/tickets', 'bi-tools', 'Repair tickets', 'tickets.manage', 'tickets'],
    ['admin/receiving', 'bi-upc-scan', 'Setting Room', 'tickets.manage'],
    ['admin/history', 'bi-clock-history', 'Change history', 'history.view_all'],
    ['-', 'Data'],
    ['admin/audit', 'bi-clipboard-check', 'Stock audit', 'audit.run'],
    ['admin/import', 'bi-box-arrow-in-down', 'Import', 'import.run'],
    ['-', 'Settings'],
    ['admin/masters', 'bi-list-check', 'Master data', 'users.manage'], // Work Centers is its first tab
    ['admin/users', 'bi-people', 'Users', 'users.manage'],
  ];
  var NAV_USER = [
    ['user/home', 'Home'],
    ['user/assets', 'My assets', 'assets.view'],
    ['user/tickets', 'Repair tickets', 'tickets.create', 'tickets'],
  ];

  // Pages that live under another menu item (Work Center is a tab of Master data).
  var NAV_ALIAS = { 'admin/work-centers': 'admin/masters' };
  function activeFor(navPath, path) {
    path = NAV_ALIAS[path] || path;
    return path === navPath || path.indexOf(navPath + '/') === 0;
  }

  function layout(area, path) {
    var app = document.getElementById('app');
    if (state.area !== area) {
      state.area = area;
      var u = state.user, appName = state.meta.app_name;
      if (area === 'admin') {
        app.innerHTML = toHtml(html`<div class="d-flex min-vh-100">
  <aside class="app-sidebar offcanvas-lg offcanvas-end" tabindex="-1" id="sidebar" aria-label="Main menu">
    <div class="sidebar-head d-flex align-items-center justify-content-between">
      <a class="brand" href="${AC.link('admin/dashboard')}" title="${appName}"><span class="brand-mark"></span><span class="nav-text">${appName}<span class="badge rounded-pill bg-primary-subtle text-primary-emphasis fw-semibold ms-1" style="font-size:.6rem">ADMIN</span></span></a>
      <button type="button" class="btn-close d-lg-none" data-bs-dismiss="offcanvas" data-bs-target="#sidebar" aria-label="Close"></button>
    </div>
    <div class="offcanvas-body d-flex flex-column p-2 flex-grow-1">
      <nav class="nav flex-column side-nav w-100" id="side-nav"><span class="nav-indicator" aria-hidden="true"></span>${sideNav()}</nav>
      <div class="mt-auto pt-2">
        <button type="button" class="nav-link side-collapse d-none d-lg-flex w-100" data-sidebar-toggle data-tip="${t('Expand menu')}" aria-label="${t('Collapse or expand the menu')}">
          <i class="bi bi-chevron-double-left"></i><span class="nav-text">${t('Collapse menu')}</span><kbd class="nav-text ms-auto">[</kbd></button>
        <div class="dropdown dropup border-top pt-2 mt-1">
          <button class="btn w-100 d-flex align-items-center gap-2 text-start border-0 user-btn" data-bs-toggle="dropdown" data-bs-popper-config='{"strategy":"fixed"}' aria-expanded="false" aria-label="${u.name}">
            <span class="avatar">${AC.fmt.initials(u.name)}</span>
            <span class="flex-grow-1 lh-sm overflow-hidden nav-text"><span class="d-block fw-semibold text-truncate">${u.name}</span><span class="d-block small text-secondary">${u.emp_code}</span></span>
            <i class="bi bi-three-dots-vertical text-secondary nav-text"></i>
          </button>
          <ul class="dropdown-menu shadow-sm user-menu">
            <li><a class="dropdown-item" href="#" data-action="edit-profile"><i class="bi bi-person-lines-fill me-2"></i>Contact details</a></li>
            <li><a class="dropdown-item" href="#" data-action="change-password"><i class="bi bi-key me-2"></i>Change password</a></li>
            <li><a class="dropdown-item" href="${AC.link('dashboard')}"><i class="bi bi-eye me-2"></i>Public overview</a></li>
            <li>${langMenuItem()}</li>
            <li>${themeMenuItem()}</li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-danger" href="#" data-action="logout"><i class="bi bi-box-arrow-right me-2"></i>Sign out</a></li>
          </ul>
        </div>
      </div>
    </div>
  </aside>
  <div class="app-main d-flex flex-column">
    <header class="mobile-bar d-lg-none d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-body sticky-top">
      <a class="brand" href="${AC.link('admin/dashboard')}"><span class="brand-mark"></span>${appName}</a>
      <button class="btn burger ms-auto" data-bs-toggle="offcanvas" data-bs-target="#sidebar" aria-controls="sidebar" aria-label="${t('Open menu')}"><i class="bi bi-list"></i></button>
    </header>
    <main class="page-wrap p-4" id="main"></main>
  </div>
</div>`);
      } else if (area === 'user') {
        var wcLabel = u.work_centers.length ? u.work_centers.map(function (w) { return w.code; }).join(', ') : t('No Work Center assigned');
        app.innerHTML = toHtml(html`<nav class="navbar navbar-expand-lg user-nav py-2 py-lg-0 sticky-top">
  <div class="container-fluid px-3 px-lg-4">
    <a class="brand me-4" href="${AC.link('user/home')}"><span class="brand-mark"></span>${appName}</a>
    <button class="btn burger ms-auto d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#userNav" aria-controls="userNav" aria-label="${t('Open menu')}"><i class="bi bi-list"></i></button>
    <div class="offcanvas offcanvas-end side-panel" tabindex="-1" id="userNav" aria-label="${t('Menu')}">
      <div class="offcanvas-header d-lg-none">
        <span class="brand"><span class="brand-mark"></span>${appName}</span>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body align-items-lg-center">
        <div class="d-lg-none panel-user">
          <span class="avatar">${AC.fmt.initials(u.name)}</span>
          <span class="lh-sm overflow-hidden"><span class="d-block fw-semibold text-truncate">${u.name}</span><span class="d-block small text-secondary">Work Centers: ${wcLabel}</span></span>
        </div>
        <ul class="navbar-nav me-auto" id="top-nav">${topNav()}</ul>
        <div class="d-flex flex-column flex-lg-row align-items-stretch align-items-lg-center gap-2 py-2 py-lg-0">
          ${AC.can('tickets.create') ? html`<button class="btn btn-primary btn-sm" data-action="ticket-create"><i class="bi bi-plus-lg me-1"></i>Report a problem</button>` : ''}
          <ul class="list-unstyled panel-links d-lg-none mb-0">
            <li><a class="dropdown-item" href="#" data-action="edit-profile"><i class="bi bi-person-lines-fill me-2"></i>Contact details</a></li>
            <li><a class="dropdown-item" href="#" data-action="change-password"><i class="bi bi-key me-2"></i>Change password</a></li>
            <li>${langMenuItem()}</li>
            <li>${themeMenuItem()}</li>
            <li><hr class="dropdown-divider"></li>
            <li><a class="dropdown-item text-danger" href="#" data-action="logout"><i class="bi bi-box-arrow-right me-2"></i>Sign out</a></li>
          </ul>
          <div class="dropdown d-none d-lg-block">
            <button class="btn btn-sm d-flex align-items-center gap-2 border-0" data-bs-toggle="dropdown" aria-expanded="false">
              <span class="avatar">${AC.fmt.initials(u.name)}</span>
              <span class="text-start lh-sm d-none d-md-block"><span class="d-block fw-semibold">${u.name}</span><span class="d-block small text-secondary text-truncate" style="max-width:220px">${wcLabel}</span></span>
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm">
              <li><span class="dropdown-item-text small text-secondary">Work Centers: ${wcLabel}</span></li>
              <li><a class="dropdown-item" href="#" data-action="edit-profile"><i class="bi bi-person-lines-fill me-2"></i>Contact details</a></li>
              <li><a class="dropdown-item" href="#" data-action="change-password"><i class="bi bi-key me-2"></i>Change password</a></li>
              <li>${langMenuItem()}</li>
              <li>${themeMenuItem()}</li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item text-danger" href="#" data-action="logout"><i class="bi bi-box-arrow-right me-2"></i>Sign out</a></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
</nav>
<main class="container-fluid px-lg-4 page-wrap py-4" id="main"></main>`);
      } else if (area === 'public') {
        app.innerHTML = toHtml(html`<nav class="navbar navbar-expand-lg user-nav py-2"><div class="container-fluid px-3 px-lg-4">
    <a class="brand me-4" href="${AC.link('assets')}"><span class="brand-mark"></span>${appName}</a>
    <div class="offcanvas offcanvas-end side-panel" tabindex="-1" id="publicNav" aria-label="${t('Menu')}">
      <div class="offcanvas-header d-lg-none">
        <span class="brand"><span class="brand-mark"></span>${appName}</span>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body align-items-lg-center">
        <ul class="navbar-nav me-auto" id="top-nav">${publicNav()}</ul>
        <div class="d-flex align-items-center gap-2 panel-tools">${AC.themeButton()}${AC.langSwitch()}</div>
      </div>
    </div>
    <div class="d-flex align-items-center gap-2 ms-auto ms-lg-2">
      ${state.user ? html`<a class="btn btn-outline-secondary btn-sm" href="${AC.link(AC.home())}">Back to work</a>`
        : html`<button type="button" class="btn btn-primary btn-sm" data-action="login">Sign in</button>`}
      <button class="btn burger d-lg-none" type="button" data-bs-toggle="offcanvas" data-bs-target="#publicNav" aria-controls="publicNav" aria-label="${t('Open menu')}"><i class="bi bi-list"></i></button>
    </div>
  </div></nav>
<main class="container-fluid px-lg-4 page-wrap py-4" id="main"></main>`);
      } else {
        app.innerHTML = '<main id="main"></main>';
      }
    }
    // Active menu item
    $$('[data-nav]', app).forEach(function (a) {
      a.classList.toggle('active', activeFor(a.getAttribute('data-nav'), path));
    });
    moveNavIndicator();
    // Close the slide-in menu (admin sidebar / user / public panel) after navigating.
    $$('.offcanvas, .offcanvas-lg', app).forEach(function (el) { var oc = bootstrap.Offcanvas.getInstance(el); if (oc) { oc.hide(); } });
    if ($('#sidebar')) { sidebarTips(); }
  }

  /** EN | TH buttons (login page, public page). */
  AC.langSwitch = function () {
    return html`<div class="btn-group btn-group-sm lang-switch" role="group" aria-label="Language">
      <button type="button" class="btn ${LANG === 'en' ? 'btn-secondary' : 'btn-outline-secondary'}" data-action="set-lang" data-lang="en">EN</button>
      <button type="button" class="btn ${LANG === 'th' ? 'btn-secondary' : 'btn-outline-secondary'}" data-action="set-lang" data-lang="th">ไทย</button></div>`;
  };
  /** Sun/moon button that switches light and dark mode (public page, login). */
  AC.themeButton = function () {
    var dark = AC.theme() === 'dark';
    var label = dark ? t('Light mode') : t('Dark mode');
    return html`<button type="button" class="btn btn-sm btn-outline-secondary theme-btn" data-action="toggle-theme" title="${label}" aria-label="${label}"><i class="bi ${dark ? 'bi-sun' : 'bi-moon-stars'}" aria-hidden="true"></i></button>`;
  };
  /** Menu entry that switches light and dark mode. */
  function themeMenuItem() {
    return AC.theme() === 'dark'
      ? html`<a class="dropdown-item" href="#" data-action="toggle-theme"><i class="bi bi-sun me-2"></i>Light mode</a>`
      : html`<a class="dropdown-item" href="#" data-action="toggle-theme"><i class="bi bi-moon-stars me-2"></i>Dark mode</a>`;
  }

  /** Menu entry that switches to the other language. */
  function langMenuItem() {
    return LANG === 'th'
      ? html`<a class="dropdown-item" href="#" data-action="set-lang" data-lang="en"><i class="bi bi-translate me-2"></i>English</a>`
      : html`<a class="dropdown-item" href="#" data-action="set-lang" data-lang="th"><i class="bi bi-translate me-2"></i>ภาษาไทย</a>`;
  }

  /**
   * The highlight behind the active sidebar item is one element that slides to the new item
   * (transform + height transition) instead of jumping. First placement is instant.
   */
  function moveNavIndicator() {
    var nav = $('#side-nav');
    if (!nav) { return; }
    var ind = $('.nav-indicator', nav);
    var active = $('.nav-link.active', nav);
    if (!active) { ind.style.opacity = '0'; return; }
    var first = !ind.hasAttribute('data-placed');
    if (first) { ind.classList.add('no-anim'); }
    ind.style.transform = 'translateY(' + active.offsetTop + 'px)';
    ind.style.height = active.offsetHeight + 'px';
    ind.style.opacity = '1';
    if (first) {
      ind.setAttribute('data-placed', '1');
      void ind.offsetWidth; // apply the instant placement before re-enabling the animation
      ind.classList.remove('no-anim');
    }
  }
  window.addEventListener('resize', moveNavIndicator);

  function sideNav() {
    return NAV_ADMIN.map(function (n) {
      if (n[0] === '-') {
        var section = NAV_ADMIN.slice(NAV_ADMIN.indexOf(n) + 1);
        var next = [];
        for (var i = 0; i < section.length && section[i][0] !== '-'; i++) { next.push(section[i]); }
        return next.some(function (x) { return !x[3] || AC.can(x[3]); }) ? html`<div class="side-label">${t(n[1])}</div>` : '';
      }
      if (n[3] && !AC.can(n[3])) { return ''; }
      return html`<a class="nav-link" data-nav="${n[0]}" href="${AC.link(n[0])}" data-tip="${t(n[2])}"><i class="bi ${n[1]}"></i><span class="nav-text">${t(n[2])}</span>${n[4] ? html`<span class="nav-count" data-nav-count="${n[4]}"></span>` : ''}</a>`;
    });
  }
  /** Public top menu: the read-only asset list and the totals overview. */
  function publicNav() {
    return [['assets', 'IT assets', 'bi-pc-display'], ['dashboard', 'Overview', 'bi-bar-chart']].map(function (n) {
      return html`<li class="nav-item"><a class="nav-link px-lg-3" data-nav="${n[0]}" href="${AC.link(n[0])}"><i class="bi ${n[2]} me-2 d-lg-none"></i>${t(n[1])}</a></li>`;
    });
  }

  function topNav() {
    return NAV_USER.map(function (n) {
      if (n[2] && !AC.can(n[2])) { return ''; }
      return html`<li class="nav-item"><a class="nav-link px-lg-3 py-lg-3" data-nav="${n[0]}" href="${AC.link(n[0])}">${t(n[1])}${n[3] ? html` <span class="badge rounded-pill text-bg-warning" data-nav-count="${n[3]}"></span>` : ''}</a></li>`;
    });
  }

  function refreshNavCounts() {
    if (!state.user || !$('[data-nav-count]')) { return; }
    AC.api.get('nav-counts').then(function (c) {
      $$('[data-nav-count]').forEach(function (el) {
        var n = c[el.getAttribute('data-nav-count')] || 0;
        el.textContent = n ? AC.fmt.number(n) : '';
        el.classList.toggle('hot', !!n);
      });
    }, function () { /* badge only */ });
  }

  /** Called after sign in / out: rebuild layout for the new user. */
  AC.setUser = function (user, csrf) {
    var signingIn = !state.user && user;
    state.user = user;
    if (csrf) { state.csrf = csrf; }
    state.area = null;
    if (signingIn) { greetOnce(true); }
  };

  /** The little PC says hi in the corner: after signing in, or once per browser session when the app opens signed in. */
  function greetOnce(force) {
    var u = state.user;
    if (!u || !AC.mascot) { return; }
    try {
      if (!force && sessionStorage.getItem('ac_greeted') === String(u.id)) { return; }
      sessionStorage.setItem('ac_greeted', String(u.id));
    } catch (e) { /* storage blocked: greet anyway */ }
    window.setTimeout(function () { AC.mascot.greet(u.first_name || u.name || ''); }, 600);
  }


  /* --------------------------------------------------------- click actions */

  var actions = {};
  /** AC.on('ticket-create', function (el, event) {...}) handles clicks on [data-action="ticket-create"]. */
  AC.on = function (name, fn) { actions[name] = fn; };
  AC.on('error-retry', function (el) {
    // Show that it is retrying; the button comes back (via paintError) if it fails again.
    el.disabled = true;
    retry.startedAt = Date.now();
    retry.pending = true;
    el.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>' + AC.esc(t('Trying again…'));
    AC.refresh();
  });
  AC.on('set-lang', function (el) { AC.setLang(el.getAttribute('data-lang')); });
  // "Clear filters" in the small-screen filter panel: reset its controls and show the results.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter-clear]');
    if (!b) { return; }
    $$('select, input', b.closest('.filter-panel')).forEach(function (c) {
      if (c.type === 'checkbox' || c.type === 'radio') { c.checked = false; } else if (c.tagName === 'SELECT') { c.selectedIndex = 0; } else if (c.type !== 'hidden') { c.value = ''; }
    });
    b.form.requestSubmit();
  });
  AC.on('toggle-theme', function () { AC.setTheme(AC.theme() === 'dark' ? 'light' : 'dark'); });

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (t && actions[t.getAttribute('data-action')]) {
      e.preventDefault();
      actions[t.getAttribute('data-action')](t, e);
    }
  });

  // Filter forms: <form data-filter> navigates to the same page with the form values as the query.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.hasAttribute('data-filter')) { return; }
    e.preventDefault();
    var openPanel = $('.filter-panel.show', form);
    if (openPanel) { bootstrap.Offcanvas.getOrCreateInstance(openPanel).hide(); }
    var q = AC.formData(form);
    Object.keys(q).forEach(function (k) { if (q[k] === '0' && form.querySelector('[name="' + k + '"][type=checkbox]')) { delete q[k]; } });
    var keep = (form.getAttribute('data-keep') || '').split(/\s+/).filter(Boolean);
    var cur = AC.query();
    keep.forEach(function (k) { if (cur[k] !== undefined && q[k] === undefined) { q[k] = cur[k]; } });
    AC.go(AC.path(), q);
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.hasAttribute && el.hasAttribute('data-autosubmit') && el.form) {
      if (SMALL.matches && el.closest('.filter-panel')) { return; }
      el.form.requestSubmit();
    }
  });

  // Sidebar collapse (remembered per browser). Shortcut: "["
  function toggleSidebar() {
    var collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem('ac_sidebar', collapsed ? 'collapsed' : 'open'); } catch (err) { /* ignore */ }
    sidebarTips();
  }

  /** Collapsed sidebar: show each item's name as a tooltip on hover (desktop only). */
  function sidebarTips() {
    var collapsed = document.documentElement.classList.contains('sidebar-collapsed') && window.innerWidth >= 992;
    $$('#sidebar [data-tip]').forEach(function (el) {
      var tip = bootstrap.Tooltip.getOrCreateInstance(el, { title: el.getAttribute('data-tip'), placement: 'right', trigger: 'hover', container: 'body' });
      tip.hide();
      if (collapsed) { tip.enable(); } else { tip.disable(); }
    });
  }
  AC.sidebarTips = sidebarTips;
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-sidebar-toggle]')) { e.preventDefault(); toggleSidebar(); }
  });
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.body.classList.contains('modal-open');
    if (typing) { return; }
    if (e.key === '[' && $('[data-sidebar-toggle]')) { toggleSidebar(); }
    if (e.key === '/') { var s = $('[data-search]'); if (s) { e.preventDefault(); s.focus(); s.select(); } }
  });

  /* --------------------------------------------------------------- widgets */

  /**
   * Behaviour attached after every render / modal:
   *   [data-select-table="#bar"]   row checkboxes (name="ids[]") + sticky bulk bar with [data-count]
   *   [data-filter-select="#sel"]  text box filtering a multi-select's options
   *   [data-picked-for="#sel"]     chips summarising a multi-select
   *   input[data-asset-lookup]     asset-number autocomplete (needs list="<datalist id>", optional data-info="#el")
   *   [data-bs-toggle=tooltip]
   */
  /* ------------------------------------------------------- small screens */

  var SMALL = window.matchMedia('(max-width: 991.98px)');

  /**
   * Filter bars (form.filter-bar[data-filter]) on small screens: the search box stays in the page and
   * every other control moves into a panel that slides in from the right ("Filters (n)" button).
   * The panel is .offcanvas-lg, so from 992px up the controls sit inline exactly as before.
   * Inside the open panel, changes are not sent one by one; "Show results" applies them together.
   */
  var filterSeq = 0;
  function enhanceFilters(root) {
    $$('form.filter-bar[data-filter]:not([data-filter-panel])', root).forEach(function (form) {
      form.setAttribute('data-filter-panel', '');
      var search = null;
      var moved = [];
      Array.prototype.slice.call(form.children).forEach(function (el) {
        if (!search && el.querySelector && (el.matches('input[type=search],input[name=q]') || el.querySelector('input[type=search],input[name=q]'))) { search = el; return; }
        if (el.matches('select, input:not([type=hidden]), .input-group, .form-check') || el.querySelector('select, input:not([type=hidden]):not([type=search])')) { moved.push(el); }
      });
      if (!moved.length) { return; }
      var id = 'filter-panel-' + (++filterSeq);
      var active = moved.reduce(function (n, el) {
        return n + $$('select, input', el).concat(el.matches('select, input') ? [el] : []).filter(function (c) {
          if (c.type === 'checkbox' || c.type === 'radio') { return c.checked; }
          if (c.tagName === 'SELECT') { return c.selectedIndex > 0; }
          return c.type !== 'hidden' && c.value !== '';
        }).length;
      }, 0);
      var panel = document.createElement('div');
      panel.className = 'filter-panel offcanvas-lg offcanvas-end';
      panel.id = id;
      panel.tabIndex = -1;
      panel.setAttribute('aria-label', t('Filters'));
      panel.innerHTML = toHtml(html`<div class="offcanvas-header d-lg-none"><h2 class="h5 mb-0"><i class="bi bi-funnel me-2"></i>Filters</h2>
          <button type="button" class="btn-close" data-bs-dismiss="offcanvas" data-bs-target="#${id}" aria-label="Close"></button></div>
        <div class="offcanvas-body filter-panel-body"></div>
        <div class="filter-panel-foot d-lg-none">
          <button type="button" class="btn btn-outline-secondary" data-filter-clear>Clear filters</button>
          <button type="submit" class="btn btn-primary flex-grow-1">Show results</button></div>`);
      var body = $('.filter-panel-body', panel);
      var anchor = moved[0];
      form.insertBefore(panel, anchor);
      moved.forEach(function (el) { body.appendChild(el); });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline-secondary btn-sm filter-toggle d-lg-none' + (active ? ' has-active' : '');
      btn.setAttribute('data-bs-toggle', 'offcanvas');
      btn.setAttribute('data-bs-target', '#' + id);
      btn.setAttribute('aria-controls', id);
      btn.innerHTML = toHtml(html`<i class="bi bi-funnel"></i><span>Filters</span>${active ? html`<span class="badge rounded-pill text-bg-primary">${active}</span>` : ''}`);
      if (search) { search.after(btn); } else { form.insertBefore(btn, panel); }
      form.classList.add('has-filter-panel');
    });
  }

  /**
   * Data tables on phones: every row becomes a card, each cell labelled with its column header
   * (data-label, from the <thead>). Not for .asset-table (own card layout) or .table-fit (small
   * summary tables that already fit). Tables without a header just wrap their cells.
   */
  function enhanceTables(root) {
    $$('table.table:not(.asset-table):not(.ticket-table):not(.table-fit):not([data-stacked])', root).forEach(function (table) {
      table.setAttribute('data-stacked', '');
      var head = $('thead tr', table);
      if (!head) { table.classList.add('table-wrap-sm'); return; }
      var labels = [];
      $$('th', head).forEach(function (th) {
        var label = th.querySelector('input') ? '' : th.textContent.replace(/\s+/g, ' ').trim();
        for (var i = 0; i < (th.colSpan || 1); i++) { labels.push(label); }
      });
      table.classList.add('table-stack');
      $$('tbody > tr', table).forEach(function (tr) {
        var col = 0, first = true;
        Array.prototype.forEach.call(tr.children, function (td) {
          if (td.colSpan > 1) { td.classList.add('stack-full'); col += td.colSpan; return; }
          var label = labels[col] || '';
          if (/^(#|No\.?|ลำดับ)$/i.test(label)) { td.classList.add('stack-hide'); col += 1; return; }
          if (td.classList.contains('col-check') || td.querySelector(':scope > input[type=checkbox]')) { td.classList.add('stack-check'); }
          else if (first) { td.classList.add('stack-primary'); first = false; }
          else if (label) { td.setAttribute('data-label', label); }
          col += 1;
        });
      });
    });
  }

  function enhance(root) {
    if (!root) { return; }
    enhanceFilters(root);
    enhanceTables(root);
  }
  AC.enhance = enhance;
  // Pages also redraw parts of themselves (live lists, tabs inside a page): enhance those too.
  var enhanceQueued = false;
  new MutationObserver(function () {
    if (enhanceQueued) { return; }
    enhanceQueued = true;
    requestAnimationFrame(function () { enhanceQueued = false; enhance(document.getElementById('main')); });
  }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });

  /** A slide-in panel that was open when the page was redrawn leaves its backdrop and scroll lock behind. */
  function clearStrayBackdrops() {
    if ($('.offcanvas.show, .offcanvas-lg.show, .modal.show')) { return; }
    $$('.offcanvas-backdrop').forEach(function (b) { b.parentNode.removeChild(b); });
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  }

  function initWidgets(root) {
    enhance(root);
    $$('[data-bs-toggle="tooltip"]', root).forEach(function (el) { bootstrap.Tooltip.getOrCreateInstance(el); });

    $$('[data-select-table]', root).forEach(function (table) {
      var bar = $(table.getAttribute('data-select-table'));
      var boxes = $$('input[name="ids[]"]', table);
      var all = $('[data-check-all]', table);
      var counter = bar ? $('[data-count]', bar) : null;
      var allLink = bar ? $('[data-select-all-results]', bar) : null;
      var last = null;
      table.selectAll = false;
      var refresh = function () {
        var n = boxes.filter(function (b) { return b.checked; }).length;
        boxes.forEach(function (b) { b.closest('tr').classList.toggle('table-active', b.checked); });
        if (counter) { counter.textContent = table.selectAll ? t('{n} (all matching the filter)', { n: counter.getAttribute('data-total') }) : n; }
        if (bar) { bar.classList.toggle('d-none', n === 0 && !table.selectAll); }
        if (all) { all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; }
        if (allLink) { allLink.classList.toggle('d-none', !(n === boxes.length && n > 0 && !table.selectAll)); }
      };
      boxes.forEach(function (b, i) {
        b.addEventListener('click', function (e) {
          if (e.shiftKey && last !== null) {
            for (var k = Math.min(last, i); k <= Math.max(last, i); k++) { boxes[k].checked = b.checked; }
          }
          last = i; table.selectAll = false; refresh();
        });
      });
      if (all) { all.addEventListener('change', function () { boxes.forEach(function (b) { b.checked = all.checked; }); table.selectAll = false; refresh(); }); }
      if (allLink) { allLink.addEventListener('click', function (e) { e.preventDefault(); table.selectAll = true; refresh(); }); }
      var clear = bar ? $('[data-clear-selection]', bar) : null;
      if (clear) { clear.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = false; }); table.selectAll = false; refresh(); }); }
      /** { ids: [...], select_all: bool } */
      table.selection = function () {
        return { ids: boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; }), select_all: !!table.selectAll };
      };
      refresh();
    });

    $$('[data-filter-select]', root).forEach(function (input) {
      var sel = $(input.getAttribute('data-filter-select'), root);
      input.addEventListener('input', function () {
        var q = input.value.trim().toLowerCase();
        Array.prototype.forEach.call(sel.options, function (o) {
          o.hidden = q !== '' && o.text.toLowerCase().indexOf(q) === -1 && !o.selected;
        });
      });
    });
    $$('[data-picked-for]', root).forEach(function (box) {
      var sel = $(box.getAttribute('data-picked-for'), root);
      var draw = function () {
        box.innerHTML = '';
        var picked = Array.prototype.filter.call(sel.options, function (o) { return o.selected; });
        if (!picked.length) { var none = document.createElement('span'); none.className = 'none'; none.textContent = t('Nothing selected'); box.appendChild(none); return; }
        picked.forEach(function (o) { var s = document.createElement('span'); s.textContent = o.text.replace(/\s+\([^)]*\)\s*$/, ''); box.appendChild(s); });
      };
      sel.addEventListener('change', draw);
      draw();
    });

    $$('input[data-asset-lookup]', root).forEach(function (input) {
      var list = document.getElementById(input.getAttribute('list'));
      var info = input.getAttribute('data-info') ? $(input.getAttribute('data-info'), root) : null;
      var cache = {}, timer = null;
      var describe = function () {
        var it = cache[input.value.trim().toUpperCase()];
        if (info) { info.textContent = it ? it.description + ' — ' + (it.work_center ? it.work_center + ' ' + (it.work_center_name || '') : '-') + ' / ' + (it.area || '-') : ''; }
        var loc = input.form && input.form.querySelector('[name="location_note"]');
        if (it && loc && !loc.value) { loc.value = it.area; }
      };
      input.addEventListener('input', function () {
        clearTimeout(timer);
        var q = input.value.trim();
        if (q.length < 2) { return; }
        timer = setTimeout(function () {
          AC.api.get('lookup/assets', { q: q }).then(function (items) {
            list.innerHTML = '';
            items.forEach(function (it) {
              var o = document.createElement('option');
              o.value = it.asset_no;
              o.label = it.description + ' · ' + (it.work_center || '') + ' · ' + (it.area || '');
              list.appendChild(o);
              cache[it.asset_no] = it;
            });
            describe();
          }, function () { /* ignore */ });
        }, 200);
      });
      input.addEventListener('change', describe);
    });
  }
  AC.initWidgets = initWidgets;

  /* ------------------------------------------------------------------ boot */

  AC.boot = function () {
    modalSetup();
    AC.api.get('session').then(function (s) {
      state.user = s.user; state.csrf = s.csrf; state.meta = s.meta;
      window.addEventListener('hashchange', function () { render(false); });
      render(false);
      greetOnce(false);
    }, function (err) {
      document.getElementById('app').innerHTML = toHtml(html`<div class="container py-5"><div class="alert alert-danger">${err.message}</div></div>`);
    });
  };
})();
