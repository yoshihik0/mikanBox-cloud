(() => {
  'use strict';

  const MAX_DIMENSION = 16000;
  const MAX_PIXELS = 40000000;
  const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

  function number(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function replaceExtension(filename, extension) {
    const dot = filename.lastIndexOf('.');
    return `${dot > 0 ? filename.slice(0, dot) : filename}.${extension}`;
  }

  function fitDimensions(width, height, requestedWidth, requestedHeight) {
    let scale = 1;
    if (requestedWidth && requestedHeight) {
      scale = Math.min(requestedWidth / width, requestedHeight / height);
    } else if (requestedWidth) {
      scale = requestedWidth / width;
    } else if (requestedHeight) {
      scale = requestedHeight / height;
    }
    scale = Math.min(scale, 1);
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    if (outWidth > MAX_DIMENSION || outHeight > MAX_DIMENSION || outWidth * outHeight > MAX_PIXELS) {
      throw new Error('Image dimensions exceed the browser processing limit.');
    }
    return { width: outWidth, height: outHeight, resized: outWidth !== width || outHeight !== height };
  }

  async function processImage(blob, filename, options) {
    const mimeType = blob.type.toLowerCase();
    if (!supportedTypes.has(mimeType)) return { blob, filename, changed: false };
    if (options.resize && (!options.maxDimension || options.maxDimension > MAX_DIMENSION)) {
      throw new Error(`Maximum image dimension must be between 1 and ${MAX_DIMENSION}px.`);
    }
    if (!options.resize && !options.width && !options.height && !options.webp) {
      return { blob, filename, changed: false };
    }

    if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot process images.');
    const bitmap = await createImageBitmap(blob);
    let canvas;
    try {
      const { width: sourceWidth, height: sourceHeight } = bitmap;
      if (!sourceWidth || !sourceHeight || sourceWidth > MAX_DIMENSION || sourceHeight > MAX_DIMENSION || sourceWidth * sourceHeight > MAX_PIXELS) {
        throw new Error('Image dimensions exceed the browser processing limit.');
      }

      let dimensions;
      if (options.resize && options.maxDimension) {
        dimensions = fitDimensions(sourceWidth, sourceHeight, options.maxDimension, options.maxDimension);
      } else {
        dimensions = fitDimensions(sourceWidth, sourceHeight, options.width, options.height);
      }
      const outputType = options.webp ? 'image/webp' : mimeType;
      if (!dimensions.resized && outputType === mimeType) return { blob, filename, changed: false };

      canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot process images.');
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    } finally {
      bitmap.close?.();
    }

    const outputType = options.webp ? 'image/webp' : mimeType;
    const result = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.85));
    if (!result || result.type !== outputType) throw new Error(`This browser cannot create ${outputType} images.`);
    return {
      blob: result,
      filename: options.webp ? replaceExtension(filename, 'webp') : filename,
      changed: true,
    };
  }

  async function cloudPrepareMediaForm(formData) {
    const action = String(formData.get('save_action') || '');
    const image = formData.get('image');
    const isUpload = action === 'upload_media';
    const isResize = action === 'resize_media' || action === 'edit_media' || action === 'convert_media_webp';
    if (!isUpload && !isResize) return formData;

    let source = image instanceof Blob ? image : null;
    let filename = source instanceof File ? source.name : '';
    if (isResize) {
      filename = String(formData.get('file') || formData.get('filename') || '');
      const width = number(formData.get('new_width'));
      const height = number(formData.get('new_height'));
      const webp = formData.get('opt_webp') === '1';
      if (webp && !/\.(?:jpe?g|png)$/i.test(filename)) throw new Error('WebP conversion is available for JPEG and PNG only.');
      let target = String(formData.get('new_filename') || filename).trim();
      if (webp) target = replaceExtension(target, 'webp');
      formData.set('new_filename', target);
      if (!width && !height && !webp) {
        if (target === filename) throw new Error('No changes to save.');
        if (action === 'edit_media') return formData;
        throw new Error('Enter a width or height, or choose WebP conversion.');
      }
      if (!filename) throw new Error('Choose an image to resize.');
      if (!source) {
        const response = await fetch(`/admin?media_preview=${encodeURIComponent(filename)}`, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Could not load the original image.');
        formData.set('source_etag',response.headers.get('ETag')||'');
        source = await response.blob();
      }
      const processed = await processImage(source, filename, { width, height, webp });
      if (!processed.changed) {
        if (action === 'edit_media' && target !== filename) return formData;
        throw new Error('The image is already at the requested size.');
      }
      const outputFile = new File([processed.blob], target, { type: processed.blob.type, lastModified: Date.now() });
      formData.set('source_file', filename);
      formData.set('new_filename', target);
      formData.set('image', outputFile);
      return formData;
    }

    if (!(source instanceof File)) throw new Error('Choose an image file.');
    const resize = formData.get('opt_resize') === '1';
    const webp = formData.get('opt_webp') === '1';
    if (!resize && !webp) return formData;
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    // Animated GIFs and SVGs are kept byte-for-byte. SVG rasterization is deliberately avoided.
    if (!['jpg','jpeg','png','webp'].includes(ext) || !supportedTypes.has(source.type.toLowerCase())) return formData;
    const maxDimension = number(formData.get('opt_max_dim')) || 2000;
    const processed = await processImage(source, filename, { resize, maxDimension, webp });
    if (processed.changed) {
      formData.set('image', new File([processed.blob], processed.filename, { type: processed.blob.type, lastModified: Date.now() }));
    }
    return formData;
  }

  window.cloudPrepareMediaForm = cloudPrepareMediaForm;
})();
