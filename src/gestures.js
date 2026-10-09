// Pinch detector: thumb tip (4) to index tip (8), normalized by hand size
// (wrist 0 to middle knuckle 9), aspect-corrected, with hysteresis.

export const PINCH_ON = 0.25; // becomes active below this ratio
export const PINCH_OFF = 0.4; // becomes inactive above this ratio
export const PINCH_COOLDOWN_MS = 700; // enforced globally by the effect switcher

export function pinchRatio(lm, aspect) {
  const d = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  return d(lm[4], lm[8]) / Math.max(d(lm[0], lm[9]), 1e-6);
}

export function makePinchDetector({ on = PINCH_ON, off = PINCH_OFF } = {}) {
  let active = false;
  let armed = false;
  return function update(lm, aspect) {
    const ratio = pinchRatio(lm, aspect);
    let fired = false;
    if (!armed) {
      // First sight of this hand: adopt its state without firing, so a hand
      // that enters the frame already pinched does not trigger a switch.
      armed = true;
      active = ratio < off;
    } else if (!active && ratio < on) {
      active = true;
      fired = true;
    } else if (active && ratio > off) {
      active = false;
    }
    return { ratio, active, fired };
  };
}
