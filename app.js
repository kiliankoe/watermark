"use strict";

const IMAGE_QUALITY = 0.92;
const DEFAULT_WATERMARK_ALPHA = 0.22;
const DEFAULT_WATERMARK_ANGLE_DEG = -30;
const MIN_WATERMARK_ALPHA = 0.04;
const MAX_WATERMARK_ALPHA = 0.5;
const MIN_WATERMARK_ANGLE = -60;
const MAX_WATERMARK_ANGLE = 60;
const VIDEO_EXPORT_FPS = 30;

const elements = {
  imageInput: document.getElementById("imageInput"),
  watermarkInput: document.getElementById("watermarkInput"),
  addDateBtn: document.getElementById("addDateBtn"),
  opacityInput: document.getElementById("opacityInput"),
  angleInput: document.getElementById("angleInput"),
  opacityValue: document.getElementById("opacityValue"),
  angleValue: document.getElementById("angleValue"),
  downloadBtn: document.getElementById("downloadBtn"),
  undoBtn: document.getElementById("undoBtn"),
  resetBtn: document.getElementById("resetBtn"),
  previewCanvas: document.getElementById("previewCanvas"),
  previewShell: document.getElementById("previewShell"),
  previewHint: document.getElementById("previewHint"),
  redactionHint: document.getElementById("redactionHint"),
  redactionActions: document.getElementById("redactionActions"),
  videoProgress: document.getElementById("videoProgress"),
  videoProgressFill: document.getElementById("videoProgressFill"),
  videoProgressText: document.getElementById("videoProgressText"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
};

const state = {
  file: null,
  mediaType: null,
  imageBitmapOrImg: null,
  videoEl: null,
  inputMime: "",
  baseName: "",
  watermarkText: "",
  watermarkOpacity: DEFAULT_WATERMARK_ALPHA,
  watermarkAngleDeg: DEFAULT_WATERMARK_ANGLE_DEG,
  previewScale: 1,
  objectUrl: null,
  redactions: [],
  draftRedaction: null,
  isVideoExporting: false,
};

let resizeRaf = null;
let videoPreviewRaf = null;

elements.imageInput.addEventListener("change", onFileSelected);
elements.watermarkInput.addEventListener("input", () => {
  state.watermarkText = elements.watermarkInput.value;
  clearError();
  renderPreview();
  updateDownloadButtonState();
});
elements.addDateBtn.addEventListener("click", insertCurrentDate);
elements.opacityInput.addEventListener("input", onOpacityChange);
elements.angleInput.addEventListener("input", onAngleChange);
elements.downloadBtn.addEventListener("click", downloadResult);
elements.undoBtn.addEventListener("click", undoLastRedaction);
elements.resetBtn.addEventListener("click", resetAllRedactions);
setupFileDropzone();
setupRedactionDrawing();
window.addEventListener("resize", () => {
  if (resizeRaf) {
    cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    renderPreview();
  });
});

updateDownloadButtonState();
updateRedactionButtonsState();
updateRedactionHint();
syncWatermarkControls();

function setupFileDropzone() {
  elements.previewShell.addEventListener("click", () => {
    if (state.mediaType === "image") {
      return;
    }
    clearError();
    openFilePicker();
  });

  elements.previewShell.addEventListener("keydown", (event) => {
    if (state.mediaType === "image") {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    clearError();
    openFilePicker();
  });

  elements.previewShell.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    elements.previewShell.classList.add("is-drop-target");
  });

  elements.previewShell.addEventListener("dragleave", (event) => {
    if (!elements.previewShell.contains(event.relatedTarget)) {
      elements.previewShell.classList.remove("is-drop-target");
    }
  });

  elements.previewShell.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) {
      return;
    }
    event.preventDefault();
    elements.previewShell.classList.remove("is-drop-target");
    const [file] = event.dataTransfer.files || [];
    void handleSelectedFile(file);
  });
}

function setupRedactionDrawing() {
  elements.previewCanvas.addEventListener("pointerdown", startRedactionDraft);
  elements.previewCanvas.addEventListener("pointermove", updateRedactionDraft);
  elements.previewCanvas.addEventListener("pointerup", finishRedactionDraft);
  elements.previewCanvas.addEventListener(
    "pointercancel",
    cancelRedactionDraft,
  );
}

function openFilePicker() {
  elements.imageInput.value = "";
  elements.imageInput.click();
}

function isFileDrag(event) {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes("Files"));
}

function insertCurrentDate() {
  const today = formatLocalDate(new Date());
  const currentText = elements.watermarkInput.value.trimEnd();
  if (currentText.includes(today)) {
    elements.watermarkInput.focus();
    return;
  }

  const nextText = currentText ? `${currentText} ${today}` : today;
  elements.watermarkInput.value = nextText;
  elements.watermarkInput.dispatchEvent(new Event("input", { bubbles: true }));
  elements.watermarkInput.focus();
}

function onOpacityChange() {
  const parsed = Number(elements.opacityInput.value);
  state.watermarkOpacity = clamp(
    parsed,
    MIN_WATERMARK_ALPHA,
    MAX_WATERMARK_ALPHA,
  );
  updateOpacityLabel();
  paintSliderFill(
    elements.opacityInput,
    state.watermarkOpacity,
    MIN_WATERMARK_ALPHA,
    MAX_WATERMARK_ALPHA,
  );
  renderPreview();
}

function onAngleChange() {
  const parsed = Number(elements.angleInput.value);
  state.watermarkAngleDeg = clamp(
    parsed,
    MIN_WATERMARK_ANGLE,
    MAX_WATERMARK_ANGLE,
  );
  updateAngleLabel();
  paintSliderFill(
    elements.angleInput,
    state.watermarkAngleDeg,
    MIN_WATERMARK_ANGLE,
    MAX_WATERMARK_ANGLE,
  );
  renderPreview();
}

function syncWatermarkControls() {
  elements.opacityInput.value = String(state.watermarkOpacity);
  elements.angleInput.value = String(state.watermarkAngleDeg);
  updateOpacityLabel();
  updateAngleLabel();
  paintSliderFill(
    elements.opacityInput,
    state.watermarkOpacity,
    MIN_WATERMARK_ALPHA,
    MAX_WATERMARK_ALPHA,
  );
  paintSliderFill(
    elements.angleInput,
    state.watermarkAngleDeg,
    MIN_WATERMARK_ANGLE,
    MAX_WATERMARK_ANGLE,
  );
}

function updateOpacityLabel() {
  elements.opacityValue.textContent = `${Math.round(state.watermarkOpacity * 100)}%`;
}

function updateAngleLabel() {
  elements.angleValue.textContent = `${Math.round(state.watermarkAngleDeg)}°`;
}

function startRedactionDraft(event) {
  if (
    state.mediaType !== "image" ||
    !state.imageBitmapOrImg ||
    event.button !== 0
  ) {
    return;
  }

  const point = pointerToCanvas(event);
  if (!point) {
    return;
  }

  event.preventDefault();
  state.draftRedaction = {
    startX: point.normalizedX,
    startY: point.normalizedY,
    currentX: point.normalizedX,
    currentY: point.normalizedY,
  };
  elements.previewShell.classList.add("is-drawing");
  elements.previewCanvas.setPointerCapture(event.pointerId);
  renderPreview();
  updateRedactionButtonsState();
}

function updateRedactionDraft(event) {
  if (!state.draftRedaction || state.mediaType !== "image") {
    return;
  }

  const point = pointerToCanvas(event);
  if (!point) {
    return;
  }

  event.preventDefault();
  state.draftRedaction.currentX = point.normalizedX;
  state.draftRedaction.currentY = point.normalizedY;
  renderPreview();
}

function finishRedactionDraft(event) {
  if (!state.draftRedaction || state.mediaType !== "image") {
    return;
  }

  const point = pointerToCanvas(event);
  if (point) {
    state.draftRedaction.currentX = point.normalizedX;
    state.draftRedaction.currentY = point.normalizedY;
  }

  const finalized = normalizeRedactionRect(state.draftRedaction);
  state.draftRedaction = null;
  elements.previewShell.classList.remove("is-drawing");

  if (elements.previewCanvas.hasPointerCapture(event.pointerId)) {
    elements.previewCanvas.releasePointerCapture(event.pointerId);
  }

  if (finalized.width >= 0.004 && finalized.height >= 0.004) {
    state.redactions.push(finalized);
  }

  renderPreview();
  updateRedactionButtonsState();
  updateDownloadButtonState();
}

function cancelRedactionDraft(event) {
  if (!state.draftRedaction || state.mediaType !== "image") {
    return;
  }

  state.draftRedaction = null;
  elements.previewShell.classList.remove("is-drawing");
  if (elements.previewCanvas.hasPointerCapture(event.pointerId)) {
    elements.previewCanvas.releasePointerCapture(event.pointerId);
  }
  renderPreview();
  updateRedactionButtonsState();
  updateDownloadButtonState();
}

function pointerToCanvas(event) {
  const rect = elements.previewCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }

  const relativeX = event.clientX - rect.left;
  const relativeY = event.clientY - rect.top;
  const x = clamp(relativeX / rect.width, 0, 1);
  const y = clamp(relativeY / rect.height, 0, 1);
  return { normalizedX: x, normalizedY: y };
}

async function onFileSelected(event) {
  const [file] = event.target.files || [];
  await handleSelectedFile(file);
}

async function handleSelectedFile(file) {
  clearStatus();
  clearError();
  hideVideoProgress();
  setVideoExportLoading(false);

  if (!file) {
    return;
  }

  try {
    setStatus("Loading file...");
    await loadMedia(file);

    if (state.mediaType === "video") {
      setStatus(
        `Loaded ${state.baseName} (${state.videoEl.videoWidth}x${state.videoEl.videoHeight}). Video redaction is disabled; watermark is supported.`,
      );
    } else {
      setStatus(
        `Loaded ${state.baseName} (${state.imageBitmapOrImg.naturalWidth}x${state.imageBitmapOrImg.naturalHeight}). Drag on the image to add redaction boxes.`,
      );
    }

    renderPreview();
    if (state.mediaType === "video") {
      startVideoPreviewLoop();
    }
  } catch (error) {
    resetMediaState();
    renderPreview();
    setError(error.message || "Could not decode that file.");
  } finally {
    updateDownloadButtonState();
    updateRedactionButtonsState();
    updateRedactionHint();
  }
}

async function loadMedia(file) {
  if (
    !file.type ||
    (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
  ) {
    throw new Error("Please select an image or video file.");
  }

  resetMediaState();

  if (file.type.startsWith("image/")) {
    await loadImageFile(file);
    return;
  }

  await loadVideoFile(file);
}

async function loadImageFile(file) {
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();

  try {
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error("Unsupported image or failed decode."));
      img.src = objectUrl;
    });

    if (typeof img.decode === "function") {
      await img.decode().catch(() => {});
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  state.file = file;
  state.mediaType = "image";
  state.imageBitmapOrImg = img;
  state.inputMime = file.type.toLowerCase();
  state.baseName = makeBaseName(file.name);
  state.objectUrl = objectUrl;
}

async function loadVideoFile(file) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;
  video.loop = true;
  video.src = objectUrl;

  try {
    await waitForEvent(video, "loadedmetadata");
    await waitForEvent(video, "loadeddata");
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Unsupported video or failed decode.");
  }

  if (!video.videoWidth || !video.videoHeight) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Could not read video dimensions.");
  }

  state.file = file;
  state.mediaType = "video";
  state.videoEl = video;
  state.inputMime = file.type.toLowerCase();
  state.baseName = makeBaseName(file.name);
  state.objectUrl = objectUrl;
}

function resetMediaState() {
  stopVideoPreviewLoop();

  if (state.videoEl) {
    state.videoEl.pause();
    state.videoEl.removeAttribute("src");
    state.videoEl.load();
  }

  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }

  state.file = null;
  state.mediaType = null;
  state.imageBitmapOrImg = null;
  state.videoEl = null;
  state.inputMime = "";
  state.baseName = "";
  state.previewScale = 1;
  state.redactions = [];
  state.draftRedaction = null;
  hideVideoProgress();
  setVideoExportLoading(false);
  elements.previewShell.classList.remove("is-drawing");
}

function stopVideoPreviewLoop() {
  if (videoPreviewRaf) {
    cancelAnimationFrame(videoPreviewRaf);
    videoPreviewRaf = null;
  }
}

function startVideoPreviewLoop() {
  if (state.mediaType !== "video" || !state.videoEl) {
    return;
  }

  stopVideoPreviewLoop();

  state.videoEl.play().catch(() => {
    // Autoplay can be blocked. We still render a static first frame.
  });

  const tick = () => {
    if (state.mediaType !== "video") {
      return;
    }
    drawVideoPreviewFrame();
    videoPreviewRaf = requestAnimationFrame(tick);
  };

  tick();
}

function renderPreview() {
  if (!state.mediaType) {
    clearPreviewCanvas();
    updateRedactionHint();
    return;
  }

  if (state.mediaType === "video") {
    layoutPreviewCanvas(state.videoEl.videoWidth, state.videoEl.videoHeight);
    drawVideoPreviewFrame();
    elements.previewShell.classList.add("has-media");
    elements.previewShell.classList.remove("is-redaction-mode");
    elements.previewShell.setAttribute(
      "aria-label",
      "Watermarked video preview. Drag and drop another file to replace it.",
    );
    updateRedactionHint();
    return;
  }

  layoutPreviewCanvas(
    state.imageBitmapOrImg.naturalWidth,
    state.imageBitmapOrImg.naturalHeight,
  );
  drawImagePreviewFrame();
  elements.previewShell.classList.add("has-media");
  elements.previewShell.classList.add("is-redaction-mode");
  elements.previewShell.setAttribute(
    "aria-label",
    "Image editor. Drag on the image to draw black redaction boxes.",
  );
  updateRedactionHint();
}

function clearPreviewCanvas() {
  const canvas = elements.previewCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = "none";
  elements.previewHint.hidden = false;
  elements.previewShell.classList.remove("has-media");
  elements.previewShell.classList.remove("is-redaction-mode");
  elements.previewShell.classList.remove("is-drawing");
  elements.previewShell.setAttribute(
    "aria-label",
    "Click to choose an image or video, or drag and drop one here",
  );
}

function layoutPreviewCanvas(originalWidth, originalHeight) {
  const canvas = elements.previewCanvas;
  const shellWidth = Math.max(240, elements.previewShell.clientWidth - 24);
  const shellHeight = Math.max(220, elements.previewShell.clientHeight - 24);
  const scale = Math.min(
    shellWidth / originalWidth,
    shellHeight / originalHeight,
  );

  state.previewScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  const cssWidth = Math.max(1, Math.round(originalWidth * state.previewScale));
  const cssHeight = Math.max(
    1,
    Math.round(originalHeight * state.previewScale),
  );
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.style.display = "block";
  elements.previewHint.hidden = true;
}

function drawImagePreviewFrame() {
  const canvas = elements.previewCanvas;
  renderFrameToCanvas(
    canvas,
    canvas.width,
    canvas.height,
    state.imageBitmapOrImg,
    state.watermarkText,
    {
      includePersistedRedactions: true,
      includeDraftRedaction: true,
    },
  );
}

function drawVideoPreviewFrame() {
  const canvas = elements.previewCanvas;
  if (!canvas.width || !canvas.height || !state.videoEl) {
    return;
  }

  renderFrameToCanvas(
    canvas,
    canvas.width,
    canvas.height,
    state.videoEl,
    state.watermarkText,
    {
      includePersistedRedactions: false,
      includeDraftRedaction: false,
    },
  );
}

function renderFrameToCanvas(
  canvas,
  width,
  height,
  source,
  text,
  options = {},
) {
  if (!source) {
    return;
  }

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  if (options.includePersistedRedactions) {
    drawPersistedRedactions(ctx, width, height);
  }

  drawWatermarkLayer(ctx, width, height, text);

  if (options.includeDraftRedaction && state.draftRedaction) {
    drawDraftRedaction(ctx, width, height, state.draftRedaction);
  }
}

function drawWatermarkLayer(ctx, width, height, text) {
  const cleanedText = String(text || "").trim();
  if (!cleanedText) {
    return;
  }

  const diagonal = Math.hypot(width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((state.watermarkAngleDeg * Math.PI) / 180);
  ctx.fillStyle = `rgba(255, 255, 255, ${state.watermarkOpacity})`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const fontSize = computeDynamicWatermarkFontSize(ctx, cleanedText, diagonal);
  ctx.font = `900 ${fontSize}px "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif`;

  const textWidth = Math.max(
    ctx.measureText(cleanedText).width,
    fontSize * 2.2,
  );
  const stepX = textWidth + fontSize * 0.85;
  const stepY = fontSize * 1.35;
  const coverage = diagonal * 2.2;

  for (let y = -coverage; y <= coverage; y += stepY) {
    const isOddRow = Math.floor((y + coverage) / stepY) % 2 !== 0;
    const rowOffset = isOddRow ? stepX / 2 : 0;
    for (let x = -coverage; x <= coverage; x += stepX) {
      ctx.fillText(cleanedText, x + rowOffset, y);
    }
  }

  ctx.restore();
}

function drawPersistedRedactions(ctx, width, height) {
  if (!state.redactions.length) {
    return;
  }

  ctx.save();
  ctx.fillStyle = "#000000";
  for (const redaction of state.redactions) {
    ctx.fillRect(
      redaction.x * width,
      redaction.y * height,
      redaction.width * width,
      redaction.height * height,
    );
  }
  ctx.restore();
}

function drawDraftRedaction(ctx, width, height, draft) {
  const rect = normalizeRedactionRect(draft);
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.86)";
  ctx.fillRect(
    rect.x * width,
    rect.y * height,
    rect.width * width,
    rect.height * height,
  );
  ctx.restore();
}

function normalizeRedactionRect(rectLike) {
  const x = Math.min(rectLike.startX, rectLike.currentX);
  const y = Math.min(rectLike.startY, rectLike.currentY);
  const width = Math.abs(rectLike.currentX - rectLike.startX);
  const height = Math.abs(rectLike.currentY - rectLike.startY);
  return { x, y, width, height };
}

async function downloadResult() {
  clearError();
  clearStatus();
  hideVideoProgress();

  if (!state.mediaType || !state.file) {
    setError("Choose or drop an image or video first.");
    return;
  }

  const cleanedText = state.watermarkText.trim();

  if (state.mediaType === "video") {
    if (!cleanedText) {
      setError("Enter watermark text before exporting a video.");
      return;
    }

    await exportVideoResult(cleanedText);
    return;
  }

  if (!cleanedText && state.redactions.length === 0) {
    setError("Enter watermark text or add at least one redaction box.");
    return;
  }

  await exportImageResult(cleanedText);
}

async function exportImageResult(cleanedText) {
  try {
    setStatus("Preparing image download...");
    const outCanvas = document.createElement("canvas");
    outCanvas.width = state.imageBitmapOrImg.naturalWidth;
    outCanvas.height = state.imageBitmapOrImg.naturalHeight;

    renderFrameToCanvas(
      outCanvas,
      outCanvas.width,
      outCanvas.height,
      state.imageBitmapOrImg,
      cleanedText,
      { includePersistedRedactions: true, includeDraftRedaction: false },
    );

    const format = deriveImageExportFormat(state.inputMime);
    const blob = await canvasToBlob(outCanvas, format.mime, format.quality);
    if (!blob) {
      throw new Error("Could not export image in this browser.");
    }

    const downloadName = `${state.baseName || "image"}-watermarked.${format.ext}`;
    triggerDownload(blob, downloadName);
    setStatus(`Downloaded ${downloadName}.`);
  } catch (error) {
    setError(error.message || "Failed to create image download.");
  }
}

async function exportVideoResult(cleanedText) {
  if (typeof MediaRecorder === "undefined") {
    setError("Video export is not supported in this browser.");
    return;
  }

  let exportVideo = null;
  let drawRaf = null;
  let recorder = null;
  let canvasStream = null;
  let sourceStream = null;

  setVideoExportLoading(true);
  showVideoProgress();
  updateVideoProgress(0);

  try {
    setStatus("Rendering watermarked video. This may take a moment...");

    const format = deriveVideoExportFormat();
    if (!format) {
      throw new Error(
        "No supported video export format was found in this browser.",
      );
    }

    exportVideo = document.createElement("video");
    exportVideo.preload = "auto";
    exportVideo.playsInline = true;
    exportVideo.muted = true;
    exportVideo.loop = false;
    exportVideo.src = state.objectUrl;

    await waitForEvent(exportVideo, "loadedmetadata");
    await waitForEvent(exportVideo, "loadeddata");

    const outCanvas = document.createElement("canvas");
    outCanvas.width = exportVideo.videoWidth;
    outCanvas.height = exportVideo.videoHeight;

    canvasStream = outCanvas.captureStream(VIDEO_EXPORT_FPS);

    if (typeof exportVideo.captureStream === "function") {
      sourceStream = exportVideo.captureStream();
      const [audioTrack] = sourceStream.getAudioTracks();
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
      }
    }

    recorder = createMediaRecorder(canvasStream, format.mime);
    const { stopPromise } = trackRecorderChunks(recorder, format.mime);

    renderFrameToCanvas(
      outCanvas,
      outCanvas.width,
      outCanvas.height,
      exportVideo,
      cleanedText,
      { includePersistedRedactions: false, includeDraftRedaction: false },
    );

    recorder.start(250);
    await exportVideo.play();

    const drawLoop = () => {
      renderFrameToCanvas(
        outCanvas,
        outCanvas.width,
        outCanvas.height,
        exportVideo,
        cleanedText,
        { includePersistedRedactions: false, includeDraftRedaction: false },
      );
      const progress = estimateVideoProgress(exportVideo);
      if (progress !== null) {
        updateVideoProgress(Math.min(progress, 0.99));
      }
      if (!exportVideo.paused && !exportVideo.ended) {
        drawRaf = requestAnimationFrame(drawLoop);
      }
    };

    drawLoop();
    await waitForVideoPlaybackCompletion(exportVideo);

    if (drawRaf) {
      cancelAnimationFrame(drawRaf);
      drawRaf = null;
    }

    if (recorder.state !== "inactive") {
      recorder.stop();
    }

    setStatus("Finalizing encoded video...");
    const durationForTimeout = Number.isFinite(exportVideo.duration)
      ? exportVideo.duration
      : 6;
    const finalizeTimeoutMs = Math.max(
      8000,
      Math.round(durationForTimeout * 2000) + 2000,
    );

    const blob = await withTimeout(
      stopPromise,
      finalizeTimeoutMs,
      "Video encoding did not finish in time. Try a shorter clip or another browser.",
    );
    if (!blob) {
      throw new Error("Could not encode video in this browser.");
    }

    updateVideoProgress(1);
    const downloadName = `${state.baseName || "video"}-watermarked.${format.ext}`;
    triggerDownload(blob, downloadName);
    setStatus(`Downloaded ${downloadName}.`);
  } catch (error) {
    setError(error.message || "Failed to create video download.");
  } finally {
    if (drawRaf) {
      cancelAnimationFrame(drawRaf);
    }

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    if (canvasStream) {
      for (const track of canvasStream.getTracks()) {
        track.stop();
      }
    }

    if (sourceStream) {
      for (const track of sourceStream.getTracks()) {
        track.stop();
      }
    }

    if (exportVideo) {
      exportVideo.pause();
      exportVideo.removeAttribute("src");
      exportVideo.load();
    }
    hideVideoProgress();
    setVideoExportLoading(false);
  }
}

function deriveImageExportFormat(inputMime) {
  const normalized = String(inputMime || "").toLowerCase();

  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return { mime: "image/jpeg", ext: "jpg", quality: IMAGE_QUALITY };
  }

  if (normalized === "image/png") {
    return { mime: "image/png", ext: "png", quality: undefined };
  }

  if (normalized === "image/webp" && supportsMimeType("image/webp")) {
    return { mime: "image/webp", ext: "webp", quality: IMAGE_QUALITY };
  }

  return { mime: "image/png", ext: "png", quality: undefined };
}

function deriveVideoExportFormat() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = [
    { mime: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mime: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
    { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
  ];

  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return candidates[0];
  }

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) {
      return candidate;
    }
  }

  return null;
}

function createMediaRecorder(stream, mimeType) {
  try {
    if (mimeType) {
      return new MediaRecorder(stream, { mimeType });
    }
    return new MediaRecorder(stream);
  } catch (_error) {
    throw new Error("Video export is not supported in this browser.");
  }
}

function trackRecorderChunks(recorder, fallbackMimeType) {
  const chunks = [];

  const stopPromise = new Promise((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("error", () => {
      reject(new Error("Failed while recording the watermarked video."));
    });

    recorder.addEventListener("stop", () => {
      if (!chunks.length) {
        resolve(null);
        return;
      }

      const mime = recorder.mimeType || fallbackMimeType || "video/webm";
      resolve(new Blob(chunks, { type: mime }));
    });
  });

  return { stopPromise };
}

function waitForVideoPlaybackCompletion(videoEl) {
  return new Promise((resolve, reject) => {
    if (videoEl.ended) {
      resolve();
      return;
    }

    const cleanup = () => {
      videoEl.removeEventListener("ended", onEnded);
      videoEl.removeEventListener("timeupdate", onTimeUpdate);
      videoEl.removeEventListener("error", onError);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };

    const onEnded = () => {
      cleanup();
      resolve();
    };

    const onTimeUpdate = () => {
      if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) {
        return;
      }
      if (videoEl.currentTime >= videoEl.duration - 0.03) {
        cleanup();
        resolve();
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error("Video playback failed during export."));
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Video playback did not complete in time."));
    }, 45000);

    videoEl.addEventListener("ended", onEnded);
    videoEl.addEventListener("timeupdate", onTimeUpdate);
    videoEl.addEventListener("error", onError, { once: true });
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function waitForEvent(target, successEvent) {
  return new Promise((resolve, reject) => {
    if (successEvent === "loadedmetadata" && target.readyState >= 1) {
      resolve();
      return;
    }
    if (successEvent === "loadeddata" && target.readyState >= 2) {
      resolve();
      return;
    }
    if (successEvent === "ended" && target.ended) {
      resolve();
      return;
    }

    const handleSuccess = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Media loading failed."));
    };

    const cleanup = () => {
      target.removeEventListener(successEvent, handleSuccess);
      target.removeEventListener("error", handleError);
    };

    target.addEventListener(successEvent, handleSuccess, { once: true });
    target.addEventListener("error", handleError, { once: true });
  });
}

function triggerDownload(blob, fileName) {
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

function undoLastRedaction() {
  if (state.mediaType !== "image" || !state.redactions.length) {
    return;
  }
  state.redactions.pop();
  renderPreview();
  updateRedactionButtonsState();
  updateDownloadButtonState();
}

function resetAllRedactions() {
  if (state.mediaType !== "image") {
    return;
  }

  if (!state.redactions.length && !state.draftRedaction) {
    return;
  }

  state.redactions = [];
  state.draftRedaction = null;
  elements.previewShell.classList.remove("is-drawing");
  renderPreview();
  updateRedactionButtonsState();
  updateDownloadButtonState();
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

function supportsMimeType(mime) {
  const probe = document.createElement("canvas");
  const data = probe.toDataURL(mime);
  return data.startsWith(`data:${mime}`);
}

function makeBaseName(fileName) {
  const trimmed = String(fileName || "").trim();
  if (!trimmed) {
    return "file";
  }
  return trimmed.replace(/\.[^/.]+$/, "") || "file";
}

function formatLocalDate(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function paintSliderFill(input, value, min, max) {
  const ratio = (value - min) / (max - min);
  const percent = clamp(Math.round(ratio * 100), 0, 100);
  input.style.setProperty("--slider-progress", `${percent}%`);
}

function setVideoExportLoading(isLoading) {
  state.isVideoExporting = isLoading;
  elements.downloadBtn.classList.toggle("is-loading", isLoading);
  elements.videoProgress.hidden = !isLoading;

  if (isLoading) {
    elements.downloadBtn.disabled = true;
    elements.downloadBtn.setAttribute("aria-busy", "true");
    return;
  }

  updateVideoProgress(0);
  elements.downloadBtn.removeAttribute("aria-busy");
  updateDownloadButtonState();
}

function showVideoProgress() {
  if (!state.isVideoExporting) {
    return;
  }
  elements.videoProgress.hidden = false;
}

function hideVideoProgress() {
  elements.videoProgress.hidden = true;
  updateVideoProgress(0);
}

function updateVideoProgress(progressRatio) {
  const percent = clamp(Math.round(progressRatio * 100), 0, 100);
  elements.videoProgressFill.style.width = `${percent}%`;
  elements.videoProgressText.textContent = `${percent}%`;
}

function estimateVideoProgress(videoEl) {
  const duration = videoEl.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  return clamp(videoEl.currentTime / duration, 0, 1);
}

function updateDownloadButtonState() {
  if (state.isVideoExporting) {
    elements.downloadBtn.disabled = true;
    return;
  }

  const hasMedia = Boolean(state.mediaType);
  const hasWatermark = state.watermarkText.trim().length > 0;
  const hasImageRedactions =
    state.mediaType === "image" && state.redactions.length > 0;

  elements.downloadBtn.disabled = !(
    hasMedia &&
    (hasWatermark || hasImageRedactions)
  );
}

function updateRedactionButtonsState() {
  const hasImage = state.mediaType === "image";
  const hasBoxes = hasImage && state.redactions.length > 0;
  const isDrawing = hasImage && Boolean(state.draftRedaction);

  elements.undoBtn.disabled = !hasImage || !hasBoxes || isDrawing;
  elements.resetBtn.disabled = !hasImage || (!hasBoxes && !isDrawing);
  elements.redactionActions.hidden = !hasBoxes;
}

function updateRedactionHint() {
  if (state.mediaType === "video") {
    elements.redactionHint.textContent =
      "Video mode: watermarking is supported. Redaction boxes are available for images only.";
    return;
  }

  if (state.mediaType === "image") {
    elements.redactionHint.textContent =
      "After loading an image, drag on it to redact sensitive areas.";
    return;
  }

  elements.redactionHint.textContent =
    "After loading an image, drag on it to redact sensitive areas.";
}

function setStatus(message) {
  elements.status.textContent = message;
}

function clearStatus() {
  elements.status.textContent = "";
}

function setError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
}

function computeDynamicWatermarkFontSize(ctx, text, diagonal) {
  const length = text.length;
  const minSize = 22;
  const maxSize = Math.max(64, Math.round(diagonal / 4.5));

  const probeSize = 100;
  ctx.font = `900 ${probeSize}px "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif`;
  const probeWidth = Math.max(1, ctx.measureText(text).width);
  const widthPerPx = probeWidth / probeSize;

  let targetRatio = 0.44;
  if (length <= 12) {
    targetRatio = 0.56;
  } else if (length <= 28) {
    targetRatio = 0.46;
  } else {
    targetRatio = 0.36;
  }

  const targetWidth = diagonal * targetRatio;
  const scaled = Math.round(targetWidth / widthPerPx);
  return clamp(scaled, minSize, maxSize);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
