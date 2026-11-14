/**
 * Sahayak — YouTube summarisation feature (Slice 1.6.1)
 * -----------------------------------------------------------------------------
 * PS §2.5 / Plan Slice 1.6.1: "Summarise -> adapter extracts video id +
 * available transcript/timestamps from the page -> Gemini -> chapter-format
 * notes in the panel". The Side-Panel half; the page half is
 * content/youtube-adapter.js and URL validation lives in
 * shared/youtube-url.js (the three Components named by the plan).
 *
 * Pipeline (identical safety shape to Slices 1.3.1–1.5.1):
 *   1. resolve active tab + URL, run the read gate FIRST (Arch §6.1) — a
 *      block/unknown page never gets injected or read,
 *   2. validate the URL is a real YouTube video (shared/youtube-url.js),
 *   3. on-demand inject the adapter and reuse the sanctioned
 *      `extract-article` guarded path (GDR-6: no new message families),
 *   4. send ONLY the adapter's whitelisted plain text (transcript/chapters,
 *      never HTML — GDR-7) to Gemini with the chapter-notes template,
 *   5. render timestamped notes; unavailable transcripts produce the PS §2.5
 *      "cannot be summarised" refusal, never a fabricated summary.
 *
 * Key handling: GDR-3 / INV-2 — same as summarise.js: panel-side storage
 * read, header-only transport, nothing key-bearing routed or injected.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  var DEFAULT_INJECT_FILES = [
    'shared/youtube-url.js',
    'content/youtube-adapter.js'
  ];

  var MSG_UNAVAILABLE =
    'Sahayak can\u2019t reach the page right now. Reopen the panel and try again.';
  var MSG_DISALLOWED =
    'Sahayak can\u2019t read this page because Chrome reserves it for the ' +
    'browser. Open a normal website and try again.';
  var MSG_NOT_VIDEO =
    'This isn\u2019t a YouTube video page. Open a public YouTube video ' +
    '(youtube.com/watch\u2026) and press Summarise again.';
  var MSG_CANNOT_SUMMARISE =
    'This video\u2019s transcript isn\u2019t available, so Sahayak can\u2019t ' +
    'summarise it. Private, removed or subtitle-less videos are skipped on ' +
    'purpose \u2014 Sahayak never guesses.';
  var MSG_RETRY_INJECT =
    'Sahayak couldn\u2019t read the video data. Reload the video page and ' +
    'try again.';

  function blockMessage(reason) {
    return 'Blocked by safety (' + (reason || 'blocked') +
      '). Sahayak won\u2019t read or summarise this page.';
  }

  /**
   * Pure prompt builder (Plan Unit-test target). `video` is the adapter's
   * whitelisted result: { title, byline, textContent, chapters, hasTranscript }.
   * Slice 1.7.1: optional `language` injects the response-language token
   * (state/preferences.js is the single source); omitted -> English.
   */
  function buildYouTubePrompt(video, language) {
    var v = video || {};
    var text = (typeof v.textContent === 'string') ? v.textContent : '';
    var title = (typeof v.title === 'string') ? v.title : '(untitled video)';
    var chapterLines = Array.isArray(v.chapters) && v.chapters.length
      ? '\n\nCHAPTER MARKS FROM THE PAGE:\n' +
        v.chapters.map(function (c) {
          return '[' + (c.time || '') + '] ' + (c.label || '');
        }).join('\n')
      : '';
    return (
      'You are Sahayak, a careful viewing assistant. Summarise the YouTube ' +
      'video below using ONLY its transcript and chapter timestamps as ' +
      'provided. Never invent content that is not in them.\n' +
      languageLine(language) + '\n\n' +
      'Respond with concise chapter-format notes: one line per section in ' +
      'the form "- [mm:ss] short section summary". Cover the whole video ' +
      'in 4-8 sections and end with a single line "Overall: <one sentence>".\n\n' +
      'VIDEO TITLE: ' + title + '\n' +
      'CHANNEL: ' + ((typeof v.byline === 'string') ? v.byline : 'unknown') + '\n' +
      'TRANSCRIPT / TIMESTAMPS:\n"""\n' + text + chapterLines + '\n"""'
    );
  }

  function languageLine(language) {
    var prefs = global.SahayakPreferences;
    if (prefs && typeof prefs.languageInstruction === 'function') {
      return prefs.languageInstruction(language);
    }
    return 'Reply in clear, simple English.';
  }

  /**
   * Pure-ish orchestrator; every side effect is injected (mirrors
   * runSummarise/runExtract):
   *   runYouTubeSummarise({ panel, scripting, render, getKey, callAI,
   *                         parseUrl, files? })
   */
  function runYouTubeSummarise(deps) {
    var d = deps || {};
    var panel = d.panel;
    var scripting = d.scripting;
    var render = (typeof d.render === 'function') ? d.render : function () {};
    var files = d.files || DEFAULT_INJECT_FILES;
    var getKey = d.getKey || defaultGetKey;
    var callAI = d.callAI || defaultCallAI;
    var parseUrl = d.parseUrl || function (u) {
      var p = global.SahayakYouTubeUrl;
      return p ? p.parseYouTubeUrl(u) : { ok: false, reason: 'empty' };
    };

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
        // STEP 1 — gate BEFORE any read/injection (Arch §6.1).
        return panel.guardRead(ctx.pi).then(function (dec) {
          return { tabId: ctx.tabId, pi: ctx.pi, dec: dec };
        });
      })
      .then(function (step) {
        if (!step.dec || !step.dec.allowed) {
          render({
            state: 'blocked',
            reason: step.dec && step.dec.reason,
            message: blockMessage(step.dec && step.dec.reason)
          });
          return; // STOP: nothing injected or sent.
        }

        // STEP 2 — the URL must actually be a YouTube video (unit-tested).
        var parsed = parseUrl(step.pi && step.pi.url);
        if (!parsed || parsed.ok !== true) {
          render({ state: 'not-a-video', message: MSG_NOT_VIDEO });
          return;
        }

        render({ state: 'reading' });

        // STEP 3 — inject the adapter, reuse the sanctioned guarded family.
        return scripting.executeScript({
          target: { tabId: step.tabId, allFrames: false },
          files: files
        })
          .then(function () {
            return panel.guardedSend('extract-article', { tabId: step.tabId });
          })
          .then(function (res) {
            var inner = res && res.result;
            if (inner && inner.error === 'no-transcript') {
              // The adapter itself refused (private/removed/subtitle-less):
              // the plan's clear "cannot be summarised" message, no AI call.
              render({ state: 'cannot', message: MSG_CANNOT_SUMMARISE });
              return;
            }
            if (!inner || inner.kind !== 'youtube') {
              // Stale article-reader listener or unreadable page: refuse with
              // guidance rather than mis-rendering a non-YouTube payload.
              render({
                state: 'cannot',
                error: (inner && inner.error) || 'not-youtube-result',
                message: MSG_RETRY_INJECT
              });
              return;
            }
            if (inner.ok !== true || !inner.textContent) {
              render({ state: 'cannot', message: MSG_CANNOT_SUMMARISE });
              return;
            }

            render({ state: 'summarising' });

            // STEP 4 — key + Gemini chapter-notes call (panel side only).
            return Promise.resolve(getKey())
              .then(function (key) {
                if (!key) {
                  render({ state: 'missing-key', message: defaultMissingKeyMessage() });
                  return;
                }
                return callAI({ key: key, prompt: buildYouTubePrompt(inner, currentLanguage()) });
              })
              .then(function (ai) {
                if (ai === undefined || ai === null) return;
                if (!ai.ok || !ai.text) {
                  render({ state: 'error', message: ai.message || MSG_UNAVAILABLE });
                  return;
                }
                render({
                  state: 'ok',
                  title: inner.title,
                  videoId: inner.videoId,
                  notes: ai.text,
                  truncated: inner.truncated
                });
              });
          });
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

  function defaultGetKey() {
    var storageManager = global.SahayakStorageManager;
    var apiKeys = global.SahayakApiKeys;
    if (!storageManager || !apiKeys) return Promise.resolve(null);
    return Promise.resolve(apiKeys.getGeminiKey(storageManager));
  }
  function defaultCallAI(opts) {
    var ex = global.SahayakExplain;
    if (!ex || typeof ex.explainSelection !== 'function') {
      return Promise.resolve({ ok: false, error: 'no-provider', message: MSG_UNAVAILABLE });
    }
    return ex.explainSelection(opts);
  }
  function defaultMissingKeyMessage() {
    var ex = global.SahayakExplain;
    return (ex && ex.MISSING_KEY_MESSAGE) ||
      'Sahayak needs a Gemini API key. Add it in Settings.';
  }

  // --------------------------------------------------------------------------
  // Browser-only wiring: YouTube card. Self-initialising (pattern of
  // extract.js / summarise.js).
  // --------------------------------------------------------------------------
  function initUI(win) {
    if (typeof win === 'undefined' || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var btn = doc.getElementById('youtube-btn');
      var outputEl = doc.getElementById('youtube-output');
      var titleEl = doc.getElementById('youtube-title');
      if (!btn || !outputEl) return;

      var panel = win.SahayakPanel;
      var scripting = win.chrome && win.chrome.scripting;

      function setTitle(txt) {
        if (!titleEl) return;
        if (txt) { titleEl.textContent = String(txt); titleEl.style.display = 'block'; }
        else { titleEl.textContent = ''; titleEl.style.display = 'none'; }
      }

      function render(st) {
        if (!st) return;
        switch (st.state) {
          case 'checking':
            setTitle(''); outputEl.textContent = 'Checking this page is safe to read\u2026';
            outputEl.className = 'youtube-output is-warn'; break;
          case 'reading':
            setTitle(''); outputEl.textContent = 'Reading the video\u2019s transcript\u2026';
            outputEl.className = 'youtube-output is-warn'; break;
          case 'summarising':
            setTitle(''); outputEl.textContent = 'Summarising with Gemini\u2026';
            outputEl.className = 'youtube-output is-warn'; break;
          case 'ok':
            setTitle(st.title);
            outputEl.textContent = st.notes +
              (st.truncated ? '\n\n(Transcript was very long; Sahayak used the first part.)' : '');
            outputEl.className = 'youtube-output is-ok'; break;
          case 'not-a-video':
          case 'cannot':
          case 'error':
          case 'missing-key':
            setTitle(''); outputEl.textContent = st.message || MSG_CANNOT_SUMMARISE;
            outputEl.className = 'youtube-output is-warn'; break;
          case 'blocked':
          case 'disallowed':
          case 'unavailable':
            setTitle(''); outputEl.textContent = st.message || MSG_DISALLOWED;
            outputEl.className = 'youtube-output is-err'; break;
          default:
            break;
        }
      }

      btn.addEventListener('click', function () {
        runYouTubeSummarise({ panel: panel, scripting: scripting, render: render });
      });
    });
  }

  var api = {
    DEFAULT_INJECT_FILES: DEFAULT_INJECT_FILES,
    MSG_UNAVAILABLE: MSG_UNAVAILABLE,
    MSG_DISALLOWED: MSG_DISALLOWED,
    MSG_NOT_VIDEO: MSG_NOT_VIDEO,
    MSG_CANNOT_SUMMARISE: MSG_CANNOT_SUMMARISE,
    blockMessage: blockMessage,
    buildYouTubePrompt: buildYouTubePrompt,
    runYouTubeSummarise: runYouTubeSummarise,
    initUI: initUI
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakYouTube = api;
    initUI(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
