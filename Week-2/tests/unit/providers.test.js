'use strict';

const assert = require('node:assert/strict');
const Gemini = require('../../providers/gemini.js');
const Groq = require('../../providers/groq.js');

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
  console.log('# Gemini provider dispatch');
  const calls = [];
  const provider = Gemini.createGeminiProvider({
    explain: {
      explainSelection(task) {
        calls.push({ kind: 'text', task });
        return Promise.resolve({ ok: true, text: 'text result' });
      },
      streamExplainSelection(task) {
        calls.push({ kind: 'stream', task });
        return Promise.resolve({ ok: true, text: 'stream result' });
      },
    },
    visionProvider: {
      answerImage(task) {
        calls.push({ kind: 'vision', task });
        return Promise.resolve({ ok: true, text: 'vision result' });
      },
    },
  });
  await provider.call({ key: 'k', prompt: 'plain text' });
  await provider.call({ key: 'k', prompt: 'stream text', onChunk() {} });
  await provider.call({
    key: 'k',
    image: 'crop',
    question: 'What is shown?',
    model: 'gemini-3.8-flash',
  });
  check(calls.map((call) => call.kind).join(',') === 'text,stream,vision',
    'dispatches text, streaming, and image tasks to their Gemini paths');
  check(calls[0].task.disableRetries === true,
    'disables legacy nested retries so the shared retry layer owns the attempt limit');
  check(calls[2].task.model === 'gemini-3.8-flash',
    'passes the selected model through the Gemini Vision route');

  console.log('\n# Groq text-only client');
  let fetchCalls = 0;
  const groq = Groq.createGroqProvider({
    endpoint: 'https://groq.test/chat/completions',
    fetchImpl(url, options) {
      fetchCalls += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json() {
          return Promise.resolve({
            choices: [{ message: { content: 'Groq text response' } }],
          });
        },
      });
    },
  });
  const rejectedImage = await groq.call({
    key: 'k',
    groqKey: 'k',
    groqModel: 'test-model',
    prompt: 'Do not use the image.',
    image: 'cropped image',
  });
  check(rejectedImage.error === 'unsupported-modality' && fetchCalls === 0,
    'rejects image-bearing requests before any Groq network call');
  const rejectedVision = await groq.call({
    groqKey: 'k',
    groqModel: 'test-model',
    prompt: 'Analyze visual content.',
    requiresVision: true,
  });
  check(rejectedVision.error === 'unsupported-modality' && fetchCalls === 0,
    'rejects explicitly vision-required tasks before any Groq network call');
  const groqText = await groq.call({
    groqKey: 'groq-key',
    groqModel: 'test-model',
    prompt: 'Text only.',
  });
  check(groqText.ok && groqText.text === 'Groq text response' && fetchCalls === 1,
    'supports an explicitly invoked text-only provider adapter');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
