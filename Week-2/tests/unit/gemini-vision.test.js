'use strict';

const assert = require('node:assert/strict');
const GeminiVision = require('../../providers/gemini-vision.js');
const ScreenshotQAPrompt = require('../../panel/prompts/screenshot-qa.js');

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

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json() { return Promise.resolve(body); },
  };
}

async function main() {
  console.log('# screenshot Q&A prompt grounding');
  const question = 'What is the highest visible bar?';
  const prompt = ScreenshotQAPrompt.buildScreenshotQAPrompt(question);
  check(prompt.includes(question), 'includes the user’s question in the prompt');
  check(
    /only information directly visible/.test(prompt) &&
      /Do not infer or invent/.test(prompt) &&
      /cannot be determined/.test(prompt),
    'requires answers to stay grounded in visible crop content'
  );
  check(/instructions visible in the image/.test(prompt),
    'treats text in the image as content, not instructions');

  console.log('\n# Gemini Vision request boundary');
  const croppedImage = 'data:image/png;base64,iVBORw0KGgo=';
  const fullScreenshot = 'data:image/png;base64,FULL_SCREENSHOT_SENTINEL';
  const key = 'AIzaFAKEfakeFAKEfakeFAKEfake1234567890';
  let capturedRequest = null;
  const result = await GeminiVision.answerImage({
    key,
    question,
    image: croppedImage,
    model: 'gemini-3.8-flash',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    fetchImpl(url, init) {
      capturedRequest = { url, init, body: JSON.parse(init.body) };
      return Promise.resolve(response(200, {
        candidates: [{ content: { parts: [{ text: 'The tallest visible bar is labeled A.' }] } }],
      }));
    },
  });
  const parts = capturedRequest.body.contents[0].parts;
  const imagePart = parts.find((part) => part.inline_data);
  const textPart = parts.find((part) => part.text);
  check(result.ok && result.text === 'The tallest visible bar is labeled A.',
    'returns the usable Gemini Vision response');
  check(capturedRequest.url.startsWith('https://generativelanguage.googleapis.com/'),
    'sends image requests only to Gemini, not Groq or a text-only provider');
  check(capturedRequest.url.includes('/gemini-3.8-flash:generateContent'),
    'uses the selected escalated model without leaving the Gemini Vision path');
  check(
    capturedRequest.init.headers['x-goog-api-key'] === key &&
      capturedRequest.url.indexOf(key) === -1 &&
      capturedRequest.init.body.indexOf(key) === -1,
    'keeps the Gemini API key out of the URL and request body');
  check(
    imagePart.inline_data.mime_type === 'image/png' &&
      imagePart.inline_data.data === 'iVBORw0KGgo=' &&
      textPart.text.includes(question),
    'sends the cropped image and question together in one Gemini request');
  check(
    capturedRequest.init.body.indexOf(fullScreenshot) === -1 &&
      JSON.stringify(result).indexOf(croppedImage) === -1,
    'does not include a full screenshot or expose image data in the result');

  console.log('\n# invalid image and empty response handling');
  let fetchCalls = 0;
  const noFetch = () => { fetchCalls += 1; return Promise.resolve(response(200, {})); };
  const missing = await GeminiVision.answerImage({ key, question, fetchImpl: noFetch });
  check(missing.error === 'missing-image' && missing.message.length > 10,
    'returns an understandable error when the crop is missing');
  const invalid = await GeminiVision.answerImage({
    key, question, image: 'data:image/png;base64,not-a-valid-image!',
    fetchImpl: noFetch,
  });
  check(invalid.error === 'invalid-image' && invalid.message.length > 10,
    'returns an understandable error when the crop data URL is invalid');
  check(fetchCalls === 0, 'does not send missing or invalid crops to Gemini');

  const empty = await GeminiVision.answerImage({
    key, question, image: croppedImage,
    fetchImpl: () => Promise.resolve(response(200, { candidates: [] })),
  });
  check(empty.error === 'empty' && empty.message.length > 10,
    'returns an understandable error for an empty Gemini response');
  const textless = await GeminiVision.answerImage({
    key, question, image: croppedImage,
    fetchImpl: () => Promise.resolve(response(200, {
      candidates: [{ content: { parts: [{ inline_data: { data: 'no text' } }] } }],
    })),
  });
  check(textless.error === 'empty' && textless.message === GeminiVision.EMPTY_RESULT_MESSAGE,
    'returns an understandable error when Gemini response has no usable text');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
