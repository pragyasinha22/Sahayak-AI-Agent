'use strict';

(function (global) {
  var GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  var GEMINI_MODEL = 'gemini-3.5-flash-lite';
  var MISSING_IMAGE_MESSAGE =
    'Capture the visible tab and apply a crop before asking a question.';
  var INVALID_IMAGE_MESSAGE =
    'Sahayak could not read the selected crop. Please capture and crop the image again.';
  var INVALID_QUESTION_MESSAGE = 'Enter a question about the selected crop.';
  var MISSING_KEY_MESSAGE =
    'Sahayak needs a Gemini API key to answer questions about images. Add it in Settings.';
  var AUTH_MESSAGE =
    'Gemini rejected your API key. Please check it in Settings.';
  var RATE_MESSAGE = 'Gemini is rate-limited right now. Please try again in a moment.';
  var NETWORK_MESSAGE = 'Sahayak could not reach Gemini. Check your connection and try again.';
  var EMPTY_RESULT_MESSAGE =
    'Gemini could not provide an answer from this crop. Try a clearer or more focused crop.';

  function resolvePromptModule() {
    if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
      return require('../panel/prompts/screenshot-qa.js');
    }
    return global.SahayakScreenshotQAPrompt;
  }

  function parseImageDataUrl(image) {
    if (typeof image !== 'string') return null;
    var match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
    if (!match || match[2].length % 4 === 1) return null;
    return { mimeType: 'image/' + match[1].toLowerCase(), data: match[2] };
  }

  function parseGeminiResponse(data) {
    var candidates = data && Array.isArray(data.candidates) ? data.candidates : [];
    var parts = candidates[0] && candidates[0].content &&
      Array.isArray(candidates[0].content.parts) ? candidates[0].content.parts : [];
    var text = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && typeof parts[i].text === 'string') text += parts[i].text;
    }
    return text.trim();
  }

  function answerImage(opts) {
    var o = opts || {};
    var key = typeof o.key === 'string' ? o.key.trim() : '';
    var question = typeof o.question === 'string' ? o.question.trim() : '';
    var model = typeof o.model === 'string' && o.model
      ? o.model
      : GEMINI_MODEL;
    var image = parseImageDataUrl(o.image);
    var fetchImpl = o.fetchImpl ||
      (typeof global.fetch === 'function' ? global.fetch.bind(global) : null);
    var prompts = o.prompts || resolvePromptModule();

    if (typeof o.image !== 'string' || !o.image) {
      return Promise.resolve({ ok: false, error: 'missing-image', message: MISSING_IMAGE_MESSAGE });
    }
    if (!image) {
      return Promise.resolve({ ok: false, error: 'invalid-image', message: INVALID_IMAGE_MESSAGE });
    }
    if (!question) {
      return Promise.resolve({ ok: false, error: 'invalid-question', message: INVALID_QUESTION_MESSAGE });
    }
    if (!key) {
      return Promise.resolve({ ok: false, error: 'missing-key', message: MISSING_KEY_MESSAGE });
    }
    if (!fetchImpl) {
      return Promise.resolve({ ok: false, error: 'no-network', message: NETWORK_MESSAGE });
    }
    if (!prompts || typeof prompts.buildScreenshotQAPrompt !== 'function') {
      return Promise.resolve({ ok: false, error: 'prompt-unavailable', message: NETWORK_MESSAGE });
    }

    var body;
    try {
      body = JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompts.buildScreenshotQAPrompt(question) },
            { inline_data: { mime_type: image.mimeType, data: image.data } }
          ]
        }]
      });
    } catch (_) {
      return Promise.resolve({ ok: false, error: 'encode', message: NETWORK_MESSAGE });
    }

    return Promise.resolve()
      .then(function () {
        return fetchImpl(GEMINI_ENDPOINT_BASE + '/' + model + ':generateContent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: body
        });
      })
      .then(function (response) {
        if (!response || typeof response.status !== 'number') throw new Error('bad-response');
        if (response.status === 401 || response.status === 403) {
          var authError = new Error('auth');
          authError.kind = 'auth';
          throw authError;
        }
        if (response.status === 429) {
          var rateError = new Error('rate-limit');
          rateError.kind = 'rate-limit';
          throw rateError;
        }
        if (response.ok === false || typeof response.json !== 'function') {
          var responseError = new Error('http');
          responseError.kind = 'http';
          responseError.status = response.status;
          throw responseError;
        }
        return response.json();
      })
      .then(function (data) {
        var text = parseGeminiResponse(data);
        return text
          ? { ok: true, text: text }
          : { ok: false, error: 'empty', message: EMPTY_RESULT_MESSAGE };
      })
      .catch(function (error) {
        var kind = error && error.kind;
        if (kind === 'auth') return { ok: false, error: 'auth', message: AUTH_MESSAGE };
        if (kind === 'rate-limit') return { ok: false, error: 'rate-limit', message: RATE_MESSAGE };
        if (kind === 'http') {
          return {
            ok: false,
            error: 'http',
            status: error.status,
            message: 'Gemini returned HTTP ' + error.status + '. Please try again later.'
          };
        }
        return { ok: false, error: 'network', message: NETWORK_MESSAGE };
      });
  }

  var api = {
    answerImage: answerImage,
    parseGeminiResponse: parseGeminiResponse,
    parseImageDataUrl: parseImageDataUrl,
    MISSING_IMAGE_MESSAGE: MISSING_IMAGE_MESSAGE,
    INVALID_IMAGE_MESSAGE: INVALID_IMAGE_MESSAGE,
    INVALID_QUESTION_MESSAGE: INVALID_QUESTION_MESSAGE,
    MISSING_KEY_MESSAGE: MISSING_KEY_MESSAGE,
    AUTH_MESSAGE: AUTH_MESSAGE,
    RATE_MESSAGE: RATE_MESSAGE,
    NETWORK_MESSAGE: NETWORK_MESSAGE,
    EMPTY_RESULT_MESSAGE: EMPTY_RESULT_MESSAGE
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakGeminiVision = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
