const FALLBACK_PRESETS = {
  "Consumer TV": {
    scanlineStrength: 0.5,
    phosphorMask: 0.5,
    barrelDistortion: 0,
    bloom: 0.5,
    flicker: 0.22,
    chromaticAberration: 0.5,
    noise: 0.5,
    pixelSize: 1,
  },
  "PVM/BVM": {
    scanlineStrength: 0.25,
    phosphorMask: 0.6,
    barrelDistortion: 0.08,
    bloom: 0.2,
    flicker: 0.12,
    chromaticAberration: 0.08,
    noise: 0.16,
    pixelSize: 1,
  },
  Arcade: {
    scanlineStrength: 0.4,
    phosphorMask: 0.45,
    barrelDistortion: 0.12,
    bloom: 0.55,
    flicker: 0.2,
    chromaticAberration: 0.2,
    noise: 0.3,
    pixelSize: 1,
  },
  "Trinitron RGB Monitor": {
    scanlineStrength: 0.2,
    phosphorMask: 0.72,
    barrelDistortion: 0.04,
    bloom: 0.16,
    flicker: 0.03,
    chromaticAberration: 0.06,
    noise: 0.05,
    pixelSize: 1,
  },
  "VHS Composite": {
    scanlineStrength: 0.48,
    phosphorMask: 0.28,
    barrelDistortion: 0.26,
    bloom: 0.68,
    flicker: 0.16,
    chromaticAberration: 0.54,
    noise: 0.34,
    pixelSize: 2,
  },
  "Portable CRT": {
    scanlineStrength: 0.56,
    phosphorMask: 0.34,
    barrelDistortion: 0.32,
    bloom: 0.34,
    flicker: 0.18,
    chromaticAberration: 0.26,
    noise: 0.24,
    pixelSize: 2,
  },
  "Late-Night Broadcast": {
    scanlineStrength: 0.35,
    phosphorMask: 0.42,
    barrelDistortion: 0.16,
    bloom: 0.5,
    flicker: 0.12,
    chromaticAberration: 0.22,
    noise: 0.2,
    pixelSize: 1,
  },
};

const MP4_MUXER_CDN = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.2/build/mp4-muxer.mjs";

function seededNoise(x, y, frame) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + frame * 19.17) * 43758.5453;
  return v - Math.floor(v);
}

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

class CRTRenderer {
  constructor() {
    this.sourceCanvas = document.createElement("canvas");
    this.fitCanvas = document.createElement("canvas");
    this.workCanvas = document.createElement("canvas");
    this.hasImage = false;
  }

  setImage(img, sourceScale = 1) {
    const inputWidth = img.naturalWidth || img.videoWidth || img.width;
    const inputHeight = img.naturalHeight || img.videoHeight || img.height;
    const scale = Math.max(0.1, Math.min(1, sourceScale || 1));
    this.sourceCanvas.width = Math.max(1, Math.round(inputWidth * scale));
    this.sourceCanvas.height = Math.max(1, Math.round(inputHeight * scale));
    const ctx = this.sourceCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, inputWidth, inputHeight, 0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
    this.hasImage = true;
  }

  sampleBilinear(data, width, height, u, v, channel) {
    const x = Math.max(0, Math.min(width - 1, u * (width - 1)));
    const y = Math.max(0, Math.min(height - 1, v * (height - 1)));
    const x0 = Math.floor(x);
    const x1 = Math.min(width - 1, x0 + 1);
    const y0 = Math.floor(y);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;

    const i00 = (y0 * width + x0) * 4 + channel;
    const i10 = (y0 * width + x1) * 4 + channel;
    const i01 = (y1 * width + x0) * 4 + channel;
    const i11 = (y1 * width + x1) * 4 + channel;

    const a = data[i00] * (1 - tx) + data[i10] * tx;
    const b = data[i01] * (1 - tx) + data[i11] * tx;
    return a * (1 - ty) + b * ty;
  }

  render(outCtx, width, height, seconds, params, frameIndex, fps) {
    outCtx.clearRect(0, 0, width, height);
    outCtx.fillStyle = "black";
    outCtx.fillRect(0, 0, width, height);
    if (!this.hasImage) return;

    this.fitCanvas.width = width;
    this.fitCanvas.height = height;
    const fitCtx = this.fitCanvas.getContext("2d", { willReadFrequently: true });
    fitCtx.clearRect(0, 0, width, height);
    fitCtx.imageSmoothingEnabled = true;
    fitCtx.imageSmoothingQuality = "high";

    const src = this.sourceCanvas;
    const srcAspect = src.width / src.height;
    const dstAspect = width / height;
    let sw = src.width;
    let sh = src.height;
    let sx = 0;
    let sy = 0;

    if (srcAspect > dstAspect) {
      sw = src.height * dstAspect;
      sx = (src.width - sw) / 2;
    } else {
      sh = src.width / dstAspect;
      sy = (src.height - sh) / 2;
    }

    fitCtx.drawImage(src, sx, sy, sw, sh, 0, 0, width, height);

    this.workCanvas.width = width;
    this.workCanvas.height = height;
    const wctx = this.workCanvas.getContext("2d", { willReadFrequently: true });
    const srcPixels = fitCtx.getImageData(0, 0, width, height);
    const outPixels = wctx.createImageData(width, height);
    const srcData = srcPixels.data;
    const dstData = outPixels.data;

    const barrel = Math.max(-0.8, Math.min(0.8, params.barrelDistortion));
    const ca = params.chromaticAberration;
    const scan = params.scanlineStrength;
    const mask = params.phosphorMask;
    const pixelSize = Math.max(1, Number(params.pixelSize) || 1);
    const pixelInfluence = 1 + (pixelSize - 1) * 0.22;
    const pixelStepX = width > 1 ? 1 / (width - 1) : 0;
    const pixelStepY = height > 1 ? 1 / (height - 1) : 0;

    for (let y = 0; y < height; y++) {
      const ny = (y / (height - 1)) * 2 - 1;
      const scanPhase = Math.sin((y + 0.5) * Math.PI);
      const scanlineGain = 1 - scan * (0.35 + 0.65 * (0.5 + 0.5 * scanPhase));

      for (let x = 0; x < width; x++) {
        const nx = (x / (width - 1)) * 2 - 1;
        const r2 = nx * nx + ny * ny;
        const warpCurve = 0.22 + 0.78 * r2;
        const warp = Math.max(0.35, 1 + barrel * warpCurve);
        const srcNx = nx / warp;
        const srcNy = ny / warp;
        const u = srcNx * 0.5 + 0.5;
        const v = srcNy * 0.5 + 0.5;

        const outIndex = (y * width + x) * 4;
        if (u < 0 || u > 1 || v < 0 || v > 1) {
          dstData[outIndex] = 0;
          dstData[outIndex + 1] = 0;
          dstData[outIndex + 2] = 0;
          dstData[outIndex + 3] = 255;
          continue;
        }

        const edgeShift = ca * (0.0012 + r2 * 0.0045) * (0.8 + (pixelSize - 1) * 0.22);
        const qx = Math.floor((u * width) / pixelSize) * pixelSize + pixelSize * 0.5;
        const qy = Math.floor((v * height) / pixelSize) * pixelSize + pixelSize * 0.5;
        const qu = Math.max(0, Math.min(1, qx / width));
        const qv = Math.max(0, Math.min(1, qy / height));

        const ru = qu + edgeShift * (0.7 + Math.abs(nx));
        const gu = qu;
        const bu = qu - edgeShift * (0.7 + Math.abs(nx));

        const red = this.sampleBilinear(srcData, width, height, ru, qv, 0)
        const green = this.sampleBilinear(srcData, width, height, gu, qv, 1)
        const blue = this.sampleBilinear(srcData, width, height, bu, qv, 2)

        const redHoriz =
          this.sampleBilinear(srcData, width, height, ru - pixelStepX, qv, 0) * 0.5 +
          this.sampleBilinear(srcData, width, height, ru + pixelStepX, qv, 0) * 0.5;
        const greenHoriz =
          this.sampleBilinear(srcData, width, height, gu - pixelStepX, qv, 1) * 0.5 +
          this.sampleBilinear(srcData, width, height, gu + pixelStepX, qv, 1) * 0.5;
        const blueHoriz =
          this.sampleBilinear(srcData, width, height, bu - pixelStepX, qv, 2) * 0.5 +
          this.sampleBilinear(srcData, width, height, bu + pixelStepX, qv, 2) * 0.5;

        const redVert =
          this.sampleBilinear(srcData, width, height, ru, qv - pixelStepY, 0) * 0.5 +
          this.sampleBilinear(srcData, width, height, ru, qv + pixelStepY, 0) * 0.5;
        const greenVert =
          this.sampleBilinear(srcData, width, height, gu, qv - pixelStepY, 1) * 0.5 +
          this.sampleBilinear(srcData, width, height, gu, qv + pixelStepY, 1) * 0.5;
        const blueVert =
          this.sampleBilinear(srcData, width, height, bu, qv - pixelStepY, 2) * 0.5 +
          this.sampleBilinear(srcData, width, height, bu, qv + pixelStepY, 2) * 0.5;

        const luminance = Math.max(red, green, blue) / 255;
        const bleed = (0.08 + params.bloom * 0.26 + mask * 0.08) * pixelInfluence * Math.pow(luminance, 0.75);
        const blend = Math.min(0.45, bleed);

        const triad = x % 3;
        const boost = 1 + mask * 0.52;
        const dim = 1 - mask * 0.32;
        const rMask = triad === 0 ? boost : dim;
        const gMask = triad === 1 ? boost : dim;
        const bMask = triad === 2 ? boost : dim;

        const dither = (BAYER_4X4[y & 3][x & 3] / 15 - 0.5) * (1.4 + params.noise * 2.2);

        const redSoft = red * (1 - blend) + (redHoriz * 0.62 + redVert * 0.38) * blend;
        const greenSoft = green * (1 - blend) + (greenHoriz * 0.62 + greenVert * 0.38) * blend;
        const blueSoft = blue * (1 - blend) + (blueHoriz * 0.62 + blueVert * 0.38) * blend;

        dstData[outIndex] = Math.min(255, Math.max(0, redSoft * scanlineGain * rMask + dither));
        dstData[outIndex + 1] = Math.min(255, Math.max(0, greenSoft * scanlineGain * gMask + dither));
        dstData[outIndex + 2] = Math.min(255, Math.max(0, blueSoft * scanlineGain * bMask + dither));
        dstData[outIndex + 3] = 255;
      }
    }

    wctx.putImageData(outPixels, 0, 0);
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = "high";
    outCtx.drawImage(this.workCanvas, 0, 0);

    const bloom = params.bloom;
    if (bloom > 0) {
      outCtx.save();
      outCtx.globalCompositeOperation = "screen";
      outCtx.globalAlpha = Math.min(0.8, (0.16 + bloom * 0.34) * pixelInfluence);
      outCtx.filter = `blur(${(0.8 + bloom * 5.6) * (1 + (pixelSize - 1) * 0.12)}px) brightness(${1 + bloom * 0.55})`;
      outCtx.drawImage(this.workCanvas, 0, 0);
      outCtx.restore();

      outCtx.save();
      outCtx.globalCompositeOperation = "lighter";
      outCtx.globalAlpha = Math.min(0.7, (0.08 + bloom * 0.24) * pixelInfluence);
      outCtx.filter = `blur(${(0.4 + bloom * 2.4) * (1 + (pixelSize - 1) * 0.1)}px)`;
      outCtx.drawImage(this.workCanvas, 1, 0);
      outCtx.drawImage(this.workCanvas, -1, 0);
      outCtx.restore();
    }

    const vignette = Math.min(0.35, 0.08 + Math.abs(barrel) * 0.22);
    const grad = outCtx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.22,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.6,
    );
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(0,0,0,${vignette.toFixed(3)})`);
    outCtx.fillStyle = grad;
    outCtx.fillRect(0, 0, width, height);

    const frameSeconds = frameIndex / fps;
    const flickerWaveA = Math.sin(frameSeconds * Math.PI * 2 * 1.94) * 0.5 + 0.5;
    const flickerWaveB = Math.sin(frameSeconds * Math.PI * 2 * 0.61 + 1.7) * 0.5 + 0.5;
    const flicker = params.flicker * (0.4 + 0.6 * (0.65 * flickerWaveA + 0.35 * flickerWaveB));
    outCtx.fillStyle = `rgba(255,255,255,${(flicker * 0.2).toFixed(3)})`;
    outCtx.fillRect(0, 0, width, height);

    const retraceY = ((frameSeconds * 1.45) % 1) * height;
    const retraceBand = Math.max(6, Math.floor(height * 0.02));
    const retraceGrad = outCtx.createLinearGradient(0, retraceY - retraceBand, 0, retraceY + retraceBand);
    retraceGrad.addColorStop(0, "rgba(255,255,255,0)");
    retraceGrad.addColorStop(0.5, `rgba(255,255,255,${(params.flicker * 0.12).toFixed(3)})`);
    retraceGrad.addColorStop(1, "rgba(255,255,255,0)");
    outCtx.fillStyle = retraceGrad;
    outCtx.fillRect(0, retraceY - retraceBand, width, retraceBand * 2);

    const jitterPx = params.flicker * (seededNoise(frameIndex, frameSeconds, 17) - 0.5) * 2.6;
    if (Math.abs(jitterPx) > 0.01) {
      outCtx.save();
      outCtx.globalAlpha = Math.min(0.14, 0.05 + params.flicker * 0.12);
      outCtx.drawImage(outCtx.canvas, jitterPx, 0);
      outCtx.restore();
    }

    if (params.noise > 0) {
      const count = Math.floor(width * height * 0.008 * params.noise);
      for (let i = 0; i < count; i++) {
        const x = Math.floor(seededNoise(i, seconds, frameIndex) * width);
        const y = Math.floor(seededNoise(i * 2, seconds + 3.1, frameIndex) * height);
        const grain = seededNoise(x + frameIndex * 0.3, y, frameIndex);
        const a = (0.02 + grain * 0.28) * params.noise;
        outCtx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        outCtx.fillRect(x, y, 1, 1);
      }

      const burst = seededNoise(frameIndex, frameSeconds * 10, 91);
      if (burst > 0.91) {
        const bandY = Math.floor(seededNoise(frameIndex, burst, 37) * height);
        const bandH = Math.max(3, Math.floor(height * 0.012));
        outCtx.fillStyle = `rgba(255,255,255,${(params.noise * 0.22).toFixed(3)})`;
        outCtx.fillRect(0, bandY, width, bandH);
      }
    }
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function getAvcCodecForResolution(width, height) {
  const macroblocksPerFrame = Math.ceil(width / 16) * Math.ceil(height / 16);

  // AVC level limits (max frame size in macroblocks).
  const levelByMaxFs = [
    { maxFs: 99, levelHex: "0a" },
    { maxFs: 396, levelHex: "15" },
    { maxFs: 1620, levelHex: "1e" },
    { maxFs: 3600, levelHex: "1f" },
    { maxFs: 8192, levelHex: "28" },
    { maxFs: 8704, levelHex: "29" },
    { maxFs: 22080, levelHex: "32" },
    { maxFs: 36864, levelHex: "33" },
    { maxFs: 139264, levelHex: "34" },
  ];

  const match = levelByMaxFs.find((entry) => macroblocksPerFrame <= entry.maxFs);
  const levelHex = match ? match.levelHex : "34";

  // Baseline profile (42 00) + computed level to avoid level-3.1 limits on larger videos.
  return `avc1.4200${levelHex}`;
}

function getTargetBitrate(width, height, fps) {
  const pixelsPerSecond = width * height * Math.max(1, fps);
  const estimated = Math.round(pixelsPerSecond * 0.11);
  return Math.max(5_000_000, Math.min(35_000_000, estimated));
}

async function exportMp4({ canvas, renderer, params, paramsResolver, fps, duration, beforeRenderFrame, onProgress, signal, bitrateScale = 1 }) {
  if (!("VideoEncoder" in window)) {
    throw new Error("WebCodecs VideoEncoder is unavailable in this browser/context.");
  }

  const { Muxer, ArrayBufferTarget } = await import(MP4_MUXER_CDN);
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new DOMException("Export cancelled by user.", "AbortError");
    }
  };
  throwIfAborted();
  const width = canvas.width;
  const height = canvas.height;
  const totalFrames = Math.max(1, Math.floor(duration * fps));
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

  let encoderFailure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderFailure = err;
    },
  });

  const codec = getAvcCodecForResolution(width, height);
  const bitrate = Math.max(250_000, Math.round(getTargetBitrate(width, height, fps) * Math.max(0.5, bitrateScale)));

  try {
    encoder.configure({
      codec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: "quality",
      hardwareAcceleration: "prefer-hardware",
    });
  } catch (error) {
    console.warn("Hardware-accelerated encoder config unavailable; falling back.", error);
    encoder.configure({
      codec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: "quality",
    });
  }

  for (let frame = 0; frame < totalFrames; frame++) {
    throwIfAborted();
    if (encoderFailure) {
      throw encoderFailure;
    }

    const t = frame / fps;
    if (beforeRenderFrame) await beforeRenderFrame(t, frame, fps);
    const frameParams = paramsResolver ? paramsResolver(t, duration) : params;
    renderer.render(ctx, width, height, t, frameParams, frame, fps);

    const videoFrame = new VideoFrame(canvas, {
      timestamp: Math.round((frame * 1_000_000) / fps),
      duration: Math.round(1_000_000 / fps),
    });

    try {
      encoder.encode(videoFrame);
    } finally {
      videoFrame.close();
    }

    onProgress?.((frame + 1) / totalFrames, frame + 1, totalFrames);

    if (frame % 30 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  throwIfAborted();
  if (encoderFailure) {
    throw encoderFailure;
  }
  encoder.close();
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: "video/mp4" });
  downloadBlob(blob, `crt-export-${Date.now()}.mp4`);
}

function getSupportedWebmMimeType(withAudio) {
  const candidates = withAudio
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

async function exportWebmRealtime({ canvas, renderer, params, paramsResolver, fps, duration, loadedSourceType, loadedVideo, loadedImage, sourceScale, onProgress, signal, includeAudio }) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const totalFrames = Math.max(1, Math.floor(duration * fps));

  const stream = canvas.captureStream(fps);
  const sourceVideo = loadedSourceType === "video" ? loadedVideo?.video : null;
  const wantsAudio = includeAudio && !!sourceVideo;

  if (wantsAudio) {
    try {
      const mediaStream = sourceVideo.captureStream?.() || sourceVideo.mozCaptureStream?.();
      const audioTrack = mediaStream?.getAudioTracks?.()[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
      }
    } catch (error) {
      console.warn("Couldn't capture original audio track; exporting without audio.", error);
    }
  }

  const mimeType = getSupportedWebmMimeType(wantsAudio);
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: getTargetBitrate(width, height, fps),
  });

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  });

  const stopPromise = new Promise((resolve) => {
    recorder.addEventListener("stop", resolve, { once: true });
  });

  recorder.start(250);

  if (sourceVideo) {
    await seekVideo(sourceVideo, 0);
    sourceVideo.pause();
  }

  const start = performance.now();
  for (let frame = 0; frame < totalFrames; frame++) {
    if (signal?.aborted) {
      recorder.stop();
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const t = frame / fps;
    if (sourceVideo) {
      await seekVideo(sourceVideo, t);
      renderer.setImage(sourceVideo, sourceScale());
    } else if (loadedImage) {
      renderer.setImage(loadedImage, sourceScale());
    }

    const frameParams = paramsResolver ? paramsResolver(t, duration) : params;
    renderer.render(ctx, width, height, t, frameParams, frame, fps);
    onProgress?.((frame + 1) / totalFrames, frame + 1, totalFrames);

    const nextFrameAt = start + ((frame + 1) * 1000) / fps;
    const delay = Math.max(0, nextFrameAt - performance.now());
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  recorder.stop();
  await stopPromise;

  for (const track of stream.getTracks()) {
    track.stop();
  }

  const blob = new Blob(chunks, { type: mimeType });
  downloadBlob(blob, `crt-export-${Date.now()}.webm`);
}

(async function boot() {
  const renderer = new CRTRenderer();
  const canvas = document.getElementById("previewCanvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const statusEl = document.getElementById("status");
  const progressEl = document.getElementById("progress");
  const previewBuffer = document.createElement("canvas");
  const exportBtn = document.getElementById("exportBtn");
  const cancelExportBtn = document.getElementById("cancelExportBtn");
  const resetParamsBtn = document.getElementById("resetParamsBtn");
  const resetSourceBtn = document.getElementById("resetSourceBtn");
  const imageInput = document.getElementById("imageInput");
  const presetSelect = document.getElementById("presetSelect");
  const keyframeTimeInput = document.getElementById("keyframeTime");
  const keyframeList = document.getElementById("keyframeList");
  const addKeyframeBtn = document.getElementById("addKeyframeBtn");
  const updateKeyframeBtn = document.getElementById("updateKeyframeBtn");
  const deleteKeyframeBtn = document.getElementById("deleteKeyframeBtn");
  const clearKeyframesBtn = document.getElementById("clearKeyframesBtn");

  const controlIds = [
    "scanlineStrength",
    "phosphorMask",
    "barrelDistortion",
    "bloom",
    "flicker",
    "chromaticAberration",
    "noise",
    "pixelSize",
  ];

  let hasLoadedSource = false;
  let loadedSourceType = "image";
  let loadedVideo = null;
  let loadedImage = null;
  const presetSchemaKeys = [
    "scanlineStrength",
    "phosphorMask",
    "barrelDistortion",
    "bloom",
    "flicker",
    "chromaticAberration",
    "noise",
    "pixelSize",
  ];

  let presets = { ...FALLBACK_PRESETS };
  let start = performance.now();
  let previewFrameSeconds = 0;
  let previewTargetSeconds = 0;
  let previewNeedsSeek = false;
  let lastPreviewTick = 0;
  let defaultParamValues = null;
  let activeExportController = null;
  let isExporting = false;
  let previewDirty = true;
  let effectKeyframes = [];
  let selectedKeyframeTime = null;

  function setupRangeWithNumber(id) {
    const slider = document.getElementById(id);
    if (!slider) return;
    const wrapper = slider.closest(".range-control");
    if (!wrapper) return;

    const numericInput = document.createElement("input");
    numericInput.type = "number";
    numericInput.className = "range-number";
    numericInput.min = slider.min;
    numericInput.max = slider.max;
    numericInput.step = slider.step || "any";
    numericInput.value = slider.value;
    numericInput.setAttribute("aria-label", `${id} numeric value`);
    wrapper.appendChild(numericInput);

    const syncToNumber = () => {
      numericInput.value = slider.value;
      numericInput.disabled = slider.disabled;
    };

    const clampToRange = (value) => {
      const min = Number(slider.min);
      const max = Number(slider.max);
      let next = Number(value);
      if (!Number.isFinite(next)) return Number(slider.value);
      if (Number.isFinite(min)) next = Math.max(min, next);
      if (Number.isFinite(max)) next = Math.min(max, next);
      return next;
    };

    numericInput.addEventListener("input", () => {
      const next = clampToRange(numericInput.value);
      slider.value = String(next);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    numericInput.addEventListener("change", () => {
      const next = clampToRange(numericInput.value);
      slider.value = String(next);
      numericInput.value = slider.value;
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });

    slider.addEventListener("input", syncToNumber);
    slider.addEventListener("change", syncToNumber);
    slider.__syncRangeNumber = syncToNumber;
    syncToNumber();
  }

  function setupSelectionBox(id, { onChange, valueParser = (value) => value, disabledWhen } = {}) {
    const root = document.getElementById(id);
    if (!root) return { getValue: () => undefined, setValue: () => {}, setDisabled: () => {} };

    const buttons = Array.from(root.querySelectorAll("button[data-value]"));
    let current = buttons.find((btn) => btn.dataset.selected === "true")?.dataset.value ?? buttons[0]?.dataset.value;

    const setSelectedVisual = () => {
      for (const btn of buttons) {
        const active = btn.dataset.value === current;
        btn.dataset.selected = active ? "true" : "false";
        btn.setAttribute("aria-checked", active ? "true" : "false");
      }
    };

    const setDisabled = (disabled) => {
      root.dataset.disabled = disabled ? "true" : "false";
      for (const btn of buttons) {
        btn.disabled = !!disabled;
      }
    };

    const setValue = (value, { silent = false } = {}) => {
      const next = String(value);
      if (!buttons.some((btn) => btn.dataset.value === next)) return;
      current = next;
      setSelectedVisual();
      if (!silent) onChange?.(valueParser(current));
    };

    for (const btn of buttons) {
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        setValue(btn.dataset.value);
      });
    }

    setSelectedVisual();
    if (typeof disabledWhen === "boolean") setDisabled(disabledWhen);

    return {
      getValue: () => valueParser(current),
      setValue: (value, options) => setValue(value, options),
      setDisabled,
    };
  }

  function setStatus(message, mode = "info") {
    statusEl.textContent = message;
    statusEl.dataset.mode = mode;
  }

  function setExportAvailability() {
    exportBtn.disabled = !hasLoadedSource || isExporting;
    cancelExportBtn.disabled = !isExporting;
    resetSourceBtn.disabled = isExporting;
    resetParamsBtn.disabled = isExporting;
    imageInput.disabled = isExporting;
    document.getElementById("fps").disabled = isExporting;
    document.getElementById("duration").disabled = isExporting;
    document.getElementById("exportQuality").disabled = isExporting;
    keyframeTimeInput.disabled = isExporting;
    keyframeList.disabled = isExporting;
    addKeyframeBtn.disabled = isExporting;
    if (isExporting) {
      updateKeyframeBtn.disabled = true;
      deleteKeyframeBtn.disabled = true;
      clearKeyframesBtn.disabled = true;
    } else {
      updateKeyframeActionState();
    }
    exportFormatControl?.setDisabled(isExporting);
    updateExportControlsState();
  }

  let previewModeControl;
  let previewScaleControl;
  let sourceScaleControl;
  let previewMaxPixelsControl;
  let presetControl;
  let exportFormatControl;

  function isStillPreviewMode() {
    return previewModeControl?.getValue() === "still";
  }

  function getPreviewScale() {
    return Math.max(0.1, Number(previewScaleControl?.getValue()) || 1);
  }

  function getSourceScale() {
    return Math.max(0.1, Number(sourceScaleControl?.getValue()) || 1);
  }

  function getPreviewMaxPixels() {
    return Math.max(0, Number(previewMaxPixelsControl?.getValue()) || 0);
  }

  function markPreviewDirty() {
    previewDirty = true;
  }

  function getPreviewRenderSize() {
    const scale = getPreviewScale();
    let width = Math.max(1, Math.round(canvas.width * scale));
    let height = Math.max(1, Math.round(canvas.height * scale));
    const maxPixels = getPreviewMaxPixels();
    if (maxPixels > 0) {
      const pixels = width * height;
      if (pixels > maxPixels) {
        const factor = Math.sqrt(maxPixels / pixels);
        width = Math.max(1, Math.round(width * factor));
        height = Math.max(1, Math.round(height * factor));
      }
    }
    return { width, height };
  }

  function refreshRendererSource() {
    if (loadedSourceType === "video" && loadedVideo?.video) {
      renderer.setImage(loadedVideo.video, getSourceScale());
      markPreviewDirty();
      return;
    }
    if (loadedSourceType === "image" && loadedImage) {
      renderer.setImage(loadedImage, getSourceScale());
      markPreviewDirty();
    }
  }

  function updatePreviewControlsState() {
    const isVideo = loadedSourceType === "video" && loadedVideo?.video;
    const stillMode = isStillPreviewMode();
    const previewTime = document.getElementById("previewTime");
    const previewFps = document.getElementById("previewFps");

    previewTime.disabled = !isVideo;
    previewFps.disabled = !isVideo || stillMode;
    previewModeControl?.setDisabled(!isVideo);
  }

  function syncPreviewTimeControl() {
    const previewTime = document.getElementById("previewTime");
    const max = loadedVideo?.video?.duration ? Math.max(0, loadedVideo.video.duration - 0.001) : 0;
    previewTime.max = max.toFixed(3);
    previewTargetSeconds = Math.max(0, Math.min(previewTargetSeconds, max));
    previewFrameSeconds = previewTargetSeconds;
    previewTime.value = previewTargetSeconds.toFixed(3);
    previewTime.__syncRangeNumber?.();
    previewNeedsSeek = loadedSourceType === "video";
  }


  function updateExportControlsState() {
    const includeAudio = document.getElementById("includeOriginalAudio");
    const isVideo = loadedSourceType === "video" && loadedVideo?.video;
    includeAudio.disabled = isExporting || !isVideo;
    if (!isVideo) includeAudio.checked = false;
  }

  function syncVideoPlaybackState() {
    const video = loadedVideo?.video;
    if (!video) return;

    if (isStillPreviewMode()) {
      if (!video.paused) {
        video.pause();
      }
      return;
    }

    if (video.paused) {
      video.play().catch(() => {});
    }
  }



  function resetParameters() {
    const targetValues = defaultParamValues || readParams();
    for (const id of controlIds) {
      if (typeof targetValues[id] === "number") {
        const slider = document.getElementById(id);
        slider.value = targetValues[id];
        slider.__syncRangeNumber?.();
      }
    }
    sourceScaleControl?.setValue("1", { silent: true });
    refreshRendererSource();
    if (loadedSourceType === "video" && isStillPreviewMode()) {
      previewNeedsSeek = true;
    }
    markPreviewDirty();
    progressEl.value = 0;
    setStatus("Parameters reset to defaults.", "success");
  }

  function clearLoadedSource({ silent = false } = {}) {
    if (loadedVideo?.video) {
      loadedVideo.video.pause();
      loadedVideo.video.removeAttribute("src");
      loadedVideo.video.load();
    }
    if (loadedVideo?.objectUrl) {
      URL.revokeObjectURL(loadedVideo.objectUrl);
    }
    if (loadedImage && typeof loadedImage.close === "function") {
      loadedImage.close();
    }

    loadedVideo = null;
    loadedImage = null;
    loadedSourceType = "image";
    hasLoadedSource = false;
    renderer.hasImage = false;

    canvas.width = 960;
    canvas.height = 540;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    imageInput.value = "";
    document.getElementById("duration").value = "4";
    previewTargetSeconds = 0;
    previewFrameSeconds = 0;
    previewNeedsSeek = false;
    syncPreviewTimeControl();
    updatePreviewControlsState();
    updateExportControlsState();
    progressEl.value = 0;
    markPreviewDirty();
    setExportAvailability();

    if (!silent) {
      setStatus("Source reset. Load a new image or video.", "info");
    }
  }

  function readParams() {
    return Object.fromEntries(controlIds.map((id) => [id, Number(document.getElementById(id).value)]));
  }

  function getExportDurationSeconds() {
    return Math.max(0.5, Number(document.getElementById("duration").value) || 4);
  }

  function clampKeyframeTime(time) {
    return Math.max(0, Math.min(Number(time) || 0, getExportDurationSeconds()));
  }

  function updateKeyframeActionState() {
    const hasSelection = selectedKeyframeTime !== null
      && effectKeyframes.some((entry) => Math.abs(entry.time - selectedKeyframeTime) < 0.0005);
    updateKeyframeBtn.disabled = !hasSelection;
    deleteKeyframeBtn.disabled = !hasSelection;
    clearKeyframesBtn.disabled = effectKeyframes.length === 0;
  }

  function renderKeyframeList() {
    keyframeList.innerHTML = "";
    for (const keyframe of effectKeyframes) {
      const opt = document.createElement("option");
      const summary = presetSchemaKeys
        .map((id) => `${id}: ${Number(keyframe.params[id] || 0).toFixed(id === "pixelSize" ? 0 : 2)}`)
        .join(" · ");
      opt.value = String(keyframe.time);
      opt.textContent = `${keyframe.time.toFixed(2)}s — ${summary}`;
      if (selectedKeyframeTime !== null && Math.abs(keyframe.time - selectedKeyframeTime) < 0.0005) {
        opt.selected = true;
      }
      keyframeList.appendChild(opt);
    }
    if (keyframeList.selectedIndex === -1 && keyframeList.options.length > 0) {
      keyframeList.selectedIndex = 0;
      selectedKeyframeTime = Number(keyframeList.value);
    }
    updateKeyframeActionState();
  }

  function upsertKeyframe(timeSeconds, params) {
    const time = clampKeyframeTime(timeSeconds);
    const existingIndex = effectKeyframes.findIndex((entry) => Math.abs(entry.time - time) < 0.0005);
    const nextEntry = {
      time,
      params: { ...params },
    };

    if (existingIndex >= 0) {
      effectKeyframes[existingIndex] = nextEntry;
    } else {
      effectKeyframes.push(nextEntry);
    }

    effectKeyframes.sort((a, b) => a.time - b.time);
    selectedKeyframeTime = time;
    keyframeTimeInput.value = time.toFixed(2);
    renderKeyframeList();
    markPreviewDirty();
  }

  function removeSelectedKeyframe() {
    if (selectedKeyframeTime === null) return;
    effectKeyframes = effectKeyframes.filter((entry) => Math.abs(entry.time - selectedKeyframeTime) >= 0.0005);
    selectedKeyframeTime = effectKeyframes.length > 0 ? effectKeyframes[0].time : null;
    renderKeyframeList();
    markPreviewDirty();
  }

  function getAnimatedParamsAtTime(timeSeconds, durationSeconds, fallbackParams, { holdEdgeValues = true } = {}) {
    const baseParams = fallbackParams || readParams();
    if (!effectKeyframes.length) {
      return baseParams;
    }

    const maxTime = Math.max(0.0001, durationSeconds || getExportDurationSeconds());
    const t = Math.max(0, Math.min(timeSeconds, maxTime));

    const first = effectKeyframes[0];
    const last = effectKeyframes[effectKeyframes.length - 1];

    if (t <= first.time) return holdEdgeValues ? { ...first.params } : { ...baseParams };
    if (t >= last.time) return holdEdgeValues ? { ...last.params } : { ...baseParams };

    for (let i = 0; i < effectKeyframes.length - 1; i++) {
      const left = effectKeyframes[i];
      const right = effectKeyframes[i + 1];
      if (t >= left.time && t <= right.time) {
        const span = Math.max(0.000001, right.time - left.time);
        const alpha = (t - left.time) / span;
        const blended = {};
        for (const id of controlIds) {
          const a = Number(left.params[id] ?? baseParams[id] ?? 0);
          const b = Number(right.params[id] ?? baseParams[id] ?? 0);
          const value = a + (b - a) * alpha;
          blended[id] = id === "pixelSize" ? Math.max(1, Math.round(value)) : value;
        }
        return blended;
      }
    }

    return { ...baseParams };
  }

  function applyPreset(name) {
    const values = presets[name];
    if (!values) return;
    for (const id of controlIds) {
      if (typeof values[id] === "number") {
        const slider = document.getElementById(id);
        slider.value = values[id];
        slider.__syncRangeNumber?.();
      }
    }
  }

  function isValidPresetValues(values) {
    if (!values || typeof values !== "object") return false;
    return presetSchemaKeys.every((key) => typeof values[key] === "number");
  }

  async function loadPresets() {
    try {
      const module = await import("./presets.js");
      if (module?.PRESETS && Object.keys(module.PRESETS).length > 0) {
        const entries = Object.entries(module.PRESETS);
        const hasInvalidPreset = entries.some(([, values]) => !isValidPresetValues(values));
        if (hasInvalidPreset) {
          setStatus("Preset file loaded with invalid schema. Using built-in presets.", "warn");
          return;
        }

        presets = { ...presets, ...module.PRESETS };
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
      const message = document.createElement("div");
      message.className = "selection-empty";
      message.textContent = "No presets available";
      presetSelect.appendChild(message);
      return;
    }

    for (const name of names) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.value = name;
      button.textContent = name;
      if (name === "Consumer TV") {
        button.dataset.selected = "true";
      }
      presetSelect.appendChild(button);
    }

    presetControl = setupSelectionBox("presetSelect", {
      onChange: (name) => {
        applyPreset(name);
        markPreviewDirty();
        progressEl.value = 0;
        setStatus(`Preset applied: ${name}`, "success");
      },
    });

    const defaultPreset = presets["Consumer TV"] ? "Consumer TV" : names[0];
    presetControl.setValue(defaultPreset, { silent: true });
    applyPreset(defaultPreset);
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

  function waitForVideoEvent(video, eventName) {
    return new Promise((resolve) => {
      const handler = () => {
        video.removeEventListener(eventName, handler);
        resolve();
      };
      video.addEventListener(eventName, handler, { once: true });
    });
  }

  async function loadVideoFromFile(file) {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.load();
    await waitForVideoEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("Video metadata is invalid or duration is unavailable.");
    }
    return { video, objectUrl };
  }

  async function seekVideo(video, timeSeconds) {
    const clamped = Math.max(0, Math.min(timeSeconds, Math.max(0, video.duration - 0.000001)));
    if (Math.abs(video.currentTime - clamped) < 0.0005) return;
    video.currentTime = clamped;
    await waitForVideoEvent(video, "seeked");
  }

  function animate(now) {
    const fps = Math.max(1, Number(document.getElementById("fps").value) || 30);
    const elapsed = (now - start) / 1000;
    const frame = Math.floor(elapsed * fps);
    const stillMode = isStillPreviewMode();

    if (loadedSourceType === "video" && loadedVideo?.video) {
      const video = loadedVideo.video;
      syncVideoPlaybackState();
      if (isStillPreviewMode()) {
        if (previewNeedsSeek || Math.abs(video.currentTime - previewTargetSeconds) > 0.0005) {
          previewNeedsSeek = false;
          seekVideo(video, previewTargetSeconds)
            .then(() => {
              previewFrameSeconds = previewTargetSeconds;
              renderer.setImage(video, getSourceScale());
              markPreviewDirty();
            })
            .catch((error) => {
              previewNeedsSeek = true;
              console.warn("Preview seek failed", error);
            });
        }
      } else {
        const previewFps = Math.max(1, Number(document.getElementById("previewFps").value) || 15);
        const minInterval = 1000 / previewFps;
        if (now - lastPreviewTick >= minInterval) {
          lastPreviewTick = now;
          renderer.setImage(video, getSourceScale());
          previewFrameSeconds = video.currentTime;
          markPreviewDirty();
          previewTargetSeconds = previewFrameSeconds;
          document.getElementById("previewTime").value = previewFrameSeconds.toFixed(3);
          document.getElementById("previewTime").__syncRangeNumber?.();
        }
      }
    }

    const shouldRender = previewDirty;
    if (shouldRender) {
      const { width: previewWidth, height: previewHeight } = getPreviewRenderSize();
      if (previewWidth === canvas.width && previewHeight === canvas.height) {
        const previewSeconds = loadedSourceType === "video" && loadedVideo?.video && !stillMode
          ? previewFrameSeconds
          : frame / fps;
        const animatedParams = getAnimatedParamsAtTime(previewSeconds, getExportDurationSeconds(), readParams(), { holdEdgeValues: false });
        renderer.render(ctx, canvas.width, canvas.height, frame / fps, animatedParams, frame, fps);
      } else {
        previewBuffer.width = previewWidth;
        previewBuffer.height = previewHeight;
        const previewCtx = previewBuffer.getContext("2d", { alpha: false, desynchronized: true });
        const previewSeconds = loadedSourceType === "video" && loadedVideo?.video && !stillMode
          ? previewFrameSeconds
          : frame / fps;
        const animatedParams = getAnimatedParamsAtTime(previewSeconds, getExportDurationSeconds(), readParams(), { holdEdgeValues: false });
        renderer.render(previewCtx, previewBuffer.width, previewBuffer.height, frame / fps, animatedParams, frame, fps);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(previewBuffer, 0, 0, canvas.width, canvas.height);
      }
      previewDirty = false;
    }
    requestAnimationFrame(animate);
  }

  imageInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (isExporting) return;
    clearLoadedSource({ silent: true });

    progressEl.value = 0.05;
    setStatus(`Processing ${file.name} (${Math.round(file.size / 1024)} KB)...`, "info");

    try {
      if (file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name)) {
        const videoSource = await loadVideoFromFile(file);
        progressEl.value = 0.4;
        renderer.setImage(videoSource.video, getSourceScale());
        loadedVideo = videoSource;
        loadedSourceType = "video";

        canvas.width = videoSource.video.videoWidth;
        canvas.height = videoSource.video.videoHeight;
        document.getElementById("duration").value = Math.max(0.5, videoSource.video.duration).toFixed(2);
        previewTargetSeconds = 0;
        previewFrameSeconds = 0;
        syncPreviewTimeControl();
        updatePreviewControlsState();
        updateExportControlsState();
        syncVideoPlaybackState();
        markPreviewDirty();

        setStatus(`Loaded video ${file.name} (${videoSource.video.videoWidth}x${videoSource.video.videoHeight}, ${videoSource.video.duration.toFixed(2)}s). Ready to export.`, "success");
      } else {
        const imageSource = await loadImageFromFile(file);
        progressEl.value = 0.4;
        loadedImage = imageSource;
        renderer.setImage(imageSource, getSourceScale());
        loadedSourceType = "image";
        previewTargetSeconds = 0;
        previewFrameSeconds = 0;
        syncPreviewTimeControl();
        updatePreviewControlsState();
        updateExportControlsState();
        markPreviewDirty();
        setStatus(`Loaded image ${file.name}. Ready to export.`, "success");
      }

      progressEl.value = 1;
      hasLoadedSource = true;
      setExportAvailability();
      start = performance.now();
    } catch (error) {
      hasLoadedSource = false;
      progressEl.value = 0;
      setExportAvailability();
      setStatus(`Couldn't load media: ${error.message}`, "error");
      console.error(error);
    }
  });

  document.getElementById("previewFps").addEventListener("input", () => {
    markPreviewDirty();
    progressEl.value = 0;
  });

  document.getElementById("previewTime").addEventListener("input", (event) => {
    previewTargetSeconds = Number(event.target.value) || 0;
    previewNeedsSeek = true;
    markPreviewDirty();
    progressEl.value = 0;
  });

  keyframeTimeInput.addEventListener("input", () => {
    keyframeTimeInput.value = String(clampKeyframeTime(keyframeTimeInput.value));
  });

  keyframeList.addEventListener("change", () => {
    const value = Number(keyframeList.value);
    selectedKeyframeTime = Number.isFinite(value) ? value : null;
    if (selectedKeyframeTime !== null) {
      keyframeTimeInput.value = selectedKeyframeTime.toFixed(2);
    }
    updateKeyframeActionState();
  });

  addKeyframeBtn.addEventListener("click", () => {
    upsertKeyframe(keyframeTimeInput.value, readParams());
    setStatus("Keyframe added.", "success");
    progressEl.value = 0;
  });

  updateKeyframeBtn.addEventListener("click", () => {
    if (selectedKeyframeTime === null) return;
    const oldTime = selectedKeyframeTime;
    effectKeyframes = effectKeyframes.filter((entry) => Math.abs(entry.time - oldTime) >= 0.0005);
    upsertKeyframe(keyframeTimeInput.value, readParams());
    setStatus("Keyframe updated from current sliders.", "success");
    progressEl.value = 0;
  });

  deleteKeyframeBtn.addEventListener("click", () => {
    removeSelectedKeyframe();
    setStatus("Keyframe removed.", "info");
    progressEl.value = 0;
  });

  clearKeyframesBtn.addEventListener("click", () => {
    effectKeyframes = [];
    selectedKeyframeTime = null;
    renderKeyframeList();
    markPreviewDirty();
    setStatus("All keyframes cleared.", "info");
    progressEl.value = 0;
  });

  exportBtn.addEventListener("click", async () => {
    if (!hasLoadedSource) {
      setStatus("Load an image or video before exporting.", "warn");
      return;
    }

    try {
      isExporting = true;
      activeExportController = new AbortController();
      setExportAvailability();
      progressEl.value = 0;
      setStatus("Preparing export...", "info");
      const fps = Math.max(1, Number(document.getElementById("fps").value) || 30);
      const duration = Math.max(0.5, Number(document.getElementById("duration").value) || 4);
      const qualityMultiplier = Math.max(0.5, Math.min(2.5, Number(document.getElementById("exportQuality").value) || 1));
      const includeOriginalAudio = document.getElementById("includeOriginalAudio").checked;
      const selectedFormat = exportFormatControl?.getValue() || "mp4";
      const mustUseRealtimeAudio = includeOriginalAudio && loadedSourceType === "video";

      if (selectedFormat === "mp4" && mustUseRealtimeAudio) {
        setStatus("Audio passthrough requires WebM realtime export. Switching format for this render.", "warn");
      }

      if (selectedFormat === "webm" || mustUseRealtimeAudio) {
        await exportWebmRealtime({
          canvas,
          renderer,
          params: readParams(),
          paramsResolver: (timeSeconds, durationSeconds) => getAnimatedParamsAtTime(timeSeconds, durationSeconds, readParams(), { holdEdgeValues: true }),
          fps,
          duration,
          loadedSourceType,
          loadedVideo,
          loadedImage,
          sourceScale: getSourceScale,
          includeAudio: includeOriginalAudio,
          onProgress: (value, current, total) => {
            progressEl.value = value;
            setStatus(`Realtime export frame ${current}/${total}`, "info");
          },
          signal: activeExportController.signal,
        });
      } else {
        await exportMp4({
          canvas,
          renderer,
          params: readParams(),
          paramsResolver: (timeSeconds, durationSeconds) => getAnimatedParamsAtTime(timeSeconds, durationSeconds, readParams(), { holdEdgeValues: true }),
          fps,
          duration,
          beforeRenderFrame: loadedSourceType === "video" && loadedVideo
            ? async (t) => {
                await seekVideo(loadedVideo.video, t);
                renderer.setImage(loadedVideo.video, getSourceScale());
              }
            : null,
          onProgress: (value, current, total) => {
            progressEl.value = value;
            setStatus(`Encoding frame ${current}/${total}`, "info");
          },
          signal: activeExportController.signal,
          bitrateScale: qualityMultiplier,
        });
      }
      setStatus("Export finished. Download should begin automatically.", "success");
    } catch (error) {
      if (error?.name === "AbortError") {
        setStatus("Export cancelled.", "warn");
      } else {
        setStatus(`Export failed: ${error.message}`, "error");
        console.error(error);
      }
    } finally {
      isExporting = false;
      activeExportController = null;
      setExportAvailability();
    }
  });

  cancelExportBtn.addEventListener("click", () => {
    if (!isExporting || !activeExportController) return;
    activeExportController.abort();
    setStatus("Cancelling export...", "warn");
  });

  resetParamsBtn.addEventListener("click", () => {
    resetParameters();
  });

  resetSourceBtn.addEventListener("click", () => {
    clearLoadedSource();
  });

  for (const id of [...controlIds, "fps", "duration"]) {
    document.getElementById(id).addEventListener("input", () => {
      markPreviewDirty();
      progressEl.value = 0;
    });
  }

  for (const id of [...controlIds, "previewTime"]) {
    setupRangeWithNumber(id);
  }

  previewModeControl = setupSelectionBox("previewMode", {
    onChange: () => {
      if (isStillPreviewMode()) {
        previewNeedsSeek = true;
      }
      updatePreviewControlsState();
      syncVideoPlaybackState();
      markPreviewDirty();
      progressEl.value = 0;
    },
  });

  previewScaleControl = setupSelectionBox("previewScale", {
    valueParser: Number,
    onChange: () => {
      markPreviewDirty();
      progressEl.value = 0;
    },
  });

  sourceScaleControl = setupSelectionBox("sourceScale", {
    valueParser: Number,
    onChange: () => {
      refreshRendererSource();
      if (loadedSourceType === "video" && isStillPreviewMode()) {
        previewNeedsSeek = true;
      }
      progressEl.value = 0;
    },
  });

  previewMaxPixelsControl = setupSelectionBox("previewMaxPixels", {
    valueParser: Number,
    onChange: () => {
      markPreviewDirty();
      progressEl.value = 0;
    },
  });

  exportFormatControl = setupSelectionBox("exportFormat", {
    onChange: () => {
      progressEl.value = 0;
    },
  });

  setExportAvailability();
  await loadPresets();
  initializePresets();
  defaultParamValues = readParams();
  updatePreviewControlsState();
  updateExportControlsState();
  syncPreviewTimeControl();
  renderKeyframeList();
  window.addEventListener("beforeunload", () => {
    if (loadedVideo?.objectUrl) {
      URL.revokeObjectURL(loadedVideo.objectUrl);
    }
    if (loadedImage && typeof loadedImage.close === "function") {
      loadedImage.close();
    }
  });

  if (statusEl.dataset.mode !== "warn") {
    setStatus("Load an image or video (MP4/WebM/MOV/etc.) to begin.", "info");
  }
  requestAnimationFrame(animate);
})();
