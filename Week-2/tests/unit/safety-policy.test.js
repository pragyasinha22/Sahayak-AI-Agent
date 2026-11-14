/**
 * Sahayak — Safety policy unit tests (Slice 1.2.1)
 * -----------------------------------------------------------------------------
 * Node-only. Table-driven, exactly as the plan's Unit-tests field demands:
 *
 *   "known banking hosts → block; password-type input → block; label 'Card
 *    number' → block; label 'Submit' → require-confirm; benign marketing
 *    page → allow"
 *
 * Plus assertions that operationalise the Slice 1.2.1 acceptance criteria:
 *   - every call returns one of the three DECISION enums
 *   - the module is deterministic across identical inputs
 *   - no `fetch`, no `chrome.*` inside any safety module (source scan)
 *
 * Run with:   node tests/unit/safety-policy.test.js
 * Exit code:  0 on pass, 1 on any failure, 2 on harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log('  \u2713 ' + msg);
  } else {
    fail++;
    failures.push(msg);
    console.log('  \u2717 ' + msg);
  }
}

function section(name) {
  console.log('\n# ' + name);
}

function deepEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ==========================================================================
// Load the three modules under test. Rules first so the internal require
// inside classifiers.js / policy.js resolves from the module cache.
// ==========================================================================
const RULES = require('../../safety/rules.js');
const CLASSIFIERS = require('../../safety/classifiers.js');
const POLICY = require('../../safety/policy.js');

const { classifyPage, classifyField, classifyText } = CLASSIFIERS;
const { decideRead, decideAction } = POLICY;

const isDecision = (v) =>
  v === RULES.DECISION.ALLOW ||
  v === RULES.DECISION.REQUIRE_CONFIRM ||
  v === RULES.DECISION.BLOCK;

// ==========================================================================
// 1. Enum completeness — the shape every later slice depends on.
// ==========================================================================
section('enum vocabulary');
{
  const decVals = Object.values(RULES.DECISION);
  assert(decVals.length === 3, 'DECISION has exactly 3 values');
  assert(decVals.includes('allow'), 'DECISION includes "allow"');
  assert(decVals.includes('require-confirm'), 'DECISION includes "require-confirm"');
  assert(decVals.includes('block'), 'DECISION includes "block"');

  const pages = Object.values(RULES.PAGE_CLASS);
  ['sensitive', 'private', 'practice', 'benign', 'unknown'].forEach((p) => {
    assert(pages.includes(p), 'PAGE_CLASS includes "' + p + '"');
  });

  const fields = Object.values(RULES.FIELD_CLASS);
  ['credential', 'consequential', 'ordinary', 'unknown'].forEach((f) => {
    assert(fields.includes(f), 'FIELD_CLASS includes "' + f + '"');
  });

  const actions = Object.values(RULES.ACTION_TYPE);
  ['click', 'type', 'select', 'scroll', 'done'].forEach((a) => {
    assert(actions.includes(a), 'ACTION_TYPE includes "' + a + '" (PS \u00a72.15)');
  });
}

// ==========================================================================
// 2. Plan Unit-tests bullet: "known banking hosts → block".
// ==========================================================================
section('classifyPage — known banking / payment hosts classify as sensitive');
{
  const urls = [
    'https://paypal.com/',
    'https://www.paypal.com/ukwebpay',
    'https://secure.paypal.com/signin',
    'https://paytm.com/',
    'https://razorpay.com/pay/',
    'https://netbanking.hdfcbank.com/',
    'https://now.axisbank.com/ib/fundtransfer',
    'https://phonepe.com/',
    'https://stripe.com/checkout',
    'https://wise.com/',
  ];
  for (const u of urls) {
    const r = classifyPage(u, {});
    assert(
      r.class === RULES.PAGE_CLASS.SENSITIVE && decideRead(r.class) === 'block',
      'block: ' + u + ' (' + r.reason + ')'
    );
  }

  // Suffix spoofing should NOT match: hostname ending in ".paypal.com" but
  // actually an attacker-controlled parent domain.
  const spoof = classifyPage('https://notpaypal.com/', {});
  assert(spoof.class !== RULES.PAGE_CLASS.SENSITIVE, 'notpaypal.com is NOT flagged sensitive (no suffix spoof)');
  const spoof2 = classifyPage('https://evil-paypal.com.attacker.test/', {});
  // Deny-biased by design: "paypal" sits after a '-' boundary inside the
  // first label, so the substring rule intentionally flags it. A false
  // positive that blocks too much is preferable to a suffix-spoof that
  // slips through (Arch §6.3 "unknown/risky defaults resolve to block").
  assert(spoof2.class === RULES.PAGE_CLASS.SENSITIVE,
    'attacker suffix "evil-paypal.com.attacker.test" IS flagged (deny-biased boundary rule)');
}

// ==========================================================================
// 3. Sensitive path patterns (mock banking page without a known host).
// ==========================================================================
section('classifyPage — sensitive paths catch mock bank/payment hosts');
{
  const checks = [
    ['https://acme.test/checkout', 'sensitive-path'],
    ['https://acme.test/payment', 'sensitive-path'],
    ['https://shop.test/cart/checkout?ref=x', 'sensitive-path'],
    ['https://demo.test/login', 'sensitive-path'],
    ['https://demo.test/otp-verify', 'sensitive-path'],
    ['https://bank.example.com/transfer', 'sensitive-host-substring'],
    ['https://pay.example.com/', 'sensitive-host-substring'],
    // Host substring ('wallet') is checked before the path table, so the
    // reason here is host-based even though the /send path would also match.
    ['https://wallet.example.org/send', 'sensitive-host-substring'],
  ];
  for (const [u, expectReason] of checks) {
    const r = classifyPage(u, {});
    assert(
      r.class === RULES.PAGE_CLASS.SENSITIVE,
      'sensitive: ' + u
    );
    // Reason drift would silently break the UI copy mapping, so pin it too.
    assert(
      r.reason === expectReason,
      'reason "' + expectReason + '" for ' + u + ' (got ' + r.reason + ')'
    );
  }
}

// ==========================================================================
// 4. Private pages (PS §2.20 "avoid sending private pages to free-tier AI").
// ==========================================================================
section('classifyPage — private pages block reads (INV-7)');
{
  const r1 = classifyPage('https://mail.google.com/mail/inbox/1234', {});
  assert(r1.class === RULES.PAGE_CLASS.PRIVATE, 'gmail inbox → private');
  assert(decideRead(r1.class) === 'block', 'private → block on read');

  const r2 = classifyPage('https://docs.example.org/drive/shared-secret', {});
  assert(r2.class === RULES.PAGE_CLASS.PRIVATE, 'drive path → private');

  const r3 = classifyPage('https://acme.test/settings/security', {});
  assert(r3.class === RULES.PAGE_CLASS.PRIVATE || r3.class === RULES.PAGE_CLASS.SENSITIVE,
    'account settings → private or (deny-biased) sensitive');
}

// ==========================================================================
// 5. Plan Unit-tests bullet: "benign marketing page → allow".
// ==========================================================================
section('classifyPage — benign marketing page allows reads');
{
  const r1 = classifyPage('https://acme.test/pricing', { isMarketingPage: true });
  assert(r1.class === RULES.PAGE_CLASS.BENIGN, 'explicit marketing hint → benign');
  assert(decideRead(r1.class) === 'allow', 'benign → allow on read');

  const r2 = classifyPage('https://blog.example.org/post/42', { isNewsArticle: true });
  assert(r2.class === RULES.PAGE_CLASS.BENIGN, 'news article hint → benign');
  assert(decideRead(r2.class) === 'allow', 'news article → allow on read');

  // Even without a hint, a plain public page falls through to benign
  // (the deny-bias is on the *host / path* tables, not on the classifier's
  // final fallback — otherwise every legitimate site would need a hint).
  const r3 = classifyPage('https://wikipedia.org/wiki/Chrome_extension', {});
  assert(r3.class === RULES.PAGE_CLASS.BENIGN, 'unmatched public page → benign');
  assert(decideRead(r3.class) === 'allow', 'unmatched public page reads allowed');
}

// ==========================================================================
// 6. Unknown / restricted URLs.
// ==========================================================================
section('classifyPage — unknown URL classes (EC-W2-12)');
{
  const chrome = classifyPage('chrome://extensions/', {});
  assert(chrome.class === RULES.PAGE_CLASS.UNKNOWN, 'chrome:// → unknown');
  assert(decideRead(chrome.class) === 'block', 'unknown → block on read (deny-biased)');

  const empty = classifyPage('', {});
  assert(empty.class === RULES.PAGE_CLASS.UNKNOWN, 'empty URL → unknown');
  assert(empty.reason === 'missing-url', 'empty URL reason = missing-url');

  const notAUrl = classifyPage('this is not a url', {});
  assert(notAUrl.class === RULES.PAGE_CLASS.UNKNOWN, 'unparseable → unknown');
  assert(notAUrl.reason === 'unparseable-url', 'unparseable reason = unparseable-url');

  const nonHttp = classifyPage('file:///C:/secret/notes.txt', {});
  assert(nonHttp.class === RULES.PAGE_CLASS.UNKNOWN, 'file:// → unknown (never read)');
  assert(decideRead(nonHttp.class) === 'block', 'file:// → block on read');
}
// -------------------------------------------------------------------------
// ==========================================================================
// Selected text — credential disclosure detection.
// ==========================================================================
section('classifyText — selected text credential protection');
  {
    const credentialText =
      'My bank account number is 123456789012 and my password is ExamplePassword123.';

    const credential = classifyText(credentialText);
    assert(
      credential.class === 'credential',
      'explicit bank account and password disclosure is blocked'
    );

    const ordinary = classifyText(
      'Gravity is the force that attracts objects toward each other.'
    );
    assert(
      ordinary.class === 'ordinary',
      'ordinary educational text remains allowed'
    );

    const numberOnly = classifyText(
      'The experiment produced the number 123456789012.'
    );
    assert(
      numberOnly.class === 'ordinary',
      'a number without credential context is not automatically blocked'
    );

    const passwordOnly = classifyText(
      'My password is ExamplePassword123.'
    );
    assert(
      passwordOnly.class === 'credential',
      'explicit password disclosure is blocked'
    );
  }
// ==========================================================================
// 7. Plan Unit-tests bullet: "password-type input → block".
// ==========================================================================
section('classifyField — password signals');
{
  const cases = [
    [{ tag: 'input', type: 'password' }, 'password', 'type=password'],
    [{ tag: 'input', type: 'text', autocomplete: 'new-password' }, 'password', 'autocomplete=new-password'],
    [{ tag: 'input', type: 'text', autocomplete: 'current-password' }, 'password', 'autocomplete=current-password'],
    [{ tag: 'input', type: 'text', name: 'password' }, 'password', 'name=password'],
    [{ tag: 'input', type: 'text', name: 'pwd' }, 'password', 'name=pwd'],
    [{ tag: 'input', type: 'text', label: 'Enter your Password' }, 'password', 'label=password'],
  ];
  for (const [d, kind, label] of cases) {
    const r = classifyField(d);
    assert(
      r.class === RULES.FIELD_CLASS.CREDENTIAL && r.kind === kind,
      'credential/' + kind + ' for ' + label
    );
    const dec = decideAction(RULES.ACTION_TYPE.TYPE, r.class, RULES.PAGE_CLASS.BENIGN);
    assert(dec === 'block', 'type on ' + label + ' → block (INV-6)');
  }
}

// ==========================================================================
// 8. OTP fields (PS §2.20).
// ==========================================================================
section('classifyField — OTP signals');
{
  const cases = [
    [{ tag: 'input', autocomplete: 'one-time-code' }, 'autocomplete=one-time-code'],
    [{ tag: 'input', type: 'text', name: 'otp' }, 'name=otp'],
    [{ tag: 'input', type: 'text', name: 'verification_code' }, 'name=verification'],
    [{ tag: 'input', type: 'text', placeholder: 'Enter OTP' }, 'placeholder=OTP'],
    [{ tag: 'input', type: 'text', label: 'SMS verification code' }, 'label=verification'],
  ];
  for (const [d, label] of cases) {
    const r = classifyField(d);
    assert(r.class === RULES.FIELD_CLASS.CREDENTIAL && r.kind === RULES.CREDENTIAL_KIND.OTP,
      'otp credential: ' + label);
    assert(decideAction(RULES.ACTION_TYPE.TYPE, r.class, RULES.PAGE_CLASS.BENIGN) === 'block',
      'type on otp (' + label + ') → block');
  }
}

// ==========================================================================
// 9. Plan Unit-tests bullet: "label 'Card number' → block".
// ==========================================================================
section('classifyField — card-information signals');
{
  // The exact case from the plan:
  const planCase = classifyField({ tag: 'input', type: 'text', label: 'Card number' });
  assert(planCase.class === RULES.FIELD_CLASS.CREDENTIAL && planCase.kind === RULES.CREDENTIAL_KIND.CARD,
    'label "Card number" → credential/card');
  assert(decideAction('type', planCase.class, 'benign') === 'block',
    'type on label "Card number" → block');

  const extras = [
    [{ tag: 'input', autocomplete: 'cc-number' }, 'autocomplete=cc-number'],
    [{ tag: 'input', autocomplete: 'cc-csc' }, 'autocomplete=cc-csc'],
    [{ tag: 'input', name: 'cvv' }, 'name=cvv'],
    [{ tag: 'input', label: 'Credit card' }, 'label=credit card'],
    [{ tag: 'input', label: 'Expiration date' }, 'label=expiration'],
  ];
  for (const [d, label] of extras) {
    const r = classifyField(d);
    assert(r.class === RULES.FIELD_CLASS.CREDENTIAL && r.kind === RULES.CREDENTIAL_KIND.CARD,
      'card credential: ' + label);
  }
}

// ==========================================================================
// 10. Plan Unit-tests bullet: "label 'Submit' → require-confirm".
// ==========================================================================
section('classifyField — consequential labels (Submit / Pay / Send)');
{
  const planCase = classifyField({ tag: 'button', type: 'submit', label: 'Submit' });
  assert(planCase.class === RULES.FIELD_CLASS.CONSEQUENTIAL,
    'label "Submit" → consequential');
  assert(planCase.kind === RULES.CONSEQUENTIAL_KIND.SUBMIT,
    'kind = submit');
  assert(decideAction('click', planCase.class, 'benign') === 'require-confirm',
    'click Submit on benign → require-confirm');

  const pay = classifyField({ tag: 'button', label: 'Pay now' });
  assert(pay.class === RULES.FIELD_CLASS.CONSEQUENTIAL && pay.kind === 'pay',
    'label "Pay now" → consequential/pay');
  assert(decideAction('click', pay.class, 'benign') === 'require-confirm',
    'click Pay → require-confirm');

  const send = classifyField({ tag: 'button', text: 'Send' });
  assert(send.class === RULES.FIELD_CLASS.CONSEQUENTIAL && send.kind === 'send',
    'visible text "Send" → consequential/send');
  assert(decideAction('click', send.class, 'benign') === 'require-confirm',
    'click Send → require-confirm');

  // Consequential on a SENSITIVE page must escalate to block (not require-confirm):
  // INV-6 wins over INV-6-with-a-confirm.
  assert(decideAction('click', 'consequential', 'sensitive') === 'block',
    'click Submit on sensitive page → block (page gate wins over field gate)');
}

// ==========================================================================
// 11. Ordinary fields.
// ==========================================================================
section('classifyField — ordinary inputs / non-mutating actions');
{
  const cases = [
    { tag: 'input', type: 'text', name: 'query' },
    { tag: 'input', type: 'email', name: 'user-email' },
    { tag: 'textarea' },
    { tag: 'select' },
    { tag: 'button', label: 'Load more' },
    { tag: 'a', text: 'Next page' },
  ];
  for (const d of cases) {
    const r = classifyField(d);
    assert(r.class === RULES.FIELD_CLASS.ORDINARY,
      'ordinary: ' + (d.tag + '/' + (d.type || '') + '/' + (d.name || d.label || d.text || '')));
    assert(decideAction('click', r.class, 'benign') === 'allow',
      'click ordinary on benign → allow');
  }
}

// ==========================================================================
// 12. decideRead complete table.
// ==========================================================================
section('decideRead — full page-class table');
{
  const table = [
    ['sensitive', 'block'],
    ['private', 'block'],
    ['unknown', 'block'],
    ['benign', 'allow'],
    ['practice', 'allow'],
    // Any value outside the enum falls through to block (deny-biased).
    ['nonsense-class', 'block'],
  ];
  for (const [inp, exp] of table) {
    const d = decideRead(inp);
    assert(d === exp, 'decideRead("' + inp + '") → ' + exp);
    assert(isDecision(d), 'decideRead returned a valid DECISION for "' + inp + '"');
  }
}

// ==========================================================================
// 13. decideAction comprehensive matrix.
// ==========================================================================
section('decideAction — matrix across action × target × page');
{
  const A = RULES.ACTION_TYPE;
  const Fv = RULES.FIELD_CLASS;
  const Pv = RULES.PAGE_CLASS;

  const table = [
    // Sensitive page: EVERY action blocks (INV-6).
    ['click',    Fv.ORDINARY,    Pv.SENSITIVE, 'block'],
    ['type',     Fv.ORDINARY,    Pv.SENSITIVE, 'block'],
    ['scroll',   Fv.ORDINARY,    Pv.SENSITIVE, 'block'],
    ['done',     Fv.ORDINARY,    Pv.SENSITIVE, 'block'],
    ['click',    Fv.CONSEQUENTIAL, Pv.SENSITIVE, 'block'],

    // Private page: same hard block.
    ['click',    Fv.ORDINARY,    Pv.PRIVATE,   'block'],
    ['scroll',   Fv.ORDINARY,    Pv.PRIVATE,   'block'],

    // Unknown page: deny-biased.
    ['click',    Fv.ORDINARY,    Pv.UNKNOWN,   'block'],

    // Benign page + credential target.
    ['type',     Fv.CREDENTIAL,  Pv.BENIGN,    'block'],
    ['click',    Fv.CREDENTIAL,  Pv.BENIGN,    'block'],
    ['select',   Fv.CREDENTIAL,  Pv.BENIGN,    'block'],
    ['scroll',   Fv.CREDENTIAL,  Pv.BENIGN,    'allow'],
    ['done',     Fv.CREDENTIAL,  Pv.BENIGN,    'allow'],

    // Benign page + consequential.
    ['click',    Fv.CONSEQUENTIAL, Pv.BENIGN,  'require-confirm'],
    ['type',     Fv.CONSEQUENTIAL, Pv.BENIGN,  'require-confirm'],
    ['select',   Fv.CONSEQUENTIAL, Pv.BENIGN,  'require-confirm'],
    ['scroll',   Fv.CONSEQUENTIAL, Pv.BENIGN,  'allow'],
    ['done',     Fv.CONSEQUENTIAL, Pv.BENIGN,  'allow'],

    // Benign page + unknown target: require-confirm (EC-W3-04 deny-bias).
    ['click',    Fv.UNKNOWN,     Pv.BENIGN,    'require-confirm'],
    ['type',     Fv.UNKNOWN,     Pv.BENIGN,    'require-confirm'],

    // Benign page + ordinary: allow.
    ['click',    Fv.ORDINARY,    Pv.BENIGN,    'allow'],
    ['type',     Fv.ORDINARY,    Pv.BENIGN,    'allow'],
    ['select',   Fv.ORDINARY,    Pv.BENIGN,    'allow'],
    ['scroll',   Fv.ORDINARY,    Pv.BENIGN,    'allow'],
    ['done',     Fv.ORDINARY,    Pv.BENIGN,    'allow'],

    // Practice page mirrors benign for ordinary targets.
    ['type',     Fv.ORDINARY,    Pv.PRACTICE,  'allow'],

    // Malformed action type → hard block (deny-biased).
    ['delete-file', Fv.ORDINARY, Pv.BENIGN,    'block'],
  ];
  for (const [at, tc, pc, exp] of table) {
    const d = decideAction(at, tc, pc);
    assert(d === exp, 'decideAction(' + at + ', ' + tc + ', ' + pc + ') → ' + exp);
    assert(isDecision(d), 'returned a valid DECISION');
  }
}

// ==========================================================================
// 14. Determinism (Slice 1.2.1 Acceptance).
// ==========================================================================
section('determinism — same input produces identical output');
{
  const runs = 3;

  // classifyPage
  {
    const url = 'https://netbanking.hdfcbank.com/login';
    const first = classifyPage(url, {});
    for (let i = 1; i < runs; i++) {
      assert(deepEqualJson(first, classifyPage(url, {})),
        'classifyPage deterministic (run ' + (i + 1) + ')');
    }
  }
  // classifyField
  {
    const d = { tag: 'input', type: 'text', name: 'card_number', label: 'Card number' };
    const first = classifyField(d);
    for (let i = 1; i < runs; i++) {
      assert(deepEqualJson(first, classifyField(d)),
        'classifyField deterministic (run ' + (i + 1) + ')');
    }
  }
  // decideAction
  {
    const first = decideAction('click', 'consequential', 'benign');
    for (let i = 1; i < runs; i++) {
      assert(decideAction('click', 'consequential', 'benign') === first,
        'decideAction deterministic (run ' + (i + 1) + ')');
    }
  }

  // Input object mutation must not leak into the returned classification.
  {
    const d = { tag: 'input', type: 'password' };
    const r = classifyField(d);
    d.type = 'text';
    const r2 = classifyField(d);
    assert(r.class === 'credential', 'past result computed at call time (password → credential)');
    assert(r2.class === 'ordinary', 're-classification after mutation reflects the NEW descriptor (text → ordinary)');
  }
}

// ==========================================================================
// 15. Purity — no fetch, no chrome.* inside safety modules.
// ==========================================================================
section('purity — source scan (Slice 1.2.1 Acceptance)');
{
  // Read each source file and assert forbidden tokens are absent.
  const FORBIDDEN = [
    { re: /\bchrome\./, label: 'chrome.' },
    { re: /\bfetch\s*\(/, label: 'fetch(' },
    { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
    { re: /\bWebSocket\b/, label: 'WebSocket' },
    { re: /\bEventSource\b/, label: 'EventSource' },
    { re: /\bnavigator\.sendBeacon\b/, label: 'navigator.sendBeacon' },
    { re: /\blocalStorage\b/, label: 'localStorage' },
    { re: /\bsessionStorage\b/, label: 'sessionStorage' },
    { re: /\bindexedDB\b/, label: 'indexedDB' },
    { re: /\bDate\.now\b/, label: 'Date.now' },
    { re: /\bMath\.random\b/, label: 'Math.random' },
    { re: /\bsetTimeout\b/, label: 'setTimeout' },
    { re: /\bsetInterval\b/, label: 'setInterval' },
  ];

  const files = [
    'safety/rules.js',
    'safety/classifiers.js',
    'safety/policy.js',
  ];

  const repoRoot = path.resolve(__dirname, '..', '..');
  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    const src = fs.readFileSync(abs, 'utf8');
    for (const { re, label } of FORBIDDEN) {
      // The token may legitimately appear inside a comment. Strip // line
      // and /* */ block comments before scanning.
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      assert(!re.test(codeOnly), rel + ': no "' + label + '" in code (only comments if present)');
    }
  }

  // Also assert the enum sets are frozen (Object.freeze).
  assert(Object.isFrozen(RULES.DECISION), 'RULES.DECISION is frozen');
  assert(Object.isFrozen(RULES.PAGE_CLASS), 'RULES.PAGE_CLASS is frozen');
  assert(Object.isFrozen(RULES.SENSITIVE_HOSTS), 'RULES.SENSITIVE_HOSTS is frozen');
  assert(Object.isFrozen(RULES.SENSITIVE_PATH_PATTERNS), 'RULES.SENSITIVE_PATH_PATTERNS is frozen');
}

// ==========================================================================
// 16. End-to-end mini-scenarios that mirror the plan's Chrome-test spirit
//     without needing Chrome (Slice 1.2.1 says Chrome test: none needed).
// ==========================================================================
section('end-to-end — panel would consume exactly this');
{
  // Scenario: user opens mock banking page and asks panel to Read page.
  const readPage = classifyPage('https://bank.example.com/login', {});
  assert(readPage.class === 'sensitive', 'e2e: mock bank classified sensitive');
  assert(decideRead(readPage.class) === 'block', 'e2e: read blocked');

  // Scenario: user starts an errand on a benign page; model proposes
  // typing into a search field.
  const goodPage = classifyPage('https://acme.test/pricing', {});
  const goodField = classifyField({ tag: 'input', type: 'text', name: 'query' });
  assert(decideRead(goodPage.class) === 'allow', 'e2e: benign page readable');
  assert(decideAction('type', goodField.class, goodPage.class) === 'allow', 'e2e: benign type allowed');

  // Scenario: model proposes clicking Submit on a benign form.
  const submitBtn = classifyField({ tag: 'button', label: 'Submit' });
  assert(decideAction('click', submitBtn.class, 'benign') === 'require-confirm',
    'e2e: click Submit on benign requires second confirm (EC-W4-08)');

  // Scenario: mid-task the user lands on a bank page (EC-W3-12).
  const bankNow = classifyPage('https://paytm.com/merchant/pay', {});
  const someTarget = classifyField({ tag: 'input', type: 'text', name: 'amount' });
  assert(decideAction('type', someTarget.class, bankNow.class) === 'block',
    'e2e: page gate blocks actions on bank even for ordinary field (INV-6)');

  // Scenario: model tries to type into a password field on a benign page.
  const pwField = classifyField({ tag: 'input', type: 'password', name: 'pw' });
  assert(decideAction('type', pwField.class, 'benign') === 'block',
    'e2e: type password → block (PS §2.20)');
}

// ==========================================================================
// Summary
// ==========================================================================
console.log('\n----------------------------------------');
console.log('Summary: ' + pass + ' passed, ' + fail + ' failed.');
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  process.exit(0);
}
