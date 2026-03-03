import { CRTRenderer } from "./crt-renderer.js";
import { exportMp4 } from "./exporter.js";

const FALLBACK_PRESETS = {
  "Consumer TV": {
    scanlineStrength: 0.45,
    phosphorMask: 0.36,
    barrelDistortion: 0.28,
    bloom: 0.45,
    flicker: 0.1,
    chromaticAberration: 0.3,
    noise: 0.2,
  },
  "PVM/BVM": {
    scanlineStrength: 0.25,
    phosphorMask: 0.6,
    barrelDistortion: 0.08,
    bloom: 0.2,
    flicker: 0.04,
    chromaticAberration: 0.08,
    noise: 0.07,
  },
  Arcade: {
    scanlineStrength: 0.4,
    phosphorMask: 0.45,
    barrelDistortion: 0.22,
    bloom: 0.55,
    flicker: 0.08,
    chromaticAberration: 0.2,
    noise: 0.12,
  },
  "Trinitron RGB Monitor": {
    scanlineStrength: 0.2,
    phosphorMask: 0.72,
    barrelDistortion: 0.04,
    bloom: 0.16,
    flicker: 0.03,
    chromaticAberration: 0.06,
    noise: 0.05,
  },
  "VHS Composite": {
    scanlineStrength: 0.48,
    phosphorMask: 0.28,
    barrelDistortion: 0.26,
    bloom: 0.68,
    flicker: 0.16,
    chromaticAberration: 0.54,
    noise: 0.34,
  },
  "Portable CRT": {
    scanlineStrength: 0.56,
    phosphorMask: 0.34,
    barrelDistortion: 0.32,
    bloom: 0.34,
    flicker: 0.18,
    chromaticAberration: 0.26,
    noise: 0.24,
  },
  "Late-Night Broadcast": {
    scanlineStrength: 0.35,
    phosphorMask: 0.42,
    barrelDistortion: 0.16,
    bloom: 0.5,
    flicker: 0.12,
    chromaticAberration: 0.22,
    noise: 0.2,
  },
};

const renderer = new CRTRenderer();
const canvas = document.getElementById("previewCanvas");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const exportBtn = document.getElementById("exportBtn");
const presetSelect = document.getElementById("presetSelect");

const controlIds = [
  "scanlineStrength",
  "phosphorMask",
  "barrelDistortion",
  "bloom",
  "flicker",
  "chromaticAberration",
  "noise",
];

let hasLoadedImage = false;
let presets = { ...FALLBACK_PRESETS };

function setStatus(message, mode = "info") {
  statusEl.textContent = message;
  statusEl.dataset.mode = mode;
}

function setExportAvailability() {
  exportBtn.disabled = !hasLoadedImage;
}

async function loadPresets() {
  try {
    const module = await import("./presets.js");
    if (module?.PRESETS && Object.keys(module.PRESETS).length > 0) {
      presets = module.PRESETS;
      setStatus("Presets loaded successfully.", "success");
      return;
    }
    setStatus("Preset file loaded but empty. Using built-in presets.", "warn");
  } catch (error) {
    setStatus("Could not load presets.js. Using built-in presets.", "warn");
    console.warn("Preset loading failed", error);
  }
}

function initializePresets() {
  const names = Object.keys(presets);
  presetSelect.innerHTML = "";

  if (names.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No presets available";
    opt.disabled = true;
    opt.selected = true;
    presetSelect.appendChild(opt);
    return;
  }

  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    presetSelect.appendChild(opt);
  }

  const defaultPreset = presets["Consumer TV"] ? "Consumer TV" : names[0];
  presetSelect.value = defaultPreset;
  applyPreset(defaultPreset);
}

function readParams() {
  return Object.fromEntries(controlIds.map((id) => [id, Number(document.getElementById(id).value)]));
}

function applyPreset(name) {
  const values = presets[name];
  if (!values) return;
  for (const id of controlIds) {
    if (typeof values[id] === "number") {
      document.getElementById(id).value = values[id];
    }
  }
  return img;
}

async function loadImageFromFile(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch (error) {
      console.warn("createImageBitmap failed; falling back to Image.decode", error);
    }
  }

  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  img.src = objectUrl;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return img;
}

presetSelect.addEventListener("change", () => {
  applyPreset(presetSelect.value);
  progressEl.value = 0;
  setStatus(`Preset applied: ${presetSelect.value}`, "success");
});

const fpsInput = document.getElementById("fps");
const durationInput = document.getElementById("duration");
let start = performance.now();

function animate(now) {
  const fps = Math.max(1, Number(fpsInput.value) || 60);
  const elapsed = (now - start) / 1000;
  const frame = Math.floor(elapsed * fps);
  renderer.render(ctx, canvas.width, canvas.height, frame / fps, readParams(), frame, fps);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

const imageInput = document.getElementById("imageInput");
imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  progressEl.value = 0.05;
  setStatus(`Processing ${file.name} (${Math.round(file.size / 1024)} KB)...`, "info");

  try {
    const imageSource = await loadImageFromFile(file);
    progressEl.value = 0.4;
    renderer.setImage(imageSource);
    if (typeof imageSource.close === "function") imageSource.close();
    progressEl.value = 1;
    hasLoadedImage = true;
    setExportAvailability();
    start = performance.now();
    setStatus(`Loaded ${file.name}. Ready to export.`, "success");
  } catch (error) {
    hasLoadedImage = false;
    progressEl.value = 0;
    setExportAvailability();
    setStatus(`Couldn't load image: ${error.message}`, "error");
    console.error(error);
  }
});

for (const id of [...controlIds, "fps", "duration"]) {
  document.getElementById(id).addEventListener("input", () => {
    progressEl.value = 0;
  });
}

exportBtn.addEventListener("click", async () => {
  if (!hasLoadedImage) {
    setStatus("Load an image before exporting.", "warn");
    return;
  }

  try {
    exportBtn.disabled = true;
    progressEl.value = 0;
    setStatus("Preparing export...", "info");
    await exportMp4({
      canvas,
      renderer,
      params: readParams(),
      fps: Math.max(1, Number(fpsInput.value) || 60),
      duration: Math.max(0.5, Number(durationInput.value) || 4),
      onProgress: (value, current, total) => {
        progressEl.value = value;
        setStatus(`Encoding frame ${current}/${total}`, "info");
      },
    });
    setStatus("Export finished. Download should begin automatically.", "success");
  } catch (error) {
    setStatus(`Export failed: ${error.message}`, "error");
    console.error(error);
  } finally {
    setExportAvailability();
  }
});

(async function init() {
  setExportAvailability();
  setStatus("Starting renderer and loading presets...", "info");
  await loadPresets();
  initializePresets();
  if (!hasLoadedImage) {
    setStatus("Load an image to begin.", "info");
  }
})();
