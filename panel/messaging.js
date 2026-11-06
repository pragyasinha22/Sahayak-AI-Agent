/**
 * Sahayak — Panel messaging channel (Slice 1.1.4, gated in Slice 1.2.2)
 * -----------------------------------------------------------------------------
 * The Side Panel's only way to talk to the outside world. Exposes:
 *
 *   SahayakPanelMessaging.install(global, deps?) ->
 *     { send, guardedSend, guardRead, guardAction, ping,
 *       requestActiveTabId, requestPageInfo, contract, gate }
 *
 * The installed object is also assigned to `global.SahayakPanel` so a manual
 * tester can call `SahayakPanel.ping()` (Slice 1.1.4 acceptance) or
 * `SahayakPanel.guardedSend('extract-article', { tabId })` (Slice 1.2.2
 * Chrome test) from the panel DevTools console.
 *
 * Slice 1.2.2 — safety becomes architectural (Arch §6.1):
 *   - `guardedSend(family, payload)` is the ONLY sanctioned path for the
 *     protected families (extract-article, scan-elements, execute-approved).
 *     It looks up the target tab's URL, consults the pure safety module via
 *     panel/safety-gate.js, and only marks + forwards the payload when the
 *     gate allowed it. Blocked requests never reach chrome.runtime.sendMessage.
 *   - `send()` on a protected family with an UNGUARDED payload logs a stable
 *     'safety-gate-bypass' warning and is REJECTED before
 *     chrome.runtime.sendMessage in every build; it THROWS synchronously in
 *     dev/test builds (unpacked extension) — plan Acceptance: "attempts
 *     without going through the gate throw in dev/test builds".
 *   - `ping` and non-tab families stay unguarded so the Slice 1.1.4
 *     round-trip is preserved.
 *
 * Security guarantees preserved from Slice 1.1.4:
 *   - Client-side forbidden-field walk runs BEFORE chrome.runtime.sendMessage
 *     (INV-2, GDR-3) — a payload carrying apiKey is rejected before the gate
 *     even sees it.
 *   - We never log `payload`. Only stable error codes are logged (INV-9).
 *
 * deps (all injectable for Node unit tests):
 *   { gate, tabsApi, safetyGateModule, isDevBuild, requestConfirm, console }
 *   isDevBuild defaults to an unpacked-load check via the manifest
 *   (updateUrl is present only for Web Store / policy-installed builds).
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  function install(g, deps) {
    const D = deps || {};
    const contract = g && g.SahayakMessageContract;
    if (!contract || typeof contract.validateEnvelope !== 'function') {
      console.warn('[Sahayak] message contract not loaded; panel messaging disabled');
      return null;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.warn('[Sahayak] chrome.runtime unavailable; panel messaging disabled');
      return null;
    }

    // Slice 1.2.2 hardening: an unguarded protected send is refused in
    // EVERY build. Unpacked (Load unpacked) extensions are the dev/test
    // surface; Web Store / policy installs set manifest.updateUrl, so its
    // absence is Chrome's own packed-vs-unpacked signal.
    const isDevBuild = D.isDevBuild || function () {
      try {
        return !chrome.runtime.getManifest().updateUrl;
      } catch (_) {
        return false;
      }
    };

    // ------------------------------------------------------------------
    // Safety gate wiring (Slice 1.2.2). Missing gate modules degrade to
    // "no guard available" — guardedSend then refuses protected families
    // (deny-biased) while ping/other unguarded paths keep working.
    // ------------------------------------------------------------------
    let gate = D.gate || null;
    if (!gate) {
      const gateModule = D.safetyGateModule || (g && g.SahayakSafetyGate);
      if (gateModule && typeof gateModule.makeGate === 'function') {
        try {
          gate = gateModule.makeGate({
            isDevBuild: isDevBuild,
            requestConfirm: D.requestConfirm,
            console: D.console,
          });
        } catch (err) {
          // Rules/classifiers/policy not loaded — surface once, then run
          // without the gate (guardedSend will refuse protected families).
          console.warn('[Sahayak] safety gate unavailable:', err && err.message);
        }
      }
    }

    const tabsApi = D.tabsApi || (typeof chrome !== 'undefined' ? chrome.tabs : undefined);

    // ------------------------------------------------------------------
    // Core send. `send` is the raw channel; the WeakSet+Symbol mark made
    // by gate.markGuarded is what lets it pass the protected-family check.
    // ------------------------------------------------------------------
    function send(family, payload, source) {
      // Slice 1.2.2 bypass detection. Runs OUTSIDE (before) the Promise
      // constructor so a dev/test-build programmer error THROWS
      // synchronously at the caller — matching the plan's Acceptance
      // wording "attempts without going through the gate throw in dev/test
      // builds" — and never surfaces as an unhandled promise rejection.
      // Packed builds log the stable warning and still REFUSE egress:
      // Slice 1.2.2 makes the gate non-bypassable, so warn-only-plus-send
      // is not acceptable. The rejection is returned BEFORE the Promise
      // body (and therefore before chrome.runtime.sendMessage) runs, in
      // every build. Runs before the forbidden-field walk so a bypass is
      // attributed to the correct cause.
      const isProtected =
        contract.TAB_ROUTES.has(family) || (gate && gate.requiresGuard(family));
      if (isProtected) {
        const p = payload == null ? {} : payload;
        const guarded = gate && gate.isGuarded(p);
        if (!guarded) {
          const bypassErr = new Error('safety-gate-bypass:' + family);
          if (gate && gate.isDevBuild()) {
            // Plan Acceptance: throw in dev/test builds. Unpacked
            // extensions are exactly the dev/test surface.
            throw bypassErr;
          }
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[Sahayak] ' + bypassErr.message);
          }
          return Promise.reject(bypassErr);
        }
      }

      return new Promise(function (resolve, reject) {
        // Defence-in-depth: a protected family may only egress with a gate
        // mark. This re-check makes chrome.runtime.sendMessage for
        // extract-article / scan-elements / execute-approved structurally
        // impossible without one, independent of the isDevBuild() flag, so
        // even a future fall-through past the early guard above cannot
        // re-enable the Slice 1.2.2 bypass.
        if (
          isProtected &&
          !(gate && gate.isGuarded(payload == null ? {} : payload))
        ) {
          reject(new Error('safety-gate-bypass:' + family));
          return;
        }
        const envelope = {
          id: contract.newMessageId(),
          family: family,
          payload: payload == null ? {} : payload,
          source: source || contract.SOURCES.PANEL,
        };

        // Client-side forbidden-field walk. Reject before we ever touch
        // chrome.runtime.sendMessage (INV-2, GDR-3).
        const forbiddenKey = contract.containsForbidden(envelope, 0);
        if (forbiddenKey) {
          reject(new Error('forbidden-field:' + forbiddenKey));
          return;
        }

        // Client-side shape check. Any error here is a programmer bug in
        // the caller — surface it, do not silently forward.
        const validation = contract.validateEnvelope(envelope);
        if (!validation.ok) {
          reject(new Error('invalid-envelope:' + validation.reason));
          return;
        }

        chrome.runtime.sendMessage(envelope, function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'send-failed'));
            return;
          }
          resolve(response);
        });
      });
    }

    /**
     * Convenience wrapper for the Slice 1.1.4 acceptance test. Callers can
     * also invoke `send('ping', {})` directly. `ping` is not a guarded
     * family, so the raw channel is correct here.
     */
    function ping() {
      return send(contract.FAMILIES.PING, {});
    }

    /**
     * Returns the currently active tab id in the panel's own window. Used by
     * Slice 1.3.1+ to build tab-routed envelopes without asking the caller
     * to pass a tabId explicitly. Fails gracefully if chrome.tabs.query is
     * unavailable (e.g. unit-test harness) or if no active tab exists.
     */
    function requestActiveTabId() {
      return new Promise(function (resolve, reject) {
        if (!tabsApi || !tabsApi.query) {
          reject(new Error('tabs-api-unavailable'));
          return;
        }
        tabsApi.query({ active: true, currentWindow: true }, function (tabs) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'query-failed'));
            return;
          }
          const t = tabs && tabs[0];
          if (!t || typeof t.id !== 'number') {
            reject(new Error('no-active-tab'));
            return;
          }
          resolve(t.id);
        });
      });
    }

    /**
     * Slice 1.2.2 — reads the target tab's URL so the gate can classify it.
     * Restricted/empty URLs come back as `url: ''` which classifyPage maps
     * to `unknown` → block (deny-biased, EC-W2-12).
     */
    function requestPageInfo(tabId) {
      return new Promise(function (resolve, reject) {
        if (!tabsApi || typeof tabsApi.get !== 'function') {
          reject(new Error('tabs-api-unavailable'));
          return;
        }
        tabsApi.get(tabId, function (tab) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'tab-get-failed'));
            return;
          }
          resolve({ url: (tab && typeof tab.url === 'string') ? tab.url : '' });
        });
      });
    }

    /**
     * Slice 1.2.2 — the sanctioned path for protected families.
     *
     *   read families (extract-article, scan-elements):
     *     payload.tabId → requestPageInfo → guardRead → allow? mark+send
     *   action family (execute-approved):
     *     payload.tabId → requestPageInfo → guardAction(envelope, pageInfo)
     *     → allow (or user-confirmed)? mark+send
     *
     * Rejects with stable codes: 'safety-blocked:<reason>',
     * 'safety-confirm-declined', 'safety-gate-unavailable'. Nothing rejected
     * here ever touches chrome.runtime.sendMessage.
     */
    function guardedSend(family, payload, source) {
      if (!gate) {
        return Promise.reject(new Error('safety-gate-unavailable'));
      }
      if (!gate.requiresGuard(family)) {
        // Unguarded families go straight through the raw channel.
        return send(family, payload, source);
      }
      const p = payload == null ? {} : payload;
      return requestPageInfo(p.tabId)
        .then(function (pageInfo) {
          if (gate.READ_FAMILIES.indexOf(family) !== -1) {
            return gate.guardRead(pageInfo).then(function (res) {
              return { direction: 'read', res: res };
            });
          }
          // Build the envelope first so guardAction sees exactly what would
          // be routed (family + payload shape assertions in one place).
          const envelope = {
            id: contract.newMessageId(),
            family: family,
            payload: p,
            source: source || contract.SOURCES.PANEL,
          };
          return gate.guardAction(envelope, pageInfo).then(function (res) {
            return { direction: 'action', res: res, envelope: envelope };
          });
        })
        .then(function (step) {
          const res = step.res;
          if (!res.allowed) {
            const code = res.reason === 'confirm-declined'
              ? 'safety-confirm-declined'
              : 'safety-blocked:' + (res.reason || res.decision);
            throw new Error(code);
          }
          if (step.direction === 'read') {
            gate.markGuarded(p);
            return send(family, p, source);
          }
          gate.markGuarded(step.envelope.payload);
          // send() re-derives its own envelope internally; the mark on the
          // caller's payload object is what it checks, so forwarding `p`
          // keeps the bypass detection honest.
          return send(family, step.envelope.payload, source);
        });
    }

    const api = {
      send: send,
      guardedSend: guardedSend,
      guardRead: gate ? gate.guardRead : undefined,
      guardAction: gate ? gate.guardAction : undefined,
      ping: ping,
      requestActiveTabId: requestActiveTabId,
      requestPageInfo: requestPageInfo,
      contract: contract,
      gate: gate,
    };

    // Expose for Chrome manual testing per Slice 1.1.4 + 1.2.2 acceptance.
    g.SahayakPanel = api;
    return api;
  }

  const api = { install: install };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakPanelMessaging = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
