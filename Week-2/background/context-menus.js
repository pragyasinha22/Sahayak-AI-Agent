'use strict';

(function (global) {
  function create(deps) {
    var d = deps || {};
    var menus = d.contextMenus;
    var sidePanel = d.sidePanel;
    var runtime = d.runtime;
    var storage = d.storage;
    var contract = d.contract || global.SahayakContextAction;
    var registrationPromise = null;

    function traceSelection(stage, text) {
      if (contract && typeof contract.traceSelection === 'function') {
        contract.traceSelection(stage, text);
      }
    }

    function register() {
      if (registrationPromise) return registrationPromise;
      if (!menus || typeof menus.removeAll !== 'function' ||
          typeof menus.create !== 'function' || !contract) {
        return Promise.reject(new Error('context-menu-api-unavailable'));
      }

      registrationPromise = new Promise(function (resolve, reject) {
        menus.removeAll(function () {
          if (runtime && runtime.lastError) {
            registrationPromise = null;
            reject(new Error('context-menu-reset-failed'));
            return;
          }

          var index = 0;
          function createNext() {
            if (index >= contract.MENU_ITEMS.length) {
              resolve();
              return;
            }
            var item = contract.MENU_ITEMS[index++];
            menus.create({
              id: item.id,
              title: item.title,
              contexts: ['selection']
            }, function () {
              if (runtime && runtime.lastError) {
                registrationPromise = null;
                reject(new Error('context-menu-create-failed'));
                return;
              }
              createNext();
            });
          }
          createNext();
        });
      });

      return registrationPromise;
    }

    function savePending(request) {
      if (!storage || typeof storage.set !== 'function') {
        return Promise.resolve(false);
      }
      var values = {};
      values[contract.storageKey(request.tabId)] = request;
      traceSelection('worker.session-write', request.text);
      return Promise.resolve()
        .then(function () { return storage.set(values); })
        .then(function () {
          traceSelection('worker.session-written', request.text);
          return true;
        })
        .catch(function () { return false; });
    }

    function sendToPanel(request) {
      if (!runtime || typeof runtime.sendMessage !== 'function') {
        return Promise.resolve(false);
      }
      traceSelection('worker.runtime-send', request.text);
      return Promise.resolve()
        .then(function () { return runtime.sendMessage(request); })
        .then(function () {
          traceSelection('worker.runtime-sent', request.text);
          return true;
        })
        .catch(function () { return false; });
    }

    function handleClick(info, tab) {
      if (runtime && runtime.id && global.console &&
          typeof global.console.info === 'function') {
        global.console.info('[Sahayak context diagnostic]', {
          stage: 'worker.identity',
          extensionId: runtime.id
        });
      }
      var request = contract && contract.createRequest(
        info && info.menuItemId,
        info && info.selectionText,
        tab,
        info && info.pageUrl,
        contract.createRequestId()
      );

      if (!request) {
        return Promise.resolve({ ok: false, error: 'invalid-context-request' });
      }
      if (!sidePanel || typeof sidePanel.open !== 'function') {
        return Promise.resolve({ ok: false, error: 'side-panel-unavailable' });
      }

      var opening;
      try {
        // Keep this call in the context-menu user-gesture stack.
        opening = sidePanel.open({ tabId: request.tabId });
      } catch (_) {
        return Promise.resolve({ ok: false, error: 'panel-open-failed' });
      }

      return Promise.resolve(opening).then(function () {
        return savePending(request).then(function (stored) {
          return sendToPanel(request).then(function (sent) {
            if (!stored && !sent) {
              return { ok: false, error: 'handoff-unavailable' };
            }
            return { ok: true, requestId: request.requestId };
          });
        });
      }).catch(function () {
        return { ok: false, error: 'panel-open-failed' };
      });
    }

    function clearTab(tabId) {
      if (!contract || !contract.isValidTabId(tabId) ||
          !storage || typeof storage.remove !== 'function') {
        return Promise.resolve();
      }
      return Promise.resolve(storage.remove(contract.storageKey(tabId)))
        .catch(function () {});
    }

    return {
      register: register,
      handleClick: handleClick,
      clearTab: clearTab
    };
  }

  var api = { create: create };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  global.SahayakContextMenus = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);