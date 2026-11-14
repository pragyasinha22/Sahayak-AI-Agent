'use strict';

const assert = require('node:assert/strict');
const ContextAction = require('../../shared/context-action.js');
const ContextMenus = require('../../background/context-menus.js');
const ContextMenuPanel = require('../../panel/features/context-menu.js');

globalThis.SahayakContextAction = ContextAction;

const selectionTextCases = [
  'What technologies did you use to build your latest project, and what features does it support?',
  'What technologies did you use to build my latest project, and what features does it support?',
  'A semicolon; followed by what should remain unchanged;',
  "What's in the project, and what's supported?",
  'First line,\nwhat is on the next line?\nFinal line.',
  '¿Qué tecnologías usaste? Café — 東京 🙂',
  '  preserve surrounding spaces  '
];

function createHarness(options) {
  const opts = options || {};
  const state = {
    menuItems: [],
    removeAllCalls: 0,
    opens: [],
    messages: [],
    storage: {},
    removedKeys: []
  };
  const chromeMock = {
    contextMenus: {
      removeAll(callback) {
        state.removeAllCalls += 1;
        state.menuItems = [];
        callback();
      },
      create(item, callback) {
        state.menuItems.push(item);
        callback();
      }
    },
    sidePanel: {
      open(details) {
        state.opens.push(details);
        return opts.openFailure
          ? Promise.reject(new Error('restricted'))
          : Promise.resolve();
      }
    },
    runtime: {
      lastError: undefined,
      sendMessage(message) {
        state.messages.push(message);
        return opts.sendFailure
          ? Promise.reject(new Error('panel-not-ready'))
          : Promise.resolve();
      }
    },
    storage: {
      set(values) {
        Object.assign(state.storage, values);
        return Promise.resolve();
      },
      remove(key) {
        state.removedKeys.push(key);
        delete state.storage[key];
        return Promise.resolve();
      }
    }
  };

  const controller = ContextMenus.create({
    contextMenus: chromeMock.contextMenus,
    sidePanel: chromeMock.sidePanel,
    runtime: chromeMock.runtime,
    storage: chromeMock.storage,
    contract: ContextAction
  });
  return { state, controller };
}

function click(controller, menuItemId, text, tab) {
  return controller.handleClick({
    menuItemId: menuItemId,
    selectionText: text,
    pageUrl: 'https://example.test/article'
  }, tab);
}

async function main() {
  let pass = 0;
  let fail = 0;

  function check(condition, message) {
    try {
      assert.ok(condition, message);
      pass += 1;
      console.log('  ✓ ' + message);
    } catch (error) {
      fail += 1;
      console.error('  ✗ ' + message);
      console.error(error.message);
    }
  }

  console.log('# context menus');
  {
    const harness = createHarness();
    await Promise.all([
      harness.controller.register(),
      harness.controller.register()
    ]);
    check(harness.state.removeAllCalls === 1,
      'concurrent registration is coalesced and clears prior menu items once');
    check(harness.state.menuItems.length === 3 &&
      harness.state.menuItems.every(function (item) {
        return item.contexts.length === 1 && item.contexts[0] === 'selection';
      }), 'registers exactly three selection-only context menu items');
    check(harness.state.menuItems.map(function (item) { return item.title; }).join('|') ===
      'Explain this|Translate this|Draft a reply',
    'registers the expected Explain, Translate, and Draft reply labels');
    await harness.controller.register();
    check(harness.state.menuItems.length === 3 && harness.state.removeAllCalls === 1,
      'repeated registration on the same worker does not create duplicates');
  }

  console.log('\n# action handoff');
  {
    const harness = createHarness();
    const cases = [
      ['sahayak-context-explain', 'explain'],
      ['sahayak-context-translate', 'translate'],
      ['sahayak-context-draft-reply', 'draft-reply']
    ];

    for (const [menuId, action] of cases) {
      const selectedText = '  Selected words  ';
      const result = await click(harness.controller, menuId, selectedText, {
        id: 21,
        url: 'https://example.test/article'
      });
      const request = harness.state.messages[harness.state.messages.length - 1];
      check(result.ok === true && request.action === action,
        action + ' menu item maps to the correct action');
      check(request.text === selectedText && request.tabId === 21,
        action + ' transfers the exact selected text with the originating tab ID');
      check(!Object.keys(request).some(function (key) {
        return /project.?facts/i.test(key);
      }), action + ' handoff carries no project-facts textarea data');
      check(harness.state.opens[harness.state.opens.length - 1].tabId === 21,
        action + ' opens the panel for the originating tab');
    }

    const pending = harness.state.storage[ContextAction.storageKey(21)];
    check(pending && pending.type === ContextAction.MESSAGE_TYPE,
      'stores a recoverable tab-specific request for panel startup');
    check(harness.state.messages.every(function (message) {
      return !Object.keys(message).some(function (key) {
        return /api.?key|token|secret/i.test(key);
      });
    }), 'handoff payload contains no API key or credential fields');
    await harness.controller.clearTab(21);
    check(!harness.state.storage[ContextAction.storageKey(21)] &&
      harness.state.removedKeys.includes(ContextAction.storageKey(21)),
    'tab-close cleanup removes only that tab pending request');
  }

  console.log('\n# invalid and restricted requests');
  {
    const harness = createHarness();
    const empty = await click(harness.controller, 'sahayak-context-explain', '  \n ', {
      id: 21,
      url: 'https://example.test/article'
    });
    check(empty.ok === false && harness.state.opens.length === 0 &&
      harness.state.messages.length === 0,
    'whitespace-only selections are rejected without opening or messaging the panel');
    const emptyString = await click(
      harness.controller,
      'sahayak-context-draft-reply',
      '',
      { id: 21, url: 'https://example.test/article' }
    );
    check(
      emptyString.ok === false &&
        harness.state.opens.length === 0 &&
        harness.state.messages.length === 0,
      'empty selected-text strings are rejected without opening or messaging the panel'
    );

    const invalidAction = await click(harness.controller, 'unknown-action', 'text', {
      id: 21,
      url: 'https://example.test/article'
    });
    check(invalidAction.ok === false && harness.state.opens.length === 0,
      'unknown action is rejected');

    const missingTab = await click(harness.controller, 'sahayak-context-explain', 'text', null);
    check(missingTab.ok === false && harness.state.opens.length === 0,
      'missing originating tab is rejected');

    const restricted = await click(harness.controller, 'sahayak-context-explain', 'text', {
      id: 21,
      url: 'chrome://settings'
    });
    check(restricted.ok === false && harness.state.opens.length === 0,
      'restricted browser pages are rejected safely');

    const openFailure = createHarness({ openFailure: true });
    const failed = await click(openFailure.controller,
      'sahayak-context-explain', 'text', {
        id: 21,
        url: 'https://example.test/article'
      });
    check(failed.ok === false && failed.error === 'panel-open-failed' &&
      openFailure.state.messages.length === 0 &&
      Object.keys(openFailure.state.storage).length === 0,
    'side-panel opening failures are handled without storing or sending a request');
  }

  console.log('\n# request validation');
  {
    const valid = ContextAction.createRequest(
      'sahayak-context-translate',
      'x'.repeat(ContextAction.MAX_SELECTION_CHARS + 20),
      { id: 8, url: 'https://example.test/' },
      '',
      'request-1'
    );
    check(valid && valid.action === 'translate' &&
      valid.text.length === ContextAction.MAX_SELECTION_CHARS,
    'selection payload is bounded before panel transfer');
    check(ContextAction.sanitizeRequest(Object.assign({}, valid, { tabId: '8' })) === null,
      'incoming request rejects a non-numeric tab ID');
    check(ContextAction.sanitizeRequest(Object.assign({}, valid, { action: 'send' })) === null,
      'incoming request rejects an invalid action');
    const unicodeBoundary = ContextAction.clampSelection(
      'x'.repeat(ContextAction.MAX_SELECTION_CHARS - 1) + '🙂'
    );
    check(
      unicodeBoundary.length === ContextAction.MAX_SELECTION_CHARS - 1 &&
        unicodeBoundary.charCodeAt(unicodeBoundary.length - 1) < 0xD800,
      'selection length limit does not split a Unicode surrogate pair'
    );

    const exactHandoff = createHarness();
    for (let i = 0; i < selectionTextCases.length; i += 1) {
      const selectedText = selectionTextCases[i];
      const result = await click(
        exactHandoff.controller,
        'sahayak-context-draft-reply',
        selectedText,
        { id: 8, url: 'https://example.test/article' }
      );
      const message = exactHandoff.state.messages[
        exactHandoff.state.messages.length - 1
      ];
      const stored = exactHandoff.state.storage[ContextAction.storageKey(8)];
      check(
        result.ok &&
          message.text === selectedText &&
          stored.text === selectedText,
        'context-menu handoff and session storage preserve selection case ' + (i + 1)
      );
    }
  }

  console.log('\n# panel display and tab isolation');
  {
    function makePanelHarness(storedRequest) {
      const elements = {
        'context-action-notice': { hidden: true },
        'context-action-name': { textContent: '' },
        'context-action-text': { textContent: '' }
      };
      const listeners = { runtime: null, storage: null };
      const receivedActions = [];
      const stored = {};
      if (storedRequest) {
        stored[ContextAction.storageKey(21)] = storedRequest;
      }
      const win = {
        document: {
          readyState: 'complete',
          getElementById: function (id) { return elements[id]; }
        },
        SahayakContextAction: ContextAction,
        SahayakContextActionWorkflow: {
          receive: function (request) { receivedActions.push(request); }
        },
        SahayakPanel: {
          requestActiveTabId: function () { return Promise.resolve(21); }
        },
        chrome: {
          runtime: {
            id: 'sahayak-test-id',
            onMessage: {
              addListener: function (listener) { listeners.runtime = listener; }
            }
          },
          storage: {
            session: {
              get: function (key) {
                const result = {};
                if (stored[key]) result[key] = stored[key];
                return Promise.resolve(result);
              },
              remove: function (key) {
                delete stored[key];
                return Promise.resolve();
              }
            },
            onChanged: {
              addListener: function (listener) { listeners.storage = listener; }
            }
          },
          tabs: { onActivated: { addListener: function () {} } }
        }
      };
      ContextMenuPanel.initUI(win);
      return {
        elements,
        listeners: listeners,
        stored: stored,
        receivedActions: receivedActions
      };
    }

    const pending = ContextAction.createRequest(
      'sahayak-context-draft-reply',
      selectionTextCases[1],
      { id: 21, url: 'https://example.test/article' },
      '',
      'pending-1'
    );
    const recovered = makePanelHarness(pending);
    await new Promise(function (resolve) { setImmediate(resolve); });
    check(recovered.elements['context-action-notice'].hidden === false &&
      recovered.elements['context-action-name'].textContent === 'Draft a reply' &&
      recovered.elements['context-action-text'].textContent === selectionTextCases[1] &&
      recovered.receivedActions[0].text === selectionTextCases[1],
    'panel restores, displays, and hands off the exact selected question');

    let panelPreservedSelections = true;
    for (let i = 0; i < selectionTextCases.length; i += 1) {
      const request = ContextAction.createRequest(
        'sahayak-context-draft-reply',
        selectionTextCases[i],
        { id: 21, url: 'https://example.test/article' },
        '',
        'panel-selection-' + i
      );
      const panel = makePanelHarness(request);
      await new Promise(function (resolve) { setImmediate(resolve); });
      panelPreservedSelections = panelPreservedSelections &&
        panel.elements['context-action-text'].textContent === selectionTextCases[i] &&
        panel.receivedActions[0].text === selectionTextCases[i];
    }
    check(
      panelPreservedSelections,
      'panel display and workflow handoff preserve spaces, punctuation, line breaks, and Unicode'
    );

    const live = makePanelHarness(null);
    await new Promise(function (resolve) { setImmediate(resolve); });
    live.listeners.runtime({
      type: ContextAction.MESSAGE_TYPE,
      requestId: 'live-1',
      action: 'translate',
      text: 'Translate this selection',
      tabId: 21
    }, { id: 'sahayak-test-id' });
    check(live.elements['context-action-notice'].hidden === false &&
      live.elements['context-action-name'].textContent === 'Translate this' &&
      live.elements['context-action-text'].textContent === 'Translate this selection',
    'panel displays a valid runtime handoff from its active tab');
    check(
      live.receivedActions.length === 1 &&
        live.receivedActions[0].action === 'translate' &&
        live.receivedActions[0].text === 'Translate this selection',
      'panel routes the validated handoff to the context-action workflow');

    live.listeners.runtime({
      type: ContextAction.MESSAGE_TYPE,
      requestId: 'wrong-tab',
      action: 'explain',
      text: 'Must not appear in another tab',
      tabId: 22
    }, { id: 'sahayak-test-id' });
    check(live.elements['context-action-name'].textContent === 'Translate this' &&
      live.elements['context-action-text'].textContent === 'Translate this selection',
    'panel ignores requests belonging to a different tab');
    check(
      live.receivedActions.length === 1,
      'panel does not route a different tab request to the context-action workflow');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) process.exitCode = 1;
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
