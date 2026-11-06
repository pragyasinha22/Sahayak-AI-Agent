/**
 * Sahayak — Gemini API-key helper (Slice 1.1.3).
 * -----------------------------------------------------------------------------
 * Sources:
 *   docs/implementation-plan.md Slice 1.1.3 (Files, Steps, Acceptance, Result)
 *   docs/architecture.md        §9 (Keys in chrome.storage.local; documented
 *                               limitation that a distributed extension's keys
 *                               are NOT truly secret)
 *   docs/problemStatement.md    §5 security note, §2.1 (settings screen)
 *   docs/edge-case.md           EC-W1-07, EC-W1-08, EC-SEC-01, GDR-3, INV-2
 *
 * Rules honoured here:
 *   - The stored value is never logged (INV-9). This module only reads and
 *     writes through the namespaced storage manager; it deliberately contains
 *     no console calls that could accidentally include the key.
 *   - maskKey() is provided so the Settings UI can display a redacted form
 *     without exposing the raw value.
 *   - shapeCheck() validates the SHAPE only ("AIza…" style). Real validity
 *     is checked by Gemini when Week-2 provider calls arrive; a wrong key
 *     returns HTTP 401/403 (EC-W1-08).
 *   - The key never travels to content scripts. Router assertions in
 *     Slice 1.1.4 enforce that; this module simply does not expose the key
 *     to any non-panel process.
 * -----------------------------------------------------------------------------
 */

'use strict';

(function (global) {
  function getGeminiKey(manager) {
    return manager.storageGet(manager.NAMESPACED.GEMINI_KEY);
  }

  function setGeminiKey(manager, value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return manager.storageSet(manager.NAMESPACED.GEMINI_KEY, trimmed);
  }

  function removeGeminiKey(manager) {
    return manager.storageRemove(manager.NAMESPACED.GEMINI_KEY);
  }

  /**
   * Redact a key for display. Shows up to head characters, a middot ellipsis,
   * and up to tail characters. Empty/null input returns an empty string so
   * the caller can render a placeholder separately.
   */
  function maskKey(value, opts) {
    const head = (opts && opts.head) || 4;
    const tail = (opts && opts.tail) || 4;
    if (typeof value !== 'string' || value.length === 0) return '';
    if (value.length <= head + tail) {
      return value[0] + '\u2022'.repeat(Math.max(0, value.length - 1));
    }
    return value.slice(0, head) + '\u2026' + value.slice(value.length - tail);
  }

  /**
   * Shape check: Gemini keys are commonly AIza… 35 chars. This is a UX hint
   * only; the extension never claims a shape-valid key is authenticated.
   */
  function looksLikeGeminiKey(value) {
    return typeof value === 'string' && /^AIza[\w-]{30,}$/.test(value);
  }

  const api = { getGeminiKey, setGeminiKey, removeGeminiKey, maskKey, looksLikeGeminiKey };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakApiKeys = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
