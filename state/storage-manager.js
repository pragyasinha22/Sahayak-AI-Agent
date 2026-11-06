/**
 * Sahayak — Namespaced chrome.storage.local wrapper (Slice 1.1.3).
 * -----------------------------------------------------------------------------
 * Sources:
 *   docs/implementation-plan.md Slice 1.1.3 (Files, Steps, Acceptance, Unit tests)
 *   docs/architecture.md        §9 (Storage tiers: .local for keys, profile, skills)
 *   docs/problemStatement.md    §2.1, §2.18, §4.2
 *   docs/edge-case.md           EC-W1-07, EC-W1-08, EC-W4-05, EC-SEC-01
 *
 * Design:
 *   - Pure-ish module: chrome.* is referenced only inside function bodies so
 *     the file can be required from Node with a mock global.chrome for unit
 *     tests (docs/implementation-plan.md Slice 1.1.3 Unit tests).
 *   - Namespaced under a single root key ("sahayak") so future slices can add
 *     profile, skills, and settings sub-keys without colliding.
 *   - Never logs values (INV-9 / EC-SEC-01 / EC-SEC-05). Keys are treated as
 *     sensitive; callers are expected to mask before display.
 *   - No AI calls, no message routing, no safety policy — those belong to
 *     Slices 1.1.4 and 1.2.1.
 * -----------------------------------------------------------------------------
 */

'use strict';

(function (global) {
  const ROOT_KEY = 'sahayak';

  /** Portable deep clone (JSON-safe; chrome.storage values are JSON-serialisable). */
  function deepClone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  /** Read a dotted path from an object; returns undefined if any hop is missing. */
  function pathGet(obj, dottedPath) {
    if (!obj || !dottedPath) return undefined;
    const parts = String(dottedPath).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i += 1) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** Write a value at a dotted path, creating intermediate objects/arrays as needed. */
  function pathSet(obj, dottedPath, value) {
    const parts = String(dottedPath).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const k = parts[i];
      if (cur[k] == null || typeof cur[k] !== 'object') {
        cur[k] = {};
      }
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  /** Delete a value at a dotted path; parent objects remain but the leaf is removed. */
  function pathRemove(obj, dottedPath) {
    const parts = String(dottedPath).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (cur == null) return obj;
      cur = cur[parts[i]];
    }
    if (cur != null) delete cur[parts[parts.length - 1]];
    return obj;
  }

  function storageGet(dottedPath) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([ROOT_KEY], (items) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        const root = items && items[ROOT_KEY] ? items[ROOT_KEY] : {};
        resolve(dottedPath ? pathGet(root, dottedPath) : root);
      });
    });
  }

  function storageSet(dottedPath, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([ROOT_KEY], (items) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        // Clone so we never mutate the object Chrome handed us.
        const root = items && items[ROOT_KEY] ? deepClone(items[ROOT_KEY]) : {};
        pathSet(root, dottedPath, value);
        chrome.storage.local.set({ [ROOT_KEY]: root }, () => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve();
        });
      });
    });
  }

  function storageRemove(dottedPath) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([ROOT_KEY], (items) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        const root = items && items[ROOT_KEY] ? deepClone(items[ROOT_KEY]) : {};
        pathRemove(root, dottedPath);
        chrome.storage.local.set({ [ROOT_KEY]: root }, () => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve();
        });
      });
    });
  }

  const api = {
    ROOT_KEY,
    NAMESPACED: {
      GEMINI_KEY: 'settings.apiKeys.gemini',
    },
    storageGet,
    storageSet,
    storageRemove,
    pathGet,
    pathSet,
    pathRemove,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakStorageManager = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
