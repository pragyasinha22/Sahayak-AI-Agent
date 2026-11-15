'use strict';

const assert = require('node:assert/strict');
const Tiering = require('../../providers/tiering.js');

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

function expectTier(task, expectedTier, expectedModel, message) {
  const result = Tiering.selectTier(task);
  check(result.ok && result.tier === expectedTier && result.model === expectedModel, message);
}

async function main() {
  console.log('# model-tier decision policy');
  expectTier(
    { prompt: 'Explain this paragraph.' },
    Tiering.LIGHTWEIGHT_TIER,
    'gemini-3.5-flash-lite',
    'defaults ordinary tasks to the lightweight model'
  );
  expectTier(
    { complex: true },
    Tiering.ESCALATED_TIER,
    'gemini-3.8-flash',
    'escalates explicitly marked complex tasks'
  );
  expectTier(
    { requiresStructuredJson: true, structuredJsonValidationFailed: true },
    Tiering.ESCALATED_TIER,
    'gemini-3.8-flash',
    'escalates after a prior validation failure for a structured-JSON task'
  );
  expectTier(
    { structuredJsonValidationFailed: true },
    Tiering.LIGHTWEIGHT_TIER,
    'gemini-3.5-flash-lite',
    'does not infer a structured-JSON requirement from a failure flag alone'
  );
  expectTier(
    { requiresStructuredJson: true },
    Tiering.LIGHTWEIGHT_TIER,
    'gemini-3.5-flash-lite',
    'does not escalate a structured-JSON task before validation has failed'
  );

  console.log('\n# explicit tier override');
  expectTier(
    { complex: true, tierOverride: 'lightweight' },
    Tiering.LIGHTWEIGHT_TIER,
    'gemini-3.5-flash-lite',
    'lets an explicit lightweight override take precedence over escalation signals'
  );
  expectTier(
    { tierOverride: 'escalated' },
    Tiering.ESCALATED_TIER,
    'gemini-3.8-flash',
    'lets an explicit escalated override select the stronger model'
  );
  for (const tierOverride of ['unknown', 'gemini-3.8-flash', null, '']) {
    const result = Tiering.selectTier({ tierOverride });
    check(
      !result.ok && result.error === 'invalid-tier' &&
        result.message === Tiering.INVALID_TIER_MESSAGE,
      'rejects unsupported tier override ' + JSON.stringify(tierOverride)
    );
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
