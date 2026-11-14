/**
 * Sahayak — Session conversation store (Slice 2.1.2).
 *
 * Stores conversation history in chrome.storage.session only.
 * Each tab gets an independent storage key.
 */
'use strict';

(function (global) {
  var KEY_PREFIX = 'chatHistory:';
  var DEFAULT_MAX_MESSAGES = 30;
  var DEFAULT_MAX_MESSAGE_CHARS = 8000;
  var DEFAULT_MAX_TOTAL_CHARS = 40000;

  function create(storageArea, options) {
    var opts = options || {};

    var maxMessages = opts.maxMessages || DEFAULT_MAX_MESSAGES;
    var maxMessageChars =
      opts.maxMessageChars || DEFAULT_MAX_MESSAGE_CHARS;
    var maxTotalChars =
      opts.maxTotalChars || DEFAULT_MAX_TOTAL_CHARS;
    // ----------------------------------------------------
    var writeQueues = Object.create(null);

    function enqueueForKey(key, task) {
      var previous = writeQueues[key] || Promise.resolve();
      var operation = previous.then(task);
      var settled = operation.then(
        function () {},
        function () {}
      );

      writeQueues[key] = settled;

      settled.then(function () {
        if (writeQueues[key] === settled) {
          delete writeQueues[key];
        }
      });

      return operation;
    }  

    if (
      !storageArea ||
      typeof storageArea.get !== 'function' ||
      typeof storageArea.set !== 'function' ||
      typeof storageArea.remove !== 'function'
    ) {
      throw new Error('A valid chrome.storage.session area is required.');
    }

    function getKey(tabId) {
      if (!Number.isInteger(tabId) || tabId < 0) {
        throw new Error('A valid tab ID is required.');
      }

      return KEY_PREFIX + tabId;
    }

    function sanitizeMessages(value) {
      if (!Array.isArray(value)) return [];

      return value
        .filter(function (message) {
          return message &&
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.text === 'string';
        })
        .map(function (message) {
          return {
            role: message.role,
            text: message.text.slice(0, maxMessageChars),
            timestamp: Number.isFinite(message.timestamp)
              ? message.timestamp
              : 0
          };
        })
        .slice(-maxMessages);
    }

    function limitMessages(messages) {
      var result = [];
      var totalChars = 0;

      for (var i = messages.length - 1; i >= 0; i -= 1) {
        var message = messages[i];

        if (totalChars + message.text.length > maxTotalChars) {
          continue;
        }

        result.unshift(message);
        totalChars += message.text.length;
      }

      return result.slice(-maxMessages);
    }

    function getMessages(tabId) {
      var key = getKey(tabId);

      return storageArea.get(key).then(function (result) {
        return sanitizeMessages(result && result[key]);
      });
    }

    function addMessage(tabId, message) {
      var key = getKey(tabId);

      if (
        !message ||
        (message.role !== 'user' && message.role !== 'assistant') ||
        typeof message.text !== 'string' ||
        !message.text.trim()
      ) {
        return Promise.reject(new Error('Invalid chat message.'));
      }

      var newMessage = {
        role: message.role,
        text: message.text.trim().slice(0, maxMessageChars),
        timestamp: Number.isFinite(message.timestamp)
          ? message.timestamp
          : Date.now()
      };

      return enqueueForKey(key, function () {
        return getMessages(tabId).then(function (messages) {
          messages.push(newMessage);

          var limited = limitMessages(messages);
          var data = {};
          data[key] = limited;

          return storageArea.set(data).then(function () {
            return limited;
          });
        });
      });
    }

    function clearTab(tabId) {
      var key = getKey(tabId);
      return enqueueForKey(key, function () {
        return storageArea.remove(key);
      });
    }

    function clearAll() {
      return storageArea.get(null).then(function (items) {
        var keys = Object.keys(items || {}).filter(function (key) {
          return key.indexOf(KEY_PREFIX) === 0;
        });

        if (keys.length === 0) return Promise.resolve();

        return storageArea.remove(keys);
      });
    }

    return {
      getMessages: getMessages,
      addMessage: addMessage,
      clearTab: clearTab,
      clearAll: clearAll
    };
  }

  var api = {
    KEY_PREFIX: KEY_PREFIX,
    DEFAULT_MAX_MESSAGES: DEFAULT_MAX_MESSAGES,
    DEFAULT_MAX_MESSAGE_CHARS: DEFAULT_MAX_MESSAGE_CHARS,
    DEFAULT_MAX_TOTAL_CHARS: DEFAULT_MAX_TOTAL_CHARS,
    create: create
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSessionStore = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);