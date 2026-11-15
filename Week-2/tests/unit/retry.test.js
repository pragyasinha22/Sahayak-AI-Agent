'use strict';

const assert = require('node:assert/strict');
const Retry = require('../../providers/retry.js');

let passed = 0;
let failed = 0;

function check(condition, message) {
  try {
    assert.ok(condition, message);
    passed += 1;
    console.log('  ✓ ' + message);
  } catch (error) {
    failed += 1;
    console.error('  ✗ ' + message);
    console.error(error.message);
  }
}

async function main() {
  console.log('# bounded retry policy');
  check(Retry.MAX_ATTEMPTS === 3,
    'documents a ceiling of three total attempts, including the initial request');

  const waits = [];
  let attempts = 0;
  const recovered = await Retry.retry(() => {
    attempts += 1;
    return Promise.resolve(attempts < 3
      ? { ok: false, error: 'rate-limit', message: 'Gemini is rate-limited.' }
      : { ok: true, text: 'Recovered' });
  }, {
    sleep: (milliseconds) => { waits.push(milliseconds); return Promise.resolve(); },
    random: () => 0,
  });
  check(recovered.ok && attempts === 3,
    'retries a rate-limited operation and succeeds within the ceiling');
  check(waits.join(',') === '500,1000',
    'uses deterministic equal-jitter delays for the first two retries');

  const upperBounds = [];
  attempts = 0;
  await Retry.retry(() => {
    attempts += 1;
    return Promise.resolve(attempts < 3
      ? { ok: false, error: 'rate-limit', message: 'Rate limited.' }
      : { ok: true });
  }, {
    sleep: (milliseconds) => { upperBounds.push(milliseconds); return Promise.resolve(); },
    random: () => 0.999999,
  });
  check(upperBounds[0] >= 500 && upperBounds[0] <= 1000 &&
      upperBounds[1] >= 1000 && upperBounds[1] <= 2000,
    'keeps jitter within the documented 500–1000 ms and 1000–2000 ms ranges');

  console.log('\n# exhausted and non-retryable failures');
  attempts = 0;
  const exhaustedWaits = [];
  let exhausted;
  try {
    await Retry.retry(() => {
      attempts += 1;
      return Promise.resolve({
        ok: false,
        error: 'rate-limit',
        message: 'Gemini is rate-limited.'
      });
    }, {
      sleep: (milliseconds) => {
        exhaustedWaits.push(milliseconds);
        return Promise.resolve();
      },
      random: () => 0.5,
    });
  } catch (error) {
    exhausted = error;
  }
  check(exhausted instanceof Retry.UnavailableError &&
      exhausted.code === 'unavailable' &&
      exhausted.message === 'Gemini is rate-limited.',
    'maps exhausted retries to an understandable UnavailableError');
  check(attempts === Retry.MAX_ATTEMPTS && exhaustedWaits.length === 2,
    'stops after the configured maximum and never loops indefinitely');

  attempts = 0;
  const unauthorized = await Retry.retry(() => {
    attempts += 1;
    return Promise.resolve({ ok: false, error: 'auth', status: 401 });
  }, {
    sleep: () => { throw new Error('non-retryable error must not sleep'); },
  });
  check(unauthorized.error === 'auth' && attempts === 1,
    'does not retry non-retryable authentication responses');

  attempts = 0;
  const badRequest = await Retry.retry(() => {
    attempts += 1;
    return Promise.resolve({ ok: false, error: 'http', status: 400 });
  });
  check(badRequest.status === 400 && attempts === 1,
    'does not retry other non-retryable client errors');

  attempts = 0;
  const network = await Retry.retry(() => {
    attempts += 1;
    return Promise.resolve(attempts === 1
      ? { ok: false, error: 'network', message: 'Network unavailable.' }
      : { ok: true, text: 'Online' });
  }, {
    sleep: () => Promise.resolve(),
    random: () => 0,
  });
  check(network.ok && attempts === 2,
    'retries a transient network failure once before success');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
