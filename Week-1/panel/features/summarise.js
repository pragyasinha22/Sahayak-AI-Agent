/**
 * Sahayak — Article Summarise feature (Slice 1.5.1)
 * -----------------------------------------------------------------------------
 * PS §2.4 / Plan Slice 1.5.1: "click Summarise on a real article -> structured
 * summary". Pipeline (all Steps of the plan, in order):
 *   1. reuse the Slice 1.4.1 read path (gate -> on-demand Readability
 *      injection -> guardedSend('extract-article')) — NOTHING new is injected
 *      or sent before the gate passes (Arch §6.1),
 *   2. send extracted text + the summary template
 *      (panel/prompts/article-summary.js) to Gemini via the Slice 1.3.1
 *      provider pattern (SahayakExplain.explainSelection — text-in/text-out),
 *   3. parse the reply into three sections and render TL;DR, five key points
 *      and next actions — or a graceful retry message when malformed.
 *
 * Security invariants:
 *   - GDR-3 / INV-2  The key is read from chrome.storage HERE (Side Panel
 *                    only) and travels only as the provider's header. It is
 *                    never injected, never in a routed message, never logged.
 *   - GDR-7 / INV-5  Only the adapter's plain-text extraction is sent; page
 *                    HTML never reaches this file, let alone the network.
 *   - EC-W1-07       Missing key -> stable settings hint, no network call
 *                    (inherited from explainSelection's contract).
 *
 * All side-effecting collaborators are injected into runSummarise() so the
 * orchestration is Node-testable with fakes
 * (tests/unit/summarise.test.js); the browser wiring at the bottom is the
 * only chrome.* consumer, mirroring panel/features/extract.js exactly.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  // Read path is identical to Slice 1.4.1; reuse its registration list rather
  // than duplicating the file names (single source of truth in extract.js).
  function defaultInjectFiles() {
    var ex = global.SahayakExtract;
    return (ex && ex.DEFAULT_INJECT_FILES) || [
      'vendor/Readability.js',
      'content/article-reader.js'
    ];
  }

  var MSG_UNAVAILABLE =
    'Sahayak can\u2019t reach the page right now. Reopen the panel and try again.';
  var MSG_DISALLOWED =
    'Sahayak can\u2019t read this page because Chrome reserves it for the ' +
    'browser. Open a normal website and try again.';
  // "Page doesn't say" path (Plan Unit-tests): too little text to summarise.
  var MSG_NOT_SUMMARISABLE =
    'The page doesn\u2019t say enough for Sahayak to summarise it. Open a ' +
    'real article and try again.';

  function blockMessage(reason) {
    return 'Blocked by safety (' + (reason || 'blocked') +
      '). Sahayak won\u2019t read or summarise this page.';
  }

  /**
   * Pure-ish orchestrator:
   *   runSummarise({ panel, scripting, render, getKey, callAI, files? })
   * `panel`   — SahayakPanel (requestActiveTabId/requestPageInfo/guardRead/
   *              guardedSend), `scripting` — chrome.scripting,
   * `getKey`  — () => Promise<string|null>, `callAI` —
   *              ({key, prompt}) => Promise<{ok, text?|message?}> (defaults to
   *              SahayakExplain.explainSelection), `render` receives a state
   * object. Never throws; every failure becomes a stable rendered message.
   */
  function runSummarise(deps) {
    var d = deps || {};
    var panel = d.panel;
    var scripting = d.scripting;
    var render = (typeof d.render === 'function') ? d.render : function () {};
    var files = d.files || defaultInjectFiles();
    var getKey = d.getKey || defaultGetKey;
    var callAI = d.callAI || defaultCallAI;

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
        return panel.requestPageInfo(tabId)
          .then(function (pi) { return { tabId: tabId, pi: pi }; });
      })
      .then(function (ctx) {
        // STEP 1a — gate BEFORE any read/injection (Arch §6.1).
        return panel.guardRead(ctx.pi).then(function (dec) {
          return { tabId: ctx.tabId, dec: dec };
        });
      })
      .then(function (step) {
        if (!step.dec || !step.dec.allowed) {
          render({
            state: 'blocked',
            reason: step.dec && step.dec.reason,
            message: blockMessage(step.dec && step.dec.reason)
          });
          return; // STOP: nothing injected, nothing sent.
        }

        render({ state: 'extracting' });

        // STEP 1b — reuse the sanctioned 1.4.1 extraction path unchanged.
        return scripting.executeScript({
          target: { tabId: step.tabId, allFrames: false },
          files: files
        })
          .then(function () {
            return panel.guardedSend('extract-article', { tabId: step.tabId });
          })
          .then(function (res) {
            var inner = res && res.result;
            if (!res || res.ok !== true || !inner || inner.ok !== true) {
              render({
                state: 'empty',
                message: (inner && inner.message) || MSG_NOT_SUMMARISABLE
              });
              return;
            }
            var article = inner; // { title, byline, textContent, truncated }

            // "Page doesn't say" guard: a stub-length extraction can't yield a
            // truthful 5-point summary; refuse instead of inventing (PS §2.4).
            if (!article.textContent ||
                String(article.textContent).trim().length < 200) {
              render({ state: 'empty', message: MSG_NOT_SUMMARISABLE });
              return;
            }

            render({ state: 'summarising' });

            // STEP 2 — key (panel-only) + provider call with summary template.
            return Promise.resolve(getKey())
              .then(function (key) {
                if (!key) {
                  render({
                    state: 'missing-key',
                    message: defaultMissingKeyMessage()
                  });
                  return;
                }
                return callAI({
                  key: key,
                  prompt: global.SahayakArticleSummary
                    .buildSummaryPrompt(article, currentLanguage())
                });
              })
              .then(function (ai) {
                if (ai === undefined || ai === null) return; // missing-key path
                if (!ai.ok) {
                  render({ state: 'error', message: ai.message || MSG_UNAVAILABLE });
                  return;
                }
                // STEP 3 — parse the three sections; enforce acceptance.
                var parsed = global.SahayakArticleSummary
                  .parseSummarySections(ai.text);
                if (!parsed.ok) {
                  render({
                    state: 'error',
                    error: parsed.error,
                    message: parsed.message
                  });
                  return;
                }
                render({
                  state: 'ok',
                  title: article.title,
                  tldr: parsed.tldr,
                  points: parsed.points,
                  nextActions: parsed.nextActions,
                  truncated: article.truncated
                });
              });
          })
      })
      .catch(function (err) {
        var m = String((err && err.message) || '');
        if (m.indexOf('safety-blocked') === 0 ||
            m.indexOf('safety-confirm-declined') === 0) {
          render({ state: 'blocked', message: blockMessage(m.split(':')[1]) });
        } else if (m.indexOf('safety-gate') === 0) {
          render({ state: 'unavailable', message: MSG_UNAVAILABLE });
        } else {
          render({ state: 'disallowed', message: MSG_DISALLOWED });
        }
      });
  }

  // Slice 1.7.1 — cached panel language feeds the prompt template.
  function currentLanguage() {
    var l = global.SahayakLanguage;
    return (l && typeof l.current === 'function') ? l.current() : 'en';
  }

  // Defaults resolved lazily so Node tests can inject fakes instead.
  function defaultGetKey() {
    var storageManager = global.SahayakStorageManager;
    var apiKeys = global.SahayakApiKeys;
    if (!storageManager || !apiKeys) return Promise.resolve(null);
    return Promise.resolve(apiKeys.getGeminiKey(storageManager));
  }
  function defaultCallAI(opts) {
    var ex = global.SahayakExplain;
    if (!ex || typeof ex.explainSelection !== 'function') {
      return Promise.resolve({
        ok: false, error: 'no-provider', message: MSG_UNAVAILABLE
      });
    }
    return ex.explainSelection(opts);
  }
  function defaultMissingKeyMessage() {
    var ex = global.SahayakExplain;
    return (ex && ex.MISSING_KEY_MESSAGE) ||
      'Sahayak needs a Gemini API key. Add it in Settings.';
  }

  // --------------------------------------------------------------------------
  // Browser-only wiring: Summarise card. Self-initialising (same pattern as
  // extract.js) so no completed slice must be edited.
  // --------------------------------------------------------------------------
  function initUI(win) {
    if (typeof win === 'undefined' || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var btn = doc.getElementById('summarise-btn');
      var outputEl = doc.getElementById('summary-output');
      if (!btn || !outputEl) return;

      var panel = win.SahayakPanel;
      var scripting = win.chrome && win.chrome.scripting;

      function clear() { while (outputEl.firstChild) outputEl.removeChild(outputEl.firstChild); }

      function addLine(cls, text) {
        var p = doc.createElement('p');
        p.className = cls;
        p.textContent = text;
        outputEl.appendChild(p);
        return p;
      }

      function addList(cls, items) {
        var ul = doc.createElement('ul');
        ul.className = cls;
        for (var i = 0; i < items.length; i++) {
          var li = doc.createElement('li');
          li.textContent = String(items[i]);
          ul.appendChild(li);
        }
        outputEl.appendChild(ul);
      }

      function render(st) {
        if (!st) return;
        outputEl.className = 'summary-output';
        switch (st.state) {
          case 'checking':
            clear(); addLine('summary-status', 'Checking this page is safe to read\u2026'); break;
          case 'extracting':
            clear(); addLine('summary-status', 'Reading the article\u2026'); break;
          case 'summarising':
            clear(); addLine('summary-status', 'Summarising with Gemini\u2026'); break;
          case 'ok':
            clear();
            if (st.title) addLine('summary-title', String(st.title));
            addLine('summary-tldr-label', 'TL;DR');
            addLine('summary-tldr', st.tldr);
            addLine('summary-points-label', 'Key points');
            addList('summary-points', st.points);
            addLine('summary-next-label', 'What to do next');
            addList('summary-next', st.nextActions);
            if (st.truncated) {
              addLine('summary-status', '(Article was very long; Sahayak used the first part.)');
            }
            outputEl.className = 'summary-output is-ok';
            break;
          case 'empty':
          case 'error':
          case 'missing-key':
            clear();
            addLine('summary-status', st.message || MSG_NOT_SUMMARISABLE);
            outputEl.className = 'summary-output is-warn';
            break;
          case 'blocked':
          case 'disallowed':
          case 'unavailable':
            clear();
            addLine('summary-status', st.message || MSG_DISALLOWED);
            outputEl.className = 'summary-output is-err';
            break;
          default:
            break;
        }
      }

      btn.addEventListener('click', function () {
        runSummarise({ panel: panel, scripting: scripting, render: render });
      });
    });
  }

  var api = {
    MSG_UNAVAILABLE: MSG_UNAVAILABLE,
    MSG_DISALLOWED: MSG_DISALLOWED,
    MSG_NOT_SUMMARISABLE: MSG_NOT_SUMMARISABLE,
    blockMessage: blockMessage,
    runSummarise: runSummarise,
    initUI: initUI
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSummarise = api;
    initUI(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
