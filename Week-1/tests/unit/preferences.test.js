/**
 * Sahayak — Language preference unit tests (Slice 1.7.1)
 * -----------------------------------------------------------------------------
 * Node-only. Exercises the plan's Slice 1.7.1 Unit-tests bullet verbatim:
 *
 *   "prompt templates include language token"
 *
 * plus hydration/default/persistence through the Slice 1.1.3 storage-manager
 * contract (mocked chrome.storage-free: a fake manager recording dotted-path
 * calls) and the cached value the panel features read at prompt-build time.
 * No Chrome, no DOM (the toggle's paint() is a documented no-op there).
 *
 * Run with:   node tests/unit/preferences.test.js
 * Exit code:  0 on pass, 1 on any failure, 2 on harness error.
 * -----------------------------------------------------------------------------
 */
'use strict';

const Preferences = require('../../state/preferences.js');
const Explain = require('../../panel/features/explain.js');
const SummaryPrompt = require('../../panel/prompts/article-summary.js');
const YouTube = require('../../panel/features/youtube.js');

// language-toggle.js resolves these lazily in set(); wire the twins.
global.SahayakPreferences = Preferences;

const Toggle = require('../../panel/ui/language-toggle.js');

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

/** Fake SahayakStorageManager (records dotted-path get/set — no chrome.*). */
function makeManager(initial) {
  const data = Object.assign({}, initial || {});
  return {
    data,
    storageGet: (path) => Promise.resolve(data[path]),
    storageSet: (path, value) => { data[path] = value; return Promise.resolve(); }
  };
}

async function main() {
  // ==========================================================================
  // 1. Normalisation — corrupt/unknown values can never reach a prompt.
  // ==========================================================================
  section('normalize');
  {
    assert(Preferences.normalize('hinglish') === 'hinglish', 'hinglish accepted');
    assert(Preferences.normalize(' HINGLISH ') === 'hinglish',
      'case/whitespace tolerated');
    assert(Preferences.normalize('en') === 'en', 'en accepted');
    assert(Preferences.normalize('fr') === 'en' && Preferences.normalize(null) === 'en' &&
      Preferences.normalize(42) === 'en',
      'unknown/missing/garbage values fall back to the safe English default');
  }

  // ==========================================================================
  // 2. Persistence through the storage-manager path contract.
  // ==========================================================================
  section('getLanguage / setLanguage');
  {
    const m = makeManager();
    assert(await Preferences.getLanguage(m) === 'en',
      'unhydrated storage -> default en');

    assert(await Preferences.setLanguage(m, 'hinglish') === 'hinglish',
      'set returns the normalised value');
    assert(m.data[Preferences.STORAGE_PATH] === 'hinglish',
      'persisted at settings.preferences.language via the manager');
    assert(await Preferences.getLanguage(m) === 'hinglish', 'hydration reads it back');

    const corrupt = makeManager();
    corrupt.data[Preferences.STORAGE_PATH] = 'xXx';
    assert(await Preferences.getLanguage(corrupt) === 'en',
      'corrupt stored value normalises to en, never crashes');

    assert(await Preferences.getLanguage(null) === 'en' &&
      await Preferences.setLanguage(null, 'hinglish') === 'hinglish',
      'missing manager degrades safely');

    const throwing = { storageGet: () => Promise.reject(new Error('storage down')) };
    assert(await Preferences.getLanguage(throwing) === 'en',
      'storage error falls back to the default language');
  }

  // ==========================================================================
  // 3. Prompt templates include the language token (plan Unit-test bullet).
  // ==========================================================================
  section('language token in every prompt template');
  {
    const h = Preferences.languageInstruction('hinglish');
    const e = Preferences.languageInstruction('en');
    assert(h.indexOf('Hinglish') !== -1, 'hinglish token names the language');
    assert(e.indexOf('English') !== -1 && e !== h, 'english token differs');

    const exPromptHinglish = Explain.buildExplainPrompt('gravity', 'hinglish');
    assert(exPromptHinglish.indexOf(h) !== -1 &&
      exPromptHinglish.indexOf('SELECTED TEXT') !== -1,
      'explain prompt carries the language token + keeps its markers');
    assert(Explain.buildExplainPrompt('gravity').indexOf(e) !== -1,
      'explain prompt without language -> English default');

    const sumHinglish = SummaryPrompt.buildSummaryPrompt({ title: 'T', textContent: 'abc' }, 'hinglish');
    assert(sumHinglish.indexOf(h) !== -1, 'article-summary prompt carries the token');
    assert(SummaryPrompt.buildSummaryPrompt({ title: 'T', textContent: 'abc' }).indexOf(e) !== -1,
      'summary prompt defaults to English');

    const ytHinglish = YouTube.buildYouTubePrompt({ title: 'V', textContent: 'tt' }, 'hinglish');
    assert(ytHinglish.indexOf(h) !== -1, 'youtube prompt carries the token');
    assert(YouTube.buildYouTubePrompt({ title: 'V', textContent: 'tt' }).indexOf(e) !== -1,
      'youtube prompt defaults to English');
  }

  // ==========================================================================
  // 4. Toggle module — cached value the features read synchronously.
  // ==========================================================================
  section('language toggle module contract');
  {
    assert(Toggle.current() === 'en', 'cache starts at the safe default');

    const m = makeManager();
    global.SahayakStorageManager = m;
    assert(await Toggle.set('hinglish') === 'hinglish',
      'set() resolves the stored value');
    assert(Toggle.current() === 'hinglish', 'cache updates synchronously for prompts');
    assert(m.data[Preferences.STORAGE_PATH] === 'hinglish',
      'click-path persistence uses the same storage path');

    assert(await Toggle.set('klingon') === 'en',
      'invalid toggle value normalises to the safe English default');
    assert(m.data[Preferences.STORAGE_PATH] === 'en',
      'the normalised default is what gets persisted');

    assert(await Toggle.get() === Toggle.current(),
      'async get() agrees with the synchronous cache');

    await Toggle.set('hinglish');
    await Toggle.reload();
    assert(Toggle.current() === 'hinglish',
      'reload() re-hydrates from storage (panel reopen keeps the choice)');
    delete global.SahayakStorageManager;
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
