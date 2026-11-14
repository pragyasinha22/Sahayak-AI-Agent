/**
 * Sahayak — storage-manager unit tests (Slice 1.1.3).
 * -----------------------------------------------------------------------------
 * Required by docs/implementation-plan.md Slice 1.1.3 "Unit tests":
 *   "storage-manager — set/get, missing-key path, namespacing."
 *
 * Runs in plain Node with no build step and no network:
 *     node tests/unit/storage-manager.test.js
 *
 * It installs a minimal mock of chrome.storage.local + chrome.runtime so
 * state/storage-manager.js can be required unmodified. No backend, no npm
 * packages (see docs/implementation-plan.md GDR-2).
 * -----------------------------------------------------------------------------
 */

'use strict';

// -----------------------------------------------------------------------------
// Minimal chrome.* mock: object semantics match Chrome's merge-on-set rule.
// -----------------------------------------------------------------------------
function makeChromeMock(initial) {
  const state = Object.assign({}, initial || {});
  return {
    _state: state,
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) if (Object.prototype.hasOwnProperty.call(state, k)) out[k] = state[k];
          queueMicrotask(() => cb(out));
        },
        set(obj, cb) {
          Object.assign(state, obj);
          queueMicrotask(() => cb && cb());
        },
        remove(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete state[k];
          queueMicrotask(() => cb && cb());
        },
        clear(cb) {
          for (const k of Object.keys(state)) delete state[k];
          queueMicrotask(() => cb && cb());
        },
      },
    },
    runtime: { lastError: undefined },
  };
}

// -----------------------------------------------------------------------------
// Tiny assertion helpers (self-contained, no external packages).
// -----------------------------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    pass += 1;
    console.log('  \u2713 ' + msg);
  } else {
    fail += 1;
    failures.push(msg);
    console.log('  \u2717 ' + msg);
  }
}

function assertEqual(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    assert(false, msg + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
  } else {
    assert(true, msg);
  }
}

function section(title, fn) {
  console.log('\n# ' + title);
  return Promise.resolve()
    .then(fn)
    .catch((err) => {
      fail += 1;
      failures.push(title + ' threw: ' + (err && err.stack ? err.stack : err));
      console.log('  \u2717 unexpected throw: ' + err);
    });
}

// -----------------------------------------------------------------------------
// Load module under test AFTER the mock is installed.
// -----------------------------------------------------------------------------
global.chrome = makeChromeMock();
const M = require('../../state/storage-manager.js');

// -----------------------------------------------------------------------------
// Tests.
// -----------------------------------------------------------------------------
async function run() {
  await section('constants + namespaced paths', () => {
    assert(M.ROOT_KEY === 'sahayak', 'root key is "sahayak" (namespacing)');
    assert(
      M.NAMESPACED && M.NAMESPACED.GEMINI_KEY === 'settings.apiKeys.gemini',
      'NAMESPACED.GEMINI_KEY uses the settings.apiKeys.gemini path'
    );
  });

  await section('storageGet: missing-key path', async () => {
    const v = await M.storageGet('settings.apiKeys.gemini');
    assert(v === undefined, 'missing key returns undefined');
    const root = await M.storageGet();
    assertEqual(root, {}, 'reading the whole namespace on a fresh install returns {}');
  });

  await section('storageSet + storageGet round-trip', async () => {
    const secret = 'AIza-TEST-VALUE-abc';
    await M.storageSet('settings.apiKeys.gemini', secret);
    const got = await M.storageGet('settings.apiKeys.gemini');
    assert(got === secret, 'round-trip returns the same value');
    assert(
      Object.prototype.hasOwnProperty.call(global.chrome._state, 'sahayak'),
      'the raw blob is stored under a single root key (never a bare apiKey top-level)'
    );
    assert(
      !Object.prototype.hasOwnProperty.call(global.chrome._state, 'apiKey'),
      'no accidental top-level "apiKey" entry (namespacing enforced)'
    );
  });

  await section('namespacing preserves sibling keys', async () => {
    await M.storageSet('settings.preferences.language', 'hinglish');
    const blob = global.chrome._state['sahayak'];
    assert(
      blob.settings && blob.settings.apiKeys && blob.settings.apiKeys.gemini === 'AIza-TEST-VALUE-abc',
      'Gemini key still present after writing a sibling path'
    );
    assert(
      blob.settings && blob.settings.preferences && blob.settings.preferences.language === 'hinglish',
      'new sibling path written correctly'
    );
  });

  await section('storageRemove deletes only the target leaf', async () => {
    await M.storageRemove('settings.apiKeys.gemini');
    const root = await M.storageGet();
    assert(
      !root.settings || !root.settings.apiKeys || root.settings.apiKeys.gemini === undefined,
      'Gemini key removed'
    );
    assert(
      root.settings && root.settings.preferences && root.settings.preferences.language === 'hinglish',
      'sibling preference still intact after remove'
    );
  });

  await section('pathGet / pathSet / pathRemove (pure helpers)', () => {
    const obj = {};
    M.pathSet(obj, 'a.b.c', 1);
    assert(M.pathGet(obj, 'a.b.c') === 1, 'pathSet + pathGet round-trip');
    assert(M.pathGet(obj, 'a.b.z') === undefined, 'pathGet missing leaf returns undefined');
    assert(M.pathGet(obj, 'x.y.z') === undefined, 'pathGet missing branch returns undefined');
    M.pathRemove(obj, 'a.b.c');
    assert(M.pathGet(obj, 'a.b.c') === undefined, 'pathRemove deletes the leaf');
    assert(M.pathGet(obj, 'a.b') !== undefined, 'parent objects remain after leaf removal');
  });

  console.log('\n----------------------------------------');
  console.log('Summary: ' + pass + ' passed, ' + fail + ' failed.');
  if (fail > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(2);
});
