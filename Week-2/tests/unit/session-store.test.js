'use strict';

const assert = require('node:assert/strict');
const SessionStore = require('../../state/session-store.js');

function createMockStorage() {
  var data = {};

  return {
    get: function (key) {
      if (key === null) {
        return Promise.resolve(Object.assign({}, data));
      }

      if (typeof key === 'string') {
        var result = {};
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          result[key] = data[key];
        }
        return Promise.resolve(result);
      }

      return Promise.resolve({});
    },

    set: function (items) {
      Object.assign(data, items);
      return Promise.resolve();
    },

    remove: function (keys) {
      (Array.isArray(keys) ? keys : [keys]).forEach(function (key) {
        delete data[key];
      });
      return Promise.resolve();
    },

    inspect: function () {
      return Object.assign({}, data);
    }
  };
}

async function main() {
  var pass = 0;
  var fail = 0;

  function check(condition, message) {
    try {
      assert.ok(condition, message);
      pass++;
      console.log('  ✓ ' + message);
    } catch (error) {
      fail++;
      console.error('  ✗ ' + message);
      console.error(error.message);
    }
  }

  console.log('# session-store');

  var storage = createMockStorage();
  var store = SessionStore.create(storage);

  await store.addMessage(12, { role: 'user', text: 'Question one' });
  await store.addMessage(12, { role: 'assistant', text: 'Answer one' });

  var messages = await store.getMessages(12);

  check(messages.length === 2, 'stores and retrieves conversation messages');
  check(messages[0].role === 'user' && messages[1].role === 'assistant',
    'preserves message roles and order');

  await store.addMessage(13, { role: 'user', text: 'Other tab' });

  check((await store.getMessages(13)).length === 1 &&
    (await store.getMessages(12)).length === 2,
    'keeps conversations isolated by tab');

  await store.clearTab(12);

  check((await store.getMessages(12)).length === 0 &&
    (await store.getMessages(13)).length === 1,
    'clears one tab without affecting another');

  var limitedStorage = createMockStorage();
  var limitedStore = SessionStore.create(limitedStorage, {
    maxMessages: 2,
    maxMessageChars: 5,
    maxTotalChars: 8
  });

  await limitedStore.addMessage(20, { role: 'user', text: 'First' });
  await limitedStore.addMessage(20, { role: 'assistant', text: 'Second' });
  await limitedStore.addMessage(20, { role: 'user', text: 'Third' });

  var limited = await limitedStore.getMessages(20);

  check(limited.length <= 2, 'caps the number of stored messages');
  check(limited.every(function (message) {
    return message.text.length <= 5;
  }), 'caps individual message size');
  check(limited.reduce(function (sum, message) {
    return sum + message.text.length;
  }, 0) <= 8, 'caps total stored message text size');

  await limitedStore.clearAll();

  check(Object.keys(limitedStorage.inspect()).length === 0,
    'clearAll removes session history keys');

  var rejected = false;
  try {
    await store.addMessage(12, { role: 'system', text: 'Invalid' });
  } catch (error) {
    rejected = true;
  }

  check(rejected, 'rejects invalid message roles');

  rejected = false;
  try {
    await store.getMessages(-1);
  } catch (error) {
    rejected = true;
  }

  check(rejected, 'rejects invalid tab IDs');
  // --------------------------------------------
  var concurrentStorage = createMockStorage();
  var concurrentStore = SessionStore.create(concurrentStorage);

  await Promise.all([
    concurrentStore.addMessage(30, { role: 'user', text: 'Message 1' }),
    concurrentStore.addMessage(30, { role: 'assistant', text: 'Message 2' }),
    concurrentStore.addMessage(30, { role: 'user', text: 'Message 3' }),
    concurrentStore.addMessage(30, { role: 'assistant', text: 'Message 4' })
  ]);

  var concurrentMessages = await concurrentStore.getMessages(30);

  check(
    concurrentMessages.length === 4,
    'does not lose messages during concurrent writes'
  );
    // clearTab must wait for pending writes to the same tab.
  var raceStorage = createMockStorage();
  var raceStore = SessionStore.create(raceStorage);

  await Promise.all([
    raceStore.addMessage(40, {
      role: 'user',
      text: 'This message must be cleared'
    }),
    raceStore.clearTab(40)
  ]);

  check(
    (await raceStore.getMessages(40)).length === 0,
    'clearTab does not allow a pending write to restore deleted history'
  );

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});