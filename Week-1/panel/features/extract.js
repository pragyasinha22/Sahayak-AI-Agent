/**
 * Sahayak — Article Extract feature (Slice 1.4.1)
 * -----------------------------------------------------------------------------
 * The Side-Panel half of "click Extract on a real article -> readable text".
 * Establishes the on-demand page-read pattern reused by every later read path
 * (summarise 1.5.1, page-chat 2.1.1, sensitive-page gate 2.5.1).
 *
 * Order of operations (Arch §6.1 — the gate runs BEFORE any read/egress):
 *   1. resolve the active tab, read its URL,
 *   2. run the pure read gate (SahayakPanel.guardRead) — a block/unknown page is
 *      refused here and NOTHING is injected or sent,
 *   3. inject `vendor/Readability.js` + `content/article-reader.js` into the tab
 *      ON DEMAND via chrome.scripting (activeTab + scripting; no host grants),
 *   4. forward the extract-article family through the sanctioned
 *      SahayakPanel.guardedSend path (which re-checks the gate + forbidden
 *      fields), and render the returned { title, byline, textContent }.
 *
 * Security:
 *   - GDR-3 / INV-2  No API key exists in this flow at all (1.4.1 does not call
 *                    Gemini), and nothing key-bearing is ever injected or sent.
 *   - GDR-7 / INV-5  Only the adapter's plain-text result is shown; raw HTML
 *                    never reaches the panel.
 *   - EC-W1-03       chrome://, Web Store and other privileged pages reject
 *                    injection; we surface the "reserved page" message and never
 *                    attempt to read them.
 *
 * The router (Slice 1.1.4) and messaging (Slices 1.1.4/1.2.2) are REUSED
 * unchanged — extract-article already routes Panel→worker→tab and the guarded
 * path already enforces the gate. Only this new feature + the vendored library
 * are added, so no completed slice is redesigned.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  var DEFAULT_INJECT_FILES = [
    'vendor/Readability.js',
    'content/article-reader.js'
  ];

  var MSG_UNAVAILABLE =
    'Sahayak can\u2019t reach the page right now. Reopen the panel and try again.';
  var MSG_DISALLOWED =
    'Sahayak can\u2019t read this page because Chrome reserves it for the ' +
    'browser. Open a normal website and try again.';
  var MSG_NO_CONTENT =
    'Sahayak couldn\u2019t find any readable content on this page.';

  function blockMessage(reason) {
    return 'Blocked by safety (' + (reason || 'blocked') +
      '). Sahayak won\u2019t read or extract this page.';
  }

  /**
   * Pure-ish orchestrator. All side-effecting collaborators are injected so this
   * runs under Node with fakes (see tests/unit/article-extract.test.js):
   *   runExtract({ panel, scripting, render, files? })
   * `panel` is SahayakPanel (requestActiveTabId, requestPageInfo, guardRead,
   * guardedSend); `scripting` is chrome.scripting; `render` receives a state
   * object. Never throws; every failure is rendered as a stable message.
   */
  function runExtract(deps) {
    var d = deps || {};
    var panel = d.panel;
    var scripting = d.scripting;
    var render = (typeof d.render === 'function') ? d.render : function () {};
    var files = d.files || DEFAULT_INJECT_FILES;

    var havePanel = panel &&
      typeof panel.requestActiveTabId === 'function' &&
      typeof panel.requestPageInfo === 'function' &&
      typeof panel.guardRead === 'function' &&
      typeof panel.guardedSend === 'function';
    var haveScripting = scripting && typeof scripting.executeScript === 'function';
    if (!havePanel || !haveScripting) {
      render({ state: 'unavailable', message: MSG_UNAVAILABLE });
      return Promise.resolve();
    }

    render({ state: 'checking' });

    return Promise.resolve()
      .then(function () { return panel.requestActiveTabId(); })
      .then(function (tabId) {
        return panel.requestPageInfo(tabId).then(function (pi) { return { tabId: tabId, pi: pi }; });
      })
      .then(function (ctx) {
        // STEP 2 — gate BEFORE any read/injection (Arch §6.1).
        return Promise.resolve(panel.guardRead(ctx.pi)).then(function (dec) {
          return { tabId: ctx.tabId, dec: dec };
        });
      })
      .then(function (step) {
        if (!step.dec || !step.dec.allowed) {
          render({ state: 'blocked', reason: step.dec && step.dec.reason, message: blockMessage(step.dec && step.dec.reason) });
          return; // STOP: nothing injected, nothing sent.
        }

        render({ state: 'extracting' });

        // STEP 3 — on-demand injection (EC-W1-03: privileged pages reject this).
        return scripting.executeScript({
          target: { tabId: step.tabId, allFrames: false },
          files: files
        })
          // STEP 4 — reuse the sanctioned guarded egress path (router unchanged).
          .then(function () { return panel.guardedSend('extract-article', { tabId: step.tabId }); })
          .then(function (res) {
            if (!res || res.ok !== true) {
              var inner0 = res && res.result;
              render({
                state: 'error',
                error: res && res.error,
                message: (inner0 && inner0.message) || MSG_NO_CONTENT
              });
              return;
            }
            var inner = res.result;
            if (inner && inner.ok === true) {
              render({
                state: 'ok',
                title: inner.title,
                byline: inner.byline,
                text: inner.textContent,
                truncated: inner.truncated
              });
            } else {
              render({ state: 'empty', message: (inner && inner.message) || MSG_NO_CONTENT });
            }
          });
      })
      .catch(function (err) {
        var m = String((err && err.message) || '');
        if (m.indexOf('safety-blocked') === 0 || m.indexOf('safety-confirm-declined') === 0) {
          render({ state: 'blocked', message: blockMessage(m.split(':')[1]) });
        } else if (m.indexOf('safety-gate') === 0) {
          render({ state: 'unavailable', message: MSG_UNAVAILABLE });
        } else {
          // Injection rejection (chrome://, Web Store) or tab access error.
          render({ state: 'disallowed', message: MSG_DISALLOWED });
        }
      });
  }

  // --------------------------------------------------------------------------
  // Browser-only wiring: Extract card. Self-initialising so no completed slice
  // (side-panel.js) must be edited.
  // --------------------------------------------------------------------------
  function initUI(win) {
    if (typeof win === 'undefined' || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var btn = doc.getElementById('extract-btn');
      var titleEl = doc.getElementById('extract-title');
      var outputEl = doc.getElementById('extract-output');
      if (!btn || !outputEl) return;

      var panel = win.SahayakPanel;
      var scripting = win.chrome && win.chrome.scripting;

      function setTitle(txt) {
        if (!titleEl) return;
        if (txt) { titleEl.textContent = txt; titleEl.style.display = 'block'; }
        else { titleEl.textContent = ''; titleEl.style.display = 'none'; }
      }

      function render(st) {
        if (!st) return;
        switch (st.state) {
          case 'checking':
            setTitle(''); outputEl.textContent = 'Checking this page is safe to read\u2026';
            outputEl.className = 'extract-output is-warn'; break;
          case 'extracting':
            setTitle(''); outputEl.textContent = 'Reading the article\u2026';
            outputEl.className = 'extract-output is-warn'; break;
          case 'ok':
            setTitle(st.title ? String(st.title) : '');
            outputEl.textContent = st.text +
              (st.truncated ? '\n\n(Article was very long; Sahayak used the first part.)' : '');
            outputEl.className = 'extract-output is-ok'; break;
          case 'empty':
          case 'error':
            setTitle(''); outputEl.textContent = st.message || MSG_NO_CONTENT;
            outputEl.className = 'extract-output is-warn'; break;
          case 'blocked':
          case 'disallowed':
          case 'unavailable':
            setTitle(''); outputEl.textContent = st.message || MSG_DISALLOWED;
            outputEl.className = 'extract-output is-err'; break;
          default:
            break;
        }
      }

      btn.addEventListener('click', function () {
        runExtract({ panel: panel, scripting: scripting, render: render });
      });
    });
  }

  var api = {
    DEFAULT_INJECT_FILES: DEFAULT_INJECT_FILES,
    MSG_UNAVAILABLE: MSG_UNAVAILABLE,
    MSG_DISALLOWED: MSG_DISALLOWED,
    MSG_NO_CONTENT: MSG_NO_CONTENT,
    blockMessage: blockMessage,
    runExtract: runExtract,
    initUI: initUI
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakExtract = api;
    initUI(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
