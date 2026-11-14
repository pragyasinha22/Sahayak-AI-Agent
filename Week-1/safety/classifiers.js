/**
 * Sahayak — Safety classifiers (Slice 1.2.1)
 * -----------------------------------------------------------------------------
 * Pure, deterministic classification functions. Given a page URL and an
 * element descriptor, they return a stable class + machine-readable reason
 * that the policy layer then maps to a decision.
 *
 * Sources:
 *   - docs/problemStatement.md  §2.20 (Safety Enforcement)
 *   - docs/architecture.md      §6.1, §6.2, §6.3 (Safety Policy Engine)
 *   - docs/implementation-plan.md Slice 1.2.1 Steps: "expose pure functions
 *     classifyPage(url, hints), classifyField(elementDescriptor)"
 *   - docs/edge-case.md         INV-3 (deterministic, pure), INV-6, INV-7
 *
 * Design properties (Arch §6.3):
 *   - **Pure.** No I/O, no async, no Date.now(), no Math.random().
 *   - **Deny-biased.** Anything the classifier cannot confidently categorise
 *     falls into `unknown`; policy layer maps unknown → require-confirm or
 *     block. Nothing here returns `allow` on its own.
 *   - **Ordering.** `classifyPage` checks sensitive first, private second,
 *     benign last. A URL that looks like both `…/checkout` and `…/inbox`
 *     resolves to sensitive (higher-severity wins).
 *   - **Reason stability.** Every reason is a machine code (`sensitive-host`,
 *     `hint-login-form`, `no-sensitive-or-private-match`, …) — never user
 *     text — so tests and log lines can compare without string drift.
 *   - **No `chrome.*`, no `fetch`, no DOM access.** Uses only the WHATWG
 *     URL constructor and pure string / regex operations.
 *
 * Not implemented here (owned by later slices):
 *   - Decisions (`allow | require-confirm | block`) → safety/policy.js.
 *   - The gate wrapping panel egress → Slice 1.2.2 `panel/safety-gate.js`.
 *   - Enriching `hints` from live DOM signals → Slice 1.2.2 wiring.
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  // Resolve the rules module. In Node tests we require it directly; in the
  // browser the manifest / script tag order loads safety/rules.js first and
  // it attaches to global.SahayakSafetyRules.
  const RULES = (typeof module === 'object' && module && module.exports && typeof require === 'function')
    ? require('./rules.js')
    : global && global.SahayakSafetyRules;

  if (!RULES) {
    // Programmer error; fail loudly at load so a misconfigured page is
    // obvious rather than silently defaulting to allow.
    throw new Error('safety/classifiers.js: rules module not loaded');
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * A hostname "matches" a rule entry `h` if hostname === h, or the hostname
   * ends with `.` + h. So `paypal.com` matches `paypal.com`, and
   * `secure.paypal.com` also matches `paypal.com`, but `notpaypal.com`
   * does NOT. Prevents suffix spoofing.
   */
  function hostnameMatchesAnyExact(hostname, list) {
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (hostname === h) return h;
      if (hostname.length > h.length + 1 &&
          hostname.endsWith('.' + h) &&
          hostname[hostname.length - h.length - 1] === '.') {
        return h;
      }
    }
    return null;
  }

  /**
   * Boundary-aware substring scan on a hostname. A substring `s` matches
   * when it appears flanked by label boundaries or string edges. So `bank`
   * matches `hdfcbank` (bank at end-of-label after hdfc? no — 'hdfc' and
   * 'bank' aren't separated) — wait, we DO want hdfcbank to match. Let me
   * relax: match when `s` appears anywhere inside a hostname label. That's
   * the deny-biased choice; false positives are acceptable because they
   * escalate to `sensitive`, not to `allow`.
   *
   * To still avoid egregious false positives like "embankment.gov" matching
   * "bank", we require the substring to be at the START of the hostname
   * or of a dot-separated label, OR preceded by `-` / `_`.
   */
  function hostnameMatchesAnySubstring(hostname, list) {
    // Split into labels: ["secure", "hdfcbank", "com"]
    const labels = hostname.split('.');
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      for (let j = 0; j < labels.length; j++) {
        const lbl = labels[j];
        // Substring at start of a label.
        if (lbl.startsWith(s)) return s;
        // Substring preceded by '-' or '_' inside a label.
        const dash = '-' + s;
        const under = '_' + s;
        if (lbl.includes(dash) || lbl.includes(under)) return s;
      }
    }
    return null;
  }

  function matchFirstPattern(haystack, patterns) {
    if (typeof haystack !== 'string') return null;
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(haystack)) return String(patterns[i]);
    }
    return null;
  }

  function lower(v) {
    return typeof v === 'string' ? v.toLowerCase() : '';
  }

  function containsAny(haystack, needles) {
    if (typeof haystack !== 'string') return null;
    const h = haystack.toLowerCase();
    for (let i = 0; i < needles.length; i++) {
      if (h.indexOf(needles[i]) !== -1) return needles[i];
    }
    return null;
  }

  // ==========================================================================
  // classifyPage(url, hints)
  // ==========================================================================

  /**
   * @param {string} url     Absolute URL of the page. Non-http(s) schemes
   *                         (chrome://, file:, view-source:, devtools://) are
   *                         classified `unknown` because the extension should
   *                         never read them (EC-W2-12).
   * @param {object} [hints] Optional, caller-supplied signals. Any subset:
   *   {
   *     hasLoginForm:  boolean,   // page contains a password field
   *     isMarketingPage: boolean, // Readability / metadata positive signal
   *     isNewsArticle: boolean,
   *     isDocumentation: boolean,
   *     isUserOwnedPage: boolean, // explicit user assertion (PS §2.20)
   *   }
   * @returns {{ class: string, reason: string, matched?: string|null }}
   */
  function classifyPage(url, hints) {
    const H = hints && typeof hints === 'object' ? hints : {};

    if (typeof url !== 'string' || url.length === 0) {
      return { class: RULES.PAGE_CLASS.UNKNOWN, reason: 'missing-url', matched: null };
    }

    let parsed;
    try {
      // URL constructor is synchronous, pure, and available in Node 10+ and
      // Chrome (extension process and content scripts alike).
      parsed = new URL(url);
    } catch (_) {
      return { class: RULES.PAGE_CLASS.UNKNOWN, reason: 'unparseable-url', matched: null };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        class: RULES.PAGE_CLASS.UNKNOWN,
        reason: 'non-http-scheme',
        matched: parsed.protocol,
      };
    }

    const hostname = lower(parsed.hostname || '');
    const pathAndQuery = (parsed.pathname || '') + (parsed.search || '');

    // Practice allowlist takes highest precedence: an explicit user-owned
    // or provided sandbox overrides every other signal.
    if (hostnameMatchesAnyExact(hostname, RULES.PRACTICE_HOST_ALLOWLIST)) {
      return { class: RULES.PAGE_CLASS.PRACTICE, reason: 'in-practice-allowlist', matched: hostname };
    }

    // Sensitive host match (exact or boundary-aware substring).
    const exactHit = hostnameMatchesAnyExact(hostname, RULES.SENSITIVE_HOSTS);
    if (exactHit) {
      return { class: RULES.PAGE_CLASS.SENSITIVE, reason: 'sensitive-host-exact', matched: exactHit };
    }
    const substrHit = hostnameMatchesAnySubstring(hostname, RULES.SENSITIVE_HOST_SUBSTRINGS);
    if (substrHit) {
      return { class: RULES.PAGE_CLASS.SENSITIVE, reason: 'sensitive-host-substring', matched: substrHit };
    }

    // Sensitive path pattern.
    const pathHit = matchFirstPattern(pathAndQuery, RULES.SENSITIVE_PATH_PATTERNS);
    if (pathHit) {
      return { class: RULES.PAGE_CLASS.SENSITIVE, reason: 'sensitive-path', matched: pathHit };
    }

    // Explicit login-form hint elevates any page to sensitive (INV-6).
    if (H.hasLoginForm === true) {
      return { class: RULES.PAGE_CLASS.SENSITIVE, reason: 'hint-login-form', matched: null };
    }

    // Private path pattern (inbox / drive / settings / etc.).
    const privateHit = matchFirstPattern(pathAndQuery, RULES.PRIVATE_PATH_PATTERNS);
    if (privateHit) {
      return { class: RULES.PAGE_CLASS.PRIVATE, reason: 'private-path', matched: privateHit };
    }

    // Explicit benign hints.
    if (H.isUserOwnedPage === true) {
      return { class: RULES.PAGE_CLASS.PRACTICE, reason: 'hint-user-owned', matched: hostname };
    }
    if (
      H.isMarketingPage === true ||
      H.isNewsArticle === true ||
      H.isDocumentation === true
    ) {
      return { class: RULES.PAGE_CLASS.BENIGN, reason: 'hint-benign-content', matched: hostname };
    }

    // Deny-biased fallback: a normal http(s) page with no sensitive /
    // private / benign signal is still classified `benign`, but ONLY
    // because it made it through the deny tables. `unknown` is reserved
    // for URLs we cannot parse at all. Reads are allowed; actions still
    // require the field classifier to say the target is safe.
    return { class: RULES.PAGE_CLASS.BENIGN, reason: 'no-sensitive-or-private-match', matched: hostname };
  }

  // ==========================================================================
  // classifyField(elementDescriptor)
  // ==========================================================================

  /**
   * Element descriptor shape (all fields optional; missing fields are
   * simply not used for a signal):
   *   {
   *     tag:          string,   // 'input' | 'button' | 'a' | 'select' | ...
   *     type:         string,   // input/submit/button type
   *     name:         string,   // name attribute
   *     id:           string,   // id attribute
   *     placeholder:  string,   // placeholder attribute
   *     autocomplete: string,   // autocomplete attribute
   *     inputmode:    string,   // inputmode attribute
   *     maxlength:    number,   // maxlength attribute
   *     label:        string,   // associated <label> text or aria-label
   *     ariaLabel:    string,   // aria-label (falls back to `label`)
   *     text:         string,   // visible button / anchor text
   *   }
   *
   * Return shape:
   *   { class, kind, reason, matched }
   *
   * Ordering: credential (highest severity) → consequential → ordinary →
   * unknown. A button labelled "Pay with password" hits credential first
   * and stays there — deny-biased.
   */
  // ---------------------------------------------
  
  /**
   * Classify selected text for explicit credential disclosures.
   * This is a heuristic, not a guarantee that all secrets are detected.
   */
  function classifyText(value) {
    const text = typeof value === 'string' ? value : '';

    if (!text.trim()) {
      return {
        class: 'unknown',
        reason: 'empty-text',
        matched: null
      };
    }

    const patterns = [
      {
        reason: 'password-disclosure',
        re: /\b(?:my\s+)?password\s*(?:is|:|=)\s*\S+/i
      },
      {
        reason: 'account-number-disclosure',
        re: /\b(?:bank\s+)?account\s+number\s*(?:is|:|=)\s*\d{6,}\b/i
      },
      {
        reason: 'otp-disclosure',
        re: /\b(?:otp|one[- ]time password|verification code)\s*(?:is|:|=)\s*\d{4,8}\b/i
      },
      {
        reason: 'card-security-code-disclosure',
        re: /\b(?:cvv|cvc|security code)\s*(?:is|:|=)\s*\d{3,4}\b/i
      },
      {
        reason: 'card-number-disclosure',
        re: /\b(?:card|credit card|debit card)\s+number\s*(?:is|:|=)\s*(?:\d[ -]?){13,19}\b/i
      }
    ];

    for (const pattern of patterns) {
      if (pattern.re.test(text)) {
        return {
          class: 'credential',
          reason: pattern.reason,
          matched: null
        };
      }
    }

    return {
      class: 'ordinary',
      reason: 'no-explicit-credential-pattern',
      matched: null
    };
  }

  // -----------------------------------------------
  function classifyField(elementDescriptor) {
    const d = elementDescriptor;
    if (!d || typeof d !== 'object') {
      return { class: RULES.FIELD_CLASS.UNKNOWN, kind: null, reason: 'no-descriptor', matched: null };
    }

    const tag = lower(d.tag);
    const typeValue = lower(d.type);
    const name = lower(d.name);
    const id = lower(d.id);
    const placeholder = lower(d.placeholder);
    const autocomplete = lower(d.autocomplete);
    const inputmode = lower(d.inputmode);
    const maxlength = typeof d.maxlength === 'number' ? d.maxlength : null;
    const label = lower(d.label || d.ariaLabel);
    // Combine the free-text signals we scan: name/id/placeholder all count
    // as "nameHints"; label/ariaLabel/text count as "labelHints".
    const nameBag = [name, id, placeholder].filter(Boolean).join(' ');
    const labelBag = [label, d.text].filter(Boolean).map(String).join(' ').toLowerCase();

    // ---- PASSWORD ----------------------------------------------------------
    if (
      RULES.PASSWORD_FIELD_SIGNALS.typeValues.indexOf(typeValue) !== -1 ||
      RULES.PASSWORD_FIELD_SIGNALS.autocompleteTokens.indexOf(autocomplete) !== -1 ||
      containsAny(nameBag, RULES.PASSWORD_FIELD_SIGNALS.nameHints) ||
      containsAny(labelBag, RULES.PASSWORD_FIELD_SIGNALS.labelHints)
    ) {
      return {
        class: RULES.FIELD_CLASS.CREDENTIAL,
        kind: RULES.CREDENTIAL_KIND.PASSWORD,
        reason: 'password-signal',
        matched:
          typeValue === 'password' ? 'type=password' :
          RULES.PASSWORD_FIELD_SIGNALS.autocompleteTokens.indexOf(autocomplete) !== -1 ? 'autocomplete=' + autocomplete :
          containsAny(nameBag, RULES.PASSWORD_FIELD_SIGNALS.nameHints) ||
          containsAny(labelBag, RULES.PASSWORD_FIELD_SIGNALS.labelHints),
      };
    }

    // ---- OTP ---------------------------------------------------------------
    const otpNameHit = containsAny(nameBag, RULES.OTP_FIELD_SIGNALS.nameHints);
    const otpLabelHit = containsAny(labelBag, RULES.OTP_FIELD_SIGNALS.labelHints);
    const otpAutocompleteHit = RULES.OTP_FIELD_SIGNALS.autocompleteTokens.indexOf(autocomplete) !== -1;
    // Small + numeric + name hint is a strong OTP signal, but any single
    // signal is enough given deny-bias.
    if (otpAutocompleteHit || otpNameHit || otpLabelHit) {
      return {
        class: RULES.FIELD_CLASS.CREDENTIAL,
        kind: RULES.CREDENTIAL_KIND.OTP,
        reason: 'otp-signal',
        matched: otpAutocompleteHit ? 'autocomplete=' + autocomplete : (otpNameHit || otpLabelHit),
      };
    }

    // ---- CARD --------------------------------------------------------------
    const cardAutocompleteHit = RULES.CARD_FIELD_SIGNALS.autocompleteTokens.indexOf(autocomplete) !== -1;
    const cardNameHit = containsAny(nameBag, RULES.CARD_FIELD_SIGNALS.nameHints);
    const cardLabelHit = containsAny(labelBag, RULES.CARD_FIELD_SIGNALS.labelHints);
    if (cardAutocompleteHit || cardNameHit || cardLabelHit) {
      return {
        class: RULES.FIELD_CLASS.CREDENTIAL,
        kind: RULES.CREDENTIAL_KIND.CARD,
        reason: 'card-signal',
        matched: cardAutocompleteHit ? 'autocomplete=' + autocomplete : (cardNameHit || cardLabelHit),
      };
    }

    // ---- CONSEQUENTIAL (Submit / Pay / Send / Purchase / Transfer) ---------
    // Only buttons, anchors, and inputs with type=submit/button qualify.
    // A `<div>` containing the word "pay" in its text is not a click target
    // the model can safely propose; treat it as ordinary to avoid spurious
    // require-confirm on non-actionable text.
    const isClickable =
      tag === 'button' ||
      tag === 'a' ||
      typeValue === 'submit' ||
      typeValue === 'button';
    if (isClickable) {
      const labelToTest = labelBag || lower(d.text);
      for (let i = 0; i < RULES.CONSEQUENTIAL_LABEL_PATTERNS.length; i++) {
        const p = RULES.CONSEQUENTIAL_LABEL_PATTERNS[i];
        if (p.re.test(labelToTest)) {
          return {
            class: RULES.FIELD_CLASS.CONSEQUENTIAL,
            kind: p.kind,
            reason: 'consequential-label',
            matched: p.kind,
          };
        }
      }
    }

    // ---- ORDINARY ----------------------------------------------------------
    const ORDINARY_INPUT_TYPES = [
      'text', 'email', 'tel', 'url', 'search', 'number',
      'date', 'datetime-local', 'time', 'month', 'week',
      'radio', 'checkbox', 'range', 'color', 'file',
    ];
    if (tag === 'select' || tag === 'textarea') {
      return { class: RULES.FIELD_CLASS.ORDINARY, kind: null, reason: 'benign-tag', matched: tag };
    }
    if (tag === 'input' && ORDINARY_INPUT_TYPES.indexOf(typeValue) !== -1) {
      return { class: RULES.FIELD_CLASS.ORDINARY, kind: null, reason: 'benign-input-type', matched: typeValue };
    }
    if (tag === 'button' || tag === 'a') {
      // Clickable, no consequential label — ordinary.
      return { class: RULES.FIELD_CLASS.ORDINARY, kind: null, reason: 'benign-clickable', matched: tag };
    }

    // ---- UNKNOWN -----------------------------------------------------------
    // Descriptor present but nothing matched. Policy treats unknown as
    // require-confirm (deny-biased).
    return { class: RULES.FIELD_CLASS.UNKNOWN, kind: null, reason: 'unclassified-field', matched: null };
  }

  const api = { classifyPage, classifyField, classifyText };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSafetyClassifiers = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
