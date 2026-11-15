'use strict';

const assert = require('node:assert/strict');
const Settings = require('../../panel/settings/settings.js');
const ApiKeys = require('../../state/api-keys.js');

async function main() {
  let passed = 0;
  function check(condition, message) {
    assert.ok(condition, message);
    passed += 1;
    console.log('  ✓ ' + message);
  }

  const values = {
    'settings.apiKeys.groq': 'groq-secret-value',
  };
  const storageManager = {
    NAMESPACED: {
      GEMINI_KEY: 'settings.apiKeys.gemini',
      GROQ_KEY: 'settings.apiKeys.groq',
      GROQ_MODEL: 'settings.providers.groqModel',
    },
    DEFAULT_GROQ_MODEL: 'openai/gpt-oss-120b',
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
  const elements = new Map();
  function makeElement() {
    return {
      dataset: {},
      listeners: {},
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      },
      appendChild() {},
      click() {
        if (this.listeners.click) this.listeners.click();
      },
    };
  }
  const root = {
    ownerDocument: { createElement: makeElement },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, makeElement());
      return elements.get(selector);
    },
  };
  const preferences = {
    TRANSLATION_TARGET_LANGUAGES: [],
    getTranslationTargetLanguage() { return Promise.resolve(''); },
    setTranslationTargetLanguage(_manager, value) { return Promise.resolve(value); },
  };

  await Settings.init(root, { storageManager, apiKeys: ApiKeys, preferences });
  const groqInput = root.querySelector('#groq-key-input');
  const groqStatus = root.querySelector('#groq-settings-status');
  const modelInput = root.querySelector('#groq-model-input');
  check(groqInput.value === ApiKeys.maskKey('groq-secret-value'),
    'hydrates the saved key in masked form');
  check(groqInput.dataset.hasValue === '1',
    'marks the masked key as configured');
  check(modelInput.value === 'openai/gpt-oss-120b',
    'hydrates the documented default Groq model');
  check(!groqStatus.textContent.includes('groq-secret-value'),
    'does not expose the saved key in status text');

  groqInput.value = '  replacement-groq-key  ';
  root.querySelector('#groq-save').click();
  await new Promise(setImmediate);
  check(values['settings.apiKeys.groq'] === 'replacement-groq-key',
    'trims and stores a replacement key locally');
  check(groqInput.value === ApiKeys.maskKey('replacement-groq-key'),
    're-masks the key after saving');
  check(!groqStatus.textContent.includes('replacement-groq-key'),
    'does not expose the saved key in status text');

  modelInput.value = 'openai/gpt-oss-120b-custom';
  root.querySelector('#groq-model-save').click();
  await new Promise(setImmediate);
  check(values['settings.providers.groqModel'] === 'openai/gpt-oss-120b-custom',
    'stores an explicitly configured Groq model');

  root.querySelector('#groq-clear').click();
  await new Promise(setImmediate);
  check(values['settings.apiKeys.groq'] === undefined,
    'clears the stored Groq key');
  check(groqInput.value === '',
    'clears the Groq key input');
  check(groqInput.dataset.hasValue === '0',
    'marks the Groq key as unconfigured after clearing');

  console.log('Settings Groq: ' + passed + ' passed, 0 failed.');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
