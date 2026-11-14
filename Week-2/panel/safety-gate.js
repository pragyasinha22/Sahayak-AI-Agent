/**
 * Sahayak — Panel safety gate (Slice 1.2.2)
 * -----------------------------------------------------------------------------
 * Makes the Slice 1.2.1 pure module non-bypassable from the panel side.
 * The gate is the ONLY sanctioned way a protected message family may leave
 * the panel (Arch §6.1: "the Safety Engine sits in the Side Panel between
 * the orchestrator/summariser and any egress").
 *
 * Exposed API (UMD — `global.SahayakSafetyGate` in the panel, module.exports
 * in Node tests):
 *
 *   makeGate(deps)        -> { guardRead, guardAction, requiresGuard,
 *                              markGuarded, isGuarded, DECISION, isDevBuild }
 *
 *   guardRead(pageInfo)          -> Promise<{ decision, allowed, class, reason }>
 *   guardAction(envelope, info)  -> Promise<{ decision, allowed, ... }>
 *
 * deps (all injectable so the gate is Node-testable without Chrome):
 *   { RULES, CLASSIFIERS, POLICY, requestConfirm, isDevBuild, console }
 *
 * Sources:
 *   - docs/architecture.md      §6.1 (placement), §6.2 (rules), §6.3 (properties)
 *   - docs/problemStatement.md  §2.20 (Safety Enforcement)
 *   - docs/implementation-plan.md Slice 1.2.2 Steps/Acceptance/Unit tests
 *   - docs/edge-case.md         EC-W2-11, EC-W3-12, EC-W4-07, EC-W4-08,
 *                               INV-3, INV-6, INV-7
 *
 * Design properties:
 *   - The gate never re-implements a safety rule. Every decision comes from
 *     safety/policy.js via safety/classifiers.js output (plan: "reuse the
 *     existing safety module").
 *   - `require-confirm` resolves a Promise that only fulfils when the
 *     injected `requestConfirm` resolves truthy — plan Unit-tests bullet
 *     "require-confirm yields a promise that resolves only on confirm".
 *   - No `fetch`, no direct `chrome.*` inside this file: Chrome access is
 *     confined to panel/messaging.js, which is a gate *consumer*.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  // UMD dependency resolution: Node tests require the modules directly; the
  // panel loads safety/rules.js → safety/classifiers.js → safety/policy.js
  // via <script> tags before this file (see panel/side-panel.html).
  function resolveDep(name, reqPath, globalName) {
    if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
      try { return require(reqPath); } catch (_) { /* fall through */ }
    }
    return global && global[globalName];
  }

  /**
   * Families that MUST pass the gate before leaving the panel.
   * - Read paths (plan wording "extract-article") plus `scan-elements`,
   *   which is the Week-3 page-read for the action map — same egress class.
   * - Action paths ("execute-approved" — every content-script command).
   * `ping` stays unguarded: it is the router's own round-trip and carries
   * no page content (Slice 1.1.4 acceptance must not regress).
   */
  const READ_FAMILIES = ['extract-article', 'scan-elements'];
  const ACTION_FAMILIES = ['execute-approved'];
  const GUARDED_FAMILIES = new Set([...READ_FAMILIES, ...ACTION_FAMILIES]);

  // Payload-marking channel between guard* and messaging.send. Because
  // panel↔worker messages are plain JSON objects (never real structured
  // clones inside the panel process), a Symbol key survives the handoff and
  // is invisible to JSON.stringify — so a marked payload cannot fake its way
  // past the bypass check with a normal field.
  const GUARD_SYMBOL = Symbol.for('sahayak.safety-guarded');

  // WeakSet fallback for hosts where the same payload object is passed by
  // reference (unit tests, future in-process callers).
  const markedPayloads = new WeakSet();

  function makeGate(deps) {
    const D = deps || {};
    const RULES = D.RULES || resolveDep('RULES', '../../safety/rules.js', 'SahayakSafetyRules');
    const CLASSIFIERS = D.CLASSIFIERS || resolveDep('CLASSIFIERS', '../../safety/classifiers.js', 'SahayakSafetyClassifiers');
    const POLICY = D.POLICY || resolveDep('POLICY', '../../safety/policy.js', 'SahayakSafetyPolicy');
    if (!RULES || !CLASSIFIERS || !POLICY) {
      throw new Error('SahayakSafetyGate: safety modules (rules/classifiers/policy) are required');
    }
    const log = D.console || (typeof console !== 'undefined' ? console : null);

    const isDevBuild = typeof D.isDevBuild === 'function'
      ? D.isDevBuild
      : function () { return false; };

    // Default confirm UX: window.confirm when present (panel context). In
    // Node tests this is always injected — no DOM dependency.
    const defaultConfirm = function (message) {
      if (typeof global.confirm === 'function') {
        return Promise.resolve(global.confirm(message));
      }
      // No confirm surface available: deny-biased (INV-3).
      return Promise.resolve(false);
    };
    const requestConfirm = typeof D.requestConfirm === 'function'
      ? D.requestConfirm
      : defaultConfirm;

    // ------------------------------------------------------------------
    // Payload marking (used by guardedSend flow in panel/messaging.js)
    // ------------------------------------------------------------------
    function markGuarded(payload) {
      if (!payload || typeof payload !== 'object') return payload;
      try { payload[GUARD_SYMBOL] = true; } catch (_) { /* frozen — WeakSet still applies */ }
      markedPayloads.add(payload);
      return payload;
    }

    function isGuarded(payload) {
      if (!payload || typeof payload !== 'object') return false;
      if (payload[GUARD_SYMBOL] === true) return true;
      return markedPayloads.has(payload);
    }

    // ------------------------------------------------------------------
    // Classify helpers — accept either a pre-classified pageInfo or a raw
    // { url, hints } pair so callers (Slice 1.3.1+) can hand the gate
    // exactly what chrome.tabs.get() gives them.
    // ------------------------------------------------------------------
    function resolvePageClass(pageInfo) {
      const info = pageInfo || {};
      if (typeof info.class === 'string') {
        return { class: info.class, reason: info.reason || 'caller-provided-class', matched: info.matched || null };
      }
      const c = CLASSIFIERS.classifyPage(info.url, info.hints || {});
      return c;
    }

    // ------------------------------------------------------------------
    // guardRead(pageInfo)
    // ------------------------------------------------------------------
    /**
     * Gate for every page-content read (extract-article, scan-elements,
     * and — from Week 2 — every provider egress). Returns a Promise so the
     * signature matches guardAction and stays await-compatible, even though
     * decideRead is synchronous by design.
     *
     * @param {{ url?: string, hints?: object, class?: string, reason?: string }} pageInfo
     * @returns {Promise<{decision:string, allowed:boolean, pageClass:string, reason:string, matched:string|null}>}
     */
    function guardRead(pageInfo) {
      const page = resolvePageClass(pageInfo);
      const decision = POLICY.decideRead(page.class);
      return Promise.resolve({
        decision: decision,
        allowed: decision === RULES.DECISION.ALLOW,
        pageClass: page.class,
        reason: page.reason,
        matched: page.matched == null ? null : page.matched,
      });
    }

    // ------------------------------------------------------------------
    // guardAction(actionEnvelope, pageInfo)
    // ------------------------------------------------------------------
    /**
     * Gate for every content-script command (execute-approved). The
     * envelope payload is expected to carry, per Arch §8.1 + §7:
     *   payload.action : { type, target }  — target is an element
     *                    descriptor consumable by classifyField.
     * Missing action/target/page info escalate rather than fall through
     * (deny-biased, EC-W3-04 / EC-W4-07).
     *
     * @returns {Promise<{decision, allowed, pageClass, targetClass, actionType, reason}>}
     */
    function guardAction(actionEnvelope, pageInfo) {
      const payload = (actionEnvelope && actionEnvelope.payload) || {};
      const action = payload.action || {};
      const actionType = typeof action.type === 'string' ? action.type : null;
      const target = action.target || null;

      const page = resolvePageClass(pageInfo);
      const targetClass = target
        ? CLASSIFIERS.classifyField(target).class
        : RULES.FIELD_CLASS.UNKNOWN;

      const decision = POLICY.decideAction(actionType, targetClass, page.class);

      if (decision === RULES.DECISION.BLOCK) {
        if (log && log.warn) {
          log.warn('[Sahayak] safety gate: blocked', {
            family: actionEnvelope && actionEnvelope.family,
            actionType: actionType,
            targetClass: targetClass,
            pageClass: page.class,
            reason: page.reason,
          });
        }
        return Promise.resolve({
          decision: decision, allowed: false,
          pageClass: page.class, targetClass: targetClass,
          actionType: actionType, reason: page.reason,
        });
      }

      if (decision === RULES.DECISION.REQUIRE_CONFIRM) {
        // Plan Steps: "UI path for require-confirm shows a confirmation
        // prompt". Plan Unit-tests: "yields a promise that resolves only on
        // confirm" — a rejecting promise on decline counts as "refused".
        const message =
          'Sahayak wants to perform a consequential action (' +
          (actionType || 'unknown') + ') on this page. Allow it?';
        return Promise.resolve()
          .then(function () { return requestConfirm(message); })
          .then(function (confirmed) {
            const ok = confirmed === true;
            return {
              decision: ok ? RULES.DECISION.ALLOW : RULES.DECISION.BLOCK,
              originalDecision: RULES.DECISION.REQUIRE_CONFIRM,
              allowed: ok,
              confirmed: ok,
              pageClass: page.class,
              targetClass: targetClass,
              actionType: actionType,
              reason: ok ? (page.reason + '+user-confirmed') : 'confirm-declined',
            };
          });
      }

      // ALLOW
      return Promise.resolve({
        decision: decision, allowed: true,
        pageClass: page.class, targetClass: targetClass,
        actionType: actionType, reason: page.reason,
      });
    }

    function requiresGuard(family) {
      return GUARDED_FAMILIES.has(family);
    }

    return {
      guardRead: guardRead,
      guardAction: guardAction,
      requiresGuard: requiresGuard,
      markGuarded: markGuarded,
      isGuarded: isGuarded,
      isDevBuild: isDevBuild,
      READ_FAMILIES: Object.freeze(READ_FAMILIES.slice()),
      ACTION_FAMILIES: Object.freeze(ACTION_FAMILIES.slice()),
      DECISION: RULES.DECISION,
    };
  }

  const api = { makeGate, READ_FAMILIES: Object.freeze(READ_FAMILIES.slice()), ACTION_FAMILIES: Object.freeze(ACTION_FAMILIES.slice()) };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSafetyGate = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
