function seededNoise(x, y, frame) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + frame * 19.17) * 43758.5453;
  return v - Math.floor(v);
}

export class CRTRenderer {
  constructor() {
    this.sourceCanvas = document.createElement("canvas");
    this.workCanvas = document.createElement("canvas");
    this.maskCanvas = document.createElement("canvas");
    this.effectCanvas = document.createElement("canvas");
    this.luminanceCanvas = document.createElement("canvas");
    this.maskPattern = null;
    this.hasImage = false;
  }

  buildLuminanceMask(width, height) {
    this.luminanceCanvas.width = width;
    this.luminanceCanvas.height = height;
    const lctx = this.luminanceCanvas.getContext("2d", { willReadFrequently: true });
    lctx.clearRect(0, 0, width, height);
    lctx.drawImage(this.workCanvas, 0, 0);

    const data = lctx.getImageData(0, 0, width, height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const maxChannel = Math.max(px[i], px[i + 1], px[i + 2]) / 255;
      const weight = Math.pow(maxChannel, 1.4);
      const alpha = Math.round(weight * 255);
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = alpha;
    }
    lctx.putImageData(data, 0, 0);
  }

  applyLuminanceEffect(outCtx, width, height, drawEffect) {
    this.effectCanvas.width = width;
    this.effectCanvas.height = height;
    const ectx = this.effectCanvas.getContext("2d");
    ectx.clearRect(0, 0, width, height);

    drawEffect(ectx);

    ectx.globalCompositeOperation = "destination-in";
    ectx.drawImage(this.luminanceCanvas, 0, 0);
    ectx.globalCompositeOperation = "source-over";

    outCtx.drawImage(this.effectCanvas, 0, 0);
  }

  setImage(img) {
    this.sourceCanvas.width = img.naturalWidth || img.videoWidth || img.width;
    this.sourceCanvas.height = img.naturalHeight || img.videoHeight || img.height;
    const ctx = this.sourceCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
    ctx.drawImage(img, 0, 0);
    this.hasImage = true;
  }

  ensureMaskPattern(ctx, strength) {
    this.maskCanvas.width = 3;
    this.maskCanvas.height = 1;
    const mctx = this.maskCanvas.getContext("2d");
    const alpha = Math.min(0.6, strength * 0.8);
    mctx.clearRect(0, 0, 3, 1);
    mctx.fillStyle = `rgba(255, 80, 80, ${alpha})`;
    mctx.fillRect(0, 0, 1, 1);
    mctx.fillStyle = `rgba(80, 255, 80, ${alpha})`;
    mctx.fillRect(1, 0, 1, 1);
    mctx.fillStyle = `rgba(80, 150, 255, ${alpha})`;
    mctx.fillRect(2, 0, 1, 1);
    this.maskPattern = ctx.createPattern(this.maskCanvas, "repeat");
  }

  render(outCtx, width, height, seconds, params, frameIndex, fps) {
    outCtx.clearRect(0, 0, width, height);
    outCtx.fillStyle = "black";
    outCtx.fillRect(0, 0, width, height);
    if (!this.hasImage) return;

    this.workCanvas.width = width;
    this.workCanvas.height = height;
    const wctx = this.workCanvas.getContext("2d", { willReadFrequently: true });
    wctx.clearRect(0, 0, width, height);

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

    const barrel = params.barrelDistortion;
    for (let y = 0; y < height; y++) {
      const ny = (y / (height - 1)) * 2 - 1;
      const curve = 1 + barrel * ny * ny;
      const lineW = width / curve;
      const dx = (width - lineW) / 2;
      const srcY = sy + (y / height) * sh;
      wctx.drawImage(src, sx, srcY, sw, sh / height, dx, y, lineW, 1);
    }

    if (params.chromaticAberration > 0) {
      const shift = 1 + params.chromaticAberration * 4;
      wctx.globalCompositeOperation = "screen";
      wctx.globalAlpha = params.chromaticAberration * 0.55;
      wctx.filter = "sepia(1) saturate(6) hue-rotate(-35deg)";
      wctx.drawImage(this.workCanvas, shift, 0);
      wctx.filter = "sepia(1) saturate(6) hue-rotate(180deg)";
      wctx.drawImage(this.workCanvas, -shift, 0);
      wctx.filter = "none";
      wctx.globalCompositeOperation = "source-over";
      wctx.globalAlpha = 1;
    }

    outCtx.drawImage(this.workCanvas, 0, 0);
    this.buildLuminanceMask(width, height);

    const scan = params.scanlineStrength;
    this.applyLuminanceEffect(outCtx, width, height, (ctx) => {
      ctx.fillStyle = `rgba(0,0,0,${0.06 + scan * 0.5})`;
      for (let y = 0; y < height; y += 2) ctx.fillRect(0, y, width, 1);
    });

    this.ensureMaskPattern(outCtx, params.phosphorMask);
    this.applyLuminanceEffect(outCtx, width, height, (ctx) => {
      ctx.globalAlpha = params.phosphorMask;
      ctx.fillStyle = this.maskPattern;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    });

    const bloom = params.bloom;
    if (bloom > 0) {
      this.applyLuminanceEffect(outCtx, width, height, (ctx) => {
        ctx.globalAlpha = bloom * 0.5;
        ctx.filter = `blur(${1 + bloom * 6}px) brightness(${1 + bloom * 0.45})`;
        ctx.drawImage(outCtx.canvas, 0, 0);
        ctx.filter = "none";
        ctx.globalAlpha = 1;
      });
    }

    const flickerWave = Math.sin((frameIndex / fps) * Math.PI * 2 * 2.1) * 0.5 + 0.5;
    const flicker = params.flicker * (0.35 + flickerWave * 0.65);
    this.applyLuminanceEffect(outCtx, width, height, (ctx) => {
      ctx.fillStyle = `rgba(255,255,255,${flicker * 0.12})`;
      ctx.fillRect(0, 0, width, height);
    });

    if (params.noise > 0) {
      this.applyLuminanceEffect(outCtx, width, height, (ctx) => {
        const count = Math.floor(width * height * 0.003 * params.noise);
        for (let i = 0; i < count; i++) {
          const x = Math.floor(seededNoise(i, seconds, frameIndex) * width);
          const y = Math.floor(seededNoise(i * 2, seconds + 3.1, frameIndex) * height);
          const a = seededNoise(x, y, frameIndex) * 0.2 * params.noise;
          ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.fillRect(x, y, 1, 1);
        }
      });
    }
  }
}
