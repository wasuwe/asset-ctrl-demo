/*
 * Asset Ctrl — camera scanner for IT asset numbers.
 *
 * Adds a camera button to every field where an IT asset number is typed or scanned:
 *   [data-scanner]        Setting Room and stock audit scan boxes (the result is submitted at once)
 *   [data-search]         list search boxes (the result is searched at once)
 *   [data-asset-lookup]   "IT asset number" in the report form (the look-up runs as when typing)
 *   [data-camera]         any other field (filled in only), e.g. the new-asset form
 *
 * The button opens a full-screen camera view with two modes:
 *   Barcode / QR   reads continuously; the first code found is used.
 *   Text           press the shutter; the text inside the frame is read (OCR) and the words that
 *                  look like asset numbers are offered to pick from.
 *
 * Libraries are bundled in assets/vendor (works offline) and loaded only when first needed:
 *   zxing/       barcode-detector ponyfill + zxing-cpp wasm (used when the browser has no BarcodeDetector)
 *   tesseract/   tesseract.js + LSTM core + English model (Text mode)
 *
 * The live camera needs HTTPS (or localhost). Without it — or if the camera cannot be opened —
 * "Take a photo" uses the phone's camera app / a picture file instead, which works on plain HTTP too.
 */
(function () {
  'use strict';

  var AC = window.AC;
  var t = AC.t, html = AC.html;
  var SELECTOR = 'input[data-scanner], input[data-search], input[data-asset-lookup], input[data-camera]';
  var me = document.currentScript && document.currentScript.src;
  var BASE = me ? me.replace(/js\/scanner\.js(\?.*)?$/, '') : 'assets/';
  var LIVE = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

  /* ---------------------------------------------------------- libraries */

  var loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { delete loaded[src]; reject(new Error('load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  /** A BarcodeDetector: the browser's own if it has one, else the bundled zxing-cpp (wasm). */
  var detectorP = null;
  function detector() {
    if (!detectorP) {
      detectorP = (window.BarcodeDetector
        ? window.BarcodeDetector.getSupportedFormats().then(function (formats) {
          if (!formats.length) { throw new Error('no formats'); }
          return new window.BarcodeDetector({ formats: formats });
        })
        : Promise.reject(new Error('no native')))
        .catch(function () {
          return loadScript(BASE + 'vendor/zxing/barcode-detector.min.js').then(function () {
            var api = window.BarcodeDetectionAPI;
            api.setZXingModuleOverrides({ locateFile: function (path) { return BASE + 'vendor/zxing/' + path; } });
            return new api.BarcodeDetector();
          });
        });
      detectorP.catch(function () { detectorP = null; });
    }
    return detectorP;
  }

  /** One OCR worker, reused; only capital letters, digits and - / are read (asset labels). */
  var ocrP = null;
  function ocr() {
    if (!ocrP) {
      ocrP = loadScript(BASE + 'vendor/tesseract/tesseract.min.js').then(function () {
        return window.Tesseract.createWorker('eng', 1, {
          workerPath: BASE + 'vendor/tesseract/worker.min.js',
          corePath: BASE + 'vendor/tesseract/tesseract-core-lstm.wasm.js',
          langPath: BASE + 'vendor/tesseract/lang',
          gzip: true,
          cacheMethod: 'none',
        });
      }).then(function (worker) {
        return worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/',
          tessedit_pageseg_mode: '11', // sparse text: labels, stickers
        }).then(function () { return worker; });
      });
      ocrP.catch(function () { ocrP = null; });
    }
    return ocrP;
  }

  /* ------------------------------------------------------------ results */

  /** A QR code may hold a link to the asset (…?no=PCS123 / ?q=PCS123) or just the number. */
  function cleanCode(raw) {
    var v = String(raw || '').trim();
    var m = /[?&#](?:no|asset_no|asset|q)=([^&#\s]+)/i.exec(v);
    if (m) { v = decodeURIComponent(m[1]); }
    return v.replace(/\s+/g, ' ').trim();
  }

  /** Words from OCR that look like an asset number: 5+ characters with at least one digit. */
  function candidates(text) {
    var seen = {};
    return String(text || '').toUpperCase().split(/[^A-Z0-9\-\/]+/)
      .map(function (w) { return w.replace(/^[-\/]+|[-\/]+$/g, ''); })
      .filter(function (w) { return w.length >= 5 && /\d/.test(w) && /[A-Z0-9]/.test(w[0]) && !seen[w] && (seen[w] = true); })
      .slice(0, 8);
  }

  function apply(input, value) {
    if (!value) { return; }
    input.value = input.classList.contains('text-uppercase') ? value.toUpperCase() : value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if ((input.hasAttribute('data-scanner') || input.hasAttribute('data-search')) && input.form) {
      input.form.requestSubmit();
    } else {
      input.focus();
    }
  }

  /* -------------------------------------------------------- camera view */

  var view = null;

  function close() {
    if (!view) { return; }
    view.stopped = true;
    if (view.stream) { view.stream.getTracks().forEach(function (tr) { tr.stop(); }); }
    clearTimeout(view.timer);
    document.removeEventListener('keydown', view.onKey, true);
    view.el.remove();
    document.body.classList.remove('cam-open');
    var back = view.input;
    view = null;
    if (back && document.contains(back) && !(back.form && back.form.hasAttribute('data-filter'))) { back.focus(); }
  }

  function setStatus(msg, tone) {
    if (!view) { return; }
    var s = view.el.querySelector('[data-cam-status]');
    s.textContent = msg || '';
    s.className = 'cam-status' + (tone ? ' is-' + tone : '');
  }

  function done(value) {
    if (!view) { return; }
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
    var input = view.input;
    close();
    apply(input, cleanCode(value));
  }

  function setMode(mode) {
    view.mode = mode;
    view.el.setAttribute('data-mode', mode);
    view.el.querySelectorAll('[data-cam-mode]').forEach(function (b) {
      var on = b.getAttribute('data-cam-mode') === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    view.el.querySelector('[data-cam-picks]').innerHTML = '';
    clearTimeout(view.timer);
    if (mode === 'code') {
      setStatus(view.stream ? t('Point the camera at a barcode or QR code.') : '');
      if (view.stream) { scanLoop(); }
    } else {
      setStatus(view.stream ? t('Fit the asset number inside the frame, then press the button.') : '');
      if (view.stream) { ocr().catch(function () { /* reported when used */ }); } // start loading early
    }
  }

  /** Barcode / QR: read a frame every ~200 ms until something is found. */
  function scanLoop() {
    if (!view || view.stopped || view.mode !== 'code') { return; }
    var video = view.video;
    detector().then(function (d) {
      if (!view || view.mode !== 'code') { return null; }
      return video.readyState >= 2 ? d.detect(video) : [];
    }).then(function (codes) {
      if (!view || view.mode !== 'code') { return; }
      var hit = (codes || []).filter(function (c) { return c.rawValue; })[0];
      if (hit) { done(hit.rawValue); return; }
      view.timer = setTimeout(scanLoop, 200);
    }, function () {
      setStatus(t('Barcode reading is not available in this browser. Use Text, or type the number.'), 'bad');
    });
  }

  /** The part of the picture inside the aiming frame (OCR reads less noise, much faster). */
  function frameCanvas(source, sw, sh) {
    var c = document.createElement('canvas');
    var cw = Math.round(sw * 0.8), ch = Math.round(sh * 0.3);
    c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.4)';
    g.drawImage(source, Math.round((sw - cw) / 2), Math.round((sh - ch) / 2), cw, ch, 0, 0, cw, ch);
    return c;
  }

  function readText(canvas) {
    var picks = view.el.querySelector('[data-cam-picks]');
    picks.innerHTML = '';
    setStatus(t('Reading the text…'), 'busy');
    view.el.classList.add('is-busy');
    return ocr().then(function (worker) { return worker.recognize(canvas); }).then(function (res) {
      if (!view) { return; }
      view.el.classList.remove('is-busy');
      var list = candidates(res && res.data && res.data.text);
      if (!list.length) { setStatus(t('No asset number found. Move closer and try again.'), 'bad'); return; }
      setStatus(t('Tap the right number:'));
      picks.innerHTML = AC.html`${list.map(function (w) { return html`<button type="button" class="btn btn-light cam-pick" data-cam-pick="${w}">${w}</button>`; })}`.toString();
    }, function () {
      if (!view) { return; }
      view.el.classList.remove('is-busy');
      setStatus(t('Text reading could not start. Check the connection and try again.'), 'bad');
    });
  }

  function shutter() {
    if (!view || !view.stream || view.el.classList.contains('is-busy')) { return; }
    var v = view.video;
    readText(frameCanvas(v, v.videoWidth, v.videoHeight));
  }

  /** "Take a photo": a still picture from the camera app or a file (works without HTTPS). */
  function fromPhoto(file) {
    if (!file || !view) { return; }
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(img.src);
      if (!view) { return; }
      if (view.mode === 'text') {
        // Without a live frame, read the middle band of the photo.
        readText(frameCanvas(img, img.naturalWidth, img.naturalHeight));
        return;
      }
      setStatus(t('Reading the picture…'), 'busy');
      detector().then(function (d) { return d.detect(img); }).then(function (codes) {
        var hit = (codes || []).filter(function (c) { return c.rawValue; })[0];
        if (hit) { done(hit.rawValue); } else { setStatus(t('No barcode or QR code found in the picture.'), 'bad'); }
      }, function () { setStatus(t('Barcode reading is not available in this browser. Use Text, or type the number.'), 'bad'); });
    };
    img.src = URL.createObjectURL(file);
  }

  function open(input) {
    if (view) { close(); }
    var el = document.createElement('div');
    el.className = 'cam-scan';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('Scan with the camera'));
    el.innerHTML = html`
      <div class="cam-top">
        <div class="cam-modes" role="group" aria-label="${t('What to read')}">
          <button type="button" class="active" data-cam-mode="code" aria-pressed="true"><i class="bi bi-qr-code-scan"></i>Barcode / QR</button>
          <button type="button" data-cam-mode="text" aria-pressed="false"><i class="bi bi-fonts"></i>Text</button>
        </div>
        <button type="button" class="cam-close" data-cam-close aria-label="${t('Close')}"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="cam-stage">
        <video playsinline muted autoplay></video>
        <div class="cam-frame" aria-hidden="true"><span></span></div>
        <div class="cam-nolive">
          <i class="bi bi-camera"></i>
          <p>${LIVE ? '' : t('The live camera needs a secure (HTTPS) address. Take a photo instead.')}</p>
        </div>
      </div>
      <div class="cam-bottom">
        <div class="cam-status" data-cam-status role="status" aria-live="polite"></div>
        <div class="cam-picks" data-cam-picks></div>
        <div class="cam-actions">
          <label class="btn btn-outline-light cam-photo"><i class="bi bi-image me-1"></i>Take a photo
            <input type="file" accept="image/*" capture="environment" hidden data-cam-file></label>
          <button type="button" class="cam-shutter" data-cam-shutter aria-label="${t('Read the text')}"><span></span></button>
          <span class="cam-spacer"></span>
        </div>
      </div>`.toString();
    document.body.appendChild(el);
    document.body.classList.add('cam-open');

    view = { el: el, input: input, video: el.querySelector('video'), stream: null, mode: 'code', timer: null, stopped: false };
    view.onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    document.addEventListener('keydown', view.onKey, true);

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cam-close],[data-cam-mode],[data-cam-shutter],[data-cam-pick]');
      if (!b) { return; }
      if (b.hasAttribute('data-cam-close')) { close(); }
      else if (b.hasAttribute('data-cam-mode')) { setMode(b.getAttribute('data-cam-mode')); }
      else if (b.hasAttribute('data-cam-shutter')) { shutter(); }
      else if (b.hasAttribute('data-cam-pick')) { done(b.getAttribute('data-cam-pick')); }
    });
    el.querySelector('[data-cam-file]').addEventListener('change', function (e) { fromPhoto(e.target.files && e.target.files[0]); e.target.value = ''; });
    el.querySelector('[data-cam-close]').focus();

    if (!LIVE) { el.classList.add('no-live'); setMode('code'); return; }
    setStatus(t('Opening the camera…'), 'busy');
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function (stream) {
        if (!view || view.el !== el) { stream.getTracks().forEach(function (tr) { tr.stop(); }); return; }
        view.stream = stream;
        view.video.srcObject = stream;
        return view.video.play().catch(function () { /* autoplay with muted is allowed */ }).then(function () { setMode(view.mode); });
      }, function (err) {
        if (!view) { return; }
        el.classList.add('no-live');
        el.querySelector('.cam-nolive p').textContent = err && err.name === 'NotAllowedError'
          ? t('Camera permission was refused. Allow the camera for this site, or take a photo instead.')
          : t('The camera could not be opened. Take a photo instead.');
        setStatus('');
      });
    // Warm up the barcode reader while the camera starts.
    detector().catch(function () { /* reported when used */ });
  }

  /* ------------------------------------------------- buttons on fields */

  function addButton(input) {
    if (input.hasAttribute('data-cam-ready') || input.readOnly || input.type === 'hidden') { return; }
    input.setAttribute('data-cam-ready', '');
    var label = t('Scan with the camera');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = '<i class="bi bi-camera"></i>';
    btn.addEventListener('click', function () { open(input); });
    var wrap = input.parentElement;
    if (wrap.classList.contains('search-wrap')) {
      btn.className = 'cam-btn cam-btn--inline';
      wrap.classList.add('has-cam');
      wrap.appendChild(btn);
    } else if (input.classList.contains('scan-input')) {
      btn.className = 'btn btn-lg btn-outline-secondary cam-btn';
      input.after(btn);
    } else {
      btn.className = 'btn btn-outline-secondary cam-btn';
      var group = document.createElement('div');
      group.className = 'input-group cam-group';
      input.before(group);
      group.appendChild(input);
      group.appendChild(btn);
    }
  }

  function scan(root) {
    (root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(SELECTOR)) : []).forEach(addButton);
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) { return; }
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(document.body); });
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  AC.scanner = { open: open, close: close, candidates: candidates, cleanCode: cleanCode };
})();
