'use strict';

(function (global) {
  // At most three total requests: the initial attempt plus two retries.
  var MAX_ATTEMPTS = 3;
  var BASE_DELAY_MS = 1000;
  var MAX_DELAY_MS = 2000;
  var DEFAULT_UNAVAILABLE_MESSAGE =
    'AI services are temporarily unavailable. Please try again shortly.';
  var RETRYABLE_HTTP_STATUSES = [500, 502, 503, 504];

  function UnavailableError(message) {
    this.name = 'UnavailableError';
    this.code = 'unavailable';
    this.message = typeof message === 'string' && message.trim()
      ? message
      : DEFAULT_UNAVAILABLE_MESSAGE;
    if (Error.captureStackTrace) Error.captureStackTrace(this, UnavailableError);
  }
  UnavailableError.prototype = Object.create(Error.prototype);
  UnavailableError.prototype.constructor = UnavailableError;

  function failureInfo(value) {
    if (!value) return null;
    if (value.ok === true) return null;

    var status = Number.isFinite(value.status) ? value.status : null;
    var error = typeof value.error === 'string' ? value.error : '';
    var kind = typeof value.kind === 'string' ? value.kind : '';
    var name = typeof value.name === 'string' ? value.name : '';

    if (status === 429 || error === 'rate-limit' || kind === 'rate-limit') {
      return { retryable: true, message: value.message };
    }
    if (status !== null && RETRYABLE_HTTP_STATUSES.indexOf(status) !== -1) {
      return { retryable: true, message: value.message };
    }
    if (error === 'network' || kind === 'network' || name === 'TypeError') {
      return { retryable: true, message: value.message };
    }
    return { retryable: false };
  }

  function isRetryable(value) {
    var info = failureInfo(value);
    return !!(info && info.retryable);
  }

  function normalizeRandom(random) {
    var value;
    try {
      value = random();
    } catch (_) {
      return 0.5;
    }
    if (!Number.isFinite(value)) return 0.5;
    return Math.max(0, Math.min(0.999999999, value));
  }

  function retryDelay(retryNumber, random) {
    var ceiling = Math.min(
      MAX_DELAY_MS,
      BASE_DELAY_MS * Math.pow(2, Math.max(0, retryNumber))
    );
    var half = ceiling / 2;
    return Math.floor(half + normalizeRandom(random) * half);
  }

  function retry(operation, options) {
    var o = options || {};
    var attempts = Number.isInteger(o.maxAttempts)
      ? Math.max(1, Math.min(MAX_ATTEMPTS, o.maxAttempts))
      : MAX_ATTEMPTS;
    var sleep = typeof o.sleep === 'function'
      ? o.sleep
      : function (delay) {
        return new Promise(function (resolve) { setTimeout(resolve, delay); });
      };
    var random = typeof o.random === 'function' ? o.random : Math.random;
    var canRetry = typeof o.canRetry === 'function'
      ? o.canRetry
      : isRetryable;
    var attemptNumber = 1;

    function runAttempt() {
      return Promise.resolve()
        .then(operation)
        .then(function (value) {
          if (!canRetry(value)) return value;
          return retryOrThrow(value);
        }, function (error) {
          if (!canRetry(error)) throw error;
          return retryOrThrow(error);
        });
    }

    function retryOrThrow(failure) {
      if (attemptNumber >= attempts) {
        var info = failureInfo(failure);
        throw new UnavailableError(
          (info && info.message) || DEFAULT_UNAVAILABLE_MESSAGE
        );
      }

      var delay = retryDelay(attemptNumber - 1, random);
      attemptNumber += 1;
      return Promise.resolve()
        .then(function () { return sleep(delay); })
        .then(runAttempt);
    }

    return runAttempt();
  }

  var api = {
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    BASE_DELAY_MS: BASE_DELAY_MS,
    MAX_DELAY_MS: MAX_DELAY_MS,
    DEFAULT_UNAVAILABLE_MESSAGE: DEFAULT_UNAVAILABLE_MESSAGE,
    UnavailableError: UnavailableError,
    isRetryable: isRetryable,
    retryDelay: retryDelay,
    retry: retry
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakRetry = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
