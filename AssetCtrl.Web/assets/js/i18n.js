/*
 * Translation engine (English source text -> Thai). Loaded before core.js.
 *
 * Dictionaries live in assets/js/lang/th-*.js and add entries with
 *   ACI18N.add('th', { 'English text': 'ข้อความไทย', 'Saved {code}.': 'บันทึก {code} แล้ว' });
 * Keys are the English text with whitespace collapsed to single spaces.
 *
 * Two ways text gets translated:
 *  1. AC.html`` templates: the static parts (text between tags, and the title / placeholder /
 *     aria-label / data-confirm attributes) are looked up automatically. Interpolated ${values}
 *     are data and are never translated.
 *  2. AC.t('Plain string', {vars}) for strings built in code (page titles, toasts, labels).
 *
 * This file also works under Node (used by the dictionary coverage script).
 */
(function (root) {
  'use strict';

  var dicts = { th: {} };
  var lang = 'en';

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function lookup(key) {
    if (lang === 'en' || !key) { return null; }
    var d = dicts[lang] || {};
    return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
  }

  /** Translate one string; keeps the surrounding whitespace; {name} placeholders are filled from vars. */
  function t(s, vars) {
    if (s === null || s === undefined) { return ''; }
    s = String(s);
    var key = norm(s);
    var tr = lookup(key);
    var out = tr === null ? s : s.replace(key.length ? /^(\s*)[\s\S]*?(\s*)$/ : /^$/, '$1' + tr.replace(/\$/g, '$$$$') + '$2');
    if (vars) {
      out = out.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m; });
    }
    return out;
  }

  var ATTR_RE = /\b(title|placeholder|aria-label|data-confirm)="([^"$]*)"/g;

  /**
   * Walk the static chunks of a tagged template, tracking whether we are inside a tag,
   * and pass every text run outside tags (and translatable attribute values) through fn.
   * Returns the new chunks. fn(text) must return the replacement text.
   */
  function mapChunks(chunks, fn) {
    var inTag = false, quote = null;
    return Array.prototype.map.call(chunks, function (chunk) {
      var res = '', text = '';
      for (var i = 0; i < chunk.length; i++) {
        var c = chunk.charAt(i);
        if (!inTag) {
          if (c === '<' && /[a-zA-Z\/!]/.test(chunk.charAt(i + 1) || 'a')) { res += fn(text, 'text'); text = ''; inTag = true; quote = null; res += c; }
          else { text += c; }
        } else {
          res += c;
          if (quote) { if (c === quote) { quote = null; } }
          else if (c === '"' || c === "'") { quote = c; }
          else if (c === '>') { inTag = false; }
        }
      }
      res += fn(text, 'text');
      return res.replace(ATTR_RE, function (m, name, value) { return name + '="' + fn(value, 'attr') + '"'; });
    });
  }

  function translateText(text) {
    if (!/[A-Za-z]/.test(text)) { return text; }
    var key = norm(text);
    var tr = lookup(key);
    if (tr === null) { return text; }
    var m = /^(\s*)[\s\S]*?(\s*)$/.exec(text);
    return m[1] + tr + m[2];
  }

  var cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  /** Translated static chunks of a template (cached per template site). */
  function templateStrings(strings) {
    if (lang === 'en') { return strings; }
    if (cache && cache.has(strings)) { return cache.get(strings); }
    var out = mapChunks(strings, translateText);
    if (cache) { cache.set(strings, out); }
    return out;
  }

  /** All translatable keys of a template's static chunks (for the coverage script). */
  function keysOf(chunks) {
    var keys = [];
    mapChunks(chunks, function (text) {
      if (/[A-Za-z]/.test(text) && norm(text)) { keys.push(norm(text)); }
      return text;
    });
    return keys;
  }

  root.ACI18N = {
    add: function (code, entries) {
      var d = dicts[code] = dicts[code] || {};
      Object.keys(entries).forEach(function (k) { d[norm(k)] = entries[k]; });
    },
    setLang: function (code) { lang = code === 'th' ? 'th' : 'en'; },
    lang: function () { return lang; },
    has: function (code, key) { return !!(dicts[code] && Object.prototype.hasOwnProperty.call(dicts[code], norm(key))); },
    dict: function (code) { return dicts[code] || {}; },
    t: t,
    templateStrings: templateStrings,
    keysOf: keysOf,
    norm: norm,
  };
})(typeof window !== 'undefined' ? window : globalThis);
