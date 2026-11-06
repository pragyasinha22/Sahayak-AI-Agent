/**
 * Sahayak — Router unit tests (Slice 1.1.4)
 * -----------------------------------------------------------------------------
 * Node-only. Mocks chrome.tabs.sendMessage + chrome.runtime.lastError and
 * exercises the factory-shaped handler so we can assert exactly the four
 * behaviours the plan calls out:
 *
 *   1. router validates envelope shape
 *   2. rejects missing `family`
 *   3. rejects unknown `family`
 *   4. rejects payloads carrying `apiKey`
 *
 * Plus extras that fall out of the same acceptance list: ping -> pong,
 * tab-routed families require tabId, tab-routed families actually forward,
 * and missing content scripts return a graceful error rather than throwing.
 *
 * Run with:   node tests/unit/router.test.js
 * Exit code:  0 on pass, 1 on any failure, 2 on harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

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

function makeChromeMock() {
  const state = {
    sends: [],
    lastError: null,
    responseFactory: function (tabId, msg) {
      return { ok: true, echoed: msg.family, tabId: tabId };
    },
  };
  const mock = {
    _state: state,
    tabs: {
      sendMessage(tabId, message, cb) {
        state.sends.push({ tabId: tabId, message: message });
        if (state.lastError) {
          mock.runtime.lastError = { message: state.lastError };
          cb();
          mock.runtime.lastError = undefined;
        } else {
          cb(state.responseFactory(tabId, message));
        }
      },
    },
    runtime: { lastError: undefined },
  };
  return mock;
}

// Install a fresh mock BEFORE requiring router.js. Router.js does not touch
// chrome at module-load time — only inside the handler closure — so this
// ordering is safe.
global.chrome = makeChromeMock();

const contract = require('../../shared/message-contract.js');
const Router = require('../../background/router.js');

function callHandler(handler, envelope) {
  return new Promise(function (resolve) {
    handler(envelope, {}, function (resp) {
      resolve(resp);
    });
  });
}

async function run() {
  const handler = Router.makeHandler(contract);

  section('ping: closes the loop inside the worker');
  {
    global.chrome._state.sends.length = 0;
    const r = await callHandler(handler, {
      id: 'req-1',
      family: 'ping',
      payload: {},
      source: 'panel',
    });
    assert(r && r.ok === true, 'ping yields ok=true');
    assert(r && r.result === 'pong', 'ping returns pong');
    assert(r && r.requestId === 'req-1', 'response echoes requestId');
    assert(r && r.source === 'worker', 'response marks source=worker');
    assert(
      global.chrome._state.sends.length === 0,
      'ping does NOT touch chrome.tabs.sendMessage'
    );
  }

  section('envelope shape validation');
  {
    global.chrome._state.sends.length = 0;
    const before = 0;

    const r1 = await callHandler(handler, null);
    assert(
      r1 && r1.ok === false && r1.error === 'invalid-envelope',
      'null envelope rejected with invalid-envelope'
    );
    assert(
      r1 && r1.reason === 'envelope-not-object',
      'reason is envelope-not-object for null'
    );

    const r2 = await callHandler(handler, { id: 'x', payload: {}, source: 'panel' });
    assert(r2 && r2.reason === 'missing-family', 'missing family rejected');

    const r3 = await callHandler(handler, {
      id: 'x',
      family: 'made-up',
      payload: {},
      source: 'panel',
    });
    assert(r3 && r3.reason === 'unknown-family', 'unknown family rejected');

    const r4 = await callHandler(handler, {
      id: 'x',
      family: 'ping',
      payload: {},
      source: 'hacker',
    });
    assert(r4 && r4.reason === 'bad-source', 'unrecognised source rejected');

    const r5 = await callHandler(handler, {
      family: 'ping',
      payload: {},
      source: 'panel',
    });
    assert(r5 && r5.reason === 'missing-or-bad-id', 'missing id rejected');

    const r6 = await callHandler(handler, {
      id: 'x',
      family: 'ping',
      payload: 'not-an-object',
      source: 'panel',
    });
    assert(r6 && r6.reason === 'payload-not-object', 'non-object payload rejected');

    assert(
      global.chrome._state.sends.length === before,
      'no invalid envelope reached chrome.tabs.sendMessage'
    );
  }

  section('forbidden fields: no key ever crosses into a routed message');
  {
    global.chrome._state.sends.length = 0;

    const top = await callHandler(handler, {
      id: 'a1',
      family: 'ping',
      payload: { apiKey: 'AIza-SECRET-DO-NOT-ROUTE' },
      source: 'panel',
    });
    assert(
      top && top.reason === 'forbidden-field:apiKey',
      'top-level apiKey inside payload rejected'
    );

    const nested = await callHandler(handler, {
      id: 'a2',
      family: 'ping',
      payload: { context: { creds: { geminiApiKey: 'AIza-SECRET' } } },
      source: 'panel',
    });
    assert(
      nested && nested.reason === 'forbidden-field:geminiApiKey',
      'deeply nested geminiApiKey rejected'
    );

    const snake = await callHandler(handler, {
      id: 'a3',
      family: 'ping',
      payload: { api_key: 'x' },
      source: 'panel',
    });
    assert(snake && snake.reason === 'forbidden-field:api_key', 'snake-case api_key rejected');

    const sibling = await callHandler(handler, {
      id: 'a4',
      family: 'ping',
      payload: {},
      source: 'panel',
      apiKey: 'AIza-SECRET',
    });
    assert(
      sibling && sibling.reason === 'forbidden-field:apiKey',
      'apiKey as an envelope sibling (outside payload) still rejected'
    );

    const inArray = await callHandler(handler, {
      id: 'a5',
      family: 'ping',
      payload: { list: [{ accessToken: 'x' }] },
      source: 'panel',
    });
    assert(
      inArray && inArray.reason === 'forbidden-field:accessToken',
      'accessToken inside an array element rejected'
    );

    const viaTab = await callHandler(handler, {
      id: 'a6',
      family: 'extract-article',
      payload: { tabId: 7, gemini_key: 'AIza-SECRET' },
      source: 'panel',
    });
    assert(
      viaTab && viaTab.reason === 'forbidden-field:gemini_key',
      'key smuggled through a tab-routed family rejected BEFORE forwarding'
    );

    assert(
      global.chrome._state.sends.length === 0,
      'zero key-bearing envelopes reached chrome.tabs.sendMessage'
    );
  }

  section('tab-routed families require a positive numeric tabId');
  {
    const r1 = await callHandler(handler, {
      id: 't1',
      family: 'extract-article',
      payload: {},
      source: 'panel',
    });
    assert(r1 && r1.reason === 'missing-tabId', 'extract-article without tabId rejected');

    const r2 = await callHandler(handler, {
      id: 't2',
      family: 'scan-elements',
      payload: { tabId: -1 },
      source: 'panel',
    });
    assert(r2 && r2.reason === 'missing-tabId', 'negative tabId rejected');

    const r3 = await callHandler(handler, {
      id: 't3',
      family: 'execute-approved',
      payload: { tabId: '44' },
      source: 'panel',
    });
    assert(
      r3 && r3.reason === 'missing-tabId',
      'string tabId rejected (must be finite number)'
    );

    const r4 = await callHandler(handler, {
      id: 't4',
      family: 'capture-screenshot',
      payload: { tabId: NaN },
      source: 'panel',
    });
    assert(r4 && r4.reason === 'missing-tabId', 'NaN tabId rejected');
  }

  section('tab-routed families forward verbatim to chrome.tabs.sendMessage');
  {
    global.chrome._state.sends.length = 0;
    global.chrome._state.lastError = null;

    const r = await callHandler(handler, {
      id: 'f1',
      family: 'extract-article',
      payload: { tabId: 42, selectorHint: 'article' },
      source: 'panel',
    });

    assert(global.chrome._state.sends.length === 1, 'exactly one sendMessage call');
    assert(
      global.chrome._state.sends[0].tabId === 42,
      'routed to the tabId supplied in payload'
    );
    assert(
      global.chrome._state.sends[0].message.id === 'f1',
      'envelope forwarded verbatim (same id)'
    );
    assert(
      global.chrome._state.sends[0].message.family === 'extract-article',
      'envelope forwarded verbatim (same family)'
    );
    assert(
      r && r.ok === true && r.result && r.result.echoed === 'extract-article',
      'content reply wrapped as ok=true result'
    );
    assert(r && r.source === 'content', 'response marks source=content');
    assert(r && r.requestId === 'f1', 'response echoes requestId back to panel');
  }

  section('missing content script surfaces as graceful no-content-script error');
  {
    global.chrome._state.lastError = 'Receiving end does not exist.';
    const r = await callHandler(handler, {
      id: 'm1',
      family: 'scan-elements',
      payload: { tabId: 99 },
      source: 'panel',
    });
    global.chrome._state.lastError = null;

    assert(
      r && r.ok === false && r.error === 'no-content-script',
      'missing content script yields error=no-content-script'
    );
    assert(
      r && typeof r.reason === 'string' && r.reason.indexOf('Receiving end') >= 0,
      'reason surfaces chrome.runtime.lastError.message verbatim'
    );
    assert(r && r.requestId === 'm1', 'error response still echoes requestId');
  }

  console.log('\n----------------------------------------');
  console.log('Summary: ' + pass + ' passed, ' + fail + ' failed.');
  if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch(function (err) {
  console.error('harness error:', err);
  process.exit(2);
});
