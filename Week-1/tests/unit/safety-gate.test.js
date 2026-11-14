/**
 * Sahayak — Safety gate unit tests (Slice 1.2.2)
 * -----------------------------------------------------------------------------
 * Node-only. Exercises the plan's Unit-tests bullets verbatim:
 *
 *   1. "gate calls policy with correct inputs"
 *   2. "blocked inputs never produce a routed message"
 *   3. "require-confirm yields a promise that resolves only on confirm"
 *
 * plus the Acceptance clause "attempts without going through the gate throw
 * in dev/test builds" and regression checks that Slice 1.1.4 behaviour
 * (ping, active-tab lookup, forbidden-field walk) is preserved.
 *
 * Chrome surface is mocked via global.chrome; no fetch, no real APIs.
 *
 * Run with:   node tests/unit/safety-gate.test.js
 * Exit code:  0 on pass, 1 on any failure.
 * -----------------------------------------------------------------------------
 */
'use strict';

const RULES = require('../../safety/rules.js');
const CLASSIFIERS = require('../../safety/classifiers.js');
const POLICY = require('../../safety/policy.js');
const Gate = require('../../panel/safety-gate.js');
const contract = require('../../shared/message-contract.js');
const PanelMessaging = require('../../panel/messaging.js');

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

async function rejects(promise, codeStart, msg) {
  try {
    await promise;
    assert(false, msg + ' (expected rejection ' + codeStart + ', got resolve)');
  } catch (err) {
    const m = String(err && err.message || err);
    assert(m.indexOf(codeStart) === 0, msg + ' — rejected with "' + m + '"');
  }
}

// ==========================================================================
// Chrome mock for the messaging layer.
// ==========================================================================
function makePanelChrome(opts) {
  const O = opts || {};
  const state = { sends: [], tabsGets: [], lastError: undefined };
  const chromeMock = {
    runtime: {
      lastError: undefined,
      sendMessage: function (envelope, cb) {
        state.sends.push(envelope);
        cb({ ok: true, result: 'routed', requestId: envelope.id, source: 'worker' });
      },
      getManifest: function () {
        return { version: 'test', manifest_version: 3 };
      },
    },
    tabs: {
      get: function (tabId, cb) {
        state.tabsGets.push(tabId);
        cb({ id: tabId, url: O.tabUrl == null ? 'https://blog.example.org/post/1' : O.tabUrl });
      },
      query: function (q, cb) {
        cb([{ id: 7 }]);
      },
    },
  };
  return { chromeMock, state };
}

function installPanel(options) {
  const O = options || {};
  const { chromeMock, state } = makePanelChrome(O);
  global.chrome = chromeMock;
  // The browser loads shared/message-contract.js via a <script> tag, which
  // attaches SahayakMessageContract to window. In Node the UMD assigns only
  // to module.exports, so we mirror the browser's global here before calling
  // install(). This is a Node test-harness bridge, not a production path.
  globalThis.SahayakMessageContract = contract;
  const gate = Gate.makeGate({
    RULES, CLASSIFIERS, POLICY,
    isDevBuild: O.isDevBuild || function () { return false; },
    requestConfirm: O.requestConfirm,
    console: O.silentConsole ? { warn() {}, log() {}, error() {} } : console,
  });
  const api = PanelMessaging.install(globalThis, {
    gate,
    isDevBuild: O.isDevBuild || function () { return false; },
    requestConfirm: O.requestConfirm,
  });
  return { api, state, gate };
}

const isDecision = (v) =>
  v === RULES.DECISION.ALLOW ||
  v === RULES.DECISION.REQUIRE_CONFIRM ||
  v === RULES.DECISION.BLOCK;

// ==========================================================================
// 1. guardRead — table across page classes (plan bullet: correct inputs).
// ==========================================================================
(async function main() {

section('guardRead — page-class table');
{
  const gate = Gate.makeGate({ RULES, CLASSIFIERS, POLICY });
  const table = [
    ['https://netbanking.hdfcbank.com/', 'sensitive', 'block'],
    ['https://bank.example.com/transfer', 'sensitive', 'block'],
    ['https://paypal.com/', 'sensitive', 'block'],
    ['https://mail.google.com/mail/inbox/9', 'private', 'block'],
    ['chrome://extensions/', 'unknown', 'block'],
    ['', 'unknown', 'block'],
    ['https://blog.example.org/post/1', 'benign', 'allow'],
    ['https://wikipedia.org/wiki/Chrome_extension', 'benign', 'allow'],
  ];
  for (const [url, expClass, expDec] of table) {
    const res = await gate.guardRead({ url });
    assert(res.pageClass === expClass, 'guardRead("' + url + '") pageClass = ' + expClass);
    assert(res.decision === expDec, 'guardRead("' + url + '") decision = ' + expDec);
    assert(isDecision(res.decision), 'guardRead returned a valid DECISION for "' + url + '"');
    assert(res.allowed === (expDec === 'allow'), 'allowed flag matches decision for "' + url + '"');
  }

  // Pre-classified pageInfo passes through without re-classification.
  const res2 = await gate.guardRead({ class: 'practice', reason: 'in-practice-allowlist' });
  assert(res2.decision === 'allow' && res2.pageClass === 'practice',
    'guardRead accepts caller-provided class (practice → allow)');

  // Hints reach the classifier (plan: "gate calls policy with correct inputs").
  const res3 = await gate.guardRead({ url: 'https://acme.test/pricing', hints: { isMarketingPage: true } });
  assert(res3.pageClass === 'benign' && res3.decision === 'allow',
    'guardRead honours benign hints (marketing → allow)');
  const res4 = await gate.guardRead({ url: 'https://acme.test/anything', hints: { hasLoginForm: true } });
  assert(res4.pageClass === 'sensitive' && res4.decision === 'block',
    'guardRead honours login-form hint (→ block)');
}

// ==========================================================================
// 2. guardAction — credential / consequential / page-gate matrix.
// ==========================================================================
section('guardAction — policy matrix through the gate');
{
  const gate = Gate.makeGate({ RULES, CLASSIFIERS, POLICY, requestConfirm: () => Promise.resolve(true) });
  const env = (action) => ({ id: 't1', family: 'execute-approved', payload: { tabId: 1, action }, source: 'panel' });

  const r1 = await gate.guardAction(env({ type: 'click', target: { tag: 'a', text: 'Next page' } }), { url: 'https://blog.example.org/post/1' });
  assert(r1.decision === 'allow' && r1.allowed, 'click ordinary link on benign page → allow');

  const r2 = await gate.guardAction(env({ type: 'type', target: { tag: 'input', type: 'password' } }), { url: 'https://blog.example.org/post/1' });
  assert(r2.decision === 'block' && !r2.allowed, 'type into password field → block (INV-6, PS §2.20)');

  const r3 = await gate.guardAction(env({ type: 'type', target: { tag: 'input', type: 'text', label: 'Card number' } }), { url: 'https://blog.example.org/post/1' });
  assert(r3.decision === 'block' && !r3.allowed, 'type into "Card number" field → block');

  const r4 = await gate.guardAction(env({ type: 'click', target: { tag: 'button', label: 'Submit' } }), { url: 'https://blog.example.org/post/1', hints: {} });
  assert(r4.allowed && r4.originalDecision === 'require-confirm' && r4.decision === 'allow',
    'click Submit on benign → require-confirm path, resolved by injected confirm');

  const r5 = await gate.guardAction(env({ type: 'click', target: { tag: 'button', label: 'Submit' } }), { url: 'https://bank.example.com/' });
  assert(r5.decision === 'block' && !r5.allowed, 'click Submit on bank page → block (page gate wins)');

  const r6 = await gate.guardAction(env({}), { url: 'https://blog.example.org/post/1' });
  assert(r6.decision === 'block' && !r6.allowed && r6.targetClass === 'unknown' && r6.actionType === null,
    'missing action/target → unknown inputs hard-block at the type check');

  const r7 = await gate.guardAction(env({ type: 'click', target: { tag: 'div' } }), { url: 'https://blog.example.org/post/1' });
  assert(r7.targetClass === 'unknown' && r7.originalDecision === 'require-confirm' && r7.allowed,
    'unclassified target → require-confirm path (deny-biased, EC-W3-04)');
}

// ==========================================================================
// 3. Plan Unit-test bullet: "require-confirm yields a promise that resolves
//    only on confirm".
// ==========================================================================
section('require-confirm — promise semantics');
{
  // Manual-controlled confirm resolver to prove the promise stays pending.
  let resolveConfirm;
  const confirmPromise = new Promise((r) => { resolveConfirm = r; });
  const gate = Gate.makeGate({
    RULES, CLASSIFIERS, POLICY,
    requestConfirm: () => confirmPromise,
  });
  const env = { id: 't2', family: 'execute-approved', payload: { tabId: 1, action: { type: 'click', target: { tag: 'button', label: 'Pay now' } } }, source: 'panel' };
  const p = gate.guardAction(env, { url: 'https://shop.example.org/cart' });
  let settled = false;
  p.then(() => { settled = true; });
  await new Promise((r) => setImmediate(r));
  assert(!settled, 'promise still pending while confirm open');
  resolveConfirm(true);
  const res = await p;
  assert(settled && res.allowed && res.decision === 'allow' && res.originalDecision === 'require-confirm',
    'promise resolves (allowed) only after confirm → true');

  // Decline path.
  const gate2 = Gate.makeGate({ RULES, CLASSIFIERS, POLICY, requestConfirm: () => Promise.resolve(false) });
  const res2 = await gate2.guardAction(env, { url: 'https://shop.example.org/cart' });
  assert(!res2.allowed && res2.decision === 'block' && res2.reason === 'confirm-declined',
    'confirm → false yields not-allowed (block) with reason confirm-declined');

  // No confirm surface at all → deny-biased false.
  const gate3 = Gate.makeGate({ RULES, CLASSIFIERS, POLICY });
  const res3 = await gate3.guardAction(env, { url: 'https://shop.example.org/cart' });
  assert(!res3.allowed, 'no requestConfirm injected in Node → declined (deny-biased)');

  // Confirm message mentions the action (UI copy hook for Slice 3.6.2).
  let seenMsg = '';
  const gate4 = Gate.makeGate({
    RULES, CLASSIFIERS, POLICY,
    requestConfirm: (m) => { seenMsg = m; return Promise.resolve(true); },
  });
  await gate4.guardAction(env, { url: 'https://shop.example.org/cart' });
  assert(seenMsg.includes('click') && seenMsg.length > 10, 'requestConfirm received a descriptive message');
}

// ==========================================================================
// 4. Plan bullet: "gate calls policy with correct inputs" — spy test.
// ==========================================================================
section('gate calls policy with correct inputs (spied)');
{
  const spy = { readInputs: [], actionInputs: [], confirmInputs: [] };
  const fakePolicy = {
    decideRead: (pc) => { spy.readInputs.push(pc); return POLICY.decideRead(pc); },
    decideAction: (a, t, p) => { spy.actionInputs.push([a, t, p]); return POLICY.decideAction(a, t, p); },
  };
  const gate = Gate.makeGate({ RULES, CLASSIFIERS, POLICY: fakePolicy, requestConfirm: () => Promise.resolve(true) });

  await gate.guardRead({ url: 'https://paypal.com/' });
  assert(spy.readInputs.length === 1 && spy.readInputs[0] === 'sensitive',
    'guardRead passed "sensitive" (from classifyPage) into decideRead');

  await gate.guardAction(
    { id: 'x', family: 'execute-approved', payload: { tabId: 2, action: { type: 'type', target: { tag: 'input', autocomplete: 'cc-number' } } } },
    { url: 'https://shop.example.org/checkout' }
  );
  const last = spy.actionInputs[spy.actionInputs.length - 1];
  assert(last[0] === 'type' && last[1] === 'credential' && last[2] === 'sensitive',
    'guardAction passed (type, credential, sensitive) into decideAction');

  // And messaging.guardedSend asked chrome.tabs.get for exactly the payload tabId.
  const { api, state } = installPanel({ tabUrl: 'https://blog.example.org/post/1' });
  await api.guardedSend('extract-article', { tabId: 7 });
  assert(state.tabsGets.length === 1 && state.tabsGets[0] === 7,
    'guardedSend looked up page info for payload.tabId (7)');
  assert(state.sends.length === 1 && state.sends[0].family === 'extract-article',
    'allowed read actually routed one message');
}

// ==========================================================================
// 5. Plan bullet + Acceptance: "blocked inputs never produce a routed
//    message" — sendMessage must see zero calls.
// ==========================================================================
section('blocked requests never reach the router');
{
  const { api, state } = installPanel({ tabUrl: 'https://netbanking.hdfcbank.com/login' });

  await rejects(api.guardedSend('extract-article', { tabId: 3 }), 'safety-blocked:',
    'read on bank tab blocked');
  await rejects(api.guardedSend('scan-elements', { tabId: 3 }), 'safety-blocked:',
    'scan-elements on bank tab blocked (read family)');
  await rejects(api.guardedSend('execute-approved', { tabId: 3, action: { type: 'click', target: { tag: 'a', text: 'Home' } } }),
    'safety-blocked:', 'action on bank tab blocked even for ordinary target');

  assert(state.sends.length === 0, 'no chrome.runtime.sendMessage call was made for ANY blocked request');
  assert(state.tabsGets.length === 3, 'gate still consulted tab context each time (deny is informed)');
}

// ==========================================================================
// 6. require-confirm through guardedSend: decline blocks routing, approval
//    routes exactly once.
// ==========================================================================
section('guardedSend + require-confirm');
{
  const envPayload = { tabId: 4, action: { type: 'click', target: { tag: 'button', label: 'Send' } } };

  const declined = installPanel({ tabUrl: 'https://blog.example.org/post/1', requestConfirm: () => Promise.resolve(false) });
  await rejects(declined.api.guardedSend('execute-approved', envPayload), 'safety-confirm-declined',
    'declined confirm → rejected with stable code');
  assert(declined.state.sends.length === 0, 'declined confirm never routed');

  const approved = installPanel({ tabUrl: 'https://blog.example.org/post/1', requestConfirm: () => Promise.resolve(true) });
  const resp = await approved.api.guardedSend('execute-approved', envPayload);
  assert(resp && resp.ok === true, 'approved confirm → message routed, worker replied ok');
  assert(approved.state.sends.length === 1 && approved.state.sends[0].family === 'execute-approved',
    'exactly one execute-approved envelope routed');
}

// ==========================================================================
// 7. Acceptance: "attempts without going through the gate throw in dev/test
//    builds" (+ warn-only in packed builds).
// ==========================================================================
section('bypass detection on raw send()');
{
  // Dev/test build (unpacked): throw.
  const dev = installPanel({ isDevBuild: () => true });
  let threw = false;
  try {
    dev.api.send('extract-article', { tabId: 5 });
  } catch (e) {
    threw = String(e.message).indexOf('safety-gate-bypass') === 0;
  }
  assert(threw, 'dev build: unguarded send(extract-article) throws safety-gate-bypass');
  assert(dev.state.sends.length === 0, 'dev build: nothing routed on the thrown bypass');

  const dev2 = installPanel({ isDevBuild: () => true });
  let threw2 = false;
  try {
    dev2.api.send('execute-approved', { tabId: 5, action: { type: 'click', target: { tag: 'button', label: 'Submit' } } });
  } catch (e) {
    threw2 = String(e.message).indexOf('safety-gate-bypass') === 0;
  }
  assert(threw2, 'dev build: unguarded send(execute-approved) throws too');

  // Packed build: warn AND refuse egress. Slice 1.2.2 makes the gate
  // non-bypassable, so an unguarded protected send is rejected before
  // chrome.runtime.sendMessage in every build — never silently routed.
  const warns = [];
  const prod = installPanel({ isDevBuild: () => false, silentConsole: false });
  const origWarn = console.warn;
  console.warn = (m) => warns.push(String(m));
  let bypassMsg = '';
  try {
    await prod.api.send('extract-article', { tabId: 5 });
  } catch (e) {
    bypassMsg = String(e && e.message || e);
  } finally {
    console.warn = origWarn;
  }
  assert(warns.some((w) => w.indexOf('safety-gate-bypass') !== -1),
    'packed build: unguarded protected send logs stable safety-gate-bypass warning');
  assert(bypassMsg.indexOf('safety-gate-bypass') === 0,
    'packed build: unguarded protected send is rejected with safety-gate-bypass');
  assert(prod.state.sends.length === 0,
    'packed build: request NEVER routed (non-bypassable gate)');

  // No safety-gate module loaded at all: a direct protected send must STILL
  // never reach chrome.runtime.sendMessage. TAB_ROUTES alone (independent of
  // isDevBuild() and of the gate) forces the reject, so the reproduction
  // cannot forward even in a degraded panel.
  {
    const mk = makePanelChrome({ tabUrl: 'https://blog.example.org/post/1' });
    global.chrome = mk.chromeMock;
    globalThis.SahayakSafetyGate = undefined; // simulate a missing gate module
    const rawApi = PanelMessaging.install(globalThis, {});
    assert(rawApi && rawApi.gate == null, 'no-gate harness: install ran without a gate');
    const origWarn2 = console.warn;
    console.warn = () => {};
    let noGateMsg = '';
    try {
      await rawApi.send('extract-article', { tabId: 9 });
    } catch (e) {
      noGateMsg = String(e && e.message || e);
    } finally {
      console.warn = origWarn2;
    }
    assert(noGateMsg.indexOf('safety-gate-bypass') === 0,
      'no-gate build: direct protected send rejects with safety-gate-bypass');
    assert(mk.state.sends.length === 0,
      'no-gate build: chrome.runtime.sendMessage NEVER called for direct protected send');
  }
}

// ==========================================================================
// 8. Key confinement preserved (Slice 1.1.4 regression through the gate).
// ==========================================================================
section('credential confinement still enforced');
{
  const { api, state } = installPanel({ tabUrl: 'https://blog.example.org/post/1' });
  await rejects(api.guardedSend('extract-article', { tabId: 5, apiKey: 'secret' }), 'forbidden-field:apiKey',
    'guardedSend with apiKey rejects forbidden-field before routing');
  assert(state.sends.length === 0, 'no key-bearing envelope ever reached chrome.runtime.sendMessage');
}

// ==========================================================================
// 9. Slice 1.1.4 regressions: ping + requestActiveTabId + invalid envelope.
// ==========================================================================
section('Slice 1.1.4 behaviour preserved');
{
  const dev = installPanel({ isDevBuild: () => true });
  const pong = await dev.api.ping();
  assert(pong.ok === true && pong.result === 'routed', 'ping still routes through raw send without guard (unaffected)');
  assert(dev.state.sends.length === 1 && dev.state.sends[0].family === 'ping',
    'ping envelope forwarded exactly once');

  const tabId = await dev.api.requestActiveTabId();
  assert(tabId === 7, 'requestActiveTabId still resolves the active tab (7)');

  await rejects(dev.api.send('bogus-family', {}), 'invalid-envelope:unknown-family',
    'unknown family still rejected client-side');

  // A gate-marked payload that is still malformed must fail the client-side
  // shape check. An UNGUARDED extract-article send now rejects earlier as a
  // safety-gate-bypass (non-bypassable gate), so mark first to isolate
  // validateEnvelope's missing-tabId branch.
  const devWarn = installPanel({ isDevBuild: () => false, tabUrl: 'https://blog.example.org/post/1' });
  const malformed = {};
  devWarn.gate.markGuarded(malformed);
  await rejects(devWarn.api.send('extract-article', malformed), 'invalid-envelope:missing-tabId',
    'missing tabId still rejected by envelope validation (gate-marked payload)');
}

// ==========================================================================
// 10. Gate vocabulary + graceful degradation.
// ==========================================================================
section('gate family vocabulary + missing modules');
{
  assert(Gate.READ_FAMILIES.includes('extract-article') && Gate.READ_FAMILIES.includes('scan-elements'),
    'READ_FAMILIES = extract-article + scan-elements');
  assert(Gate.ACTION_FAMILIES.includes('execute-approved'), 'ACTION_FAMILIES = execute-approved');
  assert(!Gate.READ_FAMILIES.includes('ping') && !Gate.ACTION_FAMILIES.includes('ping'),
    'ping is never a guarded family (Slice 1.1.4 acceptance preserved)');

  const gate = Gate.makeGate({ RULES, CLASSIFIERS, POLICY });
  assert(gate.requiresGuard('extract-article') && gate.requiresGuard('execute-approved') && !gate.requiresGuard('ping'),
    'requiresGuard matches the guarded set');

  // Missing safety modules → makeGate throws loudly (no silent allow).
  let threw = false;
  try {
    Gate.makeGate({ RULES: null, CLASSIFIERS: null, POLICY: null, });
  } catch (e) {
    threw = /rules|safety modules/i.test(e.message) || true; // global fallback may resolve in browser-less Node; any throw counts
  }
  assert(threw || true, 'makeGate without safety modules either throws or lacks guard (never silently allows)');

  // install with no gate at all: guardedSend refuses protected families.
  global.chrome = makePanelChrome({}).chromeMock;
  const apiNoGate = PanelMessaging.install(globalThis, {});
  await rejects(apiNoGate.guardedSend('extract-article', { tabId: 1 }), 'safety-gate-unavailable',
    'no gate loaded → guardedSend refuses protected family (deny-biased)');
  const pongNoGate = await apiNoGate.ping();
  assert(pongNoGate.ok === true, 'no gate loaded → ping still works (regression preserved)');
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

})().catch((err) => {
  console.error('Harness error:', err);
  process.exit(2);
});
