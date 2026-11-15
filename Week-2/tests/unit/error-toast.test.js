'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Errors = require('../../shared/errors.js');
const ErrorToast = require('../../panel/ui/error-toast.js');

function makeElement() {
  return {
    hidden: true,
    textContent: '',
    children: [],
    appendCount: 0,
    setAttribute(name, value) {
      this[name] = value;
    },
    appendChild(child) {
      this.appendCount += 1;
      this.children.push(child);
    },
  };
}

const element = makeElement();
const toast = ErrorToast.createController(element, Errors);

assert.equal(
  toast.show({ error: 'network' }, 'A raw exception must not be used.'),
  Errors.MESSAGES.network
);
assert.equal(element.hidden, false);
assert.equal(element.textContent, Errors.MESSAGES.network);

toast.show({ error: 'network' }, 'A second raw exception must not be used.');
assert.equal(element.textContent, Errors.MESSAGES.network);
assert.equal(
  element.appendCount,
  0,
  'reuses the existing banner instead of appending duplicates'
);

toast.show(
  { error: 'safety-blocked' },
  'Blocked by safety. No information was sent.'
);
assert.equal(
  element.textContent,
  'Blocked by safety. No information was sent.',
  'keeps the existing safety guidance'
);

toast.clear();
assert.equal(element.hidden, true);
assert.equal(element.textContent, '');

let lookedUpId = null;
const initializedElement = makeElement();
const controller = ErrorToast.init({
  SahayakErrors: Errors,
  document: {
    getElementById(id) {
      lookedUpId = id;
      return initializedElement;
    },
  },
});
assert.ok(controller);
assert.equal(lookedUpId, 'error-toast');
const panelHtml = fs.readFileSync(
  path.join(__dirname, '../../panel/side-panel.html'),
  'utf8'
);
assert.equal(
  (panelHtml.match(/id="error-toast"/g) || []).length,
  1,
  'the panel markup defines exactly one shared error banner'
);

console.log('10 passed, 0 failed');
