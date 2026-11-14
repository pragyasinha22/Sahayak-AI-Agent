/**
 * Sahayak — Selected-text Explain unit tests (Slice 1.3.1)
 * -----------------------------------------------------------------------------
 * Node-only. Exercises the plan's Slice 1.3.1 Unit-tests bullet list verbatim:
 *
 *   1. "selection length clamp"                 -> content/selection.js clamp
 *   2. "prompt template contains no page HTML"  -> buildExplainPrompt
 *   3. "error path when key missing shows understandable message"
 *                                                -> explainSelection (EC-W1-07)
 *
 * plus the key-confinement invariant (GDR-3 / INV-2: the key is only ever the
 * request header, never in the body/prompt/result — EC-SEC-01) and the provider
 * error mapping reused from Week 1 (EC-W1-08 auth, EC-W1-10 network). No real
 * network: fetch is injected. No Chrome globals are required.
 *
 * Run with:   node tests/unit/selection-explain.test.js
 * Exit code:  0 on pass, 1 on any failure, 2 on harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

const Selection = require('../../content/selection.js');
const Explain = require('../../panel/features/explain.js');

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

// Build a fake fetch Response-like object for explainSelection.
function makeResp(init) {
  const o = init || {};
  return {
    ok: o.ok === undefined ? (o.status >= 200 && o.status < 300) : o.ok,
    status: typeof o.status === 'number' ? o.status : 200,
    json: () => Promise.resolve(o.body),
  };
}

async function main() {
  // ==========================================================================
  // 1. Selection length clamp (plan Unit-tests bullet 1 / EC-W1-11).
  // ==========================================================================
  section('clampSelection — bounded size');
  {
    const MAX = Selection.MAX_SELECTION_CHARS;
    assert(typeof MAX === 'number' && MAX > 0, 'MAX_SELECTION_CHARS exported and positive');

    const short = Selection.clampSelection('  Hello world  ', MAX);
    assert(short.text === 'Hello world' && !short.truncated && !short.empty,
      'short selection trimmed, not truncated');

    const blank = Selection.clampSelection('   \n\t  ', MAX);
    assert(blank.empty === true && blank.text === '', 'whitespace-only treated as empty (EC empty)');

    const nonString = Selection.clampSelection(undefined, MAX);
    assert(nonString.empty === true && nonString.text === '', 'non-string treated as empty');

    const big = 'x'.repeat(MAX + 500);
    const clamped = Selection.clampSelection(big, MAX);
    assert(clamped.text.length === MAX && clamped.truncated === true && clamped.empty === false,
      'oversized selection truncated to the bound and flagged (EC-W1-11)');

    const exact = 'y'.repeat(MAX);
    const edge = Selection.clampSelection(exact, MAX);
    assert(edge.text.length === MAX && edge.truncated === false,
      'exactly-at-bound selection kept whole, not flagged truncated');
  }

  // ==========================================================================
  // 2. Prompt template contains no page HTML (plan Unit-tests bullet 2).
  // ==========================================================================
  section('buildExplainPrompt — plain-text only');
  {
    const sample = 'Quantum entanglement links two particles across distance.';
    const prompt = Explain.buildExplainPrompt(sample);
    assert(typeof prompt === 'string' && prompt.length > 0, 'returns a non-empty prompt string');
    assert(prompt.indexOf(sample) !== -1, 'prompt embeds the selected plain text');
    assert(/SELECTED TEXT/.test(prompt), 'prompt labels the selection');
    assert(prompt.indexOf('<') === -1 && prompt.indexOf('>') === -1,
      'prompt contains no HTML tags / markup');
    assert(Explain.buildExplainPrompt(null) !== undefined, 'null selection yields a prompt without throwing');

    // A crafted selection that itself contains angle brackets must not be
    // interpreted as markup — the template adds none of its own, and there is
    // no HTML wrapper anywhere.
    const withTags = Explain.buildExplainPrompt('literal <div> in text');
    assert(withTags.indexOf('<div>') !== -1 && withTags.split('<div>').length - 1 === 1,
      'user text kept verbatim; template introduces no extra markup');
  }

  // ==========================================================================
  // 3. parseGeminiResponse shape handling.
  // ==========================================================================
  section('parseGeminiResponse — defensive extraction');
  {
    const data = { candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there' }] } }] };
    assert(Explain.parseGeminiResponse(data) === 'Hello there', 'joins multi-part text');
    assert(Explain.parseGeminiResponse({}) === '', 'empty object -> empty string');
    assert(Explain.parseGeminiResponse({ candidates: [] }) === '', 'no candidates -> empty');
    assert(Explain.parseGeminiResponse(null) === '', 'null -> empty');
  }

  // ==========================================================================
  // 4. Missing key -> understandable message, NO fetch (EC-W1-07 / bullet 3).
  // ==========================================================================
  section('explainSelection — missing key');
  {
    let fetchCalled = false;
    const res = await Explain.explainSelection({
      key: '',
      prompt: Explain.buildExplainPrompt('abc'),
      fetchImpl: () => { fetchCalled = true; throw new Error('fetch must not be called'); },
    });
    assert(fetchCalled === false, 'missing key never triggers a network call');
    assert(res.ok === false && res.error === 'missing-key', 'resolves {ok:false, error:missing-key}');
    assert(typeof res.message === 'string' && res.message.length > 10, 'shows an understandable message');
    assert(res.message === Explain.MISSING_KEY_MESSAGE, 'message matches exported constant');
  }

  // ==========================================================================
  // 5. Key confinement: header only, never body/prompt/result (INV-2/GDR-3).
  // ==========================================================================
  section('explainSelection — key confinement');
  {
    const KEY = 'AIzaFAKEfakeFAKEfakeFAKEfake1234567890';
    let captured = null;
    const res = await Explain.explainSelection({
      key: KEY,
      prompt: Explain.buildExplainPrompt('Explain gravity.'),
      fetchImpl: (url, init) => {
        captured = { url, init };
        return Promise.resolve(makeResp({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } }));
      },
    });
    assert(captured && captured.init.headers['x-goog-api-key'] === KEY, 'key sent only as request header');
    assert(captured.init.body.indexOf(KEY) === -1, 'key NOT present in request body');
    assert(captured.url.indexOf(KEY) === -1, 'key NOT present in request URL');
    assert(res.ok === true && res.text === 'OK', 'success path returns provider text');
    assert(JSON.stringify(res).indexOf(KEY) === -1, 'key never appears in the returned result');
  }

  // ==========================================================================
  // 6. Provider error mapping (EC-W1-08 auth, EC-W1-10 network).
  // ==========================================================================
  section('explainSelection — provider error mapping');
  {
    const auth = await Explain.explainSelection({
      key: 'AIzaX', prompt: 'p',
      fetchImpl: () => Promise.resolve(makeResp({ status: 401 })),
    });
    assert(auth.ok === false && auth.error === 'auth' && auth.message === Explain.AUTH_MESSAGE,
      'HTTP 401 -> auth error with Settings message (EC-W1-08)');

    const rate = await Explain.explainSelection({
      key: 'AIzaX', prompt: 'p',
      fetchImpl: () => Promise.resolve(makeResp({ status: 429 })),
    });
    assert(rate.ok === false && rate.error === 'rate-limit', 'HTTP 429 -> rate-limit error');
    // ---------------------------------------------
        // Retry behaviour: transient server errors only.
    {
      let attempts = 0;

      const recovered = await Explain.explainSelection({
        key: 'AIzaX',
        prompt: 'p',
        fetchImpl: () => {
          attempts++;
          if (attempts < 2) {
            return Promise.resolve(makeResp({ status: 503 }));
          }
          return Promise.resolve(makeResp({
            status: 200,
            body: {
              candidates: [{
                content: { parts: [{ text: 'Recovered response' }] }
              }]
            }
          }));
        },
      });

      assert(
        recovered.ok === true &&
        recovered.text === 'Recovered response' &&
        attempts === 2,
        'HTTP 503 retries and succeeds on the second attempt'
      );
    }

    {
      let attempts = 0;

      const exhausted = await Explain.explainSelection({
        key: 'AIzaX',
        prompt: 'p',
        fetchImpl: () => {
          attempts++;
          return Promise.resolve(makeResp({
            status: 503,
            body: { error: { message: 'Service Unavailable' } }
          }));
        },
      });

      assert(
        exhausted.ok === false &&
        exhausted.status === 503 &&
        attempts === 3,
        'HTTP 503 stops after three total attempts'
      );
    }

    {
      let attempts = 0;

      const limited = await Explain.explainSelection({
        key: 'AIzaX',
        prompt: 'p',
        fetchImpl: () => {
          attempts++;
          return Promise.resolve(makeResp({ status: 429 }));
        },
      });

      assert(
        limited.ok === false &&
        limited.error === 'rate-limit' &&
        attempts === 1,
        'HTTP 429 is not retried'
      );
    }


    // -------------------------------------------------

    const net = await Explain.explainSelection({
      key: 'AIzaX', prompt: 'p',
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    assert(net.ok === false && net.error === 'network' && net.message === Explain.NETWORK_MESSAGE,
      'rejected fetch -> understandable network message (EC-W1-10)');

    const empty = await Explain.explainSelection({
      key: 'AIzaX', prompt: 'p',
      fetchImpl: () => Promise.resolve(makeResp({ status: 200, body: { candidates: [] } })),
    });
    assert(empty.ok === false && empty.error === 'empty', 'empty candidates -> graceful empty result');
  }

  // ==========================================================================
  // 5. On-demand selection arm (Slice 1.3.1 completeness fix). Explaining on
  //    any page must inject selection.js ONLY after the read gate passes —
  //    the activeTab path that removed the example.com-only limitation.
  // ==========================================================================
  section('armSelectionCapture — gate before injection');
  {
    const makeArmDeps = (opts) => {
      const o = opts || {};
      const calls = [];
      return {
        calls,
        panel: {
          requestActiveTabId: () => Promise.resolve(3),
          requestPageInfo: () => Promise.resolve({ tabId: 3, url: o.url || 'https://news.example/article' }),
          guardRead: () => {
            calls.push('guardRead');
            return Promise.resolve(o.dec || { allowed: true, decision: 'allow' });
          }
        },
        scripting: {
          executeScript: (req) => {
            calls.push('executeScript:' + (req.files || []).join('+'));
            if (o.injectThrows) return Promise.reject(new Error('reserved page'));
            return Promise.resolve([]);
          }
        }
      };
    };

    const states = [];
    const ok = makeArmDeps();
    await Explain.armSelectionCapture({
      panel: ok.panel, scripting: ok.scripting,
      render: (st) => states.push(st)
    });
    assert(ok.calls.join(',') === 'guardRead,executeScript:content/selection.js',
      'arm path runs the read gate BEFORE injecting the content script');
    assert(states[states.length - 1].state === 'armed' &&
      states[states.length - 1].message === Explain.ARM_OK_MESSAGE,
      'allowed page arms capture with clear guidance');
    assert(Explain.SELECTION_ARM_FILES.join(',') === 'content/selection.js',
      'arm injects only the selection listener (no key material, no contract twin)');

    const statesB = [];
    const blocked = makeArmDeps({ dec: { allowed: false, reason: 'sensitive-host' } });
    await Explain.armSelectionCapture({
      panel: blocked.panel, scripting: blocked.scripting,
      render: (st) => statesB.push(st)
    });
    assert(blocked.calls.indexOf('executeScript:content/selection.js') === -1 &&
      statesB[statesB.length - 1].state === 'blocked',
      'blocked page: nothing injected, safety refusal rendered');

    const statesD = [];
    const inj = makeArmDeps({ injectThrows: true });
    await Explain.armSelectionCapture({
      panel: inj.panel, scripting: inj.scripting, render: (st) => statesD.push(st)
    });
    assert(statesD[statesD.length - 1].state === 'disallowed',
      'reserved-page injection rejection degrades to guidance (EC-W1-03)');

    const statesN = [];
    await Explain.armSelectionCapture({ render: (st) => statesN.push(st) });
    assert(statesN[statesN.length - 1].state === 'unavailable',
      'missing collaborators -> unavailable, never a throw');
  }

  // ==========================================================================
  // 6. Slice 1.7.1 language token in the explain prompt template.
  // ==========================================================================
  section('buildExplainPrompt — language token');
  {
    const Preferences = require('../../state/preferences.js');
    global.SahayakPreferences = Preferences; // explain.js resolves it lazily
    const h = Preferences.languageInstruction('hinglish');
    const p = Explain.buildExplainPrompt('gravity', 'hinglish');
    assert(p.indexOf(h) !== -1, 'hinglish token injected into the explain prompt');
    assert(p.indexOf('SELECTED TEXT') !== -1, 'plain-text marker block unchanged');
    assert(Explain.buildExplainPrompt('gravity').indexOf(
      Preferences.languageInstruction('en')) !== -1,
      'omitted language -> safe English default');
  }

    // ==========================================================================
  // 7. Integration — credential selection must stop before all downstream work.
  // ==========================================================================
  section('initUI — credential selection blocked before page checks and Gemini');
  {
    const calls = {
      requestPageInfo: 0,
      guardRead: 0,
      getGeminiKey: 0,
      fetch: 0
    };

    let clickHandler = null;
    let selectionListener = null;

    const button = {
      addEventListener: (event, handler) => {
        if (event === 'click') clickHandler = handler;
      }
    };

    const output = {
      textContent: '',
      className: ''
    };

    const preview = {
      textContent: ''
    };

    const fakeWin = {
      document: {
        readyState: 'complete',
        getElementById: (id) => {
          if (id === 'explain-btn') return button;
          if (id === 'explain-output') return output;
          if (id === 'explain-selection') return preview;
          return null;
        }
      },

      chrome: {
        runtime: {
          onMessage: {
            addListener: (listener) => {
              selectionListener = listener;
            }
          }
        }
      },

      SahayakSafetyClassifiers: require('../../safety/classifiers.js'),

      SahayakPanel: {
        requestActiveTabId: () => {
          calls.requestPageInfo++;
          return Promise.resolve(3);
        },
        requestPageInfo: () => {
          calls.requestPageInfo++;
          return Promise.resolve({
            tabId: 3,
            url: 'https://news.example/article'
          });
        },
        guardRead: () => {
          calls.guardRead++;
          return Promise.resolve({ allowed: true });
        }
      },

      SahayakStorageManager: {},

      SahayakApiKeys: {
        getGeminiKey: () => {
          calls.getGeminiKey++;
          return Promise.resolve('test-key');
        }
      }
    };

    const originalFetch = global.fetch;

    try {
      global.fetch = (...args) => {
        calls.fetch++;
        return Promise.reject(new Error('Unexpected fetch in credential test'));
      };

      Explain.initUI(fakeWin);

      assert(
        typeof selectionListener === 'function',
        'selection message listener registered'
      );

      assert(
        typeof clickHandler === 'function',
        'Explain button click handler registered'
      );

      if (selectionListener && clickHandler) {
        selectionListener(
          {
            type: Explain.SELECTION_MESSAGE_TYPE,
            text: 'My bank account number is 123456789012 and my password is ExamplePassword123.'
          },
          { tab: { id: 3 } }
        );

        clickHandler();

        assert(
          output.textContent.indexOf('Blocked by safety') !== -1,
          'credential selection displays a safety refusal'
        );

        assert(
          output.textContent.indexOf('will not send this selection to Gemini') !== -1,
          'refusal explicitly says selection will not be sent to Gemini'
        );

        assert(
          output.className.indexOf('is-err') !== -1,
          'safety refusal receives error styling'
        );
      }

      assert(
        calls.requestPageInfo === 0,
        'credential selection never requests page information or active tab'
      );

      assert(
        calls.guardRead === 0,
        'credential selection never reaches the page read gate'
      );

      assert(
        calls.getGeminiKey === 0,
        'credential selection never retrieves the Gemini API key'
      );

      assert(
        calls.fetch === 0,
        'credential selection never calls fetch'
      );
    } finally {
      global.fetch = originalFetch;
    }
  }
  
  // ==========================================================================
  // Slice 2.1.3 — Gemini streaming provider
  // ==========================================================================
  section('streamExplainSelection — streaming response');

  {
    const KEY = 'AIzaSTREAMfake1234567890';
    const encoder = new TextEncoder();

    const events = [
      'data: ' + JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Hello ' }] } }]
      }) + '\n\n',
      'data: ' + JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'world!' }] } }]
      }) + '\n\n'
    ];

    const bytes = encoder.encode(events.join(''));
    const chunks = [
      bytes.slice(0, 35),
      bytes.slice(35)
    ];

    let readIndex = 0;
    let requestUrl = '';
    let requestOptions = '';
    const received = [];

    const result = await Explain.streamExplainSelection({
      key: KEY,
      prompt: 'Test streaming prompt',
      fetchImpl: async (url, options) => {
        requestUrl = url;
        requestOptions = options;

        return {
          ok: true,
          status: 200,
          body: {
            getReader: () => ({
              read: async () => {
                if (readIndex >= chunks.length) {
                  return { done: true };
                }

                return {
                  done: false,
                  value: chunks[readIndex++]
                };
              }
            })
          }
        };
      },
      onChunk: (chunk) => received.push(chunk)
    });

    assert(result.ok === true, 'streaming request succeeds');
    assert(result.text === 'Hello world!', 'streamed chunks form the complete response');
    assert(received.join('') === 'Hello world!', 'onChunk receives generated text');
    assert(received.length === 2, 'two SSE events produce two callbacks');
    assert(
      requestUrl.indexOf(':streamGenerateContent?alt=sse') !== -1,
      'uses Gemini SSE streaming endpoint'
    );
    assert(
      requestOptions.headers['x-goog-api-key'] === KEY,
      'API key is sent in request header'
    );
    assert(
      !requestOptions.body.includes(KEY) && !requestUrl.includes(KEY),
      'API key is absent from request body and URL'
    );
    assert(
      requestOptions.body.includes('Test streaming prompt'),
      'request body contains the prompt'
    );
    assert(
      !JSON.stringify(result).includes(KEY),
      'API key never appears in returned result'
    );
  }

  section('streamExplainSelection — error handling');

  {
    let fetchCalls = 0;

    const missingKey = await Explain.streamExplainSelection({
      key: '',
      prompt: 'Test',
      fetchImpl: async () => {
        fetchCalls++;
        return {};
      }
    });

    assert(missingKey.ok === false, 'missing key returns failure');
    assert(missingKey.error === 'missing-key', 'missing key has correct error');
    assert(fetchCalls === 0, 'missing key never triggers a network call');

    const rateLimited = await Explain.streamExplainSelection({
      key: 'fake-key',
      prompt: 'Test',
      fetchImpl: async () => ({
        ok: false,
        status: 429
      })
    });

    assert(rateLimited.ok === false, '429 returns failure');
    assert(rateLimited.error === 'rate-limit', '429 maps to rate-limit');

    const serverError = await Explain.streamExplainSelection({
      key: 'fake-key',
      prompt: 'Test',
      fetchImpl: async () => ({
        ok: false,
        status: 503
      })
    });

    assert(serverError.ok === false, '503 returns failure');
    assert(serverError.error === 'http', '503 maps to HTTP error');
    assert(serverError.status === 503, '503 status is preserved');
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
}

main().catch((err) => {
  console.error('Harness error:', err);
  process.exit(2);
});
