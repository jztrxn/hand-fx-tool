// 2D debug overlay: skeleton (video space, CSS-mirrored), HUD text, mask preview.
import { HAND_CONNECTIONS } from "./tracker.js";

const HAND_COLORS = ["#7cf3ff", "#ff7ce0"];

export function createOverlay({ canvas, hudEffect, hudDebug, maskPreview, maskCanvas }) {
  const ctx = canvas.getContext("2d");
  maskPreview.appendChild(maskCanvas);

  let debug = true;
  let showMask = false;
  let cleared = false;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    cleared = false;
  }

  function drawSkeleton(hands) {
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    const r = Math.max(2, w / 400);
    hands.forEach((hand, hi) => {
      const lm = hand.lm;
      const color = HAND_COLORS[hi % HAND_COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 0.8;
      ctx.beginPath();
      for (const { start, end } of HAND_CONNECTIONS) {
        ctx.moveTo(lm[start].x * w, lm[start].y * h);
        ctx.lineTo(lm[end].x * w, lm[end].y * h);
      }
      ctx.stroke();
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 21; i++) {
        ctx.beginPath();
        ctx.arc(lm[i].x * w, lm[i].y * h, i % 4 === 0 && i > 0 ? r * 1.6 : r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (hand.pinch?.active) {
        const a = lm[4];
        const b = lm[8];
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = r;
        ctx.beginPath();
        ctx.arc(((a.x + b.x) / 2) * w, ((a.y + b.y) / 2) * h, r * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  return {
    resize,
    get debug() {
      return debug;
    },
    toggleDebug() {
      debug = !debug;
      if (!debug) hudDebug.textContent = "";
    },
    toggleMask() {
      showMask = !showMask;
      maskPreview.hidden = !showMask;
    },
    setEffectName(name) {
      hudEffect.textContent = `effect: ${name}`;
    },
    draw(hands) {
      if (debug) {
        drawSkeleton(hands);
        cleared = false;
      } else if (!cleared) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        cleared = true;
      }
    },
    setDebugText(text) {
      if (debug) hudDebug.textContent = text;
    },
  };
}
