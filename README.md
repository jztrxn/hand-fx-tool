# Hand FX

Webcam hand tracking with real-time visual effects, entirely in the browser.
Hands are tracked with MediaPipe Hand Landmarker; a hand mask is generated from
the landmarks; a pinch gesture switches between effects rendered with three.js.
No backend, no API keys, and the model and WASM are served locally.

**Effects**
- **Aura**: the background dims and your hands get a color-cycling neon glow.
- **Particles**: sparks stream off your fingertips and trail fast motion.

## Requirements

- Node.js 18+ (for `fetch` in the postinstall script) and npm
- A webcam
- Chrome is recommended; Safari and Firefox should work too (GPU delegate support varies, so there's a CPU fallback)

## Install and run

```bash
npm install      # also copies MediaPipe WASM to public/wasm and downloads the hand model to public/models
npm run dev      # http://localhost:5173
```

Open the URL, click **Start camera** and allow camera access.

```bash
npm run build    # static site in dist/
npm run preview  # serve dist/ locally
```

`dist/` can be hosted on any static host. Camera access requires **HTTPS** (or `localhost`).

If the model download fails during install, download
[`hand_landmarker.task`](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task)
manually and save it as `public/models/hand_landmarker.task`.

## Controls

| Input | Action |
|---|---|
| Pinch (thumb tip to index tip, either hand) | Next effect |
| `1` / `2` | Select effect directly |
| `Space` | Next effect |
| `D` | Toggle debug overlay (skeleton + HUD) |
| `M` | Toggle mask preview |
| `S` | Toggle smoothing (A/B compare) |

## Testing without a webcam

Append `?src=<url>` to feed an image or video file into the pipeline instead of
the camera. Images are drawn into a canvas with a slow drift, so motion-based
effects have something to react to. Put files in `public/` (for example
`public/dev/`, which is gitignored):

```
http://localhost:5173/?src=/dev/hands.jpg
http://localhost:5173/?src=/dev/clip.mp4
```

## How it works

```
getUserMedia ─► <video> ─► HandLandmarker.detectForVideo   (once per new video frame)
                                │ raw landmarks (video space)
                                ▼
                       One Euro smoothing (per hand)
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
        pinch detector     mask canvas        fingertip data
              │                 │                  │
              ▼                 ▼                  ▼
       effect switcher ─► active effect (Aura | Particles) ─► three.js render
```

**Coordinates.** All tracking, smoothing, gestures and mask drawing use *video
space*: x, y in [0, 1], origin top-left, y down, **unmirrored**. Mirroring
happens only at output: in shaders (`uv.x = 1.0 - uv.x`), in `stage.toWorld()`
for scene positions, and with CSS `scaleX(-1)` on the 2D overlay. The canvas is
letterboxed to the video aspect ratio, so UVs, landmarks and the mask line up.

| File | Role |
|---|---|
| `src/main.js` | Bootstrap, Start button, error screens, main loop, key bindings |
| `src/camera.js` | `getUserMedia` + `<video>`; `?src=` test source |
| `src/tracker.js` | HandLandmarker wrapper (GPU with CPU fallback) |
| `src/smoothing.js` | One Euro filter, per-hand landmark filter |
| `src/gestures.js` | Pinch detector with hysteresis |
| `src/mask.js` | Landmarks → mask canvas → `CanvasTexture` |
| `src/stage.js` | three.js renderer, ortho camera, mirrored video quad, `toWorld()` |
| `src/overlay.js` | Skeleton, HUD text, mask preview |
| `src/effects/` | Effect registry/switcher, `aura.js`, `particles.js`, shared palette |

## Adding an effect

An effect is an object with this shape:

```js
{
  name: "My Effect",
  mount(stage),    // add objects to stage.scene, or stage.setQuadMaterial(material)
  unmount(stage),  // remove objects / stage.restoreQuadMaterial(); dispose geometries, materials, textures
  update(frame),   // called every frame while mounted
}
```

`frame` is:

```js
{
  nowMs, dt,           // dt in seconds, clamped to [1/120, 1/20]
  aspect,              // video width / height
  hands: [{ key, lm /* 21 × {x,y,z}, video space */, pinch: { ratio, active, fired } }],
  presence,            // 0..1, eases toward 1 while any hand is visible
  videoTexture,        // THREE.VideoTexture
  maskTexture,         // THREE.CanvasTexture (video space, unmirrored)
  maskTexel,           // [1 / maskW, 1 / maskH]
}
```

Useful stage members: `scene`, `renderer`, `videoTexture`, `toWorld(x, y, out)`,
`setQuadMaterial(m)`, `restoreQuadMaterial()`, and `VIDEO_VERT` (exported vertex
shader for full-screen video materials). Effects are created once and
mounted/unmounted on every switch, so create GPU resources in `mount` and
dispose them in `unmount`.

1. Create `src/effects/myeffect.js` exporting a factory, e.g. `createMyEffect()`.
2. Add it to `EFFECTS` in `src/effects/index.js`.

It joins the pinch/`Space` cycle automatically and gets the next number key.

## Tuning

| Constant | File | Value |
|---|---|---|
| `PINCH_ON` / `PINCH_OFF` | `src/gestures.js` | 0.25 / 0.40 (thumb–index distance ÷ wrist–middle-knuckle distance) |
| `PINCH_COOLDOWN_MS` | `src/gestures.js` | 700 (global) |
| `MIN_CUTOFF` / `BETA` / `D_CUTOFF` | `src/smoothing.js` | 1.0 / 5 / 1.0 |
| `FINGER_WIDTH` | `src/mask.js` | 0.22 × hand size |
| Particle constants | `src/effects/particles.js` | 4000 particles, life 0.8–1.6 s, drag 2.5, gravity −0.15 |

Lower `MIN_CUTOFF` reduces jitter at rest, and a higher `BETA` reduces lag on fast moves.

## Licenses

MediaPipe Tasks Vision (Apache-2.0), three.js (MIT), Vite (MIT).
