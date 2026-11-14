/**
 * Sahayak — English / Hinglish toggle (Slice 1.7.1)
 * -----------------------------------------------------------------------------
 * PS §2.6 / Plan Slice 1.7.1: "add a panel header toggle; persist language
 * preference; inject language token into prompts". This is the UI half; the
 * storage shape and the prompt token live in state/preferences.js (single
 * source of truth). Self-initialising like every other feature card so no
 * completed slice is edited.
 *
 * Behaviour:
 *   - A two-state pill (EN | हिंगलिश) rendered into the panel header.
 *   - Clicking persists via SahayakPreferences.setLanguage through the
 *     Slice 1.1.3 storage manager (survives panel close + browser restart).
 *   - Exposes window.SahayakLanguage with a synchronous current() plus an
 *     async get(); the Explain / Summarise / YouTube flows read it at
 *     prompt-build time — that is the ONLY change those pipelines make for
 *     1.7.1 (plan: "prompts get language token").
 *
 * No new permissions, no new message families, no key material involved.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  // Synchronous cache; seeded from storage at DOMContentLoaded and updated on
  // every successful set, so prompt builders never need to await storage.
  var cached = 'en';

  function manager() {
    return global.SahayakStorageManager || null;
  }

  function refresh() {
    var prefs = global.SahayakPreferences;
    if (!prefs) return Promise.resolve(cached);
    return prefs.getLanguage(manager()).then(function (lang) {
      cached = lang;
      return cached;
    });
  }

  function set(lang) {
    var prefs = global.SahayakPreferences;
    if (!prefs) return Promise.resolve(cached);
    return prefs.setLanguage(manager(), lang).then(function (stored) {
      cached = stored;
      paint();
      return cached;
    });
  }

  var api = {
    current: function () { return cached; },
    get: function () { return Promise.resolve(cached); },
    reload: refresh,
    set: set
  };

  // --------------------------------------------------------------------------
  // Header pill UI (browser only).
  // --------------------------------------------------------------------------
  var BUTTON_LABELS = [
    { lang: 'en', label: 'EN' },
    { lang: 'hinglish', label: 'Hinglish' }
  ];

  function paint() {
    if (typeof document === 'undefined') return;
    var wrap = document.getElementById('language-toggle');
    if (!wrap) return;
    var btns = wrap.querySelectorAll('.language-toggle-btn');
    for (var i = 0; i < btns.length; i++) {
      var active = btns[i].getAttribute('data-lang') === cached;
      btns[i].className = 'language-toggle-btn' + (active ? ' is-active' : '');
      btns[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function initUI(win) {
    if (typeof win === 'undefined' || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var header = doc.querySelector('.app-header');
      if (!header || doc.getElementById('language-toggle')) return;

      var wrap = doc.createElement('nav');
      wrap.id = 'language-toggle';
      wrap.className = 'language-toggle';
      wrap.setAttribute('aria-label', 'Response language');

      var labels = BUTTON_LABELS;
      for (var i = 0; i < labels.length; i++) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'language-toggle-btn';
        b.setAttribute('data-lang', labels[i].lang);
        b.textContent = labels[i].label;
        b.title = 'Respond in ' +
          (labels[i].lang === 'hinglish' ? 'Hinglish' : 'English');
        b.addEventListener('click', (function (lang) {
          return function () { set(lang); };
        })(labels[i].lang));
        wrap.appendChild(b);
      }
      header.appendChild(wrap);

      refresh().then(paint);
    });
  }

  api.initUI = initUI;
  api.LABELS = BUTTON_LABELS;

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakLanguage = api;
    initUI(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
