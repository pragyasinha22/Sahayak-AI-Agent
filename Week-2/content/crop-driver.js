'use strict';

(function (global) {
  // Captures wider or taller than this are reduced proportionally before
  // previewing/cropping; the output is at most 1600 × 1600 pixels.
  var MAX_IMAGE_DIMENSION = 1600;

  function isPositiveFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  function reducedDimensions(width, height, maxDimension) {
    var limit = isPositiveFinite(maxDimension) ? maxDimension : MAX_IMAGE_DIMENSION;
    if (!isPositiveFinite(width) || !isPositiveFinite(height)) return null;
    var scale = Math.min(1, limit / width, limit / height);
    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale))
    };
  }

  function clampCropRect(rect, imageWidth, imageHeight) {
    if (
      !rect ||
      !isPositiveFinite(imageWidth) ||
      !isPositiveFinite(imageHeight) ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height) ||
      rect.width === 0 ||
      rect.height === 0
    ) {
      return null;
    }

    var left = Math.max(0, Math.min(imageWidth, Math.min(rect.x, rect.x + rect.width)));
    var top = Math.max(0, Math.min(imageHeight, Math.min(rect.y, rect.y + rect.height)));
    var right = Math.max(0, Math.min(imageWidth, Math.max(rect.x, rect.x + rect.width)));
    var bottom = Math.max(0, Math.min(imageHeight, Math.max(rect.y, rect.y + rect.height)));
    if (right <= left || bottom <= top) return null;

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  function loadImage(dataUrl, deps) {
    if (typeof dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|webp);/i.test(dataUrl)) {
      return Promise.reject(new Error('invalid-image'));
    }

    var imageFactory = deps && deps.imageFactory;
    if (typeof imageFactory !== 'function') {
      imageFactory = function () { return new global.Image(); };
    }

    return new Promise(function (resolve, reject) {
      var image;
      try {
        image = imageFactory();
      } catch (_) {
        reject(new Error('image-unavailable'));
        return;
      }
      if (!image) {
        reject(new Error('image-unavailable'));
        return;
      }
      image.onload = function () {
        if (!isPositiveFinite(image.naturalWidth) || !isPositiveFinite(image.naturalHeight)) {
          reject(new Error('invalid-image'));
          return;
        }
        resolve(image);
      };
      image.onerror = function () { reject(new Error('invalid-image')); };
      image.src = dataUrl;
    });
  }

  function makeCanvas(deps) {
    if (deps && typeof deps.canvasFactory === 'function') {
      return deps.canvasFactory();
    }
    if (!global.document || typeof global.document.createElement !== 'function') {
      throw new Error('canvas-unavailable');
    }
    return global.document.createElement('canvas');
  }

  function prepareImage(dataUrl, deps) {
    return loadImage(dataUrl, deps).then(function (image) {
      var dimensions = reducedDimensions(
        image.naturalWidth,
        image.naturalHeight,
        MAX_IMAGE_DIMENSION
      );
      if (!dimensions) throw new Error('invalid-image');

      if (
        dimensions.width === image.naturalWidth &&
        dimensions.height === image.naturalHeight
      ) {
        return {
          previewUrl: dataUrl,
          width: dimensions.width,
          height: dimensions.height
        };
      }

      var canvas = makeCanvas(deps);
      var context = canvas && canvas.getContext('2d');
      if (!context) throw new Error('canvas-unavailable');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

      return {
        previewUrl: canvas.toDataURL('image/png'),
        width: dimensions.width,
        height: dimensions.height
      };
    });
  }

  function cropImage(dataUrl, rect, deps) {
    return loadImage(dataUrl, deps).then(function (image) {
      var crop = clampCropRect(rect, image.naturalWidth, image.naturalHeight);
      if (!crop) throw new Error('invalid-crop');

      var width = Math.max(1, Math.ceil(crop.width));
      var height = Math.max(1, Math.ceil(crop.height));
      var canvas = makeCanvas(deps);
      var context = canvas && canvas.getContext('2d');
      if (!context) throw new Error('canvas-unavailable');
      canvas.width = width;
      canvas.height = height;
      context.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        width,
        height
      );

      return {
        croppedImage: canvas.toDataURL('image/png'),
        width: width,
        height: height
      };
    });
  }

  var api = {
    MAX_IMAGE_DIMENSION: MAX_IMAGE_DIMENSION,
    reducedDimensions: reducedDimensions,
    clampCropRect: clampCropRect,
    prepareImage: prepareImage,
    cropImage: cropImage
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    global.SahayakCropDriver = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
