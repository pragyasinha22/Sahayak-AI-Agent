'use strict';

(function (global) {
  var MESSAGES = {
    rateLimit:
      'Gemini is rate-limiting requests. Sahayak will try again shortly or use a fallback if available.',
    unavailable:
      "AI services are temporarily unavailable. Sahayak didn't run your request.",
    network:
      "Sahayak couldn't reach the AI service. Check your connection and try again.",
    safetyBlock:
      'Sahayak blocked this request to protect your safety. No information was sent.',
    invalidJson:
      "Sahayak couldn't read the AI response. Please try again.",
    generic:
      "Sahayak couldn't complete this request. Please try again."
  };
  var UNAVAILABLE_GUIDANCE = [
    'Gemini is temporarily unavailable and the Groq fallback is not available.',
    'Gemini is temporarily unavailable. Add a Groq API key in Settings to use text fallback.',
    'Gemini is temporarily unavailable and Sahayak could not load Groq settings.',
    'Gemini Vision is unavailable right now. Please try again later.',
    'AI providers are unavailable right now. Please try again later.'
  ];

  function valueOf(object, key) {
    return object && typeof object[key] === 'string'
      ? object[key].toLowerCase()
      : '';
  }

  function getKind(error) {
    if (!error || typeof error !== 'object') return '';

    var code = valueOf(error, 'error') ||
      valueOf(error, 'code') ||
      valueOf(error, 'kind');
    var name = valueOf(error, 'name');
    var status = Number.isFinite(error.status) ? error.status : null;

    if (status === 429 || code === 'rate-limit' ||
        name === 'ratelimit' || name === 'ratelimiterror') {
      return 'rateLimit';
    }

    if (code === 'safety-blocked' || code === 'safety-block' ||
        code.indexOf('safety-blocked:') === 0 ||
        name === 'safetyblock' || name === 'safetyblockerror') {
      return 'safetyBlock';
    }

    if (code === 'invalid-json' || code === 'invalidjson' ||
        name === 'invalidjson' || name === 'invalidjsonerror') {
      return 'invalidJson';
    }

    if (code === 'network' || name === 'networkerror' || name === 'typeerror') {
      return 'network';
    }

    if (name === 'unavailableerror' || code === 'unavailable') {
      var message = valueOf(error, 'message');
      if (/rate.?limit|rate.?limiting/.test(message)) return 'rateLimit';
      return 'unavailable';
    }

    return '';
  }

  function safeFallbackMessage(fallback) {
    if (typeof fallback !== 'string') return '';
    var message = fallback.trim();
    if (!message || message.length > 260 || /[\r\n]/.test(message) ||
        /\b(?:Error|Exception|TypeError|RangeError|ReferenceError):/.test(message) ||
        /\bat\s+.+(?:\.js|\.ts|:\d+:\d+)/.test(message)) {
      return '';
    }
    return message;
  }

  function toUserMessage(error, fallback) {
    var kind = getKind(error);
    var safeFallback = safeFallbackMessage(fallback);
    if (kind === 'safetyBlock') {
      return safeFallback || MESSAGES.safetyBlock;
    }
    if (kind === 'unavailable' && safeFallback &&
        UNAVAILABLE_GUIDANCE.indexOf(safeFallback) !== -1) {
      return safeFallback;
    }
    if (kind && MESSAGES[kind]) return MESSAGES[kind];
    if (safeFallback) return safeFallback;
    return MESSAGES.generic;
  }

  var api = {
    MESSAGES: MESSAGES,
    getKind: getKind,
    toUserMessage: toUserMessage
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakErrors = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
