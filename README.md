# CRT Effect Renderer (Local + Static Hosting)

A lightweight browser tool that loads an image, previews an animated CRT simulation, and exports an MP4 clip.

## Open locally

### Option A: open directly with `file://`
1. Double-click `index.html`.
2. Upload an image.
3. Tune controls and click **Export MP4**.

### Option B: static server (recommended)
```bash
python -m http.server 8080
```
Then open `http://localhost:8080`.

## Browser requirements

- Chromium-based browser recommended (Chrome/Edge 116+ preferred).
- Requires **WebCodecs** (`VideoEncoder`) for MP4 export.
- Requires network access the first time to fetch `mp4-muxer` from jsDelivr CDN.

## Known limitations

- `file://` mode can be stricter depending on browser security policies. If export fails in `file://`, use a local HTTP server.
- H.264 profile/codec support varies by OS/browser build.
- Large resolutions + long durations are CPU-intensive and may freeze the tab while encoding.


## Included presets

Alongside the base presets, the renderer now ships with additional looks inspired by common CRT-era display chains:

- **Trinitron RGB Monitor**: low distortion, tight mask, clean broadcast/monitor-style output.
- **VHS Composite**: stronger bloom/chromatic bleed and noise to emulate consumer composite tape playback.
- **Portable CRT**: heavier curvature and scanline presence for small-screen portable sets.
- **Late-Night Broadcast**: balanced glow and noise for over-the-air late-night TV texture.

## CRT tuning tips

- **Consumer TV look**: increase barrel distortion, bloom, chromatic aberration, and moderate scanlines.
- **PVM/BVM look**: reduce barrel distortion and bloom, increase phosphor mask clarity, keep flicker/noise low.
- For subtle realism, keep noise under `0.2` and flicker under `0.15`.

## Effect pass order

1. Geometry warp (barrel distortion)
2. Shadow mask and scanlines
3. Bloom/glow
4. Temporal flicker and deterministic noise

Export and preview both use deterministic frame timing (`frameIndex / fps`) so visual timing remains consistent.


## Effect keyframes

You can animate CRT intensity over time (especially useful for still images):

1. Set the sliders to a desired look.
2. Enter a **Keyframe time (s)** and click **Add keyframe from current sliders**.
3. Repeat for multiple times (for example 0.0s, 1.5s, 3.0s).
4. Export: parameters are linearly interpolated between keyframes.

Notes:
- If there are no keyframes, the current slider values are used for all frames.
- `pixelSize` is interpolated and rounded to an integer per frame.
- During live preview, slider changes are always shown immediately so you can dial in the next keyframe before saving it.
