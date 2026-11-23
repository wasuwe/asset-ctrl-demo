/* Asset Ctrl — modal workflow and small enhancements (Bootstrap 5). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var modalEl = document.getElementById('app-modal');
  var dialog = document.getElementById('app-modal-dialog');
  var modal = modalEl ? bootstrap.Modal.getOrCreateInstance(modalEl) : null;
  var AJAX = { 'X-Requested-With': 'XMLHttpRequest' };

  /* ---------- toasts ---------- */
  function toast(message, type) {
    if (!message) { return; }
    var box = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast align-items-center border-0 text-bg-' + (type === 'error' ? 'danger' : 'dark');
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    el.querySelector('.toast-body').textContent = message;
    box.appendChild(el);
    var t = new bootstrap.Toast(el, { delay: type === 'error' ? 7000 : 4000 });
    el.addEventListener('hidden.bs.toast', function () { el.remove(); });
    t.show();
  }
  // Message carried across a redirect.
  try {
    var pending = sessionStorage.getItem('ac_toast');
    if (pending) { sessionStorage.removeItem('ac_toast'); toast(pending); }
  } catch (e) { /* storage unavailable */ }

  /* ---------- modal loading ---------- */
  function setModal(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    var root = tmp.firstElementChild;
    var size = root ? root.getAttribute('data-size') : '';
    dialog.className = 'modal-dialog modal-dialog-scrollable' + (size ? ' modal-' + size : '');
    dialog.innerHTML = '';
    while (tmp.firstChild) { dialog.appendChild(tmp.firstChild); }
    init(dialog);
    var f = dialog.querySelector('[autofocus], .modal-body input:not([type=hidden]):not([readonly]), .modal-body select, .modal-body textarea');
    if (f) { setTimeout(function () { f.focus(); }, 180); }
  }

  function openModal(url, options) {
    options = options || {};
    dialog.className = 'modal-dialog';
    dialog.innerHTML = '<div class="modal-content"><div class="modal-loading"><div class="spinner-border spinner-border-sm"></div></div></div>';
    modal.show();
    var req = options.body
      ? fetch(url, { method: 'POST', body: options.body, headers: AJAX, credentials: 'same-origin' })
      : fetch(url, { headers: AJAX, credentials: 'same-origin' });
    req.then(function (res) {
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('application/json') !== -1 ? res.json().then(function (j) { return { json: j }; }) : res.text().then(function (t) { return { html: t }; });
    }).then(function (r) {
      if (r.json) {
        if (r.json.html) { setModal(r.json.html); return; }
        modal.hide();
        toast((r.json.errors || ['เกิดข้อผิดพลาด']).join(' '), 'error');
        return;
      }
      setModal(r.html);
    }).catch(function () { modal.hide(); toast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error'); });
  }

  /* Reload the page body in place (keeps scroll position, no navigation). */
  function softRefresh() {
    var main = document.getElementById('main');
    if (!main) { location.reload(); return; }
    var y = window.scrollY;
    fetch(location.href, { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var fresh = doc.getElementById('main');
      if (!fresh) { location.reload(); return; }
      main.innerHTML = fresh.innerHTML;
      $$('[data-nav-count]').forEach(function (el) {
        var f = doc.querySelector('[data-nav-count="' + el.getAttribute('data-nav-count') + '"]');
        el.textContent = f ? f.textContent : '';
      });
      init(main);
      window.scrollTo(0, y);
    });
  }

  function handleResult(data, form) {
    var errors = form && form.querySelector('[data-errors]');
    if (!data.ok) {
      var list = (data.errors || ['เกิดข้อผิดพลาด']);
      if (errors) {
        errors.innerHTML = '';
        list.forEach(function (m) { var d = document.createElement('div'); d.textContent = m; errors.appendChild(d); });
        errors.classList.remove('d-none');
        errors.scrollIntoView({ block: 'nearest' });
      } else {
        toast(list.join(' '), 'error');
      }
      return;
    }
    if (data.html) { setModal(data.html); if (!modalEl.classList.contains('show')) { modal.show(); } return; }
    if (data.redirect) {
      try { if (data.message) { sessionStorage.setItem('ac_toast', data.message); } } catch (e) { /* ignore */ }
      location.href = data.redirect;
      return;
    }
    if (modal && modalEl.classList.contains('show')) { modal.hide(); }
    toast(data.message);
    if (data.refresh !== false) { softRefresh(); }
    if (data.focus) { setTimeout(function () { var f = $(data.focus); if (f) { f.focus(); } }, 400); }
  }

  /* ---------- delegated events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-modal]');
    if (t) { e.preventDefault(); openModal(t.getAttribute('data-modal')); return; }

    // Open a modal by POSTing a form's data (e.g. selected rows → bulk edit).
    t = e.target.closest('[data-modal-post]');
    if (t) {
      e.preventDefault();
      var src = $(t.getAttribute('data-form'));
      openModal(t.getAttribute('data-modal-post'), { body: new FormData(src) });
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.hasAttribute('data-ajax')) { return; }
    e.preventDefault();
    if (form.getAttribute('data-confirm') && !window.confirm(form.getAttribute('data-confirm'))) { return; }
    var btn = form.querySelector('[type=submit]');
    if (btn) { btn.disabled = true; }
    var errors = form.querySelector('[data-errors]');
    if (errors) { errors.classList.add('d-none'); }
    fetch(form.action, { method: 'POST', body: new FormData(form), headers: AJAX, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) { handleResult(data, form); })
      .catch(function () { toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error'); })
      .then(function () { if (btn) { btn.disabled = false; } });
  });

  // Plain (non-ajax) forms that still need confirmation, e.g. downloads.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.hasAttribute('data-ajax') || !form.getAttribute('data-confirm')) { return; }
    if (!window.confirm(form.getAttribute('data-confirm'))) { e.preventDefault(); }
  });

  // Collapse / expand the admin sidebar; remembered per browser. Shortcut: "["
  function toggleSidebar() {
    var collapsed = document.documentElement.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem('ac_sidebar', collapsed ? 'collapsed' : 'open'); } catch (e) { /* ignore */ }
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-sidebar-toggle]')) { e.preventDefault(); toggleSidebar(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '[' && $('[data-sidebar-toggle]') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.body.classList.contains('modal-open')) {
      toggleSidebar();
    }
  });

  // "/" focuses search
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.body.classList.contains('modal-open')) {
      var s = $('[data-search]');
      if (s) { e.preventDefault(); s.focus(); s.select(); }
    }
  });

  /* ---------- per-render initialisation ---------- */
  function init(root) {
    $$('[data-autosubmit]', root).forEach(function (el) {
      el.addEventListener('change', function () { el.form.submit(); });
    });
    $$('[data-bs-toggle="tooltip"]', root).forEach(function (el) { bootstrap.Tooltip.getOrCreateInstance(el); });

    // Row selection with a sticky action bar.
    $$('[data-select-table]', root).forEach(function (table) {
      var bar = $(table.getAttribute('data-select-table'));
      var boxes = $$('input[name="ids[]"]', table);
      var all = $('[data-check-all]', table);
      var allInput = bar ? $('input[name="select_all"]', bar.closest('form') || document) : null;
      var counter = bar ? $('[data-count]', bar) : null;
      var allLink = bar ? $('[data-select-all-results]', bar) : null;
      var last = null;
      var refresh = function () {
        var n = boxes.filter(function (b) { return b.checked; }).length;
        boxes.forEach(function (b) { b.closest('tr').classList.toggle('table-active', b.checked); });
        var everything = allInput && allInput.value === '1';
        if (counter) { counter.textContent = everything ? counter.getAttribute('data-total') + ' (ทั้งหมดตามตัวกรอง)' : n; }
        if (bar) { bar.classList.toggle('d-none', n === 0 && !everything); }
        if (all) { all.checked = n > 0 && n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; }
        if (allLink) { allLink.classList.toggle('d-none', !(n === boxes.length && n > 0 && !everything)); }
      };
      boxes.forEach(function (b, i) {
        b.addEventListener('click', function (e) {
          if (e.shiftKey && last !== null) {
            for (var k = Math.min(last, i); k <= Math.max(last, i); k++) { boxes[k].checked = b.checked; }
          }
          last = i;
          if (allInput) { allInput.value = '0'; }
          refresh();
        });
      });
      if (all) { all.addEventListener('change', function () { boxes.forEach(function (b) { b.checked = all.checked; }); if (allInput) { allInput.value = '0'; } refresh(); }); }
      if (allLink) { allLink.addEventListener('click', function (e) { e.preventDefault(); allInput.value = '1'; refresh(); }); }
      var clear = bar ? $('[data-clear-selection]', bar) : null;
      if (clear) { clear.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = false; }); if (allInput) { allInput.value = '0'; } refresh(); }); }
      refresh();
    });

    // Asset-number autocomplete
    $$('[data-asset-lookup]', root).forEach(function (input) {
      var list = document.getElementById(input.getAttribute('list'));
      var info = $(input.getAttribute('data-asset-lookup'), root.ownerDocument ? root : document) || $(input.getAttribute('data-asset-lookup'));
      var cache = {};
      var timer = null;
      var describe = function () {
        var it = cache[input.value.toUpperCase()];
        if (info) { info.textContent = it ? it.description + ' — ' + (it.work_center ? it.work_center + ' ' + (it.work_center_name || '') : '-') + ' / ' + (it.area || '-') : ''; }
        var loc = input.form && input.form.querySelector('[name="location_note"]');
        if (it && loc && !loc.value) { loc.value = it.area; }
      };
      input.addEventListener('input', function () {
        clearTimeout(timer);
        var q = input.value.trim();
        if (q.length < 2) { return; }
        timer = setTimeout(function () {
          fetch(input.getAttribute('data-url') + '&q=' + encodeURIComponent(q), { headers: AJAX, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (items) {
              list.innerHTML = '';
              items.forEach(function (it) {
                var o = document.createElement('option');
                o.value = it.asset_no;
                o.label = it.description + ' · ' + (it.work_center || '') + ' · ' + it.area;
                list.appendChild(o);
                cache[it.asset_no] = it;
              });
              describe();
            });
        }, 200);
      });
      input.addEventListener('change', describe);
    });

    // Multi-select helpers: live filter box + summary of what is selected.
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
      var render = function () {
        box.innerHTML = '';
        var picked = Array.prototype.filter.call(sel.options, function (o) { return o.selected; });
        if (!picked.length) {
          var none = document.createElement('span');
          none.className = 'none';
          none.textContent = 'ยังไม่ได้เลือก';
          box.appendChild(none);
          return;
        }
        picked.forEach(function (o) {
          var s = document.createElement('span');
          s.textContent = o.text.replace(/\s+\([^)]*\)\s*$/, '');
          box.appendChild(s);
        });
      };
      sel.addEventListener('change', render);
      render();
    });

    // Export modal: custom column picker
    $$('[data-preset-group]', root).forEach(function (group) {
      var custom = $('#custom-columns', group.closest('form'));
      var sync = function () {
        var v = $$('input[name="preset"]', group).filter(function (i) { return i.checked; })[0];
        if (custom) { custom.classList.toggle('d-none', !(v && v.value === 'custom')); }
      };
      $$('input[name="preset"]', group).forEach(function (i) { i.addEventListener('change', sync); });
      sync();
    });

    // Scanner box that opens a modal for the scanned value.
    $$('form[data-scan-modal]', root).forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = form.querySelector('input[name="no"]');
        var v = input.value.trim();
        if (!v) { return; }
        openModal(form.getAttribute('data-scan-modal') + '&no=' + encodeURIComponent(v));
        input.value = '';
      });
    });

    // Open a modal automatically (e.g. "no ticket yet → report now").
    $$('[data-auto-modal]', root).forEach(function (el) {
      setTimeout(function () { openModal(el.getAttribute('data-auto-modal')); }, 150);
    });
  }

  init(document);
  if (modalEl) {
    modalEl.addEventListener('hidden.bs.modal', function () {
      dialog.innerHTML = '';
      var s = $('[data-scanner]');
      if (s) { s.focus(); }
    });
  }
  window.AssetCtrl = { openModal: openModal, toast: toast, refresh: softRefresh };
})();
