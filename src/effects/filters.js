// Effect 3: Filters. With two hands up, the fingertips of each adjacent finger
// pair span a quad between the hands (thumb–index, index–middle, middle–ring,
// ring–pinky). Each quad shows the camera through a different filter.
import * as THREE from "three";
import { VIDEO_VERT } from "../stage.js";

const TIPS = [4, 8, 12, 16, 20];
const FADE_RATE = 10; // 1/s, how fast the quads fade in/out when two hands appear/leave

// Order matches the quads from thumb side to pinky side.
export const FILTER_NAMES = ["Black & White", "Cartoon", "Comic", "Thermal"];

const FRAG = /* glsl */ `
uniform sampler2D uVideo;
uniform vec2 uTexel;       // 1 / video size
uniform vec2 uPts[10];     // fingertips in video space: hand A 0..4, hand B 5..9
uniform float uActive;     // 0..1
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 tex(vec2 uv) { return texture2D(uVideo, uv).rgb; }

// Sobel edge magnitude on luminance.
float edges(vec2 uv, float r) {
  vec2 o = uTexel * r;
  float tl = luma(tex(uv + vec2(-o.x,  o.y))), t = luma(tex(uv + vec2(0.0,  o.y))), tr = luma(tex(uv + vec2(o.x,  o.y)));
  float l  = luma(tex(uv + vec2(-o.x, 0.0))),                                       rr = luma(tex(uv + vec2(o.x, 0.0)));
  float bl = luma(tex(uv + vec2(-o.x, -o.y))), b = luma(tex(uv + vec2(0.0, -o.y))), br = luma(tex(uv + vec2(o.x, -o.y)));
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * rr + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return length(vec2(gx, gy));
}

// Cheap blur to flatten texture before posterizing.
vec3 soft(vec2 uv) {
  vec2 o = uTexel * 2.0;
  return (tex(uv) * 2.0 + tex(uv + vec2(o.x, 0.0)) + tex(uv - vec2(o.x, 0.0))
        + tex(uv + vec2(0.0, o.y)) + tex(uv - vec2(0.0, o.y))) / 6.0;
}

vec3 saturate3(vec3 c, float s) { return clamp(mix(vec3(luma(c)), c, s), 0.0, 1.0); }

// Posterize brightness only, keeping hue (per-channel posterize shifts dark greys to odd tints).
vec3 posterize(vec3 c, float n) {
  float l = luma(c);
  float pl = floor(l * n + 0.5) / n;
  return clamp(c * (pl / max(l, 1e-3)), 0.0, 1.0);
}

vec3 filterBW(vec2 uv) {
  float g = luma(tex(uv));
  return vec3(smoothstep(0.08, 0.92, g));
}

vec3 filterCartoon(vec2 uv) {
  vec3 c = posterize(saturate3(soft(uv), 1.5), 5.0);
  float e = smoothstep(0.25, 0.55, edges(uv, 1.5));
  return c * (1.0 - e);
}

vec3 filterComic(vec2 uv) {
  vec3 c = posterize(saturate3(soft(uv), 1.8), 3.0);
  float l = luma(c);
  // Halftone dots on a 45-degree grid, sized by darkness (in video pixels).
  vec2 px = uv / uTexel;
  vec2 rp = mat2(0.7071, -0.7071, 0.7071, 0.7071) * px;
  float cell = 7.0;
  vec2 f = fract(rp / cell) - 0.5;
  float r = sqrt(clamp(1.0 - l, 0.0, 1.0)) * 0.62;
  float dotMask = 1.0 - smoothstep(r - 0.08, r + 0.08, length(f));
  vec3 paper = c * 1.15 + vec3(0.06, 0.05, 0.0);
  vec3 col = mix(paper, c * 0.45, dotMask);
  float e = smoothstep(0.2, 0.45, edges(uv, 1.2));
  return clamp(col, 0.0, 1.0) * (1.0 - e);
}

vec3 filterThermal(vec2 uv) {
  float t = smoothstep(0.02, 0.98, luma(soft(uv)));
  vec3 c = mix(vec3(0.0, 0.0, 0.15), vec3(0.25, 0.0, 0.7), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(0.9, 0.0, 0.35), smoothstep(0.2, 0.5, t));
  c = mix(c, vec3(1.0, 0.55, 0.0), smoothstep(0.45, 0.75, t));
  c = mix(c, vec3(1.0, 1.0, 0.75), smoothstep(0.75, 1.0, t));
  return c;
}

// Even-odd point-in-quad test (works for concave/twisted quads too).
float crosses(vec2 p, vec2 vi, vec2 vj) {
  return (((vi.y > p.y) != (vj.y > p.y)) &&
          (p.x < (vj.x - vi.x) * (p.y - vi.y) / (vj.y - vi.y) + vi.x)) ? 1.0 : 0.0;
}

bool inQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
  float n = crosses(p, a, d) + crosses(p, b, a) + crosses(p, c, b) + crosses(p, d, c);
  return mod(n, 2.0) > 0.5;
}

// Distance from p to segment ab, in video pixels.
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = (p - a) / uTexel;
  vec2 ba = (b - a) / uTexel;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = vec2(1.0 - vUv.x, vUv.y);   // mirrored texture coordinate (selfie view)
  vec2 p = vec2(uv.x, 1.0 - uv.y);      // same point in video space (y down)
  vec3 video = tex(uv);
  vec3 col = video;

  if (uActive > 0.001) {
    int which = -1;
    for (int k = 0; k < 4; k++) {
      if (which < 0 && inQuad(p, uPts[k], uPts[k + 1], uPts[k + 6], uPts[k + 5])) which = k;
    }
    vec3 filtered = video;
    if (which == 0) filtered = filterBW(uv);
    else if (which == 1) filtered = filterCartoon(uv);
    else if (which == 2) filtered = filterComic(uv);
    else if (which == 3) filtered = filterThermal(uv);
    col = mix(video, filtered, uActive);

    // Glowing lines: across the hands (tip to tip) and along each hand.
    float d = 1e6;
    for (int k = 0; k < 5; k++) {
      d = min(d, segDist(p, uPts[k], uPts[k + 5]));
      if (k < 4) {
        d = min(d, segDist(p, uPts[k], uPts[k + 1]));
        d = min(d, segDist(p, uPts[k + 5], uPts[k + 6]));
      }
    }
    float line = 1.0 - smoothstep(1.0, 2.5, d);
    float glow = exp(-d * 0.18) * 0.35;
    col += vec3(line + glow) * uActive;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createFilters() {
  let material = null;
  let active = 0;

  return {
    name: "Filters",
    twoHandPose: true, // main.js: ignore pinch-to-switch while both hands are up
    mount(stage) {
      const v = stage.videoTexture.image;
      material = new THREE.ShaderMaterial({
        uniforms: {
          uVideo: { value: stage.videoTexture },
          uTexel: { value: new THREE.Vector2(1 / v.videoWidth, 1 / v.videoHeight) },
          uPts: { value: Array.from({ length: 10 }, () => new THREE.Vector2()) },
          uActive: { value: 0 },
        },
        vertexShader: VIDEO_VERT,
        fragmentShader: FRAG,
        depthWrite: false,
      });
      active = 0;
      stage.setQuadMaterial(material);
    },
    unmount(stage) {
      stage.restoreQuadMaterial();
      material.dispose();
      material = null;
    },
    update(frame) {
      const u = material.uniforms;
      const two = frame.hands.length >= 2;
      if (two) {
        // Sort the pair left-to-right in the image so hand A/B don't swap between frames.
        let a = frame.hands[0].lm;
        let b = frame.hands[1].lm;
        if (a[0].x > b[0].x) [a, b] = [b, a];
        for (let k = 0; k < 5; k++) {
          u.uPts.value[k].set(a[TIPS[k]].x, a[TIPS[k]].y);
          u.uPts.value[k + 5].set(b[TIPS[k]].x, b[TIPS[k]].y);
        }
      }
      // Fade in with two hands, fade out (keeping the last quads) otherwise.
      active += ((two ? 1 : 0) - active) * (1 - Math.exp(-frame.dt * FADE_RATE));
      u.uActive.value = active;
    },
  };
}
