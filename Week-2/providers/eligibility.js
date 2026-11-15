'use strict';

(function (global) {
  var ELIGIBLE_TASK_TYPES = [
    'page-chat',
    'translation',
    'draft-reply',
    'text-summary',
    'json-action-selection'
  ];
  var INELIGIBLE_TASK_MESSAGE =
    'This task requires Gemini and cannot use the text-only fallback.';

  function IneligibleTaskError() {
    this.name = 'IneligibleTaskError';
    this.code = 'ineligible-task';
    this.message = INELIGIBLE_TASK_MESSAGE;
    if (Error.captureStackTrace) Error.captureStackTrace(this, IneligibleTaskError);
  }
  IneligibleTaskError.prototype = Object.create(Error.prototype);
  IneligibleTaskError.prototype.constructor = IneligibleTaskError;

  function isEligible(task) {
    if (!task || typeof task !== 'object' ||
        Object.prototype.hasOwnProperty.call(task, 'image') ||
        task.requiresVision === true ||
        typeof task.prompt !== 'string' ||
        !task.prompt.trim()) {
      return false;
    }
    return ELIGIBLE_TASK_TYPES.indexOf(task.taskType) !== -1;
  }

  function assertEligible(task) {
    if (!isEligible(task)) throw new IneligibleTaskError();
    return true;
  }

  var api = {
    ELIGIBLE_TASK_TYPES: ELIGIBLE_TASK_TYPES.slice(),
    INELIGIBLE_TASK_MESSAGE: INELIGIBLE_TASK_MESSAGE,
    IneligibleTaskError: IneligibleTaskError,
    isEligible: isEligible,
    assertEligible: assertEligible
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakEligibility = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
