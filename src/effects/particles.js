// Effect 2: Particles. Sparks stream off the fingertips.
// CPU-updated THREE.Points in a ring buffer; no per-frame allocations.
import * as THREE from "three";
import { paletteInto } from "./palette.js";

const COUNT = 4000;
const TIPS = [4, 8, 12, 16, 20];
const MAX_TIP_SLOTS = 2 * TIPS.length; // up to 2 hands

const EMIT_K = 2.5; // extra particles per (world unit / sec) of tip speed
const EMIT_CAP = 4;
const INHERIT = 0.3; // fraction of fingertip velocity given to new particles
const JITTER = 0.4; // random velocity magnitude (units/sec)
const LIFE_MIN = 0.8;
const LIFE_MAX = 1.6;
const DRAG = 2.5;
const GRAVITY = -0.15;
const VEL_SMOOTH = 0.08; // seconds; fingertip velocity EMA time constant

const VERT = /* glsl */ `
attribute vec3 color;
attribute float size;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = color;
  gl_PointSize = size * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, a);
}
`;

function hasKey(hands, key) {
  for (let i = 0; i < hands.length; i++) if (hands[i].key === key) return true;
  return false;
}

export function createParticles() {
  let points = null;
  let pos, vel, col, base, life, maxLife, size;
  let head = 0;
  // Per tip slot (hand slot * 5 + finger): previous world position, smoothed velocity.
  const slotKey = new Array(2).fill(null);
  const prev = new Float32Array(MAX_TIP_SLOTS * 2);
  const tipVel = new Float32Array(MAX_TIP_SLOTS * 2);
  const hasPrev = new Uint8Array(MAX_TIP_SLOTS);
  const rgb = new Float32Array(3);
  const tmp = { x: 0, y: 0 };
  let stage = null;

  function emit(x, y, vx, vy, hue) {
    const i = head;
    head = (head + 1) % COUNT;
    const a = Math.random() * Math.PI * 2;
    const j = JITTER * (0.4 + Math.random() * 0.6);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    vel[i * 2] = vx * INHERIT + Math.cos(a) * j;
    vel[i * 2 + 1] = vy * INHERIT + Math.sin(a) * j;
    life[i] = maxLife[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    paletteInto(hue + (Math.random() - 0.5) * 0.08, rgb, 0);
    base[i * 3] = rgb[0];
    base[i * 3 + 1] = rgb[1];
    base[i * 3 + 2] = rgb[2];
    size[i] = 3 + Math.random() * 3;
  }

  return {
    name: "Particles",
    mount(s) {
      stage = s;
      pos = new Float32Array(COUNT * 3);
      col = new Float32Array(COUNT * 3);
      base = new Float32Array(COUNT * 3);
      vel = new Float32Array(COUNT * 2);
      life = new Float32Array(COUNT);
      maxLife = new Float32Array(COUNT).fill(1);
      size = new Float32Array(COUNT);
      head = 0;
      hasPrev.fill(0);
      slotKey.fill(null);

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: s.renderer.getPixelRatio() } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        transparent: true,
      });
      points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      s.scene.add(points);
    },
    unmount(s) {
      s.scene.remove(points);
      points.geometry.dispose();
      points.material.dispose();
      points = pos = vel = col = base = life = maxLife = size = null;
      stage = null;
    },
    update(frame) {
      const dt = frame.dt;
      const t = frame.nowMs / 1000;
      const velA = 1 - Math.exp(-dt / VEL_SMOOTH);

      // Assign hands to the two slots by key so velocity history follows the hand.
      for (let s = 0; s < 2; s++) {
        if (slotKey[s] !== null && !hasKey(frame.hands, slotKey[s])) {
          slotKey[s] = null;
          hasPrev.fill(0, s * 5, s * 5 + 5);
        }
      }
      for (const hand of frame.hands) {
        let s = slotKey.indexOf(hand.key);
        if (s < 0) {
          s = slotKey.indexOf(null);
          if (s < 0) continue;
          slotKey[s] = hand.key;
        }
        for (let f = 0; f < 5; f++) {
          const slot = s * 5 + f;
          const p = hand.lm[TIPS[f]];
          stage.toWorld(p.x, p.y, tmp);
          if (!hasPrev[slot]) {
            prev[slot * 2] = tmp.x;
            prev[slot * 2 + 1] = tmp.y;
            tipVel[slot * 2] = tipVel[slot * 2 + 1] = 0;
            hasPrev[slot] = 1;
          }
          const px = prev[slot * 2];
          const py = prev[slot * 2 + 1];
          // Landmarks update at camera rate, render runs faster; the EMA evens that out.
          tipVel[slot * 2] += ((tmp.x - px) / dt - tipVel[slot * 2]) * velA;
          tipVel[slot * 2 + 1] += ((tmp.y - py) / dt - tipVel[slot * 2 + 1]) * velA;
          const vx = tipVel[slot * 2];
          const vy = tipVel[slot * 2 + 1];
          const speed = Math.hypot(vx, vy);
          const n = Math.min(EMIT_CAP, 1 + Math.floor(speed * EMIT_K));
          const hue = t * 0.1 + f * 0.15 + s * 0.5;
          for (let k = 0; k < n; k++) {
            // Spread spawns along the segment travelled this frame for continuous trails.
            const u = (k + Math.random()) / n;
            emit(px + (tmp.x - px) * u, py + (tmp.y - py) * u, vx, vy, hue);
          }
          prev[slot * 2] = tmp.x;
          prev[slot * 2 + 1] = tmp.y;
        }
      }

      const drag = Math.exp(-DRAG * dt);
      for (let i = 0; i < COUNT; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          life[i] = 0;
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
          continue;
        }
        vel[i * 2] *= drag;
        vel[i * 2 + 1] = vel[i * 2 + 1] * drag + GRAVITY * dt;
        pos[i * 3] += vel[i * 2] * dt;
        pos[i * 3 + 1] += vel[i * 2 + 1] * dt;
        const fade = life[i] / maxLife[i];
        col[i * 3] = base[i * 3] * fade;
        col[i * 3 + 1] = base[i * 3 + 1] * fade;
        col[i * 3 + 2] = base[i * 3 + 2] * fade;
      }

      const attrs = points.geometry.attributes;
      attrs.position.needsUpdate = true;
      attrs.color.needsUpdate = true;
      attrs.size.needsUpdate = true;
    },
  };
}
