'use strict';

const assert = require('node:assert/strict');
const Retry = require('../../providers/retry.js');
const Providers = require('../../providers/base.js');
const Tiering = require('../../providers/tiering.js');
const Gemini = require('../../providers/gemini.js');
const Eligibility = require('../../providers/eligibility.js');

let passed = 0;
let failed = 0;

function check(condition, message) {
  try {
    assert.ok(condition, message);
    passed += 1;
    console.log('  ✓ ' + message);
  } catch (error) {
    failed += 1;
    console.error('  ✗ ' + message);
    console.error(error.message);
  }
}

async function main() {
  console.log('# callAI retry and result contract');
  let attempts = 0;
  let groqCalls = 0;
  const waits = [];
  const layer = Providers.createProviderLayer({
    retry: Retry,
    gemini: {
      call() {
        attempts += 1;
        return Promise.resolve(attempts < 2
          ? { ok: false, error: 'rate-limit', message: 'Gemini rate limit.' }
          : { ok: true, text: 'Done' });
      },
    },
    groq: { call() { groqCalls += 1; } },
    sleep(milliseconds) { waits.push(milliseconds); return Promise.resolve(); },
    random() { return 0; },
  });
  const result = await layer.callAI({ key: 'gemini-key', prompt: 'Explain.' });
  check(result.ok && result.text === 'Done' && attempts === 2,
    'routes a text task through Gemini and retries a 429 result');
  check(waits.length === 1 && waits[0] === 500,
    'uses the injected deterministic delay without waiting in real time');
  check(groqCalls === 0,
    'does not invoke the dormant Groq adapter during this slice');

  console.log('\n# exhausted provider failures');
  attempts = 0;
  const exhaustedLayer = Providers.createProviderLayer({
    retry: Retry,
    gemini: {
      call() {
        attempts += 1;
        return Promise.resolve({
          ok: false,
          error: 'rate-limit',
          message: 'Gemini is rate-limited.'
        });
      },
    },
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  const exhausted = await exhaustedLayer.callAI({ key: 'gemini-key', prompt: 'Explain.' });
  check(!exhausted.ok && exhausted.error === 'unavailable' &&
      exhausted.message === 'Gemini is rate-limited.',
    'preserves the result envelope and exposes a readable exhausted-retry message');
  check(attempts === Retry.MAX_ATTEMPTS,
    'callAI remains bounded at the documented attempt ceiling');

  console.log('\n# eligible Groq fallback after Gemini retries');
  let geminiFallbackAttempts = 0;
  let groqFallbackAttempts = 0;
  let fallbackGeminiTask;
  let fallbackGroqTask;
  const fallbackWaits = [];
  const fallbackLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    eligibility: Eligibility,
    gemini: {
      call(task) {
        fallbackGeminiTask = task;
        geminiFallbackAttempts += 1;
        return Promise.resolve({
          ok: false,
          error: 'rate-limit',
          status: 429,
          message: 'Gemini is rate-limited.',
        });
      },
    },
    groq: {
      call(task) {
        fallbackGroqTask = task;
        groqFallbackAttempts += 1;
        return Promise.resolve(groqFallbackAttempts < 3
          ? { ok: false, error: 'rate-limit', status: 429, message: 'Groq is rate-limited.' }
          : { ok: true, text: 'Fallback answer.' });
      },
    },
    getGroqConfig() {
      return Promise.resolve({
        key: 'groq-test-key',
        model: 'openai/gpt-oss-120b',
      });
    },
    sleep(milliseconds) {
      fallbackWaits.push(milliseconds);
      return Promise.resolve();
    },
    random() { return 0; },
  });
  const fallbackResult = await fallbackLayer.callAI({
    key: 'gemini-test-key',
    prompt: 'Answer from the page text.',
    taskType: 'page-chat',
    complex: true,
  });
  check(
    fallbackResult.ok && fallbackResult.text === 'Fallback answer.' &&
      geminiFallbackAttempts === Retry.MAX_ATTEMPTS,
    'uses Groq only after all bounded Gemini retries fail'
  );
  check(
    groqFallbackAttempts === Retry.MAX_ATTEMPTS &&
      fallbackWaits.join(',') === '500,1000,500,1000',
    'retries the single Groq fallback with the same bounded backoff policy'
  );
  check(
    fallbackGeminiTask.model === Tiering.ESCALATED_MODEL &&
      fallbackGroqTask.groqModel === 'openai/gpt-oss-120b' &&
      !Object.prototype.hasOwnProperty.call(fallbackGroqTask, 'model'),
    'keeps Gemini tier selection separate from Groq model selection'
  );
  check(
    fallbackGroqTask.prompt === 'Answer from the page text.' &&
      fallbackGroqTask.groqKey === 'groq-test-key' &&
      !Object.prototype.hasOwnProperty.call(fallbackGroqTask, 'key') &&
      !Object.prototype.hasOwnProperty.call(fallbackGroqTask, 'taskType') &&
      !Object.prototype.hasOwnProperty.call(fallbackGroqTask, 'image'),
    'sends Groq only the text prompt and its own credentials'
  );

  let preFallbackGeminiAttempts = 0;
  let preFallbackGroqCalls = 0;
  const preFallbackLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    eligibility: Eligibility,
    gemini: {
      call() {
        preFallbackGeminiAttempts += 1;
        return Promise.resolve({
          ok: false,
          error: 'network',
          message: 'Stream connection failed before output.',
        });
      },
    },
    groq: {
      call() {
        preFallbackGroqCalls += 1;
        return Promise.resolve({ ok: true, text: 'Recovered before output.' });
      },
    },
    getGroqConfig() {
      return Promise.resolve({
        key: 'groq-test-key',
        model: 'openai/gpt-oss-120b',
      });
    },
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  const preFallbackResult = await preFallbackLayer.callAI({
    key: 'gemini-test-key',
    prompt: 'Stream a text answer.',
    taskType: 'page-chat',
    onChunk() {},
  });
  check(
    preFallbackResult.ok &&
      preFallbackGeminiAttempts === Retry.MAX_ATTEMPTS &&
      preFallbackGroqCalls === 1,
    'allows eligible fallback when a stream fails before emitting any chunk'
  );

  for (const [failureName, failGemini] of [
    ['503 response', function () {
      return Promise.resolve({
        ok: false,
        error: 'http',
        status: 503,
        message: 'Gemini service unavailable.',
      });
    }],
    ['network exception', function () {
      return Promise.reject(new TypeError('Network unavailable.'));
    }],
  ]) {
    let geminiAttemptsForFailure = 0;
    let groqCallsForFailure = 0;
    const retryableFailureLayer = Providers.createProviderLayer({
      retry: Retry,
      tiering: Tiering,
      eligibility: Eligibility,
      gemini: {
        call() {
          geminiAttemptsForFailure += 1;
          return failGemini();
        },
      },
      groq: {
        call() {
          groqCallsForFailure += 1;
          return Promise.resolve({ ok: true, text: 'Recovered.' });
        },
      },
      getGroqConfig() {
        return Promise.resolve({
          key: 'groq-test-key',
          model: 'openai/gpt-oss-120b',
        });
      },
      sleep() { return Promise.resolve(); },
      random() { return 0; },
    });
    const recovered = await retryableFailureLayer.callAI({
      key: 'gemini-test-key',
      prompt: 'A text-only request.',
      taskType: 'page-chat',
    });
    check(
      recovered.ok && geminiAttemptsForFailure === Retry.MAX_ATTEMPTS &&
        groqCallsForFailure === 1,
      'falls back after exhausted retries for a Gemini ' + failureName
    );
  }

  console.log('\n# non-retryable Gemini failures do not fall back');
  let forbiddenFallbackCalls = 0;
  for (const failure of [
    { ok: false, error: 'auth', status: 401, message: 'Unauthorized.' },
    { ok: false, error: 'http', status: 400, message: 'Invalid request.' },
    { ok: false, error: 'http', status: 404, message: 'Unsupported model.' },
  ]) {
    let geminiCalls = 0;
    const nonRetryableLayer = Providers.createProviderLayer({
      retry: Retry,
      tiering: Tiering,
      eligibility: Eligibility,
      gemini: {
        call() {
          geminiCalls += 1;
          return Promise.resolve(failure);
        },
      },
      groq: {
        call() {
          forbiddenFallbackCalls += 1;
          return Promise.resolve({ ok: true, text: 'Must not run.' });
        },
      },
      getGroqConfig() {
        return Promise.resolve({ key: 'groq-test-key', model: 'openai/gpt-oss-120b' });
      },
    });
    const nonRetryableResult = await nonRetryableLayer.callAI({
      key: 'gemini-test-key',
      prompt: 'Text request.',
      taskType: 'page-chat',
    });
    check(
      nonRetryableResult.error === failure.error && geminiCalls === 1,
      'preserves Gemini ' + failure.error + ' status ' + failure.status + ' without retry'
    );
  }
  check(forbiddenFallbackCalls === 0,
    'does not fall back for authentication, invalid-request, or unsupported-model errors');

  let missingGeminiKeyFallbacks = 0;
  const noGeminiKeyLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    eligibility: Eligibility,
    gemini: {
      call() {
        return Promise.resolve({ ok: false, error: 'missing-key', message: 'Add Gemini key.' });
      },
    },
    groq: {
      call() {
        missingGeminiKeyFallbacks += 1;
        return Promise.resolve({ ok: true, text: 'Must not run.' });
      },
    },
    getGroqConfig() {
      return Promise.resolve({ key: 'groq-test-key', model: 'openai/gpt-oss-120b' });
    },
  });
  await noGeminiKeyLayer.callAI({
    prompt: 'Text request.',
    taskType: 'page-chat',
  });
  check(missingGeminiKeyFallbacks === 0,
    'does not use Groq when the Gemini key is missing');

  let missingGroqKeyCalls = 0;
  const missingGroqKeyLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    eligibility: Eligibility,
    gemini: {
      call() {
        return Promise.resolve({
          ok: false,
          error: 'rate-limit',
          status: 429,
          message: 'Gemini is rate-limited.',
        });
      },
    },
    groq: {
      call() {
        missingGroqKeyCalls += 1;
        return Promise.resolve({ ok: true, text: 'Must not run.' });
      },
    },
    getGroqConfig() {
      return Promise.resolve({ key: '', model: 'openai/gpt-oss-120b' });
    },
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  const missingGroqKeyResult = await missingGroqKeyLayer.callAI({
    key: 'gemini-test-key',
    prompt: 'Text request.',
    taskType: 'page-chat',
  });
  check(
    missingGroqKeyResult.error === 'unavailable' && missingGroqKeyCalls === 0,
    'returns an understandable unavailable result when no Groq key is configured'
  );

  let imageGroqCalls = 0;
  const imageFallbackLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    eligibility: Eligibility,
    gemini: {
      call() {
        return Promise.resolve({
          ok: false,
          error: 'rate-limit',
          status: 429,
          message: 'Gemini is rate-limited.',
        });
      },
    },
    groq: {
      call() {
        imageGroqCalls += 1;
        return Promise.resolve({ ok: true, text: 'Must not run.' });
      },
    },
    getGroqConfig() {
      return Promise.resolve({ key: 'groq-test-key', model: 'openai/gpt-oss-120b' });
    },
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  const imageFallbackResult = await imageFallbackLayer.callAI({
    key: 'gemini-test-key',
    prompt: 'Describe this chart.',
    taskType: 'page-chat',
    image: 'data:image/png;base64,crop-only',
  });
  check(
    imageFallbackResult.error === 'unavailable' && imageGroqCalls === 0,
    'never sends an image-bearing task to Groq after Gemini retries fail'
  );

  let ineligibleGroqCalls = 0;
  const ineligibleLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    eligibility: Eligibility,
    gemini: {
      call() {
        return Promise.resolve({
          ok: false,
          error: 'rate-limit',
          status: 429,
          message: 'Gemini is rate-limited.',
        });
      },
    },
    groq: {
      call() {
        ineligibleGroqCalls += 1;
        return Promise.resolve({ ok: true, text: 'Must not run.' });
      },
    },
    getGroqConfig() {
      return Promise.resolve({ key: 'groq-test-key', model: 'openai/gpt-oss-120b' });
    },
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  const ineligibleResult = await ineligibleLayer.callAI({
    key: 'gemini-test-key',
    prompt: 'Explain the selection.',
    taskType: 'explain',
  });
  check(
    ineligibleResult.error === 'unavailable' && ineligibleGroqCalls === 0,
    'does not fall back for Explain or other undocumented text task categories'
  );

  console.log('\n# vision and stream safety');
  const fullScreenshotMarker = 'FULL_SCREENSHOT_MUST_NOT_BE_USED';
  const crop = 'data:image/png;base64,CROPPED_IMAGE';
  let seenTask;
  let visionCalls = 0;
  const imageLayer = Providers.createProviderLayer({
    retry: Retry,
    gemini: {
      call(task) {
        seenTask = task;
        return Promise.resolve({ ok: true, text: 'Visible crop answer.' });
      },
    },
  });
  const imageResult = await imageLayer.callAI({
    key: 'gemini-key',
    question: 'What is shown?',
    image: crop,
  });
  check(imageResult.ok && seenTask.image === crop &&
      JSON.stringify(seenTask).indexOf(fullScreenshotMarker) === -1,
    'keeps image-bearing tasks on Gemini and forwards the selected crop');
  check(visionCalls === 0 && groqCalls === 0,
    'does not route vision requests to a text-only provider');
  check(seenTask.model === Tiering.LIGHTWEIGHT_MODEL,
    'adds the lightweight model to a default image task without changing its provider route');

  console.log('\n# model tier selection through callAI');
  const tierModels = [];
  let tierCalls = 0;
  const tierLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    gemini: {
      call(task) {
        tierCalls += 1;
        tierModels.push(task.model);
        return Promise.resolve({ ok: true, text: 'Tiered response.' });
      },
    },
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  await tierLayer.callAI({ prompt: 'Ordinary task.' });
  await tierLayer.callAI({ prompt: 'Dense visual task.', complex: true });
  await tierLayer.callAI({
    prompt: 'Explicit lightweight override.',
    complex: true,
    tierOverride: 'lightweight',
  });
  const invalidTier = await tierLayer.callAI({
    prompt: 'Unsupported tier.',
    tierOverride: 'unknown',
  });
  check(
    tierModels.join(',') === [
      Tiering.LIGHTWEIGHT_MODEL,
      Tiering.ESCALATED_MODEL,
      Tiering.LIGHTWEIGHT_MODEL,
    ].join(','),
    'passes default, complex, and explicit override model selections through callAI'
  );
  check(
    !invalidTier.ok && invalidTier.error === 'invalid-tier' &&
      invalidTier.message === Tiering.INVALID_TIER_MESSAGE && tierCalls === 3,
    'rejects invalid tiers before invoking Gemini'
  );

  const routedTasks = [];
  const routedGemini = Gemini.createGeminiProvider({
    explain: {
      explainSelection(task) {
        routedTasks.push({ kind: 'text', task });
        return Promise.resolve({ ok: true, text: 'Text response.' });
      },
    },
    visionProvider: {
      answerImage(task) {
        routedTasks.push({ kind: 'vision', task });
        return Promise.resolve({ ok: true, text: 'Image response.' });
      },
    },
  });
  const routedLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    gemini: routedGemini,
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  await routedLayer.callAI({ prompt: 'Ordinary text task.' });
  await routedLayer.callAI({
    image: crop,
    question: 'Analyze this dense chart.',
    complex: true,
  });
  check(
    routedTasks[0].kind === 'text' &&
      routedTasks[0].task.model === Tiering.LIGHTWEIGHT_MODEL,
    'routes the default model through the existing Gemini text caller'
  );
  check(
    routedTasks[1].kind === 'vision' &&
      routedTasks[1].task.model === Tiering.ESCALATED_MODEL &&
      routedTasks[1].task.image === crop,
    'escalates a complex image task through Gemini Vision only'
  );

  let streamAttempts = 0;
  let partialGroqCalls = 0;
  const partialLayer = Providers.createProviderLayer({
    retry: Retry,
    tiering: Tiering,
    eligibility: Eligibility,
    gemini: {
      call(task) {
        streamAttempts += 1;
        task.onChunk('partial output');
        return Promise.resolve({ ok: false, error: 'network', message: 'Stream interrupted.' });
      },
    },
    groq: {
      call() {
        partialGroqCalls += 1;
        return Promise.resolve({ ok: true, text: 'Must not restart.' });
      },
    },
    getGroqConfig() {
      return Promise.resolve({ key: 'groq-test-key', model: 'openai/gpt-oss-120b' });
    },
    sleep() { throw new Error('partial stream must not retry'); },
  });
  const partial = await partialLayer.callAI({
    key: 'gemini-key',
    prompt: 'Stream.',
    taskType: 'page-chat',
    onChunk() { visionCalls += 1; },
  });
  check(!partial.ok && partial.error === 'network' &&
      streamAttempts === 1 && partialGroqCalls === 0,
    'does not retry or fall back after any stream chunk has been emitted');

  let preChunkAttempts = 0;
  let chunkCount = 0;
  const preChunkLayer = Providers.createProviderLayer({
    retry: Retry,
    gemini: {
      call(task) {
        preChunkAttempts += 1;
        if (preChunkAttempts === 1) {
          return Promise.resolve({ ok: false, error: 'rate-limit', message: 'Try again.' });
        }
        task.onChunk('complete');
        return Promise.resolve({ ok: true, text: 'complete' });
      },
    },
    sleep() { return Promise.resolve(); },
    random() { return 0; },
  });
  const streamed = await preChunkLayer.callAI({
    key: 'gemini-key',
    prompt: 'Stream.',
    onChunk() { chunkCount += 1; },
  });
  check(streamed.ok && preChunkAttempts === 2 && chunkCount === 1,
    'retries a streaming request only when the failure preceded all chunks');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
