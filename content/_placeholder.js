/**
 * Sahayak — Content script placeholder (Slice 1.1.4)
 * -----------------------------------------------------------------------------
 * A minimal, feature-free content script whose only job is to prove that the
 * background router can reach a tab-scoped listener end-to-end. Real page
 * reading starts in Slice 1.3.1; real page acting starts in Slice 3.4.1.
 *
 * Sources:
 *   - docs/architecture.md      §3.3 (Content script boundary)
 *   - docs/implementation-plan.md Slice 1.1.4 (Chrome test: "observe routing
 *                                  to a stub content script on a demo page")
 *   - docs/edge-case.md         EC-SEC-05 (isolated world)
 *
 * Rules honoured here:
 *   - Runs in Chrome's default ISOLATED world. Page scripts on the host page
 *     cannot see this file's globals or intercept its chrome.* calls.
 *   - Never reads chrome.storage. Never sees an API key. (The message
 *     contract forbids key-bearing envelopes on both directions.)
 *   - Never originates a click, form submit, or navigation. Slice 3.4.x
 *     introduces executor logic behind an approval token.
 *
 * Registered URL scope: see manifest.json -> content_scripts[0].matches.
 * Kept deliberately narrow (`https://example.com/*`) for Slice 1.1.4 to avoid
 * a broad `<all_urls>` host grant. Broader matches arrive with Slice 1.3.1
 * once Read Mode requires the extraction listener everywhere.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function () {
  const contract = self.SahayakMessageContract;
  if (!contract) {
    // The manifest is expected to load shared/message-contract.js alongside
    // this file. If it's missing we bail out rather than accept a message
    // we cannot validate. No log — we do not want to spam the page console.
    return;
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
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

    // Feature stub. Real behaviours arrive in later slices. The response is
    // deliberately shaped so the router's forwarding logic wraps it unchanged.
    sendResponse({
      ok: false,
      error: 'not-implemented',
      family: message.family,
      requestId: message.id,
      source: contract.SOURCES.CONTENT,
    });
    return false;
  });

  // One-time, page-console marker so a manual tester can confirm the stub is
  // alive on the demo tab without inspecting chrome://extensions.
  try {
    console.log(
      '[Sahayak] content placeholder registered (family stubs ready; no features yet)'
    );
  } catch (_) {
    /* Site CSP may forbid console; ignore. */
  }
})();
