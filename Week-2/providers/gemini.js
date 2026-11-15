'use strict';

(function (global) {
  function resolveExplain() {
    if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
      return require('../panel/features/explain.js');
    }
    return global.SahayakExplain;
  }

  function resolveVision() {
    if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
      return require('./gemini-vision.js');
    }
    return global.SahayakGeminiVision;
  }

  function createGeminiProvider(deps) {
    var d = deps || {};

    function call(task) {
      var request = task || {};
      var hasImage = Object.prototype.hasOwnProperty.call(request, 'image');
      if (hasImage) {
        var vision = d.visionProvider || resolveVision();
        if (!vision || typeof vision.answerImage !== 'function') {
          return Promise.resolve({
            ok: false,
            error: 'unavailable',
            message: 'Gemini Vision is unavailable right now. Please try again later.'
          });
        }
        return vision.answerImage(request);
      }

      var explain = d.explain || resolveExplain();
      if (!explain) {
        return Promise.resolve({
          ok: false,
          error: 'unavailable',
          message: 'Gemini is unavailable right now. Please try again later.'
        });
      }
      if (typeof request.onChunk === 'function') {
        if (typeof explain.streamExplainSelection !== 'function') {
          return Promise.resolve({
            ok: false,
            error: 'unavailable',
            message: 'Gemini streaming is unavailable right now. Please try again later.'
          });
        }
        return explain.streamExplainSelection(request);
      }
      if (typeof explain.explainSelection !== 'function') {
        return Promise.resolve({
          ok: false,
          error: 'unavailable',
          message: 'Gemini is unavailable right now. Please try again later.'
        });
      }
      return explain.explainSelection(Object.assign({}, request, {
        disableRetries: true
      }));
    }

    return { call: call };
  }

  var provider = createGeminiProvider();
  var api = {
    call: provider.call,
    createGeminiProvider: createGeminiProvider
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakGemini = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
