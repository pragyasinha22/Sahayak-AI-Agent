/**
 * Sahayak — Side Panel shell bootstrap (Slices 1.1.2 + 1.1.3 + 1.1.4).
 * -----------------------------------------------------------------------------
 * Registers the primary user surface (FR-1, docs/architecture.md §3.1).
 *
 * Slice 1.1.2 additions: layout-only bootstrap with panel-loaded log.
 * Slice 1.1.3 additions: Chat/Settings view toggle + Settings controller
 * wiring. The key is stored via state/storage-manager.js and displayed
 * masked; it is NEVER logged, never sent to a background message, and
 * never made available to a content script (INV-2, GDR-3, EC-SEC-01).
 * Slice 1.1.4 additions: installs the panel <-> worker <-> content message
 * router via SahayakPanelMessaging.install(). Exposes `SahayakPanel` on the
 * panel window so a manual tester can call `SahayakPanel.ping()` from the
 * panel DevTools console to exercise the router end-to-end.
 * Slice 1.2.2 additions: SahayakPanelMessaging.install() now builds the
 * safety gate (panel/safety-gate.js over safety/*.js, loaded earlier via
 * script tags) and exposes `SahayakPanel.guardedSend(...)` as the only
 * sanctioned path for extract-article / scan-elements / execute-approved.
 *
 * Still intentionally absent (owned by later slices):
 *   - fetch() to Gemini/Groq                -> Week 2 provider layer.
 *
 * Chrome acceptance (Slices 1.1.3 + 1.1.4):
 *   - Key round-trips through reload.
 *   - Masked in UI.
 *   - Nothing key-bearing appears in the panel console.
 *   - Settings persist across browser restart.
 *   - `SahayakPanel.ping()` resolves to `{ ok: true, result: 'pong' }`.
 *   - `SahayakPanel.send('ping', { apiKey: 'x' })` rejects BEFORE any
 *     chrome.runtime.sendMessage call (client-side forbidden-field walk).
 * -----------------------------------------------------------------------------
 */

'use strict';

(function bootstrapSidePanel() {
  const statusEl = document.getElementById('app-status');
  if (statusEl) statusEl.textContent = 'Ready';

  // Slice 1.1.2 Chrome-test hook: chrome.runtime.getURL resolves the panel
  // path. Logged so the manual test can inspect it via the panel DevTools.
  const panelUrl = chrome.runtime.getURL('panel/side-panel.html');
  const manifest = chrome.runtime.getManifest();

  console.log('[Sahayak] side panel loaded', {
    version: manifest.version,
    panelUrl,
  });

  // Defensive assertion (no-op in normal installs). If Chrome ever serves
  // the panel from an unexpected URL, we log rather than crash.
  if (typeof panelUrl !== 'string' || !panelUrl.endsWith('/panel/side-panel.html')) {
    console.warn('[Sahayak] unexpected panel URL', panelUrl);
  }

  // ---------------------------------------------------------------------------
  // Slice 1.1.3 — Chat / Settings view toggle.
  // ---------------------------------------------------------------------------
  const viewChat = document.getElementById('view-chat');
  const viewSettings = document.getElementById('settings-view');
  const toggleBtns = document.querySelectorAll('#view-toggle .view-toggle-btn');

  function switchView(name) {
    toggleBtns.forEach((btn) => {
      const active = btn.dataset.view === name;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (viewChat) viewChat.hidden = name !== 'chat';
    if (viewSettings) viewSettings.hidden = name !== 'settings';
  }

  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // ---------------------------------------------------------------------------
  // Slice 1.1.3 — Initialise the Settings controller.
  //
  // Dependencies are loaded earlier via <script> tags in side-panel.html:
  //   SahayakStorageManager  (state/storage-manager.js)
  //   SahayakApiKeys         (state/api-keys.js)
  //   SahayakSettingsController (panel/settings/settings.js)
  // Missing deps are logged with the stable tag but never crash the Chat view.
  // ---------------------------------------------------------------------------
  const storageManager = globalThis.SahayakStorageManager;
  const apiKeys = globalThis.SahayakApiKeys;
  const controller = globalThis.SahayakSettingsController;

  if (storageManager && apiKeys && controller && viewSettings) {
    controller
      .init(viewSettings, { storageManager, apiKeys })
      .catch((err) => {
        // Never include the raw key in error output (INV-9 / EC-SEC-01).
        console.warn('[Sahayak] settings init failed', err && err.message);
      });
  } else {
    console.warn(
      '[Sahayak] settings modules not loaded; Chat view still available.'
    );
  }

  // Default to Chat on every panel open so a returning user lands on the
  // primary surface; Settings is opt-in via the toggle.
  switchView('chat');

  // ---------------------------------------------------------------------------
  // Slice 1.1.4 — Install the panel <-> worker <-> content messaging channel.
  //
  // Dependencies already loaded earlier via <script> tags:
  //   SahayakMessageContract (shared/message-contract.js)
  //   SahayakPanelMessaging  (panel/messaging.js)
  // Missing deps leave the Chat + Settings views intact; only the router
  // call-in is disabled. Never crash the panel for a missing module.
  // ---------------------------------------------------------------------------
  const panelMessaging = globalThis.SahayakPanelMessaging;
  if (panelMessaging && typeof panelMessaging.install === 'function') {
    const installed = panelMessaging.install(globalThis);
    if (installed) {
      console.log(
        '[Sahayak] messaging ready \u2014 call SahayakPanel.ping() in this console to test the router'
      );
    }
  } else {
    console.warn('[Sahayak] panel/messaging.js not loaded; router unavailable.');
  }
})();
