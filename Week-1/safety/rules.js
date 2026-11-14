/**
 * Sahayak — Safety rule tables (Slice 1.2.1)
 * -----------------------------------------------------------------------------
 * Pure, declarative data. Contains enums and rule sets consumed by
 * safety/classifiers.js and safety/policy.js. No logic, no I/O.
 *
 * Sources:
 *   - docs/problemStatement.md  §2.20 (Safety Enforcement — the ten rules)
 *   - docs/architecture.md      §6.1, §6.2, §6.3 (Safety Policy Engine)
 *   - docs/implementation-plan.md Slice 1.2.1 (Steps: "ship rule set seeded
 *                                  with §2.20 items so gates are already
 *                                  meaningful")
 *   - docs/edge-case.md         INV-3, INV-6, INV-7, EC-W2-11, EC-W3-12,
 *                               EC-W4-07, EC-W4-08, EC-SEC-* (safety invariants)
 *
 * Architectural rules honoured by this file:
 *   INV-3   Deterministic, deny-biased, no AI dependency.
 *   INV-6   Sensitive pages, credential fields, and login/payment/OTP/card
 *           automation are hard-blocked regardless of model output.
 *   INV-7   Private/sensitive pages are never sent to free-tier AI. The
 *           `private` class exists precisely so `decideRead` can block them.
 *   GDR-5   Safety is a deterministic pure module — introduced here.
 *
 * Deliberate scope for Slice 1.2.1 (hardened to full §2.20 coverage in Week 4
 * Slice 4.3.1 per Arch §11):
 *   - Host list is seeded, not exhaustive. Additional banks / PSPs arrive
 *     through Week-4 hardening; the shape here is stable so adding entries
 *     does not change the classifier or policy.
 *   - `PRACTICE_HOST_ALLOWLIST` is intentionally EMPTY. Populated in Week-4
 *     Slice 4.3.2 alongside the practice-environment scaffolding.
 *   - No wildcard / regex escape-hatch that would allow a caller to inject
 *     patterns at runtime. Every list here is Object.freeze()-d.
 *
 * No `chrome.*`, no `fetch`, no async, no Date.now(), no Math.random() — this
 * file must be trivially auditable with grep and must be identical in Node
 * and Chrome. See Slice 1.2.1 Acceptance: "no fetch, no chrome.* inside it".
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  // ==========================================================================
  // Enums — the three-value decision and classification vocabularies.
  // ==========================================================================

  /**
   * Every safety call returns exactly one of these strings.
   * Matches Arch §6.3: "returns allow | require-confirm | block deterministically".
   */
  const DECISION = Object.freeze({
    ALLOW: 'allow',
    REQUIRE_CONFIRM: 'require-confirm',
    BLOCK: 'block',
  });

  /**
   * Page classifications. The set is closed; unclassified pages resolve to
   * `unknown` and the policy layer applies a deny-biased default.
   */
  const PAGE_CLASS = Object.freeze({
    SENSITIVE: 'sensitive',   // banking / payment / authentication — INV-6
    PRIVATE: 'private',       // inbox / drive / settings — INV-7
    PRACTICE: 'practice',     // user-owned or provided sandbox
    BENIGN: 'benign',         // ordinary public http(s) content
    UNKNOWN: 'unknown',       // unparseable / non-http / missing
  });

  /**
   * Field / element classifications. `credential` covers password, OTP, and
   * card-information fields (PS §2.20). `consequential` covers Submit / Pay /
   * Send style controls whose click requires an extra confirmation (INV-6).
   */
  const FIELD_CLASS = Object.freeze({
    CREDENTIAL: 'credential',
    CONSEQUENTIAL: 'consequential',
    ORDINARY: 'ordinary',
    UNKNOWN: 'unknown',
  });

  /**
   * Sub-kind for credential fields. Used in log/reason strings; the policy
   * layer treats every credential kind the same (block on type / click).
   */
  const CREDENTIAL_KIND = Object.freeze({
    PASSWORD: 'password',
    OTP: 'otp',
    CARD: 'card',
  });

  /**
   * Sub-kind for consequential targets. PS §2.20 names Submit, Pay, Send.
   * Purchase/Order/Transfer/etc. are seeded here as natural extensions and
   * will be reviewed against §2.20 completeness in Week-4 Slice 4.3.1.
   */
  const CONSEQUENTIAL_KIND = Object.freeze({
    SUBMIT: 'submit',
    PAY: 'pay',
    SEND: 'send',
    PURCHASE: 'purchase',
    TRANSFER: 'transfer',
  });

  /**
   * Action vocabulary. Matches PS §2.15 "Supported actions" exactly. Policy
   * rejects any action outside this set (deny-biased, INV-3).
   */
  const ACTION_TYPE = Object.freeze({
    CLICK: 'click',
    TYPE: 'type',
    SELECT: 'select',
    SCROLL: 'scroll',
    DONE: 'done',
  });

  // ==========================================================================
  // Seed rule tables. All arrays are frozen; callers cannot mutate at runtime.
  // ==========================================================================

  /**
   * Exact hostnames considered sensitive. A hostname matches if it equals one
   * of these OR ends with `.` + one of these (so `online.sbi` matches, and
   * `secure.paypal.com` matches `paypal.com`).
   *
   * Seeded from PS §2.20 "banking and payment pages" scope. Not exhaustive;
   * Week-4 Slice 4.3.1 widens it.
   */
  const SENSITIVE_HOSTS = Object.freeze([
    // Global payment processors / wallets
    'paypal.com',
    'stripe.com',
    'checkout.com',
    'wise.com',
    'revolut.com',
    'venmo.com',
    'cash.app',
    'applepay.com',
    'googlepay.com',
    'pay.google.com',
    // Indian UPI / wallets / gateways
    'paytm.com',
    'paytm.in',
    'phonepe.com',
    'razorpay.com',
    'bhimupi.org.in',
    'upi.npci.org.in',
    // Card networks / processing
    'visa.com',
    'mastercard.com',
    'americanexpress.com',
    'amex.com',
    'rupaycart.gov.in',
    // Named bank online-banking surfaces (seed — Week 4 widens)
    'hdfcbank.com',
    'netbanking.hdfcbank.com',
    'onlinesbi.sbi',
    'infinity.icici.bank',
    'axisbank.com',
    'now.axisbank.com',
    'kotak.com',
    'pnbibanking.in',
    'bankofbaroda.bank.in',
    'yesbank.co.in',
    'idfirstbank.com',
    'fedbankmobile.in',
  ]);

  /**
   * Substrings that, if they appear in a hostname (as a label boundary),
   * mark the page as sensitive. This is how a mock page like
   * `https://bank.example.com/` or `https://pay.example.org/` is caught
   * even though those hosts aren't in SENSITIVE_HOSTS. Deny-biased by design.
   *
   * The boundary rule: a substring matches when it appears at the start of
   * a hostname label or is flanked by `-` / `.` / `_`. So "bankofamerica.com"
   * matches `bank`; "embank.com" does NOT match `bank` because 'bank' is not
   * at a label boundary in "embank".
   */
  const SENSITIVE_HOST_SUBSTRINGS = Object.freeze([
    'bank',
    'banking',
    'netbanking',
    'payment',
    'payments',
    'pay',
    'wallet',
    'upi',
    'card',
    'cards',
    'credit',
    'debit',
    'loan',
    'merchant',
    'checkout',
    'transaction',
    'finance',
    'neobank',
    'crypto',
  ]);

  /**
   * URL path / query patterns that mark a page as sensitive regardless of
   * host. `checkout` on a store is high-impact; `login` / `otp` implies an
   * authentication surface. Deny-biased by design.
   */
  const SENSITIVE_PATH_PATTERNS = Object.freeze([
    /(^|\/)checkout([\/?#]|$)/i,
    /(^|\/)payment(s)?([\/?#]|$)/i,
    /(^|\/)pay([\/?#]|$)/i,
    /(^|\/)billing([\/?#]|$)/i,
    /(^|\/)transaction(s)?([\/?#]|$)/i,
    /(^|\/)transfer([\/?#]|$)/i,
    /(^|\/)deposit([\/?#]|$)/i,
    /(^|\/)withdraw(al)?([\/?#]|$)/i,
    /(^|\/)wallet([\/?#]|$)/i,
    /(^|\/|\-)(login|signin|sign-in|authenticate)([\/?#\-]|$)/i,
    /(^|\/|\-)(otp|2fa|mfa|verification|verify)([\/?#\-]|$)/i,
    /(^|\/)password([\/?#-]|$)/i,
    /(^|\/)card([- ]?information|[\/?#]|$)/i,
  ]);

  /**
   * Path patterns that mark a page as private (PS §2.20 "Avoid sending
   * private or sensitive pages to free-tier AI services"). These BLOCK reads
   * but do NOT block actions on their own — actions are governed by page
   * class + field class (see policy.js).
   */
  const PRIVATE_PATH_PATTERNS = Object.freeze([
    /(^|\/)(inbox|mail|email|messages?|dm|conversation|thread|compose)([\/?#]|$)/i,
    /(^|\/)(drive|docs|spreadsheets|presentations|notion|obsidian|confluence|sharepoint|onenote)([\/?#]|$)/i,
    /(^|\/)(settings|preferences|privacy|security|account(s)?)([\/?#]|$)/i,
    /(^|\/)(profile\/edit|edit[- ]?profile|my[- ]?account)([\/?#]|$)/i,
    /(^|\/)(calendar|contacts|todos)([\/?#]|$)/i,
  ]);

  /**
   * Signals for password fields. Any hit classifies as credential/password.
   * See PS §2.20 "Never type into password fields".
   */
  const PASSWORD_FIELD_SIGNALS = Object.freeze({
    typeValues: Object.freeze(['password', 'current-password', 'new-password']),
    autocompleteTokens: Object.freeze([
      'current-password',
      'new-password',
    ]),
    // Case-insensitive substrings matched against `name`, `id`, `placeholder`.
    nameHints: Object.freeze(['password', 'passwd', 'pwd']),
    // Substrings matched against a rendered `label` or `ariaLabel`.
    labelHints: Object.freeze(['password']),
  });

  /**
   * Signals for OTP / verification-code fields.
   * See PS §2.20 "Never type into OTP fields".
   */
  const OTP_FIELD_SIGNALS = Object.freeze({
    autocompleteTokens: Object.freeze(['one-time-code']),
    inputmodeValues: Object.freeze(['numeric']),
    // Substrings matched against name/id/placeholder.
    nameHints: Object.freeze([
      'otp', 'otc', 'pin', 'tfa', '2fa', 'mfa',
      'one-time', 'onetime', 'verification',
      'authcode', 'auth-code', 'sms-code', 'email-code',
    ]),
    labelHints: Object.freeze(['otp', 'verification code', 'one-time code']),
    // Small maxlength signals a 4-8 digit code; used with inputmode=numeric.
    shortMaxLength: 8,
  });

  /**
   * Signals for card-information fields.
   * See PS §2.20 "Never type into card-information fields".
   */
  const CARD_FIELD_SIGNALS = Object.freeze({
    autocompleteTokens: Object.freeze([
      'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
      'cc-csc', 'cc-name',
    ]),
    nameHints: Object.freeze([
      'cardnumber', 'card-number', 'card_no', 'cardno',
      'ccnum', 'ccnumber', 'cvv', 'cvc', 'amex', 'cvv2',
      'credit', 'debit', 'pan',
    ]),
    labelHints: Object.freeze([
      'card number', 'card holder', 'cardholder', 'expiry', 'expiration',
      'cvv', 'cvc', 'security code', 'credit card', 'debit card',
    ]),
  });

  /**
   * Label patterns that mark a control as consequential. Clicking these
   * requires an additional confirmation dialog distinct from Approve
   * (PS §2.20 / EC-W4-08). Matched case-insensitively against a trimmed
   * visible-label string. Anchored with ^...$ so a button called "Submit
   * form via email" still matches "submit" (leading verb) but a benign
   * "Submit feedback for review" also matches — acceptable because both
   * are, semantically, submissions.
   *
   * Kind extraction returns which word matched, so the UI layer can
   * customise the confirmation copy.
   */
  const CONSEQUENTIAL_LABEL_PATTERNS = Object.freeze([
    { kind: 'submit',   re: /(^|[^a-z])submit([^a-z]|$)/i },
    { kind: 'pay',      re: /(^|[^a-z])pay(?:s|ing|ment)?([^a-z]|$)/i },
    { kind: 'send',     re: /(^|[^a-z])send([^a-z]|$)/i },
    { kind: 'purchase', re: /(^|[^a-z])(purchase|buy|order)([^a-z]|$)/i },
    { kind: 'transfer', re: /(^|[^a-z])transfer([^a-z]|$)/i },
  ]);

  /**
   * Practice errand allowlist. EMPTY by design for Slice 1.2.1 — populated
   * in Week-4 Slice 4.3.2 when the practice environments themselves ship.
   * Adding an entry here upgrades that hostname to PAGE_CLASS.PRACTICE,
   * which grants `decideRead → allow` and lets `decideAction` fall through
   * to the field-level rules instead of blocking on `unknown` page class.
   */
  const PRACTICE_HOST_ALLOWLIST = Object.freeze([]);

  /**
   * Set of valid action-type strings. Policy layer uses this to reject any
   * actionType outside PS §2.15's supported set.
   */
  const ACTION_TYPE_SET = Object.freeze(new Set(Object.values(ACTION_TYPE)));

  /**
   * Set of valid page classes and field classes for the same reason.
   */
  const PAGE_CLASS_SET = Object.freeze(new Set(Object.values(PAGE_CLASS)));
  const FIELD_CLASS_SET = Object.freeze(new Set(Object.values(FIELD_CLASS)));

  const api = {
    // Enums
    DECISION,
    PAGE_CLASS,
    FIELD_CLASS,
    CREDENTIAL_KIND,
    CONSEQUENTIAL_KIND,
    ACTION_TYPE,
    // Rule tables
    SENSITIVE_HOSTS,
    SENSITIVE_HOST_SUBSTRINGS,
    SENSITIVE_PATH_PATTERNS,
    PRIVATE_PATH_PATTERNS,
    PASSWORD_FIELD_SIGNALS,
    OTP_FIELD_SIGNALS,
    CARD_FIELD_SIGNALS,
    CONSEQUENTIAL_LABEL_PATTERNS,
    PRACTICE_HOST_ALLOWLIST,
    // Derived sets (for validation in the policy layer)
    ACTION_TYPE_SET,
    PAGE_CLASS_SET,
    FIELD_CLASS_SET,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSafetyRules = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
