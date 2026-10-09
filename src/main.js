// Bootstrap, Start button, main loop, key bindings.
import { startCamera, startMediaSource } from "./camera.js";
import { createStage, hasWebGL } from "./stage.js";
import { createTracker } from "./tracker.js";
import { createHandFilter } from "./smoothing.js";
import { createMask } from "./mask.js";
import { createOverlay } from "./overlay.js";
import { makePinchDetector } from "./gestures.js";
import { createSwitcher } from "./effects/index.js";

const HAND_TIMEOUT_MS = 300; // reset a hand's filters after this long unseen
const PRESENCE_RATE = 12; // presence easing speed (1/s)

const $ = (id) => document.getElementById(id);
const ui = {
  stage: $("stage"),
  overlay: $("overlay"),
  startScreen: $("start-screen"),
  startBtn: $("start-btn"),
  startStatus: $("start-status"),
  errorScreen: $("error-screen"),
  errorTitle: $("error-title"),
  errorMessage: $("error-message"),
  hudEffect: $("hud-effect"),
  hudDebug: $("hud-debug"),
  maskPreview: $("mask-preview"),
};

function showError(title, message) {
  ui.startScreen.hidden = true;
  ui.errorTitle.textContent = title;
  ui.errorMessage.textContent = message;
  ui.errorScreen.hidden = false;
}

$("retry-btn").addEventListener("click", () => location.reload());

ui.startBtn.addEventListener("click", async () => {
  ui.startBtn.disabled = true;
  if (!hasWebGL()) {
    showError(
      "WebGL not available",
      "Your browser or GPU does not support WebGL, which Hand FX needs for rendering. Try a recent Chrome, Safari or Firefox with hardware acceleration enabled."
    );
    return;
  }
  try {
    ui.startStatus.textContent = "Starting camera and loading hand model…";
    const trackerP = createTracker().catch((err) => {
      console.error(err);
      const e = new Error(
        "The hand-tracking model or its WebAssembly runtime could not be loaded. Check that public/models/hand_landmarker.task and public/wasm/ exist (run `npm install`), then reload."
      );
      e.title = "Hand model failed to load";
      throw e;
    });
    const testSrc = new URLSearchParams(location.search).get("src");
    const camP = testSrc ? startMediaSource(testSrc) : startCamera();
    let failed = false;
    // If the model fails after the camera started, release the camera.
    camP.then((c) => failed && c.stream?.getTracks().forEach((t) => t.stop()), () => {});
    const [cam, tracker] = await Promise.all([camP, trackerP]).catch((err) => {
      failed = true;
      throw err;
    });
    ui.startScreen.hidden = true;
    run(cam, tracker);
  } catch (err) {
    console.error(err);
    showError(err.title || "Startup failed", err.message || String(err));
  }
});

function run({ video, aspect }, tracker) {
  const stage = createStage(ui.stage, video, aspect);
  const mask = createMask(aspect);
  const overlay = createOverlay({
    canvas: ui.overlay,
    hudEffect: ui.hudEffect,
    hudDebug: ui.hudDebug,
    maskPreview: ui.maskPreview,
    maskCanvas: mask.canvas,
  });

  const resize = () => {
    stage.resize();
    overlay.resize();
  };
  resize();
  window.addEventListener("resize", resize);

  const switcher = createSwitcher(stage, (effect) => overlay.setEffectName(effect.name));
  if (import.meta.env.DEV) window.handfx = { stage, switcher, mask }; // console debugging

  // ---- per-hand state, keyed by handedness label (identity only, see plan §4)
  const handStates = new Map(); // key -> { filter, pinch, lastSeen }
  let hands = []; // [{ key, lm, pinch }]
  let smoothing = true;

  function processResult(res, now) {
    const used = new Set();
    const next = [];
    const n = res.landmarks.length;
    for (let i = 0; i < n; i++) {
      let key = res.handedness[i]?.[0]?.categoryName ?? "Hand";
      if (used.has(key)) key = `#${i}`; // two hands with the same label: fall back to index
      used.add(key);

      let st = handStates.get(key);
      if (!st || now - st.lastSeen > HAND_TIMEOUT_MS) {
        st = { filter: createHandFilter(), pinch: makePinchDetector(), lastSeen: now };
        handStates.set(key, st);
      }
      const fdt = Math.max((now - st.lastSeen) / 1000, 1 / 240);
      st.lastSeen = now;

      const raw = res.landmarks[i];
      let lm = raw;
      if (smoothing) lm = st.filter.filter(raw, fdt);
      else st.filter.reset();

      const pinch = st.pinch(lm, aspect);
      if (pinch.fired) switcher.fire(now);
      next.push({ key, lm, pinch });
    }
    hands = next;
    for (const [key, st] of handStates) if (now - st.lastSeen > HAND_TIMEOUT_MS) handStates.delete(key);
    mask.update(hands.map((h) => h.lm));
  }

  // ---- keys
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case "d":
        overlay.toggleDebug();
        break;
      case "m":
        overlay.toggleMask();
        break;
      case "s":
        smoothing = !smoothing;
        break;
      case " ":
        e.preventDefault();
        switcher.next();
        break;
      default:
        if (e.key >= "1" && e.key <= "9" && +e.key <= switcher.count) switcher.select(+e.key - 1);
    }
  });

  // ---- main loop
  let fps = 0;
  let detectMs = 0;
  let lastNow = performance.now();
  let lastHud = 0;
  let raf = 0;
  let presence = 0;
  const frameState = {
    nowMs: 0,
    dt: 0,
    aspect,
    hands,
    presence: 0,
    videoTexture: stage.videoTexture,
    maskTexture: mask.texture,
    maskTexel: mask.texel,
  };

  let lastErrorLog = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    try {
      step(now);
    } catch (err) {
      // Keep running; one bad frame (e.g. a transient tracker error) shouldn't kill the app.
      if (now - lastErrorLog > 2000) {
        lastErrorLog = now;
        console.error(err);
      }
    }
  }

  function step(now) {
    const rawDt = (now - lastNow) / 1000;
    lastNow = now;
    if (rawDt > 0) fps += (1 / rawDt - fps) * 0.05;
    const dt = Math.min(Math.max(rawDt, 1 / 120), 1 / 20);

    const t0 = performance.now();
    const res = tracker.detect(video, now);
    if (res) {
      detectMs += (performance.now() - t0 - detectMs) * 0.1;
      processResult(res, now);
    }

    const target = hands.length > 0 ? 1 : 0;
    presence += (target - presence) * (1 - Math.exp(-dt * PRESENCE_RATE));

    frameState.nowMs = now;
    frameState.dt = dt;
    frameState.hands = hands;
    frameState.presence = presence;
    switcher.current.update(frameState);

    overlay.draw(hands);
    stage.render();

    if (now - lastHud > 200) {
      lastHud = now;
      overlay.setDebugText(
        [
          `fps      ${fps.toFixed(0)}`,
          `detect   ${detectMs.toFixed(1)} ms (${tracker.delegate})`,
          `hands    ${hands.length}  [${hands.map((h) => h.key).join(", ")}]`,
          `pinch    ${hands.map((h) => `${h.pinch.ratio.toFixed(2)}${h.pinch.active ? "*" : ""}`).join("  ") || "-"}`,
          `presence ${presence.toFixed(2)}`,
          `smooth   ${smoothing ? "on" : "off"}`,
          `video    ${video.videoWidth}×${video.videoHeight}`,
        ].join("\n")
      );
    }
  }

  // Pause when the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      lastNow = performance.now();
      raf = requestAnimationFrame(frame);
    }
  });

  raf = requestAnimationFrame(frame);
}
