// One Euro filter (Casiez et al., https://gery.casiez.net/1euro/) + per-hand smoothing.

// Tuning: lower MIN_CUTOFF = less jitter at rest; raise BETA = less lag on fast moves.
// BETA is unit-dependent; these values are for normalized [0,1] video coordinates.
export const MIN_CUTOFF = 1.0;
export const BETA = 5;
export const D_CUTOFF = 1.0;

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

class LowPass {
  y = null;
  filter(x, a) {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
}

export class OneEuro {
  constructor(minCutoff = MIN_CUTOFF, beta = BETA, dCutoff = D_CUTOFF) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.xF = new LowPass();
    this.dxF = new LowPass();
    this.prev = null;
  }
  filter(x, dt) {
    const dx = this.prev === null ? 0 : (x - this.prev) / dt;
    const edx = this.dxF.filter(dx, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.prev = x;
    return this.xF.filter(x, alpha(cutoff, dt));
  }
}

// One OneEuro per landmark (21) per axis (x, y). z passes through unfiltered.
export function createHandFilter() {
  const fx = Array.from({ length: 21 }, () => new OneEuro());
  const fy = Array.from({ length: 21 }, () => new OneEuro());
  const out = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  return {
    // Returns a reused array of 21 {x,y,z}; copy it if you need to keep it.
    filter(lm, dt) {
      for (let i = 0; i < 21; i++) {
        out[i].x = fx[i].filter(lm[i].x, dt);
        out[i].y = fy[i].filter(lm[i].y, dt);
        out[i].z = lm[i].z;
      }
      return out;
    },
    reset() {
      for (let i = 0; i < 21; i++) {
        fx[i].reset();
        fy[i].reset();
      }
    },
  };
}
