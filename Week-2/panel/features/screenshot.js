'use strict';

(function (global) {
  var CAPTURE_ERROR_MESSAGE =
    'Sahayak could not capture the visible tab. Bring it to the front and try again.';
  var SAFETY_BLOCK_MESSAGE =
    'Screenshot capture was blocked by the page safety check.';
  var INVALID_CROP_MESSAGE = 'Drag over the preview to select a crop first.';
  var ANALYSIS_SAFETY_MESSAGE =
    'Sahayak could not analyze this crop because the page safety check blocked it.';

  function createWorkflow(deps) {
    var d = deps || {};
    var panel = d.panel;
    var cropDriver = d.cropDriver;
    var previewElement = d.previewElement;
    var croppedPreviewElement = d.croppedPreviewElement;
    var cropResultElement = d.cropResultElement;
    var statusElement = d.statusElement;
    var answerElement = d.answerElement;
    var previewUrl = '';
    var croppedImage = '';
    var capturedTabId = null;

    function setStatus(message, isError) {
      if (!statusElement) return;
      statusElement.textContent = message || '';
      statusElement.className = 'screenshot-status' + (isError ? ' is-error' : '');
    }

    function getCroppedImage() {
      return croppedImage || null;
    }

    function clear() {
      previewUrl = '';
      croppedImage = '';
      capturedTabId = null;
      if (previewElement) previewElement.removeAttribute('src');
      if (croppedPreviewElement) croppedPreviewElement.removeAttribute('src');
      if (cropResultElement) cropResultElement.hidden = true;
      if (answerElement) {
        answerElement.textContent = '';
        answerElement.className = 'screenshot-answer';
      }
      setStatus('', false);
    }

    function invalidateCrop() {
      croppedImage = '';
      if (croppedPreviewElement) croppedPreviewElement.removeAttribute('src');
      if (cropResultElement) cropResultElement.hidden = true;
      if (answerElement) {
        answerElement.textContent = '';
        answerElement.className = 'screenshot-answer';
      }
    }

    function capture() {
      if (
        !panel ||
        typeof panel.requestActiveTabId !== 'function' ||
        typeof panel.guardedSend !== 'function' ||
        !cropDriver ||
        typeof cropDriver.prepareImage !== 'function'
      ) {
        setStatus(CAPTURE_ERROR_MESSAGE, true);
        return Promise.resolve({ ok: false, error: 'unavailable' });
      }

      clear();
      setStatus('Checking page safety and capturing the visible tab…', false);

      return Promise.resolve()
        .then(function () { return panel.requestActiveTabId(); })
        .then(function (tabId) {
          capturedTabId = tabId;
          return panel.guardedSend('capture-screenshot', { tabId: tabId });
        })
        .then(function (response) {
          var dataUrl = response && response.ok === true &&
            response.result && response.result.dataUrl;
          if (typeof dataUrl !== 'string') throw new Error('capture-unavailable');
          return cropDriver.prepareImage(dataUrl).then(function (prepared) {
            dataUrl = '';
            if (
              !prepared ||
              typeof prepared.previewUrl !== 'string' ||
              !prepared.previewUrl ||
              !Number.isFinite(prepared.width) ||
              !Number.isFinite(prepared.height)
            ) {
              throw new Error('invalid-image');
            }
            previewUrl = prepared.previewUrl;
            if (previewElement) previewElement.src = previewUrl;
            setStatus(
              'Drag over the preview to select a crop. Maximum image dimensions: ' +
                cropDriver.MAX_IMAGE_DIMENSION + ' × ' +
                cropDriver.MAX_IMAGE_DIMENSION + ' pixels.',
              false
            );
            return { ok: true, width: prepared.width, height: prepared.height };
          });
        })
        .catch(function (error) {
          previewUrl = '';
          var message = error && String(error.message || '');
          var blocked = message.indexOf('safety-blocked:') === 0 ||
            message.indexOf('safety-confirm-declined') === 0;
          setStatus(blocked ? SAFETY_BLOCK_MESSAGE : CAPTURE_ERROR_MESSAGE, true);
          return { ok: false, error: blocked ? 'safety-blocked' : 'capture-unavailable' };
        });
    }

    function crop(rect) {
      if (!previewUrl || !cropDriver || typeof cropDriver.cropImage !== 'function') {
        setStatus(INVALID_CROP_MESSAGE, true);
        return Promise.resolve({ ok: false, error: 'invalid-crop' });
      }

      return cropDriver.cropImage(previewUrl, rect)
        .then(function (result) {
          if (!result || typeof result.croppedImage !== 'string' || !result.croppedImage) {
            throw new Error('invalid-crop');
          }
          croppedImage = result.croppedImage;
          if (croppedPreviewElement) croppedPreviewElement.src = croppedImage;
          if (cropResultElement) cropResultElement.hidden = false;
          setStatus('Crop ready. Ask a question about the selected area below.', false);
          return {
            ok: true,
            croppedImage: croppedImage,
            width: result.width,
            height: result.height
          };
        })
        .catch(function () {
          croppedImage = '';
          setStatus(INVALID_CROP_MESSAGE, true);
          return { ok: false, error: 'invalid-crop' };
        });
    }

    function ask(question) {
      var safeQuestion = typeof question === 'string' ? question.trim() : '';
      var image = getCroppedImage();
      if (!image) {
        return Promise.resolve({
          ok: false,
          error: 'missing-image',
          message: 'Capture the visible tab and apply a crop before asking a question.'
        });
      }
      if (!safeQuestion) {
        return Promise.resolve({
          ok: false,
          error: 'invalid-question',
          message: 'Enter a question about the selected crop.'
        });
      }
      if (
        !panel ||
        typeof panel.requestPageInfo !== 'function' ||
        typeof panel.guardRead !== 'function' ||
        !Number.isInteger(capturedTabId) ||
        typeof d.callAI !== 'function' ||
        typeof d.getApiKey !== 'function'
      ) {
        return Promise.resolve({
          ok: false,
          error: 'unavailable',
          message: 'Screenshot Q&A is unavailable right now. Reopen the panel and try again.'
        });
      }

      return Promise.resolve()
        .then(function () { return panel.requestPageInfo(capturedTabId); })
        .then(function (pageInfo) { return panel.guardRead(pageInfo); })
        .then(function (decision) {
          if (!decision || decision.allowed !== true) {
            return {
              ok: false,
              error: 'safety-blocked',
              message: ANALYSIS_SAFETY_MESSAGE
            };
          }
          return Promise.resolve()
            .then(function () { return d.getApiKey(); })
            .then(function (key) {
              return d.callAI({
                key: key,
                question: safeQuestion,
                image: image
              });
            })
            .catch(function () {
              return {
                ok: false,
                error: 'analysis-unavailable',
                message: 'Sahayak could not start image analysis. Check Gemini Settings and try again.'
              };
            });
        })
        .catch(function () {
          return {
            ok: false,
            error: 'safety-check-failed',
            message: 'Sahayak could not verify page safety. Reopen the panel and try again.'
          };
        });
    }

    return {
      capture: capture,
      crop: crop,
      ask: ask,
      clear: clear,
      invalidateCrop: invalidateCrop,
      getCroppedImage: getCroppedImage
    };
  }

  function initUI(win) {
    if (!win || !win.document) return;
    var doc = win.document;

    function whenReady(fn) {
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
      else fn();
    }

    whenReady(function () {
      var captureButton = doc.getElementById('screenshot-capture-btn');
      var workspace = doc.getElementById('screenshot-workspace');
      var stage = doc.getElementById('screenshot-preview-stage');
      var preview = doc.getElementById('screenshot-preview');
      var selection = doc.getElementById('screenshot-selection');
      var cropButton = doc.getElementById('screenshot-crop-btn');
      var cropResult = doc.getElementById('screenshot-crop-result');
      var croppedPreview = doc.getElementById('screenshot-cropped-preview');
      var status = doc.getElementById('screenshot-status');
      var questionForm = doc.getElementById('screenshot-question-form');
      var questionInput = doc.getElementById('screenshot-question');
      var askButton = doc.getElementById('screenshot-ask-btn');
      var answer = doc.getElementById('screenshot-answer');
      var cropDriver = win.SahayakCropDriver;
      if (
        !captureButton || !workspace || !stage || !preview || !selection ||
        !cropButton || !cropResult || !croppedPreview || !status ||
        !questionForm || !questionInput || !askButton || !answer || !cropDriver
      ) return;

      var workflow = createWorkflow({
        panel: win.SahayakPanel,
        cropDriver: cropDriver,
        callAI: win.SahayakProviders &&
          typeof win.SahayakProviders.callAI === 'function'
          ? function (task) { return win.SahayakProviders.callAI(task); }
          : null,
        getApiKey: function () {
          if (!win.SahayakStorageManager || !win.SahayakApiKeys) {
            return Promise.reject(new Error('api-key-storage-unavailable'));
          }
          return win.SahayakApiKeys.getGeminiKey(win.SahayakStorageManager);
        },
        previewElement: preview,
        croppedPreviewElement: croppedPreview,
        cropResultElement: cropResult,
        statusElement: status,
        answerElement: answer
      });
      var dragStart = null;
      var selectedRect = null;
      var errorToast = win.SahayakErrorToast;

      function getImageBounds() {
        var image = preview.getBoundingClientRect();
        return image.width > 0 && image.height > 0 ? image : null;
      }

      function pointInImage(event, bounds) {
        return {
          x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
          y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
        };
      }

      function showSelection(start, end, bounds) {
        var left = Math.min(start.x, end.x);
        var top = Math.min(start.y, end.y);
        var width = Math.abs(end.x - start.x);
        var height = Math.abs(end.y - start.y);
        var stageBounds = stage.getBoundingClientRect();
        selection.style.left = (bounds.left - stageBounds.left + stage.scrollLeft + left) + 'px';
        selection.style.top = (bounds.top - stageBounds.top + stage.scrollTop + top) + 'px';
        selection.style.width = width + 'px';
        selection.style.height = height + 'px';
        selection.hidden = false;
        return { left: left, top: top, width: width, height: height };
      }

      captureButton.addEventListener('click', function () {
        if (errorToast && typeof errorToast.clear === 'function') {
          errorToast.clear();
        }
        captureButton.disabled = true;
        workspace.hidden = false;
        cropButton.disabled = true;
        askButton.disabled = true;
        answer.textContent = '';
        selection.hidden = true;
        selectedRect = null;
        workflow.capture().then(function (result) {
          captureButton.disabled = false;
          if (!result.ok) {
            workspace.hidden = true;
            if (errorToast && typeof errorToast.show === 'function') {
              errorToast.show(
                { error: result.error === 'safety-blocked'
                  ? 'safety-blocked'
                  : 'capture-unavailable' },
                result.error === 'safety-blocked'
                  ? SAFETY_BLOCK_MESSAGE
                  : CAPTURE_ERROR_MESSAGE
              );
            }
          }
        });
      });

      stage.addEventListener('pointerdown', function (event) {
        if (event.target !== preview || !preview.naturalWidth) return;
        var bounds = getImageBounds();
        if (!bounds) return;
        event.preventDefault();
        dragStart = pointInImage(event, bounds);
        selectedRect = null;
        cropButton.disabled = true;
        cropResult.hidden = true;
        selection.hidden = false;
        workflow.invalidateCrop();
        askButton.disabled = true;
        showSelection(dragStart, dragStart, bounds);
        if (typeof stage.setPointerCapture === 'function') {
          stage.setPointerCapture(event.pointerId);
        }
      });

      stage.addEventListener('pointermove', function (event) {
        if (!dragStart) return;
        var bounds = getImageBounds();
        if (!bounds) return;
        var end = pointInImage(event, bounds);
        showSelection(dragStart, end, bounds);
      });

      function finishDrag(event) {
        if (!dragStart) return;
        var bounds = getImageBounds();
        var end = bounds ? pointInImage(event, bounds) : null;
        if (bounds && end) {
          var displayRect = showSelection(dragStart, end, bounds);
          selectedRect = cropDriver.clampCropRect({
            x: displayRect.left * preview.naturalWidth / bounds.width,
            y: displayRect.top * preview.naturalHeight / bounds.height,
            width: displayRect.width * preview.naturalWidth / bounds.width,
            height: displayRect.height * preview.naturalHeight / bounds.height
          }, preview.naturalWidth, preview.naturalHeight);
        }
        dragStart = null;
        cropButton.disabled = !selectedRect;
      }

      stage.addEventListener('pointerup', finishDrag);
      stage.addEventListener('pointercancel', finishDrag);

      cropButton.addEventListener('click', function () {
        if (!selectedRect) return;
        cropButton.disabled = true;
        workflow.crop(selectedRect).then(function () {
          cropButton.disabled = false;
          askButton.disabled = !workflow.getCroppedImage();
        });
      });

      questionForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (askButton.disabled) return;
        if (errorToast && typeof errorToast.clear === 'function') {
          errorToast.clear();
        }
        askButton.disabled = true;
        answer.textContent = 'Checking page safety and asking Gemini…';
        workflow.ask(questionInput.value).then(function (result) {
          if (result && result.ok === true) {
            if (errorToast && typeof errorToast.clear === 'function') {
              errorToast.clear();
            }
          } else if (errorToast && typeof errorToast.show === 'function') {
            errorToast.show(
              result || { error: 'unavailable' },
              (result && result.message) || 'Sahayak could not answer this question.'
            );
          }
          answer.textContent = result && result.ok === true
            ? result.text
            : (result && result.message) || 'Sahayak could not answer this question.';
          answer.className = 'screenshot-answer' +
            (result && result.ok === true ? '' : ' is-error');
          askButton.disabled = !workflow.getCroppedImage();
        });
      });

      win.SahayakScreenshot = Object.freeze({
        getCroppedImage: workflow.getCroppedImage
      });
    });
  }

  var api = { createWorkflow: createWorkflow, initUI: initUI };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    initUI(global);
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
