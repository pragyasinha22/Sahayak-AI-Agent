/**
 * Sahayak — Content-script selection capture (Slice 1.3.1)
 * -----------------------------------------------------------------------------
 * PS §2.2 "Selected Text Explanation". Runs in the page's ISOLATED world on the
 * URLs listed in manifest.json -> content_scripts[0].matches. Its only job:
 *
 *   - listen for `mouseup`, read the current text selection,
 *   - bound its size (EC-W1-11: oversized selections truncated before any read;
 *     EC empty selection: nothing forwarded, no egress),
 *   - hand the bounded plain-text selection to the Side Panel.
 *
 * Architectural rules honoured here:
 *   - GDR-3 / INV-2  It NEVER touches chrome.storage and never sees an API key;
 *     the message it sends carries only the selected text.
 *   - Arch §3.3      Content scripts return only structured data and never
 *     originate an action. There is no AI call and no decisioning here.
 *   - INV-5          Only the (bounded) selection leaves the page, never the
 *     full raw page text.
 *
 * Transport note: the panel is an extension page, so `chrome.runtime.sendMessage`
 * from a content script is delivered to the panel's own `chrome.runtime.onMessage`
 * listener (see panel/features/explain.js). This deliberately does NOT reuse the
 * four request/response families owned by Slice 1.1.4's message contract
 * (GDR-6 "no new families"); a tiny, namespaced push type is used instead so the
 * completed contract and router are left untouched.
 *
 * Node-testable: the pure helpers are exported via module.exports under Node so
 * tests/unit/selection-explain.test.js can exercise the clamp without a browser.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  var MAX_SELECTION_CHARS = 2000;
  var SELECTION_MESSAGE_TYPE = 'sahayak:selection';

  /**
   * Bounded-size clamp used by both the browser listener and the tests.
   * Returns { text, truncated, empty }. Whitespace-only input is treated as an
   * empty selection (EC empty) so nothing is forwarded.
   */
  function clampSelection(text, max) {
    var limit = (typeof max === 'number' && max > 0) ? max : MAX_SELECTION_CHARS;
    var value = (typeof text === 'string') ? text : '';
    var trimmed = value.trim();
    if (trimmed.length === 0) {
      return { text: '', truncated: false, empty: true };
    }
    if (trimmed.length <= limit) {
      return { text: trimmed, truncated: false, empty: false };
    }
    return { text: trimmed.slice(0, limit), truncated: true, empty: false };
  }

  // --------------------------------------------------------------------------
  // Isolated-world wiring (browser only). Guarded so requiring this file in
  // Node for unit tests has no side effects.
  // --------------------------------------------------------------------------
  function registerSelectionListener(win) {
    if (!win || !win.document || !win.chrome || !win.chrome.runtime ||
        typeof win.chrome.runtime.sendMessage !== 'function') {
      return;
    }
    // Slice 1.3.1 fix: the panel can now inject this script ON DEMAND
    // (explain.js armSelectionCapture). A page that was already declaratively
    // matched — or armed twice — must not stack duplicate mouseup listeners;
    // the window flag makes repeat injection a no-op.
    if (win.__sahayakSelectionRegistered) return;
    win.__sahayakSelectionRegistered = true;

    function onMouseUp() {
      var raw = '';
      try {
        raw = win.getSelection ? String(win.getSelection().toString()) : '';
      } catch (_) {
        raw = '';
      }
      var clamped = clampSelection(raw, MAX_SELECTION_CHARS);
      if (clamped.empty) return; // EC empty selection: no forward, no read.

      var message = {
        type: SELECTION_MESSAGE_TYPE,
        text: clamped.text,
        truncated: clamped.truncated
      };
      // Fire-and-forget. The background router will answer "invalid-envelope"
      // for this non-envelope push; we intentionally ignore every reply, so we
      // swallow the returned promise to avoid an unhandled rejection.
      try {
        var sent = win.chrome.runtime.sendMessage(message);
        if (sent && typeof sent.catch === 'function') sent.catch(function () {});
      } catch (_) {
        /* No receiving context; nothing to do. */
      }
    }

    win.document.addEventListener('mouseup', onMouseUp);
  }

  var api = {
    MAX_SELECTION_CHARS: MAX_SELECTION_CHARS,
    SELECTION_MESSAGE_TYPE: SELECTION_MESSAGE_TYPE,
    clampSelection: clampSelection
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSelection = api;
    registerSelectionListener(global);
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
