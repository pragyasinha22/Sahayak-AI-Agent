/**
 * Sahayak — Language preference (Slice 1.7.1)
 * -----------------------------------------------------------------------------
 * PS §2.6 / Plan Slice 1.7.1: "persist language preference; inject language
 * token into prompts". This module owns the STORAGE SHAPE and the PROMPT
 * TOKEN text; the UI half lives in panel/ui/language-toggle.js. Pure — no
 * chrome.* here; it receives the already-built SahayakStorageManager.
 *
 * Contract:
 *   - Allowed values: 'en' (default) | 'hinglish'. Anything else normalises
 *     to 'en' — a corrupt or hand-edited storage entry can never crash a
 *     prompt build (deny-biased to the safest, clearest option).
 *   - Stored at settings.preferences.language through the Slice 1.1.3
 *     storage manager (namespaced, no duplicate chrome.storage calls), so the
 *     preference survives panel closes and browser restarts like the key.
 *   - languageInstruction(lang) is the single source of truth for the token
 *     every prompt template injects (explain, article summary, youtube).
 * -----------------------------------------------------------------------------
 */
'use strict';

(function (global) {
  var LANG_EN = 'en';
  var LANG_HINGLISH = 'hinglish';
  var ALLOWED = [LANG_EN, LANG_HINGLISH];
  var STORAGE_PATH = 'settings.preferences.language';
  var TRANSLATION_TARGET_STORAGE_PATH =
    'settings.preferences.translationTargetLanguage';
  var TRANSLATION_TARGET_LANGUAGES = Object.freeze([
    'English',
    'Hindi',
    'Bengali',
    'Tamil',
    'Telugu',
    'Marathi',
    'Spanish',
    'French',
    'German',
    'Japanese'
  ]);

  function normalize(value) {
    var v = (typeof value === 'string') ? value.trim().toLowerCase() : '';
    return ALLOWED.indexOf(v) !== -1 ? v : LANG_EN;
  }

  var INSTRUCTIONS = {};
  INSTRUCTIONS[LANG_EN] =
    'Reply in clear, simple English.';
  INSTRUCTIONS[LANG_HINGLISH] =
    'Reply in Hinglish \u2014 a natural mix of Hindi and English written the ' +
    'way friends speak in India. Keep technical terms in English.';

  /** The language token injected into every prompt template (PS §2.6). */
  function languageInstruction(language) {
    return INSTRUCTIONS[normalize(language)];
  }

  function getLanguage(manager) {
    if (!manager || typeof manager.storageGet !== 'function') {
      return Promise.resolve(LANG_EN);
    }
    return Promise.resolve()
      .then(function () { return manager.storageGet(STORAGE_PATH); })
      .then(function (value) { return normalize(value); })
      .catch(function () { return LANG_EN; });
  }

  function setLanguage(manager, language) {
    var value = normalize(language);
    if (!manager || typeof manager.storageSet !== 'function') {
      return Promise.resolve(value); // nothing to persist; still return valid value
    }
    return Promise.resolve()
      .then(function () { return manager.storageSet(STORAGE_PATH, value); })
      .then(function () { return value; });
  }

  function normalizeTranslationTargetLanguage(value) {
    var target = (typeof value === 'string') ? value.trim().toLowerCase() : '';
    for (var i = 0; i < TRANSLATION_TARGET_LANGUAGES.length; i++) {
      if (TRANSLATION_TARGET_LANGUAGES[i].toLowerCase() === target) {
        return TRANSLATION_TARGET_LANGUAGES[i];
      }
    }
    return '';
  }

  function getTranslationTargetLanguage(manager) {
    if (!manager || typeof manager.storageGet !== 'function') {
      return Promise.resolve('');
    }
    return Promise.resolve()
      .then(function () {
        return manager.storageGet(TRANSLATION_TARGET_STORAGE_PATH);
      })
      .then(normalizeTranslationTargetLanguage)
      .catch(function () { return ''; });
  }

  function setTranslationTargetLanguage(manager, language) {
    var value = normalizeTranslationTargetLanguage(language);
    if (!manager || typeof manager.storageSet !== 'function') {
      return Promise.resolve(value);
    }
    return Promise.resolve()
      .then(function () {
        return manager.storageSet(TRANSLATION_TARGET_STORAGE_PATH, value);
      })
      .then(function () { return value; });
  }

  var api = {
    LANG_EN: LANG_EN,
    LANG_HINGLISH: LANG_HINGLISH,
    ALLOWED: ALLOWED,
    STORAGE_PATH: STORAGE_PATH,
    TRANSLATION_TARGET_STORAGE_PATH: TRANSLATION_TARGET_STORAGE_PATH,
    TRANSLATION_TARGET_LANGUAGES: TRANSLATION_TARGET_LANGUAGES,
    normalize: normalize,
    languageInstruction: languageInstruction,
    getLanguage: getLanguage,
    setLanguage: setLanguage,
    normalizeTranslationTargetLanguage: normalizeTranslationTargetLanguage,
    getTranslationTargetLanguage: getTranslationTargetLanguage,
    setTranslationTargetLanguage: setTranslationTargetLanguage
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakPreferences = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
