/**
 * Sahayak — Safety policy (Slice 1.2.1)
 * -----------------------------------------------------------------------------
 * The pure decision layer. Given the classes produced by safety/classifiers.js
 * plus an action type, returns one of `allow | require-confirm | block`.
 *
 * Sources:
 *   - docs/problemStatement.md  §2.20 (Safety Enforcement)
 *   - docs/architecture.md      §6.1 (placement), §6.2 (rules), §6.3 (properties)
 *   - docs/implementation-plan.md Slice 1.2.1 Steps: "expose pure functions
 *     decideRead(pageClass), decideAction(actionType, targetClass, pageClass)"
 *   - docs/edge-case.md         INV-3 (deterministic + deny-biased), INV-6,
 *                               INV-7, EC-W2-11, EC-W3-12, EC-W4-07, EC-W4-08
 *
 * Design properties (Arch §6.3):
 *   - **Pure function.** No I/O, no async, no clock, no randomness.
 *   - **Deny-biased.** Anything not explicitly allowed is either blocked or
 *     escalated to require-confirm. Never the other way.
 *   - **Layered with approval.** Blocking here is independent of, and
 *     applied before, the user-approval gate. Slice 1.2.2 wires that in.
 *   - **AI-independent.** The result never changes based on any model output;
 *     the same (page, target, action) triple always yields the same decision
 *     (INV-3).
 *
 * Purity enforcement (Slice 1.2.1 Acceptance):
 *   - No `fetch(...)` anywhere in the module.
 *   - No `chrome.*` anywhere in the module.
 *   - No `Date.now()`, `Math.random()`, or environment inspection beyond the
 *     UMD loader's global-name fallback.
 *
 * Not implemented here (owned by later slices):
 *   - Actual UI prompts for `require-confirm` -> Slice 1.2.2.
 *   - Value-shape checks on `type` actions (e.g. "is this an OTP digit
 *     string?") -> Week-4 Slice 4.3.1 hardening.
 *   - Kill-switch state -> Slice 4.3.2 (PS §2.16, EC-W3-09).
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  const RULES = (typeof module === 'object' && module && module.exports && typeof require === 'function')
    ? require('./rules.js')
    : global && global.SahayakSafetyRules;

  if (!RULES) {
    throw new Error('safety/policy.js: rules module not loaded');
  }

  const D = RULES.DECISION;
  const P = RULES.PAGE_CLASS;
  const F = RULES.FIELD_CLASS;

  // ==========================================================================
  // decideRead(pageClass)
  // ==========================================================================

  /**
   * Gate applied before any page-content egress (Readability text, action
   * map, selection) is sent to a provider or rendered in the panel.
   *
   *   sensitive → block             (PS §2.20, INV-6, EC-W2-11, EC-W3-12)
   *   private   → block             (PS §2.20, INV-7)
   *   unknown   → block             (deny-biased: unparseable/non-http URLs
   *                                  should never trigger an AI call;
   *                                  EC-W2-12 chrome:// targets)
   *   benign    → allow
   *   practice  → allow
   *
   * `require-confirm` is intentionally NOT returned by decideRead: reading
   * is a one-shot user gesture (Explain / Summarise / Chat) and the panel
   * UX for it is either "yes do it" or "the safety gate refused". Adding a
   * mid-flight confirm here would just duplicate the user's original click
   * without adding a real safety layer. Consequent action paths still get
   * `require-confirm` from decideAction.
   *
   * @param {string} pageClass
   * @returns {string} one of D.BLOCK | D.ALLOW
   */
  function decideRead(pageClass) {
    switch (pageClass) {
      case P.SENSITIVE: return D.BLOCK;
      case P.PRIVATE:   return D.BLOCK;
      case P.UNKNOWN:   return D.BLOCK;
      case P.BENIGN:    return D.ALLOW;
      case P.PRACTICE:  return D.ALLOW;
      // Any class not in our enum falls through to a hard block. This is
      // the "unknown/risky defaults resolve to block" branch of Arch §6.3.
      default:          return D.BLOCK;
    }
  }

  // ==========================================================================
  // decideAction(actionType, targetClass, pageClass)
  // ==========================================================================

  /**
   * Gate applied to every proposed browser action before it can appear in
   * the review card. The orchestrator's `Validating → Blocked` transition
   * (Arch §7.1) fires when this returns D.BLOCK; `require-confirm` triggers
   * the second confirmation dialog (EC-W4-08).
   *
   * Ordering — highest severity wins:
   *
   *   1. Unknown/incompatible inputs  → require-confirm or block.
   *   2. Page class gate:
   *        sensitive → block          (INV-6, EC-W3-12 — no agent action on
   *                                   banking/payment pages at all)
   *        private   → block          (INV-7 — private pages must not leak
   *                                   through the action path either)
   *        unknown   → block          (deny-biased)
   *   3. Field class gate (only reached for benign / practice pages):
   *        credential:
   *          click / type / select → block   (INV-6, EC-W4-07, PS §2.20)
   *          scroll / done         → allow   (non-mutating; the field itself
   *                                            is not touched)
   *        consequential:
   *          click / type / select → require-confirm  (INV-6, EC-W4-08)
   *          scroll / done         → allow
   *        ordinary:
   *          any supported action  → allow
   *        unknown:
   *          any                   → require-confirm  (deny-biased, INV-3)
   *
   * @param {string} actionType   One of RULES.ACTION_TYPE values.
   * @param {string} targetClass  One of RULES.FIELD_CLASS values.
 * @param {string} pageClass    One of RULES.PAGE_CLASS values.
 * @returns {string} one of D.ALLOW | D.REQUIRE_CONFIRM | D.BLOCK
 */
  function decideAction(actionType, targetClass, pageClass) {
    // Sanity: any input outside the enum vocabulary escalates rather than
    // falls through to allow. This makes it impossible for a future caller
    // to sneak past the gate by inventing a new actionType.
    if (typeof actionType !== 'string' || !RULES.ACTION_TYPE_SET.has(actionType)) {
      // Unknown or malformed action type: hard block. Do NOT require-confirm,
      // because we cannot describe what would be confirmed.
      return D.BLOCK;
    }
    if (typeof pageClass !== 'string' || !RULES.PAGE_CLASS_SET.has(pageClass)) {
      return D.BLOCK;
    }
    if (typeof targetClass !== 'string' || !RULES.FIELD_CLASS_SET.has(targetClass)) {
      // Missing / unknown target class: escalate to require-confirm rather
      // than block, because the page itself is fine. This preserves the
      // user's ability to approve on their own page when the classifier
      // simply couldn't recognise the element (EC-W3-13 empty action map).
      return D.REQUIRE_CONFIRM;
    }

    // 2. Page-class gate.
    if (pageClass === P.SENSITIVE) return D.BLOCK;
    if (pageClass === P.PRIVATE)   return D.BLOCK;
    if (pageClass === P.UNKNOWN)   return D.BLOCK;

    // 3. Field-class rules (only for BENIGN or PRACTICE pages).
    if (targetClass === F.CREDENTIAL) {
      // PS §2.20: never type into password / OTP / card fields. Clicking
      // one is equally unsafe (autofill / focus / keystroke capture), so
      // click and select also block.
      if (actionType === RULES.ACTION_TYPE.TYPE)   return D.BLOCK;
      if (actionType === RULES.ACTION_TYPE.CLICK)  return D.BLOCK;
      if (actionType === RULES.ACTION_TYPE.SELECT) return D.BLOCK;
      // scroll and done are non-mutating and do not target the field.
      return D.ALLOW;
    }

    if (targetClass === F.CONSEQUENTIAL) {
      // PS §2.20 / EC-W4-08: explicit second confirmation for Submit/Pay/Send.
      // Only the mutating actions require the confirm; scroll / done are
      // pass-through.
      if (
        actionType === RULES.ACTION_TYPE.CLICK ||
        actionType === RULES.ACTION_TYPE.TYPE ||
        actionType === RULES.ACTION_TYPE.SELECT
      ) {
        return D.REQUIRE_CONFIRM;
      }
      return D.ALLOW;
    }

    if (targetClass === F.UNKNOWN) {
      // Deny-biased: user must confirm an element the classifier couldn't
      // label. Prevents silent execution on ambiguous DOM (EC-W3-04).
      return D.REQUIRE_CONFIRM;
    }

    // targetClass === ORDINARY on BENIGN or PRACTICE → allow.
    return D.ALLOW;
  }

  const api = { decideRead, decideAction };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSafetyPolicy = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
