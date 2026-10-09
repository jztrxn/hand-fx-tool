// Bootstrap, Start button, main loop, key bindings.
import { startCamera } from "./camera.js";
import { createStage, hasWebGL } from "./stage.js";

const $ = (id) => document.getElementById(id);
const ui = {
  stage: $("stage"),
  startScreen: $("start-screen"),
  startBtn: $("start-btn"),
  startStatus: $("start-status"),
  errorScreen: $("error-screen"),
  errorTitle: $("error-title"),
  errorMessage: $("error-message"),
  hudDebug: $("hud-debug"),
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
    showError("WebGL not available", "Your browser or GPU does not support WebGL, which Hand FX needs for rendering. Try a recent Chrome, Safari or Firefox with hardware acceleration enabled.");
    return;
  }
  try {
    ui.startStatus.textContent = "Starting camera…";
    const cam = await startCamera();
    ui.startScreen.hidden = true;
    run(cam);
  } catch (err) {
    console.error(err);
    showError(err.title || "Startup failed", err.message || String(err));
  }
});

function run({ video, aspect }) {
  const stage = createStage(ui.stage, video, aspect);
  stage.resize();
  window.addEventListener("resize", () => stage.resize());

  let fps = 0;
  let lastNow = performance.now();
  let raf = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const rawDt = (now - lastNow) / 1000;
    lastNow = now;
    if (rawDt > 0) fps += (1 / rawDt - fps) * 0.05;

    stage.render();
    ui.hudDebug.textContent = `fps ${fps.toFixed(0)}`;
  }

  raf = requestAnimationFrame(frame);
}
