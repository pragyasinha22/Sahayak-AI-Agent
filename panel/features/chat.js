/**
 * Sahayak — Page-grounded chat (Slice 2.1.1).
 *
 * Each question reuses the established read-gate → Readability injection →
 * guarded extraction path. Page text and API keys stay in the Side Panel;
 * conversation history exists only in this document's DOM.
 */
'use strict';

(function (global) {
  var MIN_PAGE_CONTEXT_CHARS = 200;
  var MSG_CANNOT_READ =
    "Sahayak can't read the current page, so it can't answer from it.";
  var MSG_EXTRACTION_FAILED =
    "Sahayak couldn't extract readable text from the current page, so it can't answer from it.";
  var MSG_INSUFFICIENT_CONTEXT =
    "Sahayak couldn't find enough readable text to answer from this page.";
  var MSG_GEMINI_FAILED =
    "Sahayak couldn't get an answer from Gemini. Please try again.";
  var MSG_KEY_FAILED =
    "Sahayak couldn't retrieve the Gemini API key. Check Settings and try again.";

  function defaultInjectFiles() {
    var extract = global.SahayakExtract;
    return (extract && extract.DEFAULT_INJECT_FILES) || [
      'vendor/Readability.js',
      'content/article-reader.js'
    ];
  }

  function defaultGetKey() {
    var storageManager = global.SahayakStorageManager;
    var apiKeys = global.SahayakApiKeys;
    if (!storageManager || !apiKeys) return Promise.resolve(null);
    return Promise.resolve(apiKeys.getGeminiKey(storageManager));
  }

  function defaultCallAI(opts) {
    var explain = global.SahayakExplain;
    if (!explain || typeof explain.explainSelection !== 'function') {
      return Promise.resolve({
        ok: false,
        error: 'no-provider',
        message: MSG_GEMINI_FAILED
      });
    }
    return explain.explainSelection(opts);
  }

  function missingKeyMessage() {
    var explain = global.SahayakExplain;
    return (explain && explain.MISSING_KEY_MESSAGE) ||
      'Sahayak needs a Gemini API key. Add it in Settings.';
  }

  function currentLanguage() {
    var language = global.SahayakLanguage;
    return (language && typeof language.current === 'function')
      ? language.current()
      : 'en';
  }

  /**
   * runChat({ panel, scripting, render, getKey, callAI, buildPrompt, files })
   *
   * Collaborators are injectable for deterministic Node tests. Rendering uses
   * states: checking, extracting, answering, ok, error, and missing-key.
   */
  function runChat(deps) {
    var d = deps || {};
    var panel = d.panel;
    var scripting = d.scripting;
    var render = (typeof d.render === 'function') ? d.render : function () {};
    var files = d.files || defaultInjectFiles();
    var getKey = d.getKey || defaultGetKey;
    var callAI = d.callAI || defaultCallAI;
    var buildPrompt = d.buildPrompt ||
      (global.SahayakPageChat && global.SahayakPageChat.buildPageChatPrompt);
    var question = (typeof d.question === 'string') ? d.question.trim() : '';

    var havePanel = panel &&
      typeof panel.requestActiveTabId === 'function' &&
      typeof panel.requestPageInfo === 'function' &&
      typeof panel.guardRead === 'function' &&
      typeof panel.guardedSend === 'function';
    var haveScripting = scripting && typeof scripting.executeScript === 'function';
    if (!havePanel || !haveScripting || typeof buildPrompt !== 'function' || !question) {
      render({ state: 'error', message: MSG_CANNOT_READ });
      return Promise.resolve();
    }

    render({ state: 'checking' });

    return Promise.resolve()
      .then(function () { return panel.requestActiveTabId(); })
      .then(function (tabId) {
        return panel.requestPageInfo(tabId).then(function (pageInfo) {
          return { tabId: tabId, pageInfo: pageInfo };
        });
      })
      .then(function (ctx) {
        return Promise.resolve(panel.guardRead(ctx.pageInfo)).then(function (decision) {
          return { tabId: ctx.tabId, decision: decision };
        });
      })
      .then(function (step) {
        if (!step.decision || !step.decision.allowed) {
          render({ state: 'error', message: MSG_CANNOT_READ });
          return null;
        }

        render({ state: 'extracting' });
        return Promise.resolve()
          .then(function () {
            return scripting.executeScript({
              target: { tabId: step.tabId, allFrames: false },
              files: files
            });
          })
          .then(function () {
            return panel.guardedSend('extract-article', { tabId: step.tabId });
          })
          .then(function (res) {
            var article = res && res.result;
            if (!res || res.ok !== true || !article || article.ok !== true) {
              render({
                state: 'error',
                message: (article && article.message) || MSG_EXTRACTION_FAILED
              });
              return null;
            }

            var text = (typeof article.textContent === 'string')
              ? article.textContent.trim()
              : '';
            if (text.length < MIN_PAGE_CONTEXT_CHARS) {
              render({ state: 'error', message: MSG_INSUFFICIENT_CONTEXT });
              return null;
            }
            return { article: article, text: text };
          });
      })
      .then(function (context) {
        if (!context) return;

        render({ state: 'answering' });
        return Promise.resolve()
          .then(function () { return getKey(); })
          .then(function (key) {
            if (!key) {
              render({ state: 'missing-key', message: missingKeyMessage() });
              return null;
            }

            var prompt = buildPrompt(question, context.text, currentLanguage());
            if (!prompt) {
              render({ state: 'error', message: MSG_INSUFFICIENT_CONTEXT });
              return null;
            }
            return Promise.resolve(callAI({ key: key, prompt: prompt }))
              .then(function (result) {
                if (!result || !result.ok) {
                  render({
                    state: 'error',
                    message: (result && result.message) || MSG_GEMINI_FAILED
                  });
                  return;
                }
                render({
                  state: 'ok',
                  text: result.text,
                  truncated: context.article.truncated === true
                });
              })
              .catch(function () {
                render({ state: 'error', message: MSG_GEMINI_FAILED });
              });
          })
          .catch(function () {
            render({ state: 'error', message: MSG_KEY_FAILED });
          });
      })
      .catch(function () {
        render({ state: 'error', message: MSG_CANNOT_READ });
      });
  }

  function initUI(win) {
    if (typeof win === 'undefined' || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var historyEl = doc.getElementById('chat-history');
      var form = doc.getElementById('chat-form');
      var input = doc.getElementById('chat-question');
      var sendButton = doc.getElementById('chat-send');
      var statusEl = doc.getElementById('chat-status');
      if (!historyEl || !form || !input || !sendButton || !statusEl) return;

      function appendMessage(role, text, state) {
        var article = doc.createElement('article');
        article.className = 'chat-message chat-message-' + role;
        if (state === 'error') article.className += ' is-error';

        var label = doc.createElement('strong');
        label.className = 'chat-message-label';
        label.textContent = role === 'user' ? 'You' : 'Sahayak';

        var body = doc.createElement('p');
        body.className = 'chat-message-text';
        body.textContent = text;

        article.appendChild(label);
        article.appendChild(body);
        historyEl.appendChild(article);
        historyEl.scrollTop = historyEl.scrollHeight;
      }

      function render(state) {
        if (!state) return;
        if (state.state === 'checking') {
          statusEl.textContent = 'Checking this page is safe to read…';
          statusEl.hidden = false;
          return;
        }
        if (state.state === 'extracting') {
          statusEl.textContent = 'Reading the article…';
          statusEl.hidden = false;
          return;
        }
        if (state.state === 'answering') {
          statusEl.textContent = 'Answering from the page…';
          statusEl.hidden = false;
          return;
        }

        statusEl.textContent = '';
        statusEl.hidden = true;
        // -------------------------
        if (state.state === 'error' || state.state === 'missing-key') {
          var errorMessage = state.message || 'Something went wrong. Please try again.';

          if (activeTabId === responseTabId) {
            appendMessage('assistant', errorMessage, 'error');
          }

          if (Number.isInteger(responseTabId) && sessionStore) {
            sessionStore.addMessage(responseTabId, {
              role: 'assistant',
              text: errorMessage,
              timestamp: Date.now()
            }).catch(function (error) {
              console.warn(
                '[Sahayak Chat] Could not save error:',
                error && error.message
              );
            });
          }

          return;
        }

        if (state.state === 'ok') {
          var answer = (typeof state.text === 'string') ? state.text : '';
          if (state.truncated) {
            answer += '\n\n(This answer is based only on the available beginning portion of the article.)';
          }
          appendMessage('assistant', answer, 'ok');
        } else {
          appendMessage('assistant', state.message || MSG_GEMINI_FAILED, 'error');
        }
        
      }

      var panel = win.SahayakPanel;
      var scripting = win.chrome && win.chrome.scripting;
      var busy = false;

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var question = input.value.trim();
        if (!question || busy) return;

        appendMessage('user', question);
        input.value = '';
        busy = true;
        input.disabled = true;
        sendButton.disabled = true;

        runChat({
          question: question,
          panel: panel,
          scripting: scripting,
          render: render
        }).then(function () {
          busy = false;
          input.disabled = false;
          sendButton.disabled = false;
          input.focus();
        });
      });
    });
  }

  var api = {
    MIN_PAGE_CONTEXT_CHARS: MIN_PAGE_CONTEXT_CHARS,
    MSG_CANNOT_READ: MSG_CANNOT_READ,
    MSG_EXTRACTION_FAILED: MSG_EXTRACTION_FAILED,
    MSG_INSUFFICIENT_CONTEXT: MSG_INSUFFICIENT_CONTEXT,
    MSG_GEMINI_FAILED: MSG_GEMINI_FAILED,
    runChat: runChat,
    initUI: initUI,
    defaultInjectFiles: defaultInjectFiles
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakChat = api;
    initUI(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
