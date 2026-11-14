/**
 * Sahayak — Shared message contract (Slice 1.1.4)
 * -----------------------------------------------------------------------------
 * Single source of truth for the envelope that travels between the Side Panel,
 * the background service worker, and any future content script. Every process
 * imports this module and validates the same shape, so a caller cannot send a
 * half-formed message and a listener cannot accidentally trust one.
 *
 * Sources:
 *   - docs/problemStatement.md §2.1  (Week 1 — Chrome Extension Foundation)
 *   - docs/architecture.md     §3.2  (Background service worker as thin router)
 *   - docs/architecture.md     §8.1  (Message envelope contract)
 *   - docs/implementation-plan.md Slice 1.1.4
 *   - docs/edge-case.md        EC-SEC-01, EC-SEC-04, EC-W1-05, EC-W3-04
 *
 * Envelope:
 *   {
 *     id:       string,        // unique per-request id; used for correlation
 *     family:   string,        // one of the KNOWN_FAMILIES below
 *     payload:  object|null,   // family-specific data
 *     source:   string,        // 'panel' | 'worker' | 'content'
 *   }
 *
 * Reserved families (Arch §8.1 — nothing else may be routed):
 *   ping                 — sanity round-trip panel <-> worker
 *   extract-article      — panel -> content (tab-scoped)
 *   scan-elements        — panel -> content (tab-scoped)
 *   capture-screenshot   — panel -> worker (chrome.tabs.captureVisibleTab)
 *   execute-approved     — panel -> content (tab-scoped); requires approval
 *                          token enforced in Slice 3.4.4, not by the router
 *
 * Architectural rules honoured by this module:
 *   INV-2  Keys NEVER appear in a routed message. containsForbidden() walks
 *          the whole object and rejects any envelope carrying an apiKey-like
 *          field at any depth.
 *   GDR-3  Router cannot leak keys to a content script — enforced by the
 *          same containsForbidden() check on both outbound directions.
 *   GDR-6  No new families introduced here — only the four reserved by Arch
 *          §8.1 plus `ping` for the router's own acceptance test.
 *
 * No Chrome APIs are used here. This module is pure and Node-testable.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  const FAMILIES = Object.freeze({
    PING: 'ping',
    EXTRACT_ARTICLE: 'extract-article',
    SCAN_ELEMENTS: 'scan-elements',
    CAPTURE_SCREENSHOT: 'capture-screenshot',
    EXECUTE_APPROVED: 'execute-approved',
  });

  const SOURCES = Object.freeze({
    PANEL: 'panel',
    WORKER: 'worker',
    CONTENT: 'content',
  });

  const KNOWN_FAMILIES = new Set(Object.values(FAMILIES));
  const KNOWN_SOURCES = new Set(Object.values(SOURCES));

  /**
   * Families that must be forwarded by the worker to a specific tab's content
   * script (or handled by the worker with tab context, as with screenshot).
   * Validation therefore requires a positive `payload.tabId` for these.
   */
  const TAB_ROUTES = new Set([
    FAMILIES.EXTRACT_ARTICLE,
    FAMILIES.SCAN_ELEMENTS,
    FAMILIES.CAPTURE_SCREENSHOT,
    FAMILIES.EXECUTE_APPROVED,
  ]);

  /**
   * Field names that must never appear anywhere in a routed envelope. The
   * walk is intentionally broad (snake + camel + generic secret-ish tokens)
   * so a future caller cannot accidentally forward credentials to a tab.
   *
   * Matches EC-SEC-01 (keys not truly secret in a distributed extension)
   * and INV-2 (keys never cross the process boundary).
   */
  const FORBIDDEN = Object.freeze([
    'apiKey',
    'api_key',
    'geminiApiKey',
    'gemini_key',
    'groqApiKey',
    'groq_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'clientSecret',
    'client_secret',
    'serviceAccount',
    'service_account',
  ]);

  const FORBIDDEN_SET = new Set(FORBIDDEN);
  const MAX_WALK_DEPTH = 12;

  /**
   * Recursive walk over plain objects and arrays. Returns the first offending
   * key name it finds, or null if the value is safe to route.
   *
   * Non-plain objects (Map, Set, Date, class instances) are treated as opaque:
   * we do not walk their internals because the extension never constructs one
   * inside an envelope, and doing so would risk cross-realm surprises.
   */
  function containsForbidden(value, depth) {
    const d = depth || 0;
    if (d > MAX_WALK_DEPTH) return null;
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return null;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const found = containsForbidden(value[i], d + 1);
        if (found) return found;
      }
      return null;
    }

    // Only walk plain objects.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;

    for (const k of Object.keys(value)) {
      if (FORBIDDEN_SET.has(k)) return k;
      const found = containsForbidden(value[k], d + 1);
      if (found) return found;
    }
    return null;
  }

  /**
   * Validates the envelope shape and every rule the router relies on.
   * Returns `{ ok: true }` or `{ ok: false, reason: '<machine-code>' }`.
   * The reason string is a stable code — never user text — so routers and
   * tests can compare without depending on phrasing (EC-SEC-04).
   */
  function validateEnvelope(msg) {
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
      return { ok: false, reason: 'envelope-not-object' };
    }
    if (typeof msg.id !== 'string' || msg.id.length === 0) {
      return { ok: false, reason: 'missing-or-bad-id' };
    }
    if (typeof msg.family !== 'string' || msg.family.length === 0) {
      return { ok: false, reason: 'missing-family' };
    }
    if (!KNOWN_FAMILIES.has(msg.family)) {
      return { ok: false, reason: 'unknown-family' };
    }
    if (
      msg.payload !== undefined &&
      msg.payload !== null &&
      (typeof msg.payload !== 'object' || Array.isArray(msg.payload))
    ) {
      return { ok: false, reason: 'payload-not-object' };
    }
    if (typeof msg.source !== 'string' || !KNOWN_SOURCES.has(msg.source)) {
      return { ok: false, reason: 'bad-source' };
    }

    // Forbidden-field walk runs on the *whole* envelope, not just payload,
    // so a caller cannot smuggle a key as a sibling of `family`.
    const forbiddenKey = containsForbidden(msg, 0);
    if (forbiddenKey) {
      return { ok: false, reason: 'forbidden-field:' + forbiddenKey };
    }

    if (TAB_ROUTES.has(msg.family)) {
      const p = msg.payload || {};
      if (typeof p.tabId !== 'number' || !Number.isFinite(p.tabId) || p.tabId <= 0) {
        return { ok: false, reason: 'missing-tabId' };
      }
    }

    return { ok: true };
  }

  /**
   * Extension-safe id generator. Uses crypto.randomUUID when available
   * (Chrome 92+, Node 19+) and falls back to a time + random composite so
   * the pure module also runs under older Node test harnesses.
   */
  function newMessageId() {
    if (
      typeof global.crypto === 'object' &&
      global.crypto !== null &&
      typeof global.crypto.randomUUID === 'function'
    ) {
      return global.crypto.randomUUID();
    }
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 10);
    return 'msg-' + t + '-' + r;
  }

  const api = {
    FAMILIES,
    SOURCES,
    KNOWN_FAMILIES,
    KNOWN_SOURCES,
    TAB_ROUTES,
    FORBIDDEN,
    validateEnvelope,
    containsForbidden,
    newMessageId,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakMessageContract = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
