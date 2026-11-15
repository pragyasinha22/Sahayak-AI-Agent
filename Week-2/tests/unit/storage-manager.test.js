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
  const runtime = { lastError: undefined };
  let nextGetError = null;
  let nextSetError = null;
  let holdNextSet = false;
  let heldSetCallback = null;
  let heldSetStarted = null;
  const mock = {
    _state: state,
    _getCalls: 0,
    _setCalls: 0,
    storage: {
      local: {
        get(keys, cb) {
          mock._getCalls += 1;
          const out = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) {
            if (Object.prototype.hasOwnProperty.call(state, k)) {
              out[k] = JSON.parse(JSON.stringify(state[k]));
            }
          }
          const error = nextGetError;
          nextGetError = null;
          queueMicrotask(() => {
            runtime.lastError = error ? { message: error } : undefined;
            try {
              cb(out);
            } finally {
              runtime.lastError = undefined;
            }
          });
        },
        set(obj, cb) {
          mock._setCalls += 1;
          const error = nextSetError;
          nextSetError = null;
          const complete = () => {
            if (!error) Object.assign(state, JSON.parse(JSON.stringify(obj)));
            runtime.lastError = error ? { message: error } : undefined;
            try {
              if (cb) cb();
            } finally {
              runtime.lastError = undefined;
            }
          };
          if (holdNextSet) {
            holdNextSet = false;
            heldSetCallback = complete;
            heldSetStarted.resolve();
          } else {
            queueMicrotask(complete);
          }
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
    runtime,
    failNextGet(message) { nextGetError = message; },
    failNextSet(message) { nextSetError = message; },
    holdNextStorageSet() {
      holdNextSet = true;
      let resolve;
      const started = new Promise((done) => { resolve = done; });
      heldSetStarted = { promise: started, resolve: resolve };
      return started;
    },
    releaseHeldStorageSet() {
      if (!heldSetCallback) throw new Error('No held storage write.');
      const complete = heldSetCallback;
      heldSetCallback = null;
      heldSetStarted = null;
      complete();
    },
  };
  return mock;
}

function makeLockManager() {
  const queue = [];
  let held = false;
  let activeCallbacks = 0;
  const manager = {
    requests: [],
    maxActiveCallbacks: 0,
    request(name, options, callback) {
      this.requests.push({ name: name, options: options });
      return new Promise((resolve, reject) => {
        queue.push({ callback: callback, resolve: resolve, reject: reject });
        runNext();
      });
    },
  };

  function runNext() {
    if (held || queue.length === 0) return;
    held = true;
    activeCallbacks += 1;
    manager.maxActiveCallbacks = Math.max(
      manager.maxActiveCallbacks,
      activeCallbacks
    );
    const request = queue.shift();
    Promise.resolve()
      .then(request.callback)
      .then(request.resolve, request.reject)
      .then(() => {
        activeCallbacks -= 1;
        held = false;
        runNext();
      });
  }

  return manager;
}

function setLockManager(locks) {
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: locks ? { locks: locks } : {},
  });
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
setLockManager(makeLockManager());

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
    assert(
      M.NAMESPACED.GROQ_KEY === 'settings.apiKeys.groq' &&
        M.NAMESPACED.GROQ_MODEL === 'settings.providers.groqModel' &&
        M.DEFAULT_GROQ_MODEL === 'openai/gpt-oss-120b',
      'Groq key and model settings use the local namespaced paths and approved default'
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

  await section('Groq settings round-trip independently', async () => {
    await M.storageSet(M.NAMESPACED.GROQ_KEY, 'gsk-test-value');
    await M.storageSet(M.NAMESPACED.GROQ_MODEL, M.DEFAULT_GROQ_MODEL);
    assert(
      await M.storageGet(M.NAMESPACED.GROQ_KEY) === 'gsk-test-value',
      'Groq key round-trips through local namespaced storage'
    );
    assert(
      await M.storageGet(M.NAMESPACED.GROQ_MODEL) === 'openai/gpt-oss-120b',
      'Groq model ID round-trips through local namespaced storage'
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

  await section('overlapping Gemini and Groq saves preserve both values', async () => {
    global.chrome = makeChromeMock();
    const locks = makeLockManager();
    setLockManager(locks);

    await Promise.all([
      M.storageSet(M.NAMESPACED.GEMINI_KEY, 'GEMINI_TEST_SENTINEL'),
      M.storageSet(M.NAMESPACED.GROQ_KEY, 'GROQ_TEST_SENTINEL'),
    ]);

    const root = global.chrome._state[M.ROOT_KEY];
    assert(
      M.pathGet(root, M.NAMESPACED.GEMINI_KEY) === 'GEMINI_TEST_SENTINEL' &&
        M.pathGet(root, M.NAMESPACED.GROQ_KEY) === 'GROQ_TEST_SENTINEL',
      'both independently saved keys survive overlapping writes'
    );
    assert(
      locks.requests.length === 2 &&
        locks.requests.every((request) =>
          request.name === 'sahayak-storage-root-write' &&
          request.options.mode === 'exclusive'
        ),
      'both operations request the same exclusive root lock'
    );
  });

  await section('save and removal preserve unrelated values', async () => {
    global.chrome = makeChromeMock();
    setLockManager(makeLockManager());
    await M.storageSet(M.NAMESPACED.GROQ_KEY, 'GROQ_TEST_SENTINEL');
    await M.storageSet('settings.preferences.language', 'hinglish');

    await Promise.all([
      M.storageSet(M.NAMESPACED.GEMINI_KEY, 'GEMINI_TEST_SENTINEL'),
      M.storageRemove(M.NAMESPACED.GROQ_KEY),
    ]);

    const root = global.chrome._state[M.ROOT_KEY];
    assert(
      M.pathGet(root, M.NAMESPACED.GEMINI_KEY) === 'GEMINI_TEST_SENTINEL' &&
        M.pathGet(root, M.NAMESPACED.GROQ_KEY) === undefined &&
        M.pathGet(root, 'settings.preferences.language') === 'hinglish',
      'overlapping save and removal affect only their requested paths'
    );
  });

  await section('concurrent updates to unrelated nested paths survive', async () => {
    global.chrome = makeChromeMock();
    setLockManager(makeLockManager());

    await Promise.all([
      M.storageSet(M.NAMESPACED.GEMINI_KEY, 'GEMINI_TEST_SENTINEL'),
      M.storageSet(M.NAMESPACED.GROQ_MODEL, M.DEFAULT_GROQ_MODEL),
      M.storageSet('settings.preferences.language', 'hinglish'),
    ]);

    const root = global.chrome._state[M.ROOT_KEY];
    assert(
      M.pathGet(root, M.NAMESPACED.GEMINI_KEY) === 'GEMINI_TEST_SENTINEL' &&
        M.pathGet(root, M.NAMESPACED.GROQ_MODEL) === M.DEFAULT_GROQ_MODEL &&
        M.pathGet(root, 'settings.preferences.language') === 'hinglish',
      'concurrent nested-path updates all remain present'
    );
  });

  await section('the lock is held until the storage write completes', async () => {
    global.chrome = makeChromeMock();
    const locks = makeLockManager();
    setLockManager(locks);
    const firstWriteStarted = global.chrome.holdNextStorageSet();

    const first = M.storageSet(M.NAMESPACED.GEMINI_KEY, 'GEMINI_TEST_SENTINEL');
    await firstWriteStarted;
    const readsBeforeSecondRequest = global.chrome._getCalls;
    const second = M.storageSet(M.NAMESPACED.GROQ_KEY, 'GROQ_TEST_SENTINEL');

    assert(
      locks.requests.length === 2 &&
        global.chrome._getCalls === readsBeforeSecondRequest &&
        locks.maxActiveCallbacks === 1,
      'the second root read waits while the first storage write is pending'
    );

    global.chrome.releaseHeldStorageSet();
    await Promise.all([first, second]);
    const root = global.chrome._state[M.ROOT_KEY];
    assert(
      locks.maxActiveCallbacks === 1 &&
        M.pathGet(root, M.NAMESPACED.GEMINI_KEY) === 'GEMINI_TEST_SENTINEL' &&
        M.pathGet(root, M.NAMESPACED.GROQ_KEY) === 'GROQ_TEST_SENTINEL',
      'the next operation starts after release and observes the completed write'
    );
  });

  await section('storage errors propagate and release the lock', async () => {
    global.chrome = makeChromeMock();
    const locks = makeLockManager();
    setLockManager(locks);

    global.chrome.failNextGet('storage read failed');
    let readError;
    try {
      await M.storageSet(M.NAMESPACED.GEMINI_KEY, 'GEMINI_TEST_SENTINEL');
    } catch (error) {
      readError = error;
    }
    assert(
      !!readError && readError.message === 'storage read failed',
      'a root-read error rejects the storage operation'
    );

    global.chrome.failNextSet('storage write failed');
    let writeError;
    try {
      await M.storageSet(M.NAMESPACED.GROQ_KEY, 'GROQ_TEST_SENTINEL');
    } catch (error) {
      writeError = error;
    }
    assert(
      !!writeError && writeError.message === 'storage write failed',
      'a root-write error rejects the storage operation'
    );

    await M.storageSet('settings.preferences.language', 'hinglish');
    assert(
      locks.maxActiveCallbacks === 1 &&
        M.pathGet(global.chrome._state[M.ROOT_KEY], 'settings.preferences.language') ===
          'hinglish',
      'a later write succeeds after prior errors release the lock'
    );
  });

  await section('missing Web Locks support rejects without touching storage', async () => {
    global.chrome = makeChromeMock();
    setLockManager(null);

    let setError;
    try {
      await M.storageSet(M.NAMESPACED.GEMINI_KEY, 'GEMINI_TEST_SENTINEL');
    } catch (error) {
      setError = error;
    }
    let removeError;
    try {
      await M.storageRemove(M.NAMESPACED.GROQ_KEY);
    } catch (error) {
      removeError = error;
    }

    assert(
      !!setError &&
        setError.message.indexOf('Web Locks API is unavailable') !== -1 &&
        !!removeError &&
        removeError.message.indexOf('Web Locks API is unavailable') !== -1 &&
        global.chrome._getCalls === 0 &&
        global.chrome._setCalls === 0,
      'set and remove reject explicitly without Web Locks or storage access'
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
