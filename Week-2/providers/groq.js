'use strict';

(function (global) {
  var GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  var TEXT_ONLY_MESSAGE = 'Groq accepts text-only tasks; image requests must use Gemini Vision.';

  function createGroqProvider(deps) {
    var d = deps || {};
    var fetchImpl = d.fetchImpl ||
      (typeof global.fetch === 'function' ? global.fetch.bind(global) : null);
    var endpoint = d.endpoint || GROQ_ENDPOINT;

    function call(task) {
      var request = task || {};
      if (Object.prototype.hasOwnProperty.call(request, 'image') ||
          request.requiresVision === true) {
        return Promise.resolve({
          ok: false,
          error: 'unsupported-modality',
          message: TEXT_ONLY_MESSAGE
        });
      }

      var key = typeof request.groqKey === 'string' ? request.groqKey.trim() : '';
      var model = typeof request.groqModel === 'string' ? request.groqModel.trim() : '';
      var prompt = typeof request.prompt === 'string' ? request.prompt : '';
      if (!key || !model || !prompt) {
        return Promise.resolve({
          ok: false,
          error: 'unavailable',
          message: 'Groq is not configured for this task.'
        });
      }
      if (!fetchImpl) {
        return Promise.resolve({
          ok: false,
          error: 'network',
          message: 'Sahayak could not reach Groq. Check your connection and try again.'
        });
      }

      return Promise.resolve()
        .then(function () {
          return fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + key
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: 'user', content: prompt }]
            })
          });
        })
        .then(function (response) {
          if (!response || typeof response.status !== 'number') {
            return { ok: false, error: 'network', message: 'Sahayak could not reach Groq.' };
          }
          if (response.status === 401 || response.status === 403) {
            return { ok: false, error: 'auth', message: 'Groq rejected its configured API key.' };
          }
          if (response.status === 429) {
            return { ok: false, error: 'rate-limit', status: 429, message: 'Groq is rate-limited.' };
          }
          if (response.ok === false) {
            return {
              ok: false,
              error: 'http',
              status: response.status,
              message: 'Groq returned HTTP ' + response.status + '.'
            };
          }
          if (typeof response.json !== 'function') {
            return { ok: false, error: 'http', message: 'Groq returned an invalid response.' };
          }
          return response.json().then(function (body) {
            var choices = body && Array.isArray(body.choices) ? body.choices : [];
            var text = choices[0] && choices[0].message &&
              typeof choices[0].message.content === 'string'
              ? choices[0].message.content.trim()
              : '';
            return text
              ? { ok: true, text: text }
              : { ok: false, error: 'empty', message: 'Groq returned no usable response.' };
          });
        })
        .catch(function () {
          return {
            ok: false,
            error: 'network',
            message: 'Sahayak could not reach Groq. Check your connection and try again.'
          };
        });
    }

    return { call: call };
  }

  var provider = createGroqProvider();
  var api = {
    call: provider.call,
    createGroqProvider: createGroqProvider,
    TEXT_ONLY_MESSAGE: TEXT_ONLY_MESSAGE
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakGroq = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
