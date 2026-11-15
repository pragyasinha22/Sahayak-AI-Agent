'use strict';

(function (global) {
  var GENERIC_MESSAGE =
    "Sahayak couldn't complete this request. Please try again.";

  function createController(element, errors) {
    if (!element) throw new TypeError('An error banner element is required.');

    var lastMessage = '';
    var mapper = errors && typeof errors.toUserMessage === 'function'
      ? errors
      : null;

    function show(error, fallback) {
      var message = mapper
        ? mapper.toUserMessage(error, fallback)
        : (typeof fallback === 'string' && fallback.trim()
          ? fallback
          : GENERIC_MESSAGE);
      if (message !== lastMessage) element.textContent = message;
      element.hidden = false;
      lastMessage = message;
      return message;
    }

    function clear() {
      element.hidden = true;
      element.textContent = '';
      lastMessage = '';
    }

    return Object.freeze({ show: show, clear: clear });
  }

  function init(win) {
    if (!win || !win.document) return null;
    var element = win.document.getElementById('error-toast');
    var errors = win.SahayakErrors;
    if (!element || !errors) return null;
    var controller = createController(element, errors);
    win.SahayakErrorToast = controller;
    return controller;
  }

  var api = { createController: createController, init: init };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    init(global);
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
