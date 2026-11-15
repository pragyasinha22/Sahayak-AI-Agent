'use strict';

const assert = require('node:assert/strict');
const CropDriver = require('../../content/crop-driver.js');
const Screenshot = require('../../panel/features/screenshot.js');

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

function fakeImageFactory(width, height) {
  return function () {
    const image = {
      naturalWidth: width,
      naturalHeight: height,
      set src(value) {
        this._src = value;
        queueMicrotask(() => this.onload());
      },
      get src() { return this._src; },
    };
    return image;
  };
}

function fakeCanvasFactory(drawCalls) {
  return function () {
    return {
      width: 0,
      height: 0,
      getContext() {
        return { drawImage: (...args) => drawCalls.push(args) };
      },
      toDataURL() { return 'data:image/png;base64,cropped-result'; },
    };
  };
}

async function main() {
  console.log('# crop bounds and image sizing');
  check(CropDriver.MAX_IMAGE_DIMENSION === 1600,
    'documents a fixed 1600-pixel maximum image width and height');

  const reduced = CropDriver.reducedDimensions(3840, 2160);
  check(reduced.width === 1600 && reduced.height === 900,
    'reduces an oversized image proportionally without changing its aspect ratio');
  const smaller = CropDriver.reducedDimensions(800, 600);
  check(smaller.width === 800 && smaller.height === 600,
    'does not upscale captures already below the maximum');

  const clamped = CropDriver.clampCropRect(
    { x: -20, y: 70, width: 50, height: 40 },
    100,
    80
  );
  check(
    clamped.x === 0 && clamped.y === 70 &&
      clamped.width === 30 && clamped.height === 10,
    'clamps a crop extending beyond multiple image boundaries'
  );
  const reverseDrag = CropDriver.clampCropRect(
    { x: 90, y: 60, width: -50, height: -30 },
    100,
    80
  );
  check(
    reverseDrag.x === 40 && reverseDrag.y === 30 &&
      reverseDrag.width === 50 && reverseDrag.height === 30,
    'normalizes reverse-direction drag coordinates'
  );
  check(
    CropDriver.clampCropRect({ x: 150, y: 150, width: 10, height: 10 }, 100, 100) === null,
    'rejects a crop entirely outside the image'
  );

  console.log('\n# canvas resize and crop application');
  const resizeDraws = [];
  const prepared = await CropDriver.prepareImage(
    'data:image/png;base64,original-capture',
    {
      imageFactory: fakeImageFactory(3840, 2160),
      canvasFactory: fakeCanvasFactory(resizeDraws),
    }
  );
  check(prepared.width === 1600 && prepared.height === 900,
    'prepares a preview no larger than the documented dimensions');
  check(resizeDraws.length === 1 && resizeDraws[0][3] === 1600 && resizeDraws[0][4] === 900,
    'draws oversized capture into a reduced canvas');

  const cropDraws = [];
  const cropped = await CropDriver.cropImage(
    'data:image/png;base64,reduced-preview',
    { x: -10, y: 70, width: 40, height: 30 },
    {
      imageFactory: fakeImageFactory(100, 80),
      canvasFactory: fakeCanvasFactory(cropDraws),
    }
  );
  check(cropped.width === 30 && cropped.height === 10,
    'applies the boundary-clamped crop dimensions');
  check(
    cropDraws.length === 1 &&
      cropDraws[0][1] === 0 && cropDraws[0][2] === 70 &&
      cropDraws[0][3] === 30 && cropDraws[0][4] === 10,
    'drawImage receives only the clamped source rectangle'
  );

  console.log('\n# capture workflow and output boundary');
  const fullCapture = 'data:image/png;base64,full-capture';
  const croppedCapture = 'data:image/png;base64,cropped-only';
  const previewElement = {
    src: '',
    removeAttribute(name) { if (name === 'src') this.src = ''; },
  };
  const croppedPreviewElement = {
    src: '',
    removeAttribute(name) { if (name === 'src') this.src = ''; },
  };
  const cropResultElement = { hidden: true };
  const statusElement = { textContent: '', className: '' };
  const calls = [];
  const visionCalls = [];
  const workflow = Screenshot.createWorkflow({
    panel: {
      requestActiveTabId() {
        calls.push('active-tab');
        return Promise.resolve(7);
      },
      requestPageInfo(tabId) {
        calls.push({ pageInfoTabId: tabId });
        return Promise.resolve({ url: 'https://chart.example.org/' });
      },
      guardRead(pageInfo) {
        calls.push({ guardedPageInfo: pageInfo });
        return Promise.resolve({ allowed: true });
      },
      guardedSend(family, payload) {
        calls.push({ family, payload });
        return Promise.resolve({ ok: true, result: { dataUrl: fullCapture } });
      },
    },
    callAI(options) {
        visionCalls.push(options);
        return Promise.resolve({ ok: true, text: 'The crop shows a chart.' });
    },
    getApiKey() { return Promise.resolve('test-gemini-key'); },
    cropDriver: {
      MAX_IMAGE_DIMENSION: 1600,
      prepareImage(dataUrl) {
        calls.push({ prepareImageInput: dataUrl });
        return Promise.resolve({ previewUrl: 'data:image/png;base64,reduced-preview', width: 1600, height: 900 });
      },
      cropImage(dataUrl, rect) {
        calls.push({ cropImageInput: dataUrl, rect });
        return Promise.resolve({ croppedImage: croppedCapture, width: 100, height: 50 });
      },
    },
    previewElement,
    croppedPreviewElement,
    cropResultElement,
    statusElement,
  });

  const captureResult = await workflow.capture();
  check(captureResult.ok && captureResult.width === 1600 && captureResult.height === 900,
    'captures the active tab and reports only preview dimensions');
  check(
    calls.some((call) => call && call.family === 'capture-screenshot' &&
      call.payload.tabId === 7),
    'requests capture through the safety-gated screenshot route for the active tab'
  );
  check(
    previewElement.src === 'data:image/png;base64,reduced-preview' &&
      calls.some((call) => call && call.prepareImageInput === fullCapture),
    'keeps the full capture only for in-panel preview preparation'
  );
  check(workflow.getCroppedImage() === null,
    'does not expose a full screenshot as the analysis image before cropping');

  const cropResult = await workflow.crop({ x: 20, y: 30, width: 100, height: 50 });
  check(cropResult.ok && cropResult.croppedImage === croppedCapture,
    'exposes the cropped image after the user applies a crop');
  check(
    Object.keys(cropResult).sort().join(',') === 'croppedImage,height,ok,width' &&
      workflow.getCroppedImage() === croppedCapture &&
      croppedPreviewElement.src === croppedCapture &&
      cropResultElement.hidden === false,
    'only the crop is available from the workflow for later analysis'
  );
  check(
    calls.some((call) => call && call.cropImageInput === 'data:image/png;base64,reduced-preview'),
    'crops from the reduced preview rather than passing the original capture onward'
  );

  const answer = await workflow.ask('What does this chart show?');
  check(answer.ok && answer.text === 'The crop shows a chart.',
    'returns the Gemini Vision answer for the user question');
  check(
    visionCalls.length === 1 &&
      visionCalls[0].image === croppedCapture &&
      visionCalls[0].question === 'What does this chart show?' &&
      visionCalls[0].key === 'test-gemini-key',
    'passes only the applied crop and user question to the vision provider'
  );
  check(
    JSON.stringify(answer).indexOf(fullCapture) === -1 &&
      JSON.stringify(visionCalls[0]).indexOf(fullCapture) === -1,
    'never exposes the full capture as analysis input or output'
  );

  workflow.invalidateCrop();
  const missingCropAnswer = await workflow.ask('What does this chart show?');
  check(!missingCropAnswer.ok && missingCropAnswer.error === 'missing-image',
    'requires a crop before image analysis');
  check(visionCalls.length === 1,
    'does not call Gemini Vision when the crop has been invalidated');

  const blockedCalls = [];
  const blockedAnalysisWorkflow = Screenshot.createWorkflow({
    panel: {
      requestActiveTabId() { return Promise.resolve(7); },
      requestPageInfo() { return Promise.resolve({ url: 'https://bank.example.org/' }); },
      guardRead() { return Promise.resolve({ allowed: false }); },
      guardedSend() {
        return Promise.resolve({ ok: true, result: { dataUrl: fullCapture } });
      },
    },
    callAI() {
      blockedCalls.push('provider');
      return Promise.resolve({ ok: true, text: 'unexpected' });
    },
    getApiKey() { blockedCalls.push('key'); return Promise.resolve('test-key'); },
    cropDriver: {
      prepareImage() {
        return Promise.resolve({ previewUrl: 'data:image/png;base64,preview', width: 10, height: 10 });
      },
      cropImage() {
        return Promise.resolve({ croppedImage: croppedCapture, width: 5, height: 5 });
      },
    },
  });
  await blockedAnalysisWorkflow.capture();
  await blockedAnalysisWorkflow.crop({ x: 0, y: 0, width: 5, height: 5 });
  const blockedAnswer = await blockedAnalysisWorkflow.ask('What is visible?');
  check(!blockedAnswer.ok && blockedAnswer.error === 'safety-blocked',
    'refuses screenshot Q&A when the read-safety gate blocks the page');
  check(blockedCalls.length === 0,
    'does not read the API key or call Gemini after a safety block');

  const deniedWorkflow = Screenshot.createWorkflow({
    panel: {
      requestActiveTabId() { return Promise.resolve(7); },
      guardedSend() { return Promise.reject(new Error('safety-blocked:sensitive-page')); },
    },
    cropDriver: {
      prepareImage() { throw new Error('must-not-decode'); },
      cropImage() { throw new Error('must-not-crop'); },
    },
    statusElement,
  });
  const denied = await deniedWorkflow.capture();
  check(!denied.ok && denied.error === 'safety-blocked',
    'stops capture when the read-safety gate blocks the page');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 2;
});
