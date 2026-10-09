// Landmarks -> hand mask on a 2D canvas, uploaded as a texture.
// Video space, unmirrored; the shader mirrors when sampling.
import * as THREE from "three";

const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
const PALM = [0, 1, 5, 9, 13, 17];

// Finger thickness as a fraction of hand size (wrist -> middle knuckle). Tune 0.18 to 0.30.
export const FINGER_WIDTH = 0.22;
const MASK_W = 512;

export function drawMask(ctx, hands, w, h) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ctx.strokeStyle = "#fff";
  ctx.lineCap = ctx.lineJoin = "round";
  for (const lm of hands) {
    const size = Math.hypot((lm[0].x - lm[9].x) * w, (lm[0].y - lm[9].y) * h);
    ctx.lineWidth = size * FINGER_WIDTH;
    // palm: filled polygon, padded with a stroke
    ctx.beginPath();
    PALM.forEach((i, k) => (k ? ctx.lineTo(lm[i].x * w, lm[i].y * h) : ctx.moveTo(lm[i].x * w, lm[i].y * h)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // fingers: thick round-capped polylines
    for (const chain of FINGERS) {
      ctx.beginPath();
      chain.forEach((i, k) => (k ? ctx.lineTo(lm[i].x * w, lm[i].y * h) : ctx.moveTo(lm[i].x * w, lm[i].y * h)));
      ctx.stroke();
    }
  }
}

export function createMask(aspect) {
  const w = MASK_W;
  const h = Math.round(MASK_W / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  let wasEmpty = false;
  return {
    canvas,
    texture,
    texel: [1 / w, 1 / h],
    // hands: array of 21-landmark arrays (video space)
    update(hands) {
      if (hands.length === 0 && wasEmpty) return; // already blank, skip upload
      wasEmpty = hands.length === 0;
      drawMask(ctx, hands, w, h);
      texture.needsUpdate = true;
    },
  };
}
