"use strict";

const IMAGE_QUALITY = 0.92;
const WATERMARK_ALPHA = 0.22;
const WATERMARK_ANGLE_DEG = -30;

const elements = {
  imageInput: document.getElementById("imageInput"),
  watermarkInput: document.getElementById("watermarkInput"),
  downloadBtn: document.getElementById("downloadBtn"),
  undoBtn: document.getElementById("undoBtn"),
  resetBtn: document.getElementById("resetBtn"),
  previewCanvas: document.getElementById("previewCanvas"),
  previewShell: document.getElementById("previewShell"),
  previewHint: document.getElementById("previewHint"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
};

const state = {
  file: null,
  imageBitmapOrImg: null,
  inputMime: "",
  baseName: "",
  watermarkText: "",
  previewScale: 1,
  objectUrl: null,
  redactions: [],
  draftRedaction: null,
};

let resizeRaf = null;

elements.imageInput.addEventListener("change", onImageSelected);
elements.watermarkInput.addEventListener("input", () => {
  state.watermarkText = elements.watermarkInput.value;
  clearError();
  renderPreview();
  updateDownloadButtonState();
});
elements.downloadBtn.addEventListener("click", downloadResult);
elements.undoBtn.addEventListener("click", undoLastRedaction);
elements.resetBtn.addEventListener("click", resetAllRedactions);
setupImageDropzone();
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

function setupImageDropzone() {
  elements.previewShell.addEventListener("click", () => {
    if (state.imageBitmapOrImg) {
      return;
    }
    clearError();
    openImagePicker();
  });

  elements.previewShell.addEventListener("keydown", (event) => {
    if (state.imageBitmapOrImg) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    clearError();
    openImagePicker();
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

function openImagePicker() {
  elements.imageInput.value = "";
  elements.imageInput.click();
}

function isFileDrag(event) {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes("Files"));
}

function startRedactionDraft(event) {
  if (!state.imageBitmapOrImg || event.button !== 0) {
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
  if (!state.draftRedaction) {
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
  if (!state.draftRedaction) {
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
  if (!state.draftRedaction) {
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

async function onImageSelected(event) {
  const [file] = event.target.files || [];
  await handleSelectedFile(file);
}

async function handleSelectedFile(file) {
  clearStatus();
  clearError();

  if (!file) {
    return;
  }

  try {
    setStatus("Loading image...");
    await loadImage(file);
    setStatus(
      `Loaded ${state.baseName} (${state.imageBitmapOrImg.naturalWidth}x${state.imageBitmapOrImg.naturalHeight}). Drag on the image to add redaction boxes.`,
    );
    renderPreview();
  } catch (error) {
    resetImageState();
    renderPreview();
    setError(error.message || "Could not decode that image.");
  } finally {
    updateDownloadButtonState();
    updateRedactionButtonsState();
  }
}

function resetImageState() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
  state.file = null;
  state.imageBitmapOrImg = null;
  state.inputMime = "";
  state.baseName = "";
  state.previewScale = 1;
  state.redactions = [];
  state.draftRedaction = null;
  elements.previewShell.classList.remove("is-drawing");
}

async function loadImage(file) {
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("Please select a supported image file.");
  }

  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }

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
  state.imageBitmapOrImg = img;
  state.inputMime = file.type.toLowerCase();
  state.baseName = makeBaseName(file.name);
  state.objectUrl = objectUrl;
  state.redactions = [];
  state.draftRedaction = null;
}

function renderPreview() {
  const image = state.imageBitmapOrImg;
  const canvas = elements.previewCanvas;

  if (!image) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = "none";
    elements.previewHint.hidden = false;
    elements.previewShell.classList.remove("has-image");
    elements.previewShell.classList.remove("is-drawing");
    elements.previewShell.setAttribute(
      "aria-label",
      "Click to choose an image or drag and drop one here",
    );
    return;
  }

  const originalWidth = image.naturalWidth;
  const originalHeight = image.naturalHeight;
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
  renderToCanvas(canvas, pixelWidth, pixelHeight, state.watermarkText, {
    includeDraftRedaction: true,
  });
  canvas.style.display = "block";
  elements.previewHint.hidden = true;
  elements.previewShell.classList.add("has-image");
  elements.previewShell.setAttribute(
    "aria-label",
    "Image editor. Drag on the image to draw black redaction boxes.",
  );
}

function renderToCanvas(canvas, width, height, text, options = {}) {
  const image = state.imageBitmapOrImg;
  if (!image) {
    return;
  }

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  drawPersistedRedactions(ctx, width, height);

  const cleanedText = String(text || "").trim();
  if (cleanedText) {
    const diagonal = Math.hypot(width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate((WATERMARK_ANGLE_DEG * Math.PI) / 180);
    ctx.fillStyle = `rgba(255, 255, 255, ${WATERMARK_ALPHA})`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const fontSize = computeDynamicWatermarkFontSize(
      ctx,
      cleanedText,
      diagonal,
    );
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

  if (options.includeDraftRedaction && state.draftRedaction) {
    drawDraftRedaction(ctx, width, height, state.draftRedaction);
  }
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

  if (!state.imageBitmapOrImg || !state.file) {
    setError("Choose or drop an image first.");
    return;
  }

  const cleanedText = state.watermarkText.trim();
  if (!cleanedText && state.redactions.length === 0) {
    setError("Enter watermark text or add at least one redaction box.");
    return;
  }

  try {
    setStatus("Preparing download...");
    const outCanvas = document.createElement("canvas");
    outCanvas.width = state.imageBitmapOrImg.naturalWidth;
    outCanvas.height = state.imageBitmapOrImg.naturalHeight;
    renderToCanvas(outCanvas, outCanvas.width, outCanvas.height, cleanedText);

    const format = deriveExportFormat(state.inputMime);
    const blob = await canvasToBlob(outCanvas, format.mime, format.quality);
    if (!blob) {
      throw new Error("Could not export image in this browser.");
    }

    const downloadName = `${state.baseName || "image"}-watermarked.${format.ext}`;
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    setStatus(`Downloaded ${downloadName}.`);
  } catch (error) {
    setError(error.message || "Failed to create download.");
  }
}

function undoLastRedaction() {
  if (!state.redactions.length) {
    return;
  }
  state.redactions.pop();
  renderPreview();
  updateRedactionButtonsState();
  updateDownloadButtonState();
}

function resetAllRedactions() {
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

function deriveExportFormat(inputMime) {
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
    return "image";
  }
  return trimmed.replace(/\.[^/.]+$/, "") || "image";
}

function updateDownloadButtonState() {
  const hasImage = Boolean(state.imageBitmapOrImg);
  const hasWatermark = state.watermarkText.trim().length > 0;
  const hasRedactions = state.redactions.length > 0;
  elements.downloadBtn.disabled = !(hasImage && (hasWatermark || hasRedactions));
}

function updateRedactionButtonsState() {
  const hasImage = Boolean(state.imageBitmapOrImg);
  const hasBoxes = state.redactions.length > 0;
  const isDrawing = Boolean(state.draftRedaction);

  elements.undoBtn.disabled = !hasImage || !hasBoxes || isDrawing;
  elements.resetBtn.disabled = !hasImage || (!hasBoxes && !isDrawing);
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

  // Measure once at a stable probe size, then scale to a target coverage width.
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
