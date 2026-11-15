/**
 * Sahayak — Background message router (Slice 1.1.4)
 * -----------------------------------------------------------------------------
 * The worker is a THIN coordinator (Arch §3.2, §8.1). It does not decide
 * policy, does not hold state, and does not touch API keys. It:
 *
 *   1. Validates every incoming envelope via SahayakMessageContract.
 *   2. Answers `ping` directly so the panel can observe a round-trip without
 *      needing any content script running.
 *   3. Captures the active visible tab for `capture-screenshot`; forwards
 *      other tab-routed families (extract-article, scan-elements,
 *      execute-approved) to the target tab via
 *      chrome.tabs.sendMessage, wrapping either the content reply or a
 *      graceful { ok:false, error:'no-content-script' } back to the panel.
 *
 * Sources:
 *   - docs/problemStatement.md  §2.1 (Week 1 — Chrome Extension Foundation)
 *   - docs/architecture.md      §3.2 (Background service worker responsibilities)
 *   - docs/architecture.md      §8.1 (Message envelope contract)
 *   - docs/implementation-plan.md Slice 1.1.4 (Acceptance: "no key ever crosses
 *                                  into a routed message (assert in router)")
 *   - docs/edge-case.md         EC-SEC-01, EC-SEC-04, EC-W1-05
 *
 * Security guarantees enforced here:
 *   - Every envelope is validated before being routed anywhere. A payload
 *     carrying apiKey / geminiApiKey / token-shaped fields is rejected with
 *     error 'invalid-envelope' and never reaches chrome.tabs.sendMessage.
 *   - We NEVER enrich a routed message with anything read from
 *     chrome.storage.local — the router is stateless.
 *   - We never console.log the payload itself (INV-9).
 *
 * Not implemented here (deliberately, owned by later slices):
 *   - Approval-token verification for `execute-approved` -> Slice 3.4.4.
 *   - Safety-gate classification before routing          -> Slice 1.2.1.
 *   - Rate limiting / dedupe of identical ids            -> Slice 3.4.5.
 *   - Screenshot capture uses the worker's tabs API after validating that the
 *     requested tab is the active tab in its window. Crop selection remains
 *     panel-owned; the worker never stores or logs image data.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  /**
   * @param {object} contract  SahayakMessageContract (injected so the router
   *                           is Node-testable with a stub).
   * @param {object} [deps]    Optional override of { tabs, runtime } for tests.
   * @returns {(message:any, sender:any, sendResponse:(r:any)=>void)=>boolean}
   */
  function makeHandler(contract, deps) {
    if (!contract || typeof contract.validateEnvelope !== 'function') {
      throw new TypeError('SahayakRouter.makeHandler: contract is required');
    }
    const D = deps || {};
    const tabsApi = D.tabs || (typeof chrome !== 'undefined' ? chrome.tabs : undefined);
    const runtimeApi =
      D.runtime || (typeof chrome !== 'undefined' ? chrome.runtime : undefined);

    return function handle(message, sender, sendResponse) {
      void sender; // Chrome's MessageSender; unused by the router today.

      if (typeof sendResponse !== 'function') {
        // Fire-and-forget sender; nothing to reply to. Do not claim the
        // channel is open.
        return false;
      }

      const validation = contract.validateEnvelope(message);
      if (!validation.ok) {
        sendResponse({
          ok: false,
          error: 'invalid-envelope',
          reason: validation.reason,
          requestId: message && typeof message.id === 'string' ? message.id : null,
        });
        return false;
      }

      // Family `ping` closes the loop entirely inside the worker. This is
      // what Slice 1.1.4 acceptance "Panel sends a ping payload; router
      // returns pong" refers to.
      if (message.family === contract.FAMILIES.PING) {
        sendResponse({
          ok: true,
          result: 'pong',
          requestId: message.id,
          source: contract.SOURCES.WORKER,
        });
        return false;
      }

      if (message.family === contract.FAMILIES.CAPTURE_SCREENSHOT) {
        if (
          !tabsApi ||
          typeof tabsApi.get !== 'function' ||
          typeof tabsApi.captureVisibleTab !== 'function'
        ) {
          sendResponse({
            ok: false,
            error: 'capture-unavailable',
            requestId: message.id,
            source: contract.SOURCES.WORKER,
          });
          return false;
        }

        const tabId = message.payload.tabId;
        tabsApi.get(tabId, function (tab) {
          if (
            (runtimeApi && runtimeApi.lastError) ||
            !tab ||
            tab.active !== true ||
            typeof tab.windowId !== 'number'
          ) {
            sendResponse({
              ok: false,
              error: 'capture-unavailable',
              requestId: message.id,
              source: contract.SOURCES.WORKER,
            });
            return;
          }

          tabsApi.captureVisibleTab(
            tab.windowId,
            { format: 'png' },
            function (dataUrl) {
              if (
                (runtimeApi && runtimeApi.lastError) ||
                typeof dataUrl !== 'string' ||
                dataUrl.indexOf('data:image/') !== 0
              ) {
                sendResponse({
                  ok: false,
                  error: 'capture-unavailable',
                  requestId: message.id,
                  source: contract.SOURCES.WORKER,
                });
                return;
              }

              sendResponse({
                ok: true,
                result: { dataUrl: dataUrl },
                requestId: message.id,
                source: contract.SOURCES.WORKER,
              });
            }
          );
        });

        return true;
      }

      // Tab-routed families forward to the content script in the given tab.
      // The router does not interpret the payload — that is the target's job.
      const tabId = message.payload && message.payload.tabId;
      if (!tabsApi || typeof tabsApi.sendMessage !== 'function') {
        sendResponse({
          ok: false,
          error: 'router-misconfigured',
          reason: 'tabs.sendMessage unavailable',
          requestId: message.id,
        });
        return false;
      }

      tabsApi.sendMessage(tabId, message, function (response) {
        const lastErr = runtimeApi && runtimeApi.lastError;
        if (lastErr) {
          // EC-W1-05 (no listener on tab) and EC-W1-06 (restricted page) both
          // surface here. We translate the raw Chrome error into a stable
          // machine code and never echo the underlying message back verbatim
          // into a data field beyond `reason`, because Chrome's own strings
          // sometimes quote the extension id (harmless, but we prefer shape).
          sendResponse({
            ok: false,
            error: 'no-content-script',
            reason: String(lastErr.message || 'unknown'),
            requestId: message.id,
          });
          return;
        }
        sendResponse({
          ok: true,
          result: response,
          requestId: message.id,
          source: contract.SOURCES.CONTENT,
        });
      });

      // Keep the message port open so the asynchronous sendResponse above
      // can actually reach the panel (Chrome requirement).
      return true;
    };
  }

  const api = { makeHandler };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakRouter = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
