'use strict';

(function (global) {
  var LIGHTWEIGHT_TIER = 'lightweight';
  var ESCALATED_TIER = 'escalated';
  var DEFAULT_TIER = LIGHTWEIGHT_TIER;
  var LIGHTWEIGHT_MODEL = 'gemini-3.5-flash-lite';
  var ESCALATED_MODEL = 'gemini-3.8-flash';
  var INVALID_TIER_MESSAGE =
    'Sahayak received an unsupported model tier. Use lightweight or escalated.';

  function modelForTier(tier) {
    if (tier === LIGHTWEIGHT_TIER) return LIGHTWEIGHT_MODEL;
    if (tier === ESCALATED_TIER) return ESCALATED_MODEL;
    return null;
  }

  function selectTier(task) {
    var request = task && typeof task === 'object' ? task : {};
    var hasOverride = Object.prototype.hasOwnProperty.call(request, 'tierOverride');

    if (hasOverride) {
      var overrideModel = modelForTier(request.tierOverride);
      if (!overrideModel) {
        return {
          ok: false,
          error: 'invalid-tier',
          message: INVALID_TIER_MESSAGE
        };
      }
      return {
        ok: true,
        tier: request.tierOverride,
        model: overrideModel
      };
    }

    var validationEscalation =
      request.requiresStructuredJson === true &&
      request.structuredJsonValidationFailed === true;
    var tier = request.complex === true || validationEscalation
      ? ESCALATED_TIER
      : DEFAULT_TIER;

    return {
      ok: true,
      tier: tier,
      model: modelForTier(tier)
    };
  }

  var api = {
    LIGHTWEIGHT_TIER: LIGHTWEIGHT_TIER,
    ESCALATED_TIER: ESCALATED_TIER,
    DEFAULT_TIER: DEFAULT_TIER,
    LIGHTWEIGHT_MODEL: LIGHTWEIGHT_MODEL,
    ESCALATED_MODEL: ESCALATED_MODEL,
    INVALID_TIER_MESSAGE: INVALID_TIER_MESSAGE,
    selectTier: selectTier
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakTiering = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
