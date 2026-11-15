'use strict';

(function (global) {
  function resolveDependency(globalName, relativePath) {
    if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
      return require(relativePath);
    }
    return global[globalName];
  }

  function createProviderLayer(deps) {
    var d = deps || {};
    var retryModule = d.retry || resolveDependency('SahayakRetry', './retry.js');
    var gemini = d.gemini || resolveDependency('SahayakGemini', './gemini.js');
    var groq = d.groq || resolveDependency('SahayakGroq', './groq.js');
    var tiering = d.tiering || resolveDependency('SahayakTiering', './tiering.js');
    var eligibility = d.eligibility ||
      resolveDependency('SahayakEligibility', './eligibility.js');
    var missingProviderMessage =
      'AI providers are unavailable right now. Please try again later.';

    function unavailableResult(message) {
      return {
        ok: false,
        error: 'unavailable',
        message: message || missingProviderMessage
      };
    }

    function isUnavailableError(error) {
      return !!(error &&
        (error.name === 'UnavailableError' || error.code === 'unavailable'));
    }

    function loadGroqConfig() {
      if (typeof d.getGroqConfig === 'function') {
        return Promise.resolve().then(function () {
          return d.getGroqConfig();
        });
      }

      var storage = global.SahayakStorageManager;
      var apiKeys = global.SahayakApiKeys;
      if (!storage || !apiKeys ||
          typeof apiKeys.getGroqKey !== 'function' ||
          typeof storage.storageGet !== 'function' ||
          !storage.NAMESPACED ||
          !storage.NAMESPACED.GROQ_MODEL) {
        return Promise.reject(new Error('Groq settings are unavailable.'));
      }

      return Promise.all([
        apiKeys.getGroqKey(storage),
        storage.storageGet(storage.NAMESPACED.GROQ_MODEL)
      ]).then(function (values) {
        return {
          key: values[0],
          model: values[1] || storage.DEFAULT_GROQ_MODEL
        };
      });
    }

    function callGroqFallback(task, geminiError, emittedChunk) {
      if (!eligibility || typeof eligibility.isEligible !== 'function' ||
          !eligibility.isEligible(task) ||
          emittedChunk) {
        return unavailableResult(geminiError.message || missingProviderMessage);
      }
      if (typeof task.key !== 'string' || !task.key.trim()) {
        return unavailableResult(geminiError.message || missingProviderMessage);
      }
      if (!groq || typeof groq.call !== 'function') {
        return unavailableResult(
          'Gemini is temporarily unavailable and the Groq fallback is not available.'
        );
      }

      return loadGroqConfig().then(function (config) {
        var groqKey = config && typeof config.key === 'string'
          ? config.key.trim()
          : '';
        var groqModel = config && typeof config.model === 'string'
          ? config.model.trim()
          : '';
        if (!groqKey || !groqModel) {
          return unavailableResult(
            'Gemini is temporarily unavailable. Add a Groq API key in Settings to use text fallback.'
          );
        }

        var groqTask = {
          prompt: task.prompt,
          groqKey: groqKey,
          groqModel: groqModel
        };
        return retryModule.retry(function () {
          return groq.call(groqTask);
        }, {
          sleep: d.sleep,
          random: d.random,
          maxAttempts: d.maxAttempts
        }).catch(function (error) {
          if (isUnavailableError(error)) {
            return unavailableResult(error.message);
          }
          return {
            ok: false,
            error: 'network',
            message: 'Sahayak could not reach Groq. Check your connection and try again.'
          };
        });
      }, function () {
        return unavailableResult(
          'Gemini is temporarily unavailable and Sahayak could not load Groq settings.'
        );
      });
    }

    function callAI(task) {
      if (!task || typeof task !== 'object') {
        return Promise.resolve({
          ok: false,
          error: 'invalid-task',
          message: 'Sahayak could not prepare this AI request.'
        });
      }
      if (!retryModule || typeof retryModule.retry !== 'function' ||
          !gemini || typeof gemini.call !== 'function' ||
          !tiering || typeof tiering.selectTier !== 'function') {
        return Promise.resolve({
          ok: false,
          error: 'unavailable',
          message: missingProviderMessage
        });
      }

      var tier = tiering.selectTier(task);
      if (!tier || tier.ok !== true) {
        return Promise.resolve({
          ok: false,
          error: 'invalid-tier',
          message: (tier && tier.message) || tiering.INVALID_TIER_MESSAGE
        });
      }

      var emittedChunk = false;
      var lastGeminiOutcome = null;
      var request = Object.assign({}, task, { model: tier.model });
      if (typeof task.onChunk === 'function') {
        request.onChunk = function (chunk) {
          if (typeof chunk === 'string' && chunk.length > 0) emittedChunk = true;
          task.onChunk(chunk);
        };
      }

      return retryModule.retry(function () {
        return Promise.resolve()
          .then(function () {
            return gemini.call(request);
          })
          .then(function (result) {
            lastGeminiOutcome = result;
            return result;
          }, function (error) {
            lastGeminiOutcome = error;
            throw error;
          });
      }, {
        canRetry: function (failure) {
          return !emittedChunk && retryModule.isRetryable(failure);
        },
        sleep: d.sleep,
        random: d.random,
        maxAttempts: d.maxAttempts
      }).then(function (result) {
        return result;
      }).catch(function (error) {
        var exhaustedRetryableFailure =
          isUnavailableError(error) &&
          lastGeminiOutcome !== null &&
          retryModule.isRetryable(lastGeminiOutcome);
        if (exhaustedRetryableFailure && !emittedChunk) {
          return callGroqFallback(task, error, emittedChunk);
        }
        if (isUnavailableError(error)) {
          return unavailableResult(error.message);
        }
        return {
          ok: false,
          error: 'network',
          message: 'Sahayak could not reach Gemini. Check your connection and try again.'
        };
      });
    }

    return { callAI: callAI };
  }

  var layer = createProviderLayer();
  var api = {
    callAI: layer.callAI,
    createProviderLayer: createProviderLayer
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakProviders = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
