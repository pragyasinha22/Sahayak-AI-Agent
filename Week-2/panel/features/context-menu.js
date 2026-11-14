'use strict';

(function (global) {
  function initUI(win) {
    if (!win || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var notice = doc.getElementById('context-action-notice');
      var actionEl = doc.getElementById('context-action-name');
      var textEl = doc.getElementById('context-action-text');
      var contract = win.SahayakContextAction;
      var panel = win.SahayakPanel;
      var runtime = win.chrome && win.chrome.runtime;
      var storage = win.chrome && win.chrome.storage;
      var session = storage && storage.session;
      if (!notice || !actionEl || !textEl || !contract) return;

      var activeTabId = null;
      var seenRequestIds = Object.create(null);
      var queuedRequests = Object.create(null);

      function clearPending(tabId) {
        if (session && typeof session.remove === 'function') {
          Promise.resolve(session.remove(contract.storageKey(tabId))).catch(function () {});
        }
      }

      function showRequest(value, source) {
        if (typeof contract.traceSelection === 'function') {
          contract.traceSelection(
            'panel.request-received:' + (source || 'unknown'),
            value && value.text
          );
        }
        var request = contract.sanitizeRequest(value);
        if (!request) return;
        if (typeof contract.traceSelection === 'function') {
          contract.traceSelection('panel.request-validated', request.text);
        }
        if (activeTabId === null) {
          queuedRequests[request.tabId] = request;
          return;
        }
        if (request.tabId !== activeTabId) return;
        if (seenRequestIds[request.requestId]) {
          clearPending(request.tabId);
          return;
        }

        seenRequestIds[request.requestId] = true;
        actionEl.textContent = contract.ACTION_LABELS[request.action];
        textEl.textContent = request.text;
        if (typeof contract.traceSelection === 'function') {
          contract.traceSelection('panel.selection-displayed', textEl.textContent);
        }
        notice.hidden = false;
        var workflow = win.SahayakContextActionWorkflow;
        if (workflow && typeof workflow.receive === 'function') {
          workflow.receive(request);
        }
        clearPending(request.tabId);
      }

      function loadPending(tabId) {
        if (!session || typeof session.get !== 'function') return Promise.resolve();
        var key = contract.storageKey(tabId);
        return Promise.resolve(session.get(key)).then(function (values) {
          var request = contract.sanitizeRequest(values && values[key]);
          if (request && request.tabId === tabId) {
            showRequest(request, 'session-storage');
          }
        }).catch(function () {});
      }

      function refreshActiveTab() {
        if (!panel || typeof panel.requestActiveTabId !== 'function') return;
        Promise.resolve(panel.requestActiveTabId()).then(function (tabId) {
          if (!contract.isValidTabId(tabId)) return;
          activeTabId = tabId;
          notice.hidden = true;
          if (queuedRequests[tabId]) {
            showRequest(queuedRequests[tabId], 'queued-message');
            delete queuedRequests[tabId];
          }
          return loadPending(tabId);
        }).catch(function () {});
      }

      if (runtime && runtime.onMessage) {
        runtime.onMessage.addListener(function (message, sender) {
          if (!message || message.type !== contract.MESSAGE_TYPE) return;
          if (!sender || sender.id !== runtime.id || sender.tab) return;
          showRequest(message, 'runtime-message');
        });
      }

      if (storage && storage.onChanged) {
        storage.onChanged.addListener(function (changes, areaName) {
          if (areaName !== 'session' || !contract.isValidTabId(activeTabId)) return;
          var key = contract.storageKey(activeTabId);
          if (changes && changes[key] && changes[key].newValue) {
            showRequest(changes[key].newValue, 'session-storage-change');
          }
        });
      }

      if (win.chrome && win.chrome.tabs && win.chrome.tabs.onActivated) {
        win.chrome.tabs.onActivated.addListener(refreshActiveTab);
      }

      refreshActiveTab();
    });
  }

  var api = { initUI: initUI };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakContextMenuPanel = api;
    initUI(global);
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);