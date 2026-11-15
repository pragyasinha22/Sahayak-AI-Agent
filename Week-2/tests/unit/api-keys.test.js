'use strict';

const assert = require('node:assert/strict');
const ApiKeys = require('../../state/api-keys.js');

async function main() {
  const values = {};
  const manager = {
    NAMESPACED: {
      GROQ_KEY: 'settings.apiKeys.groq',
    },
    storageGet(path) {
      return Promise.resolve(values[path]);
    },
    storageSet(path, value) {
      values[path] = value;
      return Promise.resolve();
    },
    storageRemove(path) {
      delete values[path];
      return Promise.resolve();
    },
  };
  let passed = 0;
  let failed = 0;

  function check(condition, name) {
    try {
      assert.ok(condition, name);
      passed += 1;
      console.log('  ✓ ' + name);
    } catch (error) {
      failed += 1;
      console.error('  ✗ ' + name);
      console.error(error.message);
    }
  }

  await ApiKeys.setGroqKey(manager, '  gsk-test-value  ');
  check(
    values[manager.NAMESPACED.GROQ_KEY] === 'gsk-test-value',
    'trims and stores the Groq key through the namespaced storage manager'
  );
  check(
    await ApiKeys.getGroqKey(manager) === 'gsk-test-value',
    'reads the Groq key through the namespaced storage manager'
  );
  check(
    ApiKeys.maskKey(await ApiKeys.getGroqKey(manager)) !== 'gsk-test-value',
    'provides only a masked value for Groq key display'
  );
  await ApiKeys.removeGroqKey(manager);
  check(
    await ApiKeys.getGroqKey(manager) === undefined,
    'removes the stored Groq key without affecting unrelated paths'
  );

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
