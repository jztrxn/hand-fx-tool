# Hand FX: Browser POC Build Plan (agent handoff)

A minimal in-browser tool: webcam in, hand landmarks tracked, a hand mask derived from the landmarks, one gesture (pinch), and two visual effects the user can switch between. Everything is free/open source, runs client-side, needs no backend and no API keys.

---

## 1. Goal and scope

**Build**
- Webcam feed rendered in a WebGL canvas (mirrored, selfie view)
- Hand tracking for up to 2 hands (21 landmarks each)
- Debug overlay: skeleton, hand count, FPS, detection time, mask preview
- A hand "mask" generated from landmarks
- One gesture: **pinch** (thumb tip to index tip)
- Two effects, switchable by pinch and by keyboard:
  1. **Aura**: video dims, the hand gets a color-cycling neon glow
  2. **Particles**: sparks stream off the fingertips

**Not in scope (do not build)**
- ML segmentation models, SAM, gesture-recognizer model, custom model training
- Node-graph editor, presets UI, recording/export, audio reactivity
- Frameworks (React, Vue), backend, auth, analytics

---

## 2. Decisions already made (do not relitigate)

| Area | Decision | Why |
|---|---|---|
| Build tool | Vite, vanilla JS (ES modules). TypeScript is fine if preferred. | Zero config, fast reload |
| Tracking | `@mediapipe/tasks-vision` **HandLandmarker** only | One small model, 21 landmarks, runs in VIDEO mode |
| Rendering | three.js with an orthographic camera, a video quad, and `Points` | Fast to build; shaders are plain GLSL |
| Mask | Drawn from landmarks onto a 2D canvas, uploaded as a texture | Cheap, no extra model, looks good enough for a POC |
| Gesture | Pinch via landmark distance with hysteresis | Not built into the landmarker; trivial to implement |
| Hosting | Static build (`npm run build`) | Shareable anywhere |

Licenses: MediaPipe (Apache-2.0), three.js (MIT), Vite (MIT).

---

## 3. Coordinate conventions (single source of truth)

This is the most common source of bugs here, so it is written down once.

- **Video space**: x and y in [0, 1], origin top-left, **y down**, **not mirrored**. Tracker output, smoothing, gesture math and mask drawing all happen in video space.
- **Mirroring happens only at the final output step**:
  - Shader: `uv.x = 1.0 - uv.x` when sampling video and mask
  - Scene coordinates: `x_world = aspect * (1 - 2*x)`, `y_world = 1 - 2*y`
  - 2D debug overlay canvas: CSS `transform: scaleX(-1)`
- **World space**: orthographic camera `left=-aspect, right=aspect, top=1, bottom=-1`. The canvas is sized to the **video aspect ratio** (fit inside the window, letterboxed), so UVs, landmarks and mask all line up without extra math.
- **Distances** (gestures): multiply x deltas by `aspect` (video width / height) before measuring, otherwise normalized coordinates are stretched.

---

## 4. Architecture

```
getUserMedia ─► <video> ─► HandLandmarker.detectForVideo
                                │ raw landmarks (video space)
                                ▼
                       One Euro smoothing (per hand)
                                │ smoothed landmarks
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
        pinch detector     mask canvas        fingertip data
              │                 │                  │
              ▼                 ▼                  ▼
       effect switcher ─► active effect (Aura | Particles) ─► three.js render
```

### File layout

```
hand-fx/
├─ index.html
├─ package.json
├─ public/
│  ├─ models/hand_landmarker.task      # downloaded model (see M0)
│  └─ wasm/                            # copied from node_modules/@mediapipe/tasks-vision/wasm
└─ src/
   ├─ main.js        # bootstrap, Start button, main loop, key bindings
   ├─ camera.js      # getUserMedia + <video> setup; returns { video, aspect }
   ├─ tracker.js     # HandLandmarker wrapper
   ├─ smoothing.js   # OneEuro filter + per-hand smoothing
   ├─ gestures.js    # pinch detector
   ├─ mask.js        # landmarks -> mask canvas + CanvasTexture
   ├─ stage.js       # three.js renderer, ortho camera, video quad, toWorld()
   ├─ overlay.js     # 2D debug overlay: skeleton, HUD text, mask preview
   └─ effects/
      ├─ index.js    # registry + switcher
      ├─ aura.js
      └─ particles.js
```

### Data contract passed to effects each frame

```js
// FrameState
{
  nowMs, dt,                  // dt in seconds (clamped to [1/120, 1/20])
  aspect,                     // video width / height
  hands: [{
    key,                      // stable key, see "Hand identity" below
    lm,                       // 21 smoothed {x, y, z} in video space
    pinch: { ratio, active, fired }
  }],
  presence,                   // 0..1, eases toward 1 when any hand is visible, toward 0 when not
  videoTexture,               // THREE.VideoTexture
  maskTexture,                // THREE.CanvasTexture, video space, unmirrored
  maskTexel: [1 / maskW, 1 / maskH]
}
```

### Effect interface

```js
{
  name: "Aura",
  mount(stage),        // add objects / swap the video quad's material
  unmount(stage),      // remove objects, restore the plain video material, dispose GPU resources
  update(frame)        // called every frame while mounted
}
```

Switching = `current.unmount(stage); next.mount(stage)`. Effects must clean up fully so repeated switching does not leak.

### Hand identity

MediaPipe does not give stable hand IDs. Use the handedness label (`"Left"` / `"Right"`) **only as a stable key** for per-hand filters and pinch detectors. Its left/right meaning may be inverted for un-mirrored input, so never rely on it semantically. If two hands share a label in one frame, fall back to the result index. Reset a hand's filters if it has been absent for more than ~300 ms.

---

## 5. Effect specs

### Effect 1: Aura (fragment-shader effect on the video quad)

- Swap the video quad's material for a `ShaderMaterial` sampling `uVideo` and `uMask`
- Outside the hand: video dimmed (about 35% brightness at full `presence`)
- Inside the hand: video plus a slight tint
- Around the hand: soft halo from multi-tap sampling of the mask (two rings of 8 taps, radii roughly 10 px and 24 px in mask pixels), colored with a time-cycling cosine palette
- `presence` scales the whole effect so it fades in and out instead of popping
- Sketch in section 7.5; tune visually

### Effect 2: Particles (CPU-updated `THREE.Points`)

- Pool of 4,000 particles in a ring buffer (position, velocity, life, color arrays)
- Emitters: fingertips, landmarks `4, 8, 12, 16, 20`
- Each frame, per fingertip: emit 1 + `floor(speed * k)` particles (cap about 4), where speed is the smoothed fingertip velocity in world units/sec
- Initial velocity: 30% of fingertip velocity plus a random direction (magnitude about 0.4 units/sec)
- Lifetime 0.8 to 1.6 s; drag `vel *= exp(-2.5 * dt)`; slight downward gravity (about -0.15)
- Rendering: `PointsMaterial` or a tiny `ShaderMaterial`, `blending: AdditiveBlending`, `depthWrite: false`, `transparent: true`, pixel size 3 to 6, per-vertex color
- Fade by multiplying color by `life / maxLife` (additive blending makes "fade to black" equal "fade out")
- Hue from the same palette function as Aura, offset per finger
- Video stays visible and undimmed (plain video material)
- Update buffers in place and set `geometry.attributes.position.needsUpdate = true` and the same for color. **No per-frame allocations.**

---

## 6. Gesture spec: pinch

- `ratio = dist(lm[4], lm[8]) / dist(lm[0], lm[9])`, thumb tip to index tip, normalized by hand size (wrist to middle-finger knuckle). Aspect-corrected as in section 3.
- **Hysteresis**: becomes active when `ratio < 0.25`, inactive when `ratio > 0.40`
- **Fires** once on the rising edge (inactive to active)
- **Cooldown**: ignore fires within 700 ms of the last accepted fire. Enforce the cooldown **globally** in the switcher, so two hands pinching together cannot double-switch.
- Fire = switch to the next effect (cycle through the registry)
- Thresholds are starting points; expose them as constants at the top of `gestures.js`

### Controls

| Input | Action |
|---|---|
| Pinch (either hand) | Next effect |
| `1` / `2` | Select effect directly |
| `Space` | Next effect |
| `D` | Toggle debug overlay (skeleton + HUD) |
| `M` | Toggle mask preview (small picture-in-picture) |
| `S` | Toggle smoothing on/off (for A/B comparison while tuning) |

Keyboard controls are also the fallback if pinch is unreliable on someone's camera.

---

## 7. Key code sketches

These are starting points, not final code. Verify API details against the installed package's typings, since field names have changed across versions (for example `handedness` vs `handednesses`).

### 7.1 Tracker (`tracker.js`)

```js
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export async function createTracker() {
  const fileset = await FilesetResolver.forVisionTasks("/wasm"); // local copy, works offline
  const make = (delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate },
      runningMode: "VIDEO",
      numHands: 2,
    });

  let landmarker;
  try { landmarker = await make("GPU"); } catch { landmarker = await make("CPU"); }

  let lastVideoTime = -1;
  return {
    // returns null when the video has no new frame since the last call
    detect(video, nowMs) {
      if (video.currentTime === lastVideoTime) return null;
      lastVideoTime = video.currentTime;
      // timestamps must be strictly increasing in VIDEO mode
      return landmarker.detectForVideo(video, nowMs);
      // result.landmarks[i]  -> 21 normalized {x,y,z}
      // result.handedness[i] -> categories[0].categoryName ("Left" | "Right")
    },
  };
}
```

### 7.2 One Euro filter (`smoothing.js`)

Reference: Casiez et al., "1 Euro Filter" (https://gery.casiez.net/1euro/).

```js
const alpha = (cutoff, dt) => 1 / (1 + (1 / (2 * Math.PI * cutoff)) / dt);

class LowPass {
  y = null;
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}

export class OneEuro {
  // beta is unit-dependent: published defaults (about 0.007) are tuned for pixels.
  // For normalized [0,1] coordinates start around beta = 5 and tune by eye.
  constructor(minCutoff = 1.0, beta = 5, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.xF = new LowPass(); this.dxF = new LowPass(); this.prev = null;
  }
  filter(x, dt) {
    const dx = this.prev === null ? 0 : (x - this.prev) / dt;
    const edx = this.dxF.filter(dx, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.prev = x;
    return this.xF.filter(x, alpha(cutoff, dt));
  }
}
// One OneEuro per hand key, per landmark (21), per axis (x, y). Pass z through unfiltered.
// Tuning: lower minCutoff = less jitter at rest; raise beta = less lag on fast moves.
```

### 7.3 Pinch (`gestures.js`)

```js
export function makePinchDetector({ on = 0.25, off = 0.4 } = {}) {
  let active = false;
  return function update(lm, aspect) {
    const d = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
    const ratio = d(lm[4], lm[8]) / d(lm[0], lm[9]);
    let fired = false;
    if (!active && ratio < on) { active = true; fired = true; }
    else if (active && ratio > off) active = false;
    return { ratio, active, fired };
  };
}
// The switcher applies the global 700 ms cooldown to `fired`.
```

### 7.4 Mask from landmarks (`mask.js`)

```js
const FINGERS = [[1,2,3,4], [5,6,7,8], [9,10,11,12], [13,14,15,16], [17,18,19,20]];
const PALM = [0, 1, 5, 9, 13, 17];

export function drawMask(ctx, hands, w, h) {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ctx.strokeStyle = "#fff";
  ctx.lineCap = ctx.lineJoin = "round";
  for (const lm of hands) {
    const P = (i) => [lm[i].x * w, lm[i].y * h];
    const size = Math.hypot(lm[0].x * w - lm[9].x * w, lm[0].y * h - lm[9].y * h); // hand size in px
    // palm: filled polygon, padded with a stroke
    ctx.beginPath();
    PALM.forEach((i, k) => { const [x, y] = P(i); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = size * 0.22; ctx.stroke();
    // fingers: thick round-capped polylines
    ctx.lineWidth = size * 0.22;      // tune 0.18 to 0.30
    for (const chain of FINGERS) {
      ctx.beginPath();
      chain.forEach((i, k) => { const [x, y] = P(i); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
}
// Canvas size: about 512 px wide, height = round(512 / aspect). Same aspect as the video, so no distortion.
// Then: texture.needsUpdate = true every frame.
// Soften edges in the shader (multi-tap), not with ctx.filter (inconsistent Safari support).
```

### 7.5 Aura shader sketch (`effects/aura.js`)

Vertex:
```glsl
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

Fragment:
```glsl
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform vec2 uMaskTexel;   // 1 / mask canvas size
uniform float uTime;
uniform float uPresence;   // 0..1
varying vec2 vUv;

vec3 palette(float t) { return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }

void main() {
  vec2 uv = vec2(1.0 - vUv.x, vUv.y);        // mirror (selfie view)
  vec3 video = texture2D(uVideo, uv).rgb;
  float m = texture2D(uMask, uv).r;

  float halo = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 dir = vec2(cos(a), sin(a));
    halo += texture2D(uMask, uv + dir * uMaskTexel * 10.0).r;
    halo += texture2D(uMask, uv + dir * uMaskTexel * 24.0).r;
  }
  halo /= 16.0;

  float outside = clamp(halo - m, 0.0, 1.0);  // glow outside the hand
  vec3 glow = palette(uTime * 0.1 + uv.x * 0.6);

  vec3 dimmed   = video * mix(1.0, 0.35, uPresence);
  vec3 handTint = video + glow * 0.25;
  vec3 col = mix(dimmed, handTint, m);
  col += glow * outside * 1.6 * uPresence;
  gl_FragColor = vec4(col, 1.0);
}
```

---

## 8. Milestones (each is commit-sized, each has an acceptance check)

### M0: Scaffold and camera
- `npm create vite@latest hand-fx -- --template vanilla`; `npm i three @mediapipe/tasks-vision` (pin versions)
- Copy WASM: `cp -r node_modules/@mediapipe/tasks-vision/wasm public/wasm` (add as a `postinstall` script)
- Download the model into `public/models/`:
  `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
  (if this 404s, take the current link from the "Models" section of the Hand Landmarker overview page)
- "Start" button, then `getUserMedia` (`{ video: { width: 1280, height: 720, facingMode: "user" } }`), `<video playsinline muted autoplay>`
- three.js canvas sized to video aspect, `VideoTexture` on a quad, mirrored
- FPS counter

**Accept:** live mirrored video fills the canvas without distortion; moving your left hand moves it on the left side of the screen, like a mirror.

### M1: Tracking and landmark overlay
- `tracker.js`, then run `detect` once per new video frame in the main loop
- `overlay.js`: 2D canvas over the stage (CSS-mirrored), draws 21 points and the bones for each hand
- HUD (toggle `D`): hand count, FPS, detection ms

**Accept:** two hands are tracked at once and the skeleton sits on the hands; detection time is visible; no console errors with zero hands in frame.

### M2: Smoothing and mask
- `smoothing.js` (One Euro per hand/landmark/axis), `S` toggles it
- `mask.js`: draw the mask, upload as `CanvasTexture` (`generateMipmaps = false`, `LinearFilter`)
- `M` shows the mask as a small preview

**Accept:** the mask covers palm and fingers with a small margin; smoothing visibly reduces jitter when toggled on vs off; the mask follows hands without noticeable lag.

### M3: Effect 1, Aura
- Effect interface + registry in `effects/index.js`, then `aura.js`
- `presence` easing: `presence += (target - presence) * (1 - Math.exp(-dt * 12))`

**Accept:** with a hand in frame the background dims and the hand glows with cycling color; hand leaves, effect fades out smoothly; two hands work.

### M4: Effect 2, Particles
**Accept:** sparks stream from all five fingertips and trail faster motion; at least 30 FPS on a mid-range laptop; no per-frame allocations (check in the browser profiler if in doubt).

### M5: Pinch and switching
- `gestures.js`, switcher with global cooldown, keyboard bindings, HUD shows active effect name (always visible, small) and pinch ratio (debug only)

**Accept:** pinching switches effects once per pinch, never double-fires, and does not fire from a relaxed open hand; keys `1`/`2`/`Space` work; repeated switching (50+ times) does not grow memory or slow rendering.

### M6: Polish and README
- Error states with human-readable messages: camera denied / no camera, no WebGL, model or WASM failed to load
- Pause the loop when the tab is hidden
- `npm run build` and `npm run preview` work
- `README.md`: install, run, controls, how to add an effect (implement the interface in section 4 and register it)

**Accept:** everything in the checklist below.

---

## 9. Gotchas

1. **Secure context**: `getUserMedia` needs HTTPS or `localhost`. Vite dev on localhost is fine.
2. **Autoplay/permission**: start the camera from a button click; show a clear message if permission is denied.
3. **Timestamps** passed to `detectForVideo` must be strictly increasing. Only call it on new video frames (check `video.currentTime`, or use `requestVideoFrameCallback`).
4. **Detection is synchronous** and blocks the main thread (roughly 5 to 15 ms). Fine for the POC; if the frame budget is blown, move tracking into a Web Worker (see the MediaPipe samples repo).
5. **No hands** gives empty arrays. Handle it everywhere (mask clears, particles stop emitting, `presence` eases to 0).
6. **Pin versions** and use local copies of the WASM and model. Avoid `@latest` CDN URLs.
7. **Color management**: keep video and mask textures at the default (no color-space conversion) and treat shader output as final. If colors look washed out or too dark, check this first.
8. **Mask texture**: set `needsUpdate = true` every frame after drawing, and keep it low resolution (about 512 px wide); it is blurred and sampled, not displayed.
9. **Mirror consistency**: if the overlay, mask and particles disagree about left/right, one of them breaks the rule in section 3.
10. **Test in Chrome first**; then Safari and Firefox. GPU-delegate behavior differs between browsers, which is why the CPU fallback exists.

---

## 10. Definition of done

- [ ] `npm install && npm run dev` works from a clean clone; `npm run build` produces a static site that works when served
- [ ] Mirrored live video, correct aspect, no stretch
- [ ] 0, 1 and 2 hands handled without errors
- [ ] Skeleton overlay aligned with hands (`D`), mask preview aligned (`M`)
- [ ] Smoothing toggle (`S`) shows a clear difference
- [ ] Both effects work and fade correctly when hands enter/leave
- [ ] Pinch switches effects reliably, no double-triggers, no false triggers from a relaxed hand
- [ ] 30+ FPS on a typical laptop at 720p (report the measured FPS and hardware)
- [ ] 50+ rapid effect switches: no leak, no slowdown
- [ ] Camera-denied and model-load-failure states show readable messages
- [ ] README written

**When reporting back, include:** measured FPS and machine, any deviations from this plan and why, final pinch thresholds and One Euro parameters, and known issues.

---

## 11. Stretch goals (only after everything above is done)

- Feedback trails for Aura (ping-pong render targets with decay)
- A third effect (e.g., a displacement/ripple distortion driven by the mask)
- Second gesture using the same landmark math (open palm held for 1 s, or two-hand distance for effect intensity)
- Web Worker for tracking
- Better mask via a promptable segmenter (landmarks as point prompts) in place of the capsule mask
- Stream landmarks out over WebSocket to an external renderer

---

## 12. References

- MediaPipe Hand Landmarker (Web): https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- MediaPipe web samples (worker implementation, full example): https://github.com/google-ai-edge/mediapipe-samples-web
- 1 Euro Filter: https://gery.casiez.net/1euro/
- three.js docs: https://threejs.org/docs/
- Vite: https://vite.dev/
