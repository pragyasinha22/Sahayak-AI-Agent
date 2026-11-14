/**
 * Sahayak — MV3 Background Service Worker
 * -----------------------------------------------------------------------------
 * Slices implemented in this file:
 *   1.1.1 — MV3 manifest + service worker skeleton + toolbar action icon.
 *   1.1.2 — Side Panel shell + panel-open binding. Adds
 *           chrome.action.onClicked -> chrome.sidePanel.open() and per-tab
 *           binding via chrome.tabs.onActivated -> chrome.sidePanel.setOptions.
 *   1.1.4 — Panel <-> background <-> content message router. Imports the
 *           shared message contract + router module and registers a
 *           chrome.runtime.onMessage listener that validates every envelope
 *           and forwards tab-targeted families to the correct tab.
 *
 * Sources:
 *   - docs/problemStatement.md §2.1  (Week 1 — Chrome Extension Foundation)
 *   - docs/architecture.md     §3.2  (Background Service Worker responsibilities)
 *   - docs/architecture.md     §4    (Manifest V3 structure)
 *   - docs/implementation-plan.md Slice 1.1.1 (Objective / Steps / Acceptance)
 *
 * Architectural rules honoured by this skeleton:
 *   GDR-1  Chrome MV3 only — no persistent background page.
 *   GDR-2  No backend — everything runs inside the extension.
 *   GDR-3  No API keys here. AI calls live only in the Side Panel (Slice 1.1.2).
 *   GDR-5  No policy decisions here. Safety is a pure module in Slice 1.2.1.
 *   Arch §3.2 This worker is EPHEMERAL and holds NO authoritative state.
 *
 * Deliberately NOT implemented yet (owned by later slices):
 *   - Settings + Gemini API-key storage     -> Slice 1.1.3
 *   - Safety gate + policy module           -> Slice 1.2.1 / 1.2.2
 *   - Context menus                         -> Slice 2.2.1
 * -----------------------------------------------------------------------------
 */

'use strict';

// MV3 service workers must import additional scripts synchronously at the
// top of the file, before any listener registration. Slice 1.1.4 adds:
//   ../shared/message-contract.js -> SahayakMessageContract (pure module)
//   ./router.js                   -> SahayakRouter.makeHandler factory
importScripts('../shared/message-contract.js');
importScripts('../shared/context-action.js');
importScripts('router.js');
importScripts('context-menus.js');

/**
 * Single log line used to satisfy the Slice 1.1.1 acceptance criterion:
 * "service-worker log line prints on install".
 */
const WORKER_TAG = '[Sahayak]';

const contextMenuController = SahayakContextMenus.create({
  contextMenus: chrome.contextMenus,
  sidePanel: chrome.sidePanel,
  runtime: chrome.runtime,
  storage: chrome.storage.session,
  contract: SahayakContextAction,
});

/**
 * Emit a version + reason banner when Chrome installs, updates, or
 * re-registers the extension after a Chrome/browser restart.
 */
function logRegistration(reason) {
  const manifest = chrome.runtime.getManifest();
  console.log(
    `${WORKER_TAG} service worker registered`,
    {
      version: manifest.version,
      manifestVersion: manifest.manifest_version,
      reason,
    }
  );
}

/**
 * Chrome fires onInstalled after Load unpacked, after updates, and after
 * a browser install-run event. Registration logging here proves the worker
 * is alive without adding any feature behaviour owned by later slices.
 */
chrome.runtime.onInstalled.addListener((details) => {
  logRegistration(details.reason);
  contextMenuController.register().catch(() => {
    console.warn(`${WORKER_TAG} context menu registration failed`);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  contextMenuController.handleClick(info, tab).catch(() => {
    console.warn(`${WORKER_TAG} context menu handoff failed`);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  contextMenuController.clearTab(tabId).catch(() => {
    console.warn(`${WORKER_TAG} context request cleanup failed`);
  });
});

/**
 * Fire a lightweight boot log whenever the worker wakes up from suspension.
 * This is diagnostic only; no state is written to chrome.storage here
 * (approval and task progress persistence is Slice 3.4.5 territory).
 */
logRegistration('startup');

// -----------------------------------------------------------------------------
// Slice 1.1.2 — Side Panel shell + panel-open binding (FR-1, Arch §3.1).
// -----------------------------------------------------------------------------

/**
 * Must remain in sync with manifest.json -> side_panel.default_path. Any
 * drift will be visible in the panel's own URL assertion (panel/side-panel.js)
 * and in Chrome's "Side panel not configured" error.
 */
const SIDE_PANEL_PATH = 'panel/side-panel.html';

/**
 * Bind the Side Panel to whichever tab is currently active so focus changes
 * keep the panel available (Slice 1.1.2 acceptance: "panel state survives
 * focus changes"). Some restricted surfaces (chrome://*, Web Store) reject
 * per-tab setOptions; failing silently here is safe because opening the
 * panel is a window-scoped operation handled separately below.
 *
 * Note: chrome.tabs.onActivated is available without the "tabs" permission
 * because the event only carries { tabId, windowId } (no URL/title).
 */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.sidePanel
    .setOptions({ tabId, path: SIDE_PANEL_PATH, enabled: true })
    .catch(() => {
      /* Restricted surfaces may reject binding; ignore for Slice 1.1.2. */
    });
});

/**
 * Toolbar click opens the Side Panel docked to the current window (FR-1).
 * Chrome enforces that chrome.sidePanel.open() be called synchronously
 * inside a user gesture, so we dispatch it first and then issue per-tab
 * setOptions as a best-effort follow-up (a Promise-then-open would lose
 * the gesture and Chrome would raise "sidePanel.open() may only be called
 * in response to a user gesture").
 */
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
    console.error(`${WORKER_TAG} sidePanel.open failed`, err);
  });

  if (typeof tab.id === 'number') {
    chrome.sidePanel
      .setOptions({ tabId: tab.id, path: SIDE_PANEL_PATH, enabled: true })
      .catch(() => {
        /* Ignore per-tab binding failure; open() was already dispatched. */
      });
  }
});

// -----------------------------------------------------------------------------
// Slice 1.1.4 — Panel <-> background <-> content message router (Arch §3.2, §8.1).
// -----------------------------------------------------------------------------

/**
 * The router is intentionally thin:
 *   - It validates every envelope against the shared message contract.
 *   - It answers `ping` directly (Slice 1.1.4 acceptance).
 *   - It forwards tab-targeted families (extract-article, scan-elements,
 *     capture-screenshot, execute-approved) to the tab that owns the
 *     content-script listener, via chrome.tabs.sendMessage(payload.tabId, ...).
 *   - It NEVER enriches a routed message with anything read from storage,
 *     so an apiKey cannot leak even if a future caller forgets the guard.
 *
 * The forbidden-field assertion runs on every envelope. See
 * shared/message-contract.js and tests/unit/router.test.js.
 */
chrome.runtime.onMessage.addListener(
  SahayakRouter.makeHandler(SahayakMessageContract)
);
