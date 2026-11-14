'use strict';

(function (global) {
  var MESSAGE_TYPE = 'sahayak:context-action';
  var MAX_SELECTION_CHARS = 2000;
  var MENU_ITEMS = Object.freeze([
    { id: 'sahayak-context-explain', action: 'explain', title: 'Explain this' },
    { id: 'sahayak-context-translate', action: 'translate', title: 'Translate this' },
    { id: 'sahayak-context-draft-reply', action: 'draft-reply', title: 'Draft a reply' }
  ]);
  var ACTION_LABELS = Object.freeze({
    explain: 'Explain this',
    translate: 'Translate this',
    'draft-reply': 'Draft a reply'
  });
  var ACTIONS = new Set(Object.keys(ACTION_LABELS));

  function isValidTabId(tabId) {
    return Number.isInteger(tabId) && tabId > 0;
  }

  function clampSelection(text) {
    var value = (typeof text === 'string') ? text : '';
    if (!value.trim()) return '';
    if (value.length <= MAX_SELECTION_CHARS) return value;

    var end = MAX_SELECTION_CHARS;
    var lastCodeUnit = value.charCodeAt(end - 1);
    var nextCodeUnit = value.charCodeAt(end);
    if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF &&
        nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
      end -= 1;
    }
    return value.slice(0, end);
  }

  function getSelectionDiagnostics(text) {
    var value = typeof text === 'string' ? text : '';
    var focus = value.indexOf(', and ');
    if (focus !== -1) {
      focus += 2;
    } else {
      focus = value.toLowerCase().indexOf('what');
      if (focus === -1) focus = value.indexOf(';');
    }

    var start = focus === -1 ? 0 : Math.max(0, focus - 2);
    var end = Math.min(value.length, start + 18);
    var codeUnits = [];
    for (var index = start; index < end; index += 1) {
      codeUnits.push(value.charCodeAt(index));
    }

    var hash = 2166136261;
    for (var hashIndex = 0; hashIndex < value.length; hashIndex += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(hashIndex), 16777619);
    }

    return {
      length: value.length,
      fingerprint: (hash >>> 0).toString(16),
      windowStart: start,
      codeUnits: codeUnits
    };
  }

  function traceSelection(stage, text) {
    if (global.console && typeof global.console.info === 'function') {
      global.console.info('[Sahayak context diagnostic]', {
        stage: stage,
        selection: getSelectionDiagnostics(text)
      });
    }
  }

  function isSupportedUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    try {
      var parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function storageKey(tabId) {
    return 'sahayakContextAction:' + tabId;
  }

  function createRequestId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'context-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function sanitizeRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.type !== MESSAGE_TYPE || !ACTIONS.has(value.action) ||
        !isValidTabId(value.tabId) || typeof value.requestId !== 'string' ||
        !value.requestId.trim()) {
      return null;
    }

    var text = clampSelection(value.text);
    if (!text.trim()) return null;

    return {
      type: MESSAGE_TYPE,
      requestId: value.requestId.slice(0, 100),
      action: value.action,
      text: text,
      tabId: value.tabId
    };
  }

  function createRequest(menuItemId, selectionText, tab, pageUrl, requestId) {
    traceSelection('worker.selection-captured', selectionText);
    var item = MENU_ITEMS.find(function (entry) {
      return entry.id === menuItemId;
    });
    var tabId = tab && tab.id;
    var url = tab && typeof tab.url === 'string' && tab.url
      ? tab.url
      : pageUrl;
    if (!item || !isValidTabId(tabId) || !isSupportedUrl(url)) return null;

    var request = sanitizeRequest({
      type: MESSAGE_TYPE,
      requestId: requestId,
      action: item.action,
      text: selectionText,
      tabId: tabId
    });
    traceSelection('worker.request-created', request && request.text);
    return request;
  }

  var api = {
    MESSAGE_TYPE: MESSAGE_TYPE,
    MAX_SELECTION_CHARS: MAX_SELECTION_CHARS,
    MENU_ITEMS: MENU_ITEMS,
    ACTION_LABELS: ACTION_LABELS,
    isValidTabId: isValidTabId,
    clampSelection: clampSelection,
    isSupportedUrl: isSupportedUrl,
    storageKey: storageKey,
    createRequestId: createRequestId,
    getSelectionDiagnostics: getSelectionDiagnostics,
    traceSelection: traceSelection,
    sanitizeRequest: sanitizeRequest,
    createRequest: createRequest
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  global.SahayakContextAction = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);