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
  var MAX_PAGE_CONTEXT_CHARS = 10000;
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

    if (!explain) {
      return Promise.resolve({
        ok: false,
        error: 'no-provider',
        message: MSG_GEMINI_FAILED
      });
    }

    if (typeof explain.streamExplainSelection === 'function') {
      return explain.streamExplainSelection(opts);
    }

    if (typeof explain.explainSelection === 'function') {
      return explain.explainSelection(opts);
    }

    return Promise.resolve({
      ok: false,
      error: 'no-provider',
      message: MSG_GEMINI_FAILED
    });
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
    var requestedTabId = Number.isInteger(d.tabId) ? d.tabId : null;

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
      .then(function () {
        return requestedTabId !== null
          ? requestedTabId
          : panel.requestActiveTabId();
      })
      .then(function (tabId) {
        return panel.requestPageInfo(tabId).then(function (pageInfo) {
          return { tabId: tabId, pageInfo: pageInfo };
        });
      })
      .then(function (ctx) {
        console.log('[Sahayak Chat] Page info:', ctx.pageInfo);

        return Promise.resolve(panel.guardRead(ctx.pageInfo)).then(function (decision) {
          console.log('[Sahayak Chat] Read decision:', decision);
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

            var contextTruncated =
              article.truncated === true || text.length > MAX_PAGE_CONTEXT_CHARS;

            var pageContext = text.slice(0, MAX_PAGE_CONTEXT_CHARS);

            return {
              article: article,
              text: pageContext,
              truncated: contextTruncated
            };
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
            return Promise.resolve(callAI({
              key: key,
              prompt: prompt,
              onChunk: function (chunk) {
                if (typeof chunk !== 'string' || !chunk) return;

                render({
                  state: 'streaming',
                  chunk: chunk
                });
              }
            }))
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
                  truncated: context.truncated
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
      .catch(function (error) {
        console.error('[Sahayak Chat] runChat failed:', error);
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

      // ---------------------------------------------------
      function appendFormattedText(container, text) {
        var value = String(text || '');
        var boldPattern = /\*\*([^*]+)\*\*/g;
        var lastIndex = 0;
        var match;

        while ((match = boldPattern.exec(value)) !== null) {
          if (match.index > lastIndex) {
            container.appendChild(
              doc.createTextNode(value.slice(lastIndex, match.index))
            );
          }

          var strong = doc.createElement('strong');
          strong.textContent = match[1];
          container.appendChild(strong);

          lastIndex = boldPattern.lastIndex;
        }

        if (lastIndex < value.length) {
          container.appendChild(
            doc.createTextNode(value.slice(lastIndex))
          );
        }
      }

      function appendMessage(role, text, state) {
        var article = doc.createElement('article');
        article.className = 'chat-message chat-message-' + role;
        if (state === 'error') article.className += ' is-error';

        var label = doc.createElement('strong');
        label.className = 'chat-message-label';
        label.textContent = role === 'user' ? 'You' : 'Sahayak';

        var body = doc.createElement('p');
        body.className = 'chat-message-text';
        if (role === 'assistant') {
          appendFormattedText(body, text);
        } else {
          body.textContent = text;
        }

        article.appendChild(label);
        article.appendChild(body);
        historyEl.appendChild(article);
        historyEl.scrollTop = historyEl.scrollHeight;
      }
      // -------------------------------------------
      function createStreamingMessage() {
        var article = doc.createElement('article');
        article.className = 'chat-message chat-message-assistant';

        var label = doc.createElement('strong');
        label.className = 'chat-message-label';
        label.textContent = 'Sahayak';

        var body = doc.createElement('p');
        body.className = 'chat-message-text';

        article.appendChild(label);
        article.appendChild(body);
        historyEl.appendChild(article);

        return {
          update: function (text) {
            body.textContent = text;
            historyEl.scrollTop = historyEl.scrollHeight;
          },
          finalize: function (text) {
            body.textContent = '';
            appendFormattedText(body, text);
            historyEl.scrollTop = historyEl.scrollHeight;
          },
          remove: function () {
            if (article.parentNode) {
              article.parentNode.removeChild(article);
            }
          }
        };
      }

      var streamingMessage = null;
      var streamingText = '';

      function render(state, responseTabId) {
        if (!state) return;
        // ----------------------------------
        if (state.state === 'answering') {
          streamingText = '';
          if (streamingMessage) {
            streamingMessage.remove();
            streamingMessage = null;
          }
          statusEl.textContent = 'Answering from the page…';
          statusEl.hidden = false;
          return;
        }

        if (state.state === 'streaming') {
          streamingText += state.chunk || '';
          statusEl.textContent = '';
          statusEl.hidden = true;

          if (activeTabId === responseTabId) {
            if (!streamingMessage) {
              streamingMessage = createStreamingMessage();
            }
            streamingMessage.update(streamingText);
          }
          return;
        }
        // --------------------------------------
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
       

        statusEl.textContent = '';
        statusEl.hidden = true;
        if (state.state === 'ok') {
          // ---------------------------------
          if (
            state.state === 'error' ||
            state.state === 'missing-key'
          ) {
            if (streamingMessage) {
              streamingMessage.remove();
              streamingMessage = null;
            }
            streamingText = '';
          }
          
          var answer = (typeof state.text === 'string') ? state.text.trim() : '';

          var refusalSentence = global.SahayakPageChat &&
            global.SahayakPageChat.REFUSAL_SENTENCE;

          var isRefusal = Boolean(            
            refusalSentence && answer.startsWith(refusalSentence)
          );
          console.log('[CHAT UI DEBUG]', {
            answer: JSON.stringify(answer),
            refusalSentence: JSON.stringify(refusalSentence),
            isRefusal: isRefusal,
            truncated: state.truncated
          });

          if (state.truncated === true && !isRefusal) {
            answer += '\n\n(This answer is based only on the available beginning portion of the article.)';
          }

          if (Number.isInteger(responseTabId) && sessionStore) {
            sessionStore.addMessage(responseTabId, {
              role: 'assistant',
              text: answer,
              timestamp: Date.now()
            }).catch(function (error) {
              console.warn(
                '[Sahayak Chat] Could not save answer:',
                error && error.message
              );
            });
          }

          if (activeTabId === responseTabId) {
            if (streamingMessage) {
              streamingMessage.finalize(answer);
              streamingMessage = null;
            } else {
              appendMessage('assistant', answer, 'ok');
            }
          } else if (streamingMessage) {
            streamingMessage.remove();
            streamingMessage = null;
          }

          streamingText = '';

          
        }
      }
      // ------------------------------------------------------
            var panel = win.SahayakPanel;
      var scripting = win.chrome && win.chrome.scripting;
      var storageArea = win.chrome && win.chrome.storage &&
        win.chrome.storage.session;
      var sessionStoreModule = win.SahayakSessionStore;
      var sessionStore = (
        sessionStoreModule &&
        typeof sessionStoreModule.create === 'function' &&
        storageArea
      ) ? sessionStoreModule.create(storageArea) : null;

      var activeTabId = null;
      var historyLoadVersion = 0;
      var busy = false;

      function showChatIntro() {
        var intro = doc.createElement('p');
        intro.className = 'chat-intro';
        intro.textContent =
          'Ask a question about this page. Answers use only its readable article text.';
        historyEl.appendChild(intro);
      }

      function loadTabHistory(tabId) {
        if (!Number.isInteger(tabId)) {
          return Promise.resolve();
        }

        activeTabId = tabId;
        var loadVersion = ++historyLoadVersion;

        historyEl.textContent = '';

        if (!sessionStore) {
          showChatIntro();
          return Promise.resolve();
        }

        return sessionStore.getMessages(tabId).then(function (messages) {
          if (loadVersion !== historyLoadVersion ||
              activeTabId !== tabId) {
            return;
          }

          historyEl.textContent = '';

          if (!messages.length) {
            showChatIntro();
            return;
          }

          messages.forEach(function (message) {
            appendMessage(message.role, message.text);
          });
        }).catch(function (error) {
          console.warn(
            '[Sahayak Chat] Could not restore chat history:',
            error && error.message
          );
          if (loadVersion === historyLoadVersion &&
              activeTabId === tabId) {
            showChatIntro();
          }
        });
      }
      // ----------------------------------------
            function initializeActiveTab() {
        if (!panel || typeof panel.requestActiveTabId !== 'function') {
          return;
        }

        panel.requestActiveTabId().then(function (tabId) {
          return loadTabHistory(tabId);
        }).catch(function (error) {
          console.warn(
            '[Sahayak Chat] Could not identify active tab:',
            error && error.message
          );
        });
      }

      initializeActiveTab();

      if (win.chrome && win.chrome.tabs &&
          win.chrome.tabs.onActivated) {
        win.chrome.tabs.onActivated.addListener(function () {
          initializeActiveTab();
        });
      }
      if (win.chrome && win.chrome.tabs &&
        win.chrome.tabs.onRemoved &&
        sessionStore &&
        typeof sessionStore.clearTab === 'function') {
      win.chrome.tabs.onRemoved.addListener(function (tabId) {
        sessionStore.clearTab(tabId).catch(function (error) {
          console.warn(
            '[Sahayak Chat] Could not clear closed-tab history:',
            error && error.message
          );
        });
      });
    }
      // ------------------------------------------------ 

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var question = input.value.trim();
        if (!question || busy) return;

        busy = true;
        input.value = '';
        input.disabled = true;
        sendButton.disabled = true;

        function finish() {
          busy = false;
          input.disabled = false;
          sendButton.disabled = false;
          input.focus();
        }

        if (!panel || typeof panel.requestActiveTabId !== 'function') {
          finish();
          render({ state: 'error', message: MSG_CANNOT_READ });
          return;
        }

        panel.requestActiveTabId().then(function (tabId) {
          return loadTabHistory(tabId).then(function () {
            return tabId;
          });
        }).then(function (tabId) {
          if (activeTabId === tabId) {
            appendMessage('user', question);
          }

          var saveQuestion = sessionStore
            ? sessionStore.addMessage(tabId, {
                role: 'user',
                text: question,
                timestamp: Date.now()
              }).catch(function (error) {
                console.warn('[Sahayak Chat] Could not save question:', error);
              })
            : Promise.resolve();

          return saveQuestion.then(function () {
            return runChat({
              question: question,
              tabId: tabId,
              panel: panel,
              scripting: scripting,
              render: function (state) {
                render(state, tabId);
              }
            }).then(function () {
              return tabId;
            });
          });
        }).then(function (tabId) {
          return finish();
        }).catch(function (error) {
          console.error('[Sahayak Chat] Submit failed:', error);
          if (activeTabId !== null) {
            render({ state: 'error', message: MSG_CANNOT_READ });
          }
          finish();
        });
      });
      // ----------------------
    });
  }

  var api = {
    MIN_PAGE_CONTEXT_CHARS: MIN_PAGE_CONTEXT_CHARS,
    MAX_PAGE_CONTEXT_CHARS: MAX_PAGE_CONTEXT_CHARS,
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
