// Effect 1: Aura. Video dims, the hand gets a color-cycling neon glow.
import * as THREE from "three";
import { VIDEO_VERT } from "../stage.js";
import { PALETTE_GLSL } from "./palette.js";

const FRAG = /* glsl */ `
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform vec2 uMaskTexel;   // 1 / mask canvas size
uniform float uTime;
uniform float uPresence;   // 0..1
varying vec2 vUv;

${PALETTE_GLSL}

void main() {
  vec2 uv = vec2(1.0 - vUv.x, vUv.y);        // mirror (selfie view)
  vec3 video = texture2D(uVideo, uv).rgb;
  float m = texture2D(uMask, uv).r;

  // Three rings of 12 taps (radii in mask pixels), each ring rotated so the
  // taps interleave; inner rings weigh more. Sparse rings show "ghost" copies
  // of the hand at large radii, so this is denser than the plan's 2x8 sketch.
  float halo = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.523599;
    halo += 0.45 * texture2D(uMask, uv + vec2(cos(a), sin(a)) * uMaskTexel * 7.0).r;
    halo += 0.35 * texture2D(uMask, uv + vec2(cos(a + 0.174533), sin(a + 0.174533)) * uMaskTexel * 15.0).r;
    halo += 0.20 * texture2D(uMask, uv + vec2(cos(a + 0.349066), sin(a + 0.349066)) * uMaskTexel * 26.0).r;
  }
  halo /= 12.0;

  float outside = clamp(halo - m, 0.0, 1.0);  // glow outside the hand
  float edge = smoothstep(0.0, 0.6, outside);
  vec3 glow = palette(uTime * 0.1 + uv.x * 0.6 + uv.y * 0.3);

  vec3 dimmed   = video * mix(1.0, 0.35, uPresence);
  vec3 handTint = video + glow * 0.25 * uPresence;
  vec3 col = mix(dimmed, handTint, m);
  col += glow * edge * 1.6 * uPresence;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createAura() {
  let material = null;

  return {
    name: "Aura",
    mount(stage) {
      material = new THREE.ShaderMaterial({
        uniforms: {
          uVideo: { value: stage.videoTexture },
          uMask: { value: null },
          uMaskTexel: { value: new THREE.Vector2() },
          uTime: { value: 0 },
          uPresence: { value: 0 },
        },
        vertexShader: VIDEO_VERT,
        fragmentShader: FRAG,
        depthWrite: false,
      });
      stage.setQuadMaterial(material);
    },
    unmount(stage) {
      stage.restoreQuadMaterial();
      material.dispose();
      material = null;
    },
    update(frame) {
      const u = material.uniforms;
      u.uMask.value = frame.maskTexture;
      u.uMaskTexel.value.set(frame.maskTexel[0], frame.maskTexel[1]);
      u.uTime.value = frame.nowMs / 1000;
      u.uPresence.value = frame.presence;
    },
  };
}
