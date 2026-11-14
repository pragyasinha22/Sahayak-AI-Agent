'use strict';

(function (global) {
  var EMPTY_SELECTION_MESSAGE =
    'Select some text first, then choose a Sahayak context-menu action.';
  var SAFETY_BLOCK_MESSAGE =
    'Blocked by safety. Sahayak will not send this selection to the AI provider.';
  var SAFETY_UNAVAILABLE_MESSAGE =
    'Sahayak could not verify that this page is safe to read. No text was sent.';
  var MISSING_KEY_MESSAGE =
    'Sahayak needs a Gemini API key to translate text or draft a reply. Add it in Settings.';
  var KEY_READ_ERROR_MESSAGE =
    'Sahayak could not read the Gemini API key from local Settings.';
  var PROVIDER_ERROR_MESSAGE =
    'Sahayak could not generate a response. Please try again.';

  function traceSelection(stage, text) {
    var contract = global.SahayakContextAction;
    if (contract && typeof contract.traceSelection === 'function') {
      contract.traceSelection(stage, text);
    }
  }

  function traceDraft(stage, details) {
    if (global.console && typeof global.console.info === 'function') {
      global.console.info('[Sahayak draft diagnostic]', Object.assign({
        stage: stage
      }, details));
    }
  }

  function getPageOrigin(pageInfo) {
    if (!pageInfo || typeof pageInfo.url !== 'string') return '';
    try {
      return new URL(pageInfo.url).origin;
    } catch (_) {
      return '';
    }
  }

  function runContextAction(deps) {
    var d = deps || {};
    var request = d.request || {};
    var action = request.action;
    var text = typeof request.text === 'string' ? request.text : '';
    var context = d.context;
    var panel = d.panel;
    var render = typeof d.render === 'function' ? d.render : function () {};
    var classifier = d.classifier;
    var preferences = d.preferences;
    var storageManager = d.storageManager;
    var projectFacts = action === 'draft-reply' &&
      typeof d.projectFacts === 'string' ? d.projectFacts : '';
    if (action === 'draft-reply') {
      traceSelection('draft.workflow-start', text);
      traceDraft('workflow-input', { projectFactsLength: projectFacts.length });
    }

    if (!text.trim()) {
      render({ state: 'error', message: EMPTY_SELECTION_MESSAGE });
      return Promise.resolve();
    }
    if (action !== 'translate' && action !== 'draft-reply') {
      render({ state: 'error', message: 'This context-menu action is not supported.' });
      return Promise.resolve();
    }
    if (action === 'draft-reply' &&
        (!d.draftContexts || d.draftContexts.indexOf(context) === -1)) {
      render({ state: 'error', message: 'Choose Email, LinkedIn, or Forum before drafting.' });
      return Promise.resolve();
    }
    if (action === 'draft-reply' &&
        (!d.draftPrompt ||
         typeof d.draftPrompt.buildDraftPrompt !== 'function' ||
         typeof d.draftPrompt.enforceProjectFacts !== 'function')) {
      render({
        state: 'error',
        message: 'Draft safety protection is unavailable. No reply was generated.'
      });
      return Promise.resolve();
    }
    if (!classifier || typeof classifier.classifyText !== 'function') {
      render({
        state: 'error',
        message: 'Blocked by safety: the selected-text safety check is unavailable.'
      });
      return Promise.resolve();
    }
    var textDecision = classifier.classifyText(text);
    if (!textDecision || textDecision.class !== 'ordinary') {
      render({
        state: 'error',
        message: 'Blocked by safety: the selection may contain credentials.'
      });
      return Promise.resolve();
    }
    if (projectFacts.trim()) {
      var factsDecision = classifier.classifyText(projectFacts);
      if (!factsDecision || factsDecision.class !== 'ordinary') {
        render({
          state: 'error',
          message: 'Blocked by safety: the supplied project facts may contain credentials.'
        });
        return Promise.resolve();
      }
    }

    if (!panel ||
        typeof panel.requestPageInfo !== 'function' ||
        typeof panel.guardRead !== 'function' ||
        typeof d.getKey !== 'function' ||
        typeof d.callAI !== 'function') {
      render({ state: 'error', message: SAFETY_UNAVAILABLE_MESSAGE });
      return Promise.resolve();
    }

    render({
      state: 'working',
      message: action === 'translate' ? 'Checking safety before translating…' :
        'Checking safety before drafting…'
    });

    var targetTab = Number.isInteger(request.tabId)
      ? Promise.resolve(request.tabId)
      : (typeof panel.requestActiveTabId === 'function'
        ? panel.requestActiveTabId()
        : Promise.reject(new Error('active-tab-unavailable')));

    return targetTab
      .then(function (tabId) {
        return panel.requestPageInfo(tabId);
      })
      .then(function (pageInfo) {
        return Promise.resolve(panel.guardRead(pageInfo)).then(function (decision) {
          return { pageInfo: pageInfo, decision: decision };
        });
      })
      .then(function (checked) {
        if (!checked.decision || !checked.decision.allowed) {
          render({ state: 'error', message: SAFETY_BLOCK_MESSAGE });
          return null;
        }

        return Promise.resolve()
          .then(function () { return d.getKey(); })
          .then(function (key) {
            if (!key) {
              render({ state: 'error', message: MISSING_KEY_MESSAGE });
              return null;
            }

            var prompt;
            if (action === 'translate') {
              var targetLanguage = preferences &&
                typeof preferences.getTranslationTargetLanguage === 'function'
                ? Promise.resolve().then(function () {
                  return preferences.getTranslationTargetLanguage(storageManager);
                }).catch(function () { return ''; })
                : Promise.resolve('');
              return targetLanguage.then(function (language) {
                prompt = d.translatePrompt.buildTranslatePrompt(text, language);
                return sendToProvider(prompt, key);
              });
            }

            var language = d.language;
            var pageContext = getPageOrigin(checked.pageInfo);
            prompt = d.draftPrompt.buildDraftPrompt(
              text,
              context,
              pageContext,
              language,
              { projectFacts: projectFacts }
            );
            traceDraft('gemini-prompt', {
              selectedTextLength: text.length,
              projectFactsLength: projectFacts.length,
              promptLength: prompt.length,
              hasTrustedFactsSection:
                prompt.indexOf('TRUSTED USER-PROVIDED PROJECT FACTS:') !== -1,
              promptContainsExactFacts:
                !!projectFacts.trim() && prompt.indexOf(projectFacts) !== -1
            });
            return sendToProvider(prompt, key);
          }, function () {
            render({ state: 'error', message: KEY_READ_ERROR_MESSAGE });
          });
      })
      .catch(function (error) {
        if (error && error.message === 'context-provider-failed') {
          render({ state: 'error', message: PROVIDER_ERROR_MESSAGE });
          return;
        }
        render({ state: 'error', message: SAFETY_UNAVAILABLE_MESSAGE });
      });

    function sendToProvider(prompt, key) {
      if (!prompt) {
        render({ state: 'error', message: EMPTY_SELECTION_MESSAGE });
        return Promise.resolve();
      }

      render({
        state: 'working',
        message: action === 'translate' ? 'Translating…' : 'Drafting reply…'
      });

      return Promise.resolve()
        .then(function () {
          return d.callAI({
            key: key,
            prompt: prompt
          });
        })
        .then(function (result) {
          if (!result || !result.ok || !result.text ||
              typeof result.text !== 'string' || !result.text.trim()) {
            render({
              state: 'error',
              message: (result && result.message) || PROVIDER_ERROR_MESSAGE
            });
            return;
          }
          var responseText = result.text.trim();
          if (action === 'draft-reply' &&
              d.draftPrompt &&
              typeof d.draftPrompt.enforceProjectFacts === 'function') {
            responseText = d.draftPrompt.enforceProjectFacts(
              responseText,
              text,
              context,
              projectFacts,
              d.language
            );
            traceDraft('safeguard-complete', {
              projectFactsLength: projectFacts.length,
              providerReplyLength: result.text.length,
              finalReplyLength: responseText.length,
              finalContainsExactFacts:
                !!projectFacts.trim() &&
                responseText.indexOf(projectFacts.trim()) !== -1
            });
          }
          render({ state: 'ok', text: responseText });
        })
        .catch(function () {
          throw new Error('context-provider-failed');
        });
    }
  }

  function defaultGetKey(win) {
    var storage = win.SahayakStorageManager;
    var apiKeys = win.SahayakApiKeys;
    if (!storage || !apiKeys || typeof apiKeys.getGeminiKey !== 'function') {
      return Promise.resolve('');
    }
    return apiKeys.getGeminiKey(storage);
  }

  function defaultCallAI(win) {
    var explain = win.SahayakExplain;
    return function (opts) {
      if (!explain || typeof explain.explainSelection !== 'function') {
        return Promise.reject(new Error('provider-unavailable'));
      }
      return explain.explainSelection(opts);
    };
  }

  function initUI(win) {
    if (!win || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var picker = doc.getElementById('draft-context-picker');
      var resultEl = doc.getElementById('context-action-result');
      var selectedTextEl = doc.getElementById('context-action-text');
      var copySelectionBtn = doc.getElementById('context-action-copy-selection');
      var copyResultBtn = doc.getElementById('context-action-copy-result');
      var copyStatusEl = doc.getElementById('context-action-copy-status');
      var projectFactsInput = doc.getElementById('draft-project-facts');
      var buttons = doc.querySelectorAll('.draft-context-btn');
      if (!picker || !resultEl || !selectedTextEl ||
          !copySelectionBtn || !copyResultBtn || !copyStatusEl) return;

      var currentRequest = null;
      var currentResult = '';
      var generation = 0;
      var contexts = win.SahayakDraftPrompt &&
        win.SahayakDraftPrompt.CONTEXTS || ['Email', 'LinkedIn', 'Forum'];

      function render(state, requestGeneration) {
        if (requestGeneration !== generation) return;
        resultEl.textContent = state.text || state.message || '';
        resultEl.className = 'context-action-result' +
          (state.state === 'error' ? ' is-error' : '');
        currentResult = state.state === 'ok' && typeof state.text === 'string'
          ? state.text
          : '';
        if (state.state === 'ok') {
          traceDraft('reply-displayed', { resultLength: currentResult.length });
        }
        copyResultBtn.hidden = !currentResult;
      }

      function copyText(text) {
        var clipboard = win.navigator && win.navigator.clipboard;
        if (!text || !clipboard || typeof clipboard.writeText !== 'function') {
          copyStatusEl.textContent =
            'Copy is unavailable here. Select the text and use Ctrl+C.';
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(function () { return clipboard.writeText(text); })
          .then(function () {
            copyStatusEl.textContent = 'Copied to clipboard.';
          })
          .catch(function () {
            copyStatusEl.textContent =
              'Could not copy. Select the text and use Ctrl+C.';
          });
      }

      function run(request, context) {
        var requestGeneration = ++generation;
        var api = win.SahayakPanel;
        var projectFacts = projectFactsInput ? projectFactsInput.value : '';
        traceSelection('draft.context-button-selection', request.text);
        traceDraft('context-button-facts-captured', {
          projectFactsLength: projectFacts.length
        });
        return runContextAction({
          request: request,
          context: context,
          panel: api,
          classifier: win.SahayakSafetyClassifiers,
          preferences: win.SahayakPreferences,
          storageManager: win.SahayakStorageManager,
          translatePrompt: win.SahayakTranslatePrompt,
          draftPrompt: win.SahayakDraftPrompt,
          draftContexts: contexts,
          projectFacts: projectFacts,
          language: win.SahayakLanguage &&
            typeof win.SahayakLanguage.current === 'function'
            ? win.SahayakLanguage.current()
            : 'en',
          getKey: function () { return defaultGetKey(win); },
          callAI: defaultCallAI(win),
          render: function (state) { render(state, requestGeneration); }
        });
      }

      function receive(request) {
        generation++;
        currentRequest = request;
        traceSelection('draft.request-received', request && request.text);
        picker.hidden = !request || request.action !== 'draft-reply';
        selectedTextEl.textContent =
          request && typeof request.text === 'string' ? request.text : '';
        copySelectionBtn.hidden = !selectedTextEl.textContent;
        copyResultBtn.hidden = true;
        currentResult = '';
        copyStatusEl.textContent = '';
        Array.prototype.forEach.call(buttons, function (button) {
          button.setAttribute('aria-pressed', 'false');
        });
        resultEl.textContent = '';
        resultEl.className = 'context-action-result';
        if (request && request.action === 'draft-reply') {
          resultEl.textContent = request.text
            ? 'Choose a reply context to draft.'
            : EMPTY_SELECTION_MESSAGE;
          if (!request.text) resultEl.className += ' is-error';
        } else if (request && request.action === 'translate') {
          return run(request, null);
        }
        return Promise.resolve();
      }

      copySelectionBtn.addEventListener('click', function () {
        if (currentRequest) {
          traceSelection('panel.selection-copied', currentRequest.text);
          return copyText(currentRequest.text);
        }
      });

      copyResultBtn.addEventListener('click', function () {
        if (currentResult) {
          traceDraft('reply-copied', {
            resultLength: currentResult.length,
            matchesDisplayed: currentResult === resultEl.textContent
          });
          return copyText(currentResult);
        }
      });

      Array.prototype.forEach.call(buttons, function (button) {
        button.addEventListener('click', function () {
          if (!currentRequest || currentRequest.action !== 'draft-reply') return;
          Array.prototype.forEach.call(buttons, function (option) {
            option.setAttribute(
              'aria-pressed',
              option === button ? 'true' : 'false'
            );
          });
          return run(currentRequest, button.getAttribute('data-draft-context'));
        });
      });

      win.SahayakContextActionWorkflow = { receive: receive };
    });
  }

  var api = {
    EMPTY_SELECTION_MESSAGE: EMPTY_SELECTION_MESSAGE,
    SAFETY_BLOCK_MESSAGE: SAFETY_BLOCK_MESSAGE,
    MISSING_KEY_MESSAGE: MISSING_KEY_MESSAGE,
    KEY_READ_ERROR_MESSAGE: KEY_READ_ERROR_MESSAGE,
    PROVIDER_ERROR_MESSAGE: PROVIDER_ERROR_MESSAGE,
    getPageOrigin: getPageOrigin,
    runContextAction: runContextAction,
    initUI: initUI
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakContextActions = api;
    initUI(global);
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
