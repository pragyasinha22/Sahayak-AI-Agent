/**
 * Sahayak — Settings view controller (Slice 1.1.3).
 * -----------------------------------------------------------------------------
 * Sources:
 *   docs/implementation-plan.md Slice 1.1.3 (Files, Steps, Acceptance)
 *   docs/architecture.md        §3.1, §9 (only the Side Panel holds keys)
 *   docs/edge-case.md           EC-W1-07 (missing key path), EC-W1-08 (invalid
 *                               key hint), EC-SEC-01 (documented non-secret
 *                               caveat)
 *
 * Behaviour:
 *   - Renders a Settings form into #settings-view on first load.
 *   - Reads the stored Gemini key via state/api-keys.js + state/storage-manager.js
 *     and hydrates the field as a MASKED value (Slice 1.1.3 acceptance:
 *     "masked in UI").
 *   - Save writes the trimmed value to chrome.storage.local under the
 *     namespaced path; re-masked. Clear removes it.
 *   - A persistent caveat block documents the PS §5 / Arch §9 limitation that
 *     keys stored in a distributed extension are not truly secret.
 *
 * Never does:
 *   - Call Gemini or any AI provider (Slice 2.4.1 territory).
 *   - Log the raw key value (INV-9).
 *   - Post the key to the background or a content script (INV-2, GDR-3 —
 *     Slice 1.1.4 router enforces this; this module simply does not send).
 * -----------------------------------------------------------------------------
 */

'use strict';

(function (global) {
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  function init(rootEl, deps) {
    const StorageManager = deps.storageManager;
    const ApiKeys = deps.apiKeys;

    // Module-private snapshot of the last-loaded key. Held only in memory;
    // never printed. Cleared on view reload.
    let currentKey = '';
    let revealTimer = null;

    rootEl.innerHTML = `
      <div class="settings-form" role="region" aria-label="Sahayak settings">
        <h2 class="settings-title">Settings</h2>
        <p class="settings-subtitle">
          Configure the assistant's private credentials. Everything here stays
          on this device.
        </p>

        <label class="field-label" for="gemini-key-input">Gemini API key</label>
        <div class="field-row">
          <input
            id="gemini-key-input"
            class="field-input"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="Paste your Gemini API key"
          />
          <button id="gemini-reveal" class="btn btn-secondary" type="button" title="Temporarily show the value">Show</button>
        </div>

        <div class="field-actions">
          <button id="gemini-save" class="btn btn-primary" type="button">Save</button>
          <button id="gemini-clear" class="btn btn-danger" type="button">Clear</button>
        </div>

        <p
          id="settings-status"
          class="settings-status"
          role="status"
          aria-live="polite"
        >&nbsp;</p>

        <div class="settings-caveat" role="note">
          <strong>Security note.</strong>
          Sahayak stores your key only in
          <code>chrome.storage.local</code> on this device. It is never
          committed to source control and never sent to content scripts. It is
          <em>not truly secret</em>: anyone with access to this browser profile
          can inspect extension storage. Treat it as a personal key, not a
          shared secret. See <code>docs/architecture.md</code> §9 and
          <code>docs/problemStatement.md</code> §5 for the full caveat.
        </div>

        <div class="settings-empty" data-empty="true" hidden>
          No key stored. Add your Gemini API key to continue (Week-1 features
          require it from Slice 1.3.1 onwards).
        </div>
      </div>
    `;

    const input = rootEl.querySelector('#gemini-key-input');
    const saveBtn = rootEl.querySelector('#gemini-save');
    const clearBtn = rootEl.querySelector('#gemini-clear');
    const revealBtn = rootEl.querySelector('#gemini-reveal');
    const statusEl = rootEl.querySelector('#settings-status');
    const emptyEl = rootEl.querySelector('.settings-empty');

    function setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.className = 'settings-status' + (kind ? ' is-' + kind : '');
    }

    function updateEmptyState() {
      emptyEl.hidden = !!currentKey;
    }

    function hydrateMasked(keyValue) {
      currentKey = typeof keyValue === 'string' ? keyValue : '';
      // Populate the input with the MASKED value; type="password" hides
      // bullets visually but the underlying string is redacted for anyone
      // who does inspect the DOM.
      input.value = currentKey ? ApiKeys.maskKey(currentKey) : '';
      input.dataset.hasValue = currentKey ? '1' : '0';
      updateEmptyState();
    }

    function loadKey() {
      return ApiKeys.getGeminiKey(StorageManager)
        .then((v) => hydrateMasked(v))
        .catch(() => {
          // EC-W4-05 style recovery: corrupted storage falls back to empty.
          hydrateMasked('');
          setStatus('Sahayak could not read your saved settings. Defaults restored.', 'warn');
        });
    }

    saveBtn.addEventListener('click', () => {
      const raw = (input.value || '').trim();

      // Case: user re-saved the same masked value we hydrated — treat as no-op.
      if (raw.includes('\u2026') || raw.includes('\u2022')) {
        setStatus('Value is masked. Paste the real key to overwrite.', 'warn');
        return;
      }

      if (!raw) {
        ApiKeys.removeGeminiKey(StorageManager).then(() => {
          hydrateMasked('');
          setStatus('No key saved.', 'warn');
        });
        return;
      }

      ApiKeys.setGeminiKey(StorageManager, raw).then(() => {
        hydrateMasked(raw);
        if (!ApiKeys.looksLikeGeminiKey(raw)) {
          // EC-W1-08 hint: shape mismatch, but we save anyway (user knows best).
          setStatus(
            'Saved (unusual shape — Gemini may reject it). Sahayak will not verify until AI features are enabled.',
            'warn'
          );
        } else {
          setStatus('Saved. Key is stored locally on this device only.', 'ok');
        }
      }).catch(() => {
        setStatus('Couldn\u2019t save your key. Please try again.', 'err');
      });
    });

    revealBtn.addEventListener('click', () => {
      if (!currentKey) {
        setStatus('No key to reveal yet.', 'warn');
        return;
      }
      input.type = 'text';
      input.value = currentKey;
      setStatus('Revealed for a few seconds. Sahayak will re-mask shortly.', 'warn');
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        input.type = 'password';
        hydrateMasked(currentKey);
        setStatus('', null);
      }, 4000);
    });

    clearBtn.addEventListener('click', () => {
      ApiKeys.removeGeminiKey(StorageManager).then(() => {
        currentKey = '';
        input.value = '';
        input.dataset.hasValue = '0';
        updateEmptyState();
        setStatus('Key cleared from local storage.', 'ok');
      }).catch(() => {
        setStatus('Couldn\u2019t clear the key.', 'err');
      });
    });

    return loadKey();
  }

  const api = { init };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakSettingsController = api;
  }
})(
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : window
);
