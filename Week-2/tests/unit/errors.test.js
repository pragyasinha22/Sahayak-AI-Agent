'use strict';

const assert = require('node:assert/strict');
const Errors = require('../../shared/errors.js');

const cases = [
  [
    { status: 429 },
    Errors.MESSAGES.rateLimit,
    'maps HTTP 429 to the rate-limit message'
  ],
  [
    { name: 'UnavailableError', code: 'unavailable' },
    Errors.MESSAGES.unavailable,
    'maps UnavailableError to the unavailable message'
  ],
  [
    { name: 'TypeError', message: 'raw transport details' },
    Errors.MESSAGES.network,
    'maps network exceptions without showing their raw message'
  ],
  [
    { name: 'InvalidJSONError' },
    Errors.MESSAGES.invalidJson,
    'maps InvalidJSONError to the invalid-response message'
  ],
  [
    { error: 'invalid-json' },
    Errors.MESSAGES.invalidJson,
    'maps invalid-json result envelopes'
  ],
];

let passed = 0;
for (const [failure, expected, description] of cases) {
  assert.equal(Errors.toUserMessage(failure), expected, description);
  passed += 1;
}

assert.equal(
  Errors.toUserMessage(
    { error: 'safety-blocked' },
    'Blocked by safety: no text was sent.'
  ),
  'Blocked by safety: no text was sent.',
  'preserves a feature-specific safety block message'
);
passed += 1;

assert.equal(
  Errors.toUserMessage(
    { error: 'unavailable' },
    'Gemini is temporarily unavailable. Add a Groq API key in Settings to use text fallback.'
  ),
  'Gemini is temporarily unavailable. Add a Groq API key in Settings to use text fallback.',
  'preserves actionable Groq configuration guidance'
);
passed += 1;

assert.equal(
  Errors.toUserMessage(null, ''),
  Errors.MESSAGES.generic,
  'uses a safe generic message when the failure and fallback are empty'
);
passed += 1;

assert.equal(
  Errors.toUserMessage(
    { error: 'unknown' },
    'Error: private transport details\n    at private.js:1:1'
  ),
  Errors.MESSAGES.generic,
  'rejects stack traces supplied as fallback text'
);
passed += 1;

const rawException = new Error('private transport details');
rawException.stack = 'Error: private transport details\n    at private.js:1:1';
assert.equal(
  Errors.toUserMessage(rawException),
  Errors.MESSAGES.generic,
  'never displays raw exception messages or stack traces'
);
passed += 1;

assert.equal(
  Errors.getKind({ error: 'malformed' }),
  '',
  'does not classify a normal summary-format refusal as InvalidJSON'
);
passed += 1;

console.log(passed + ' passed, 0 failed');
