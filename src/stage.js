// three.js renderer, orthographic camera, mirrored video quad, toWorld().
//
// World space: left=-aspect, right=aspect, top=1, bottom=-1. The canvas is
// sized to the video aspect ratio, so UVs, landmarks and the mask line up.
import * as THREE from "three";

export const VIDEO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PLAIN_FRAG = /* glsl */ `
uniform sampler2D uVideo;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(1.0 - vUv.x, vUv.y); // mirror (selfie view)
  gl_FragColor = vec4(texture2D(uVideo, uv).rgb, 1.0);
}
`;

export function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function createStage(container, video, aspect) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  // Treat shader output as final: no color-space conversion anywhere (plan §9.7).
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, -10, 10);

  const videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.generateMipmaps = false;

  const plainMaterial = new THREE.ShaderMaterial({
    uniforms: { uVideo: { value: videoTexture } },
    vertexShader: VIDEO_VERT,
    fragmentShader: PLAIN_FRAG,
    depthWrite: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2 * aspect, 2), plainMaterial);
  quad.renderOrder = -1;
  scene.add(quad);

  function resize() {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    let w = ww;
    let h = ww / aspect;
    if (h > wh) {
      h = wh;
      w = wh * aspect;
    }
    w = Math.floor(w);
    h = Math.floor(h);
    container.style.width = `${w}px`;
    container.style.height = `${h}px`;
    renderer.setSize(w, h, false);
    return { w, h };
  }

  return {
    renderer,
    scene,
    camera,
    aspect,
    videoTexture,
    quad,
    resize,
    // Video space (x,y in [0,1], y down, unmirrored) -> world space (mirrored).
    toWorld(x, y, out = { x: 0, y: 0 }) {
      out.x = aspect * (1 - 2 * x);
      out.y = 1 - 2 * y;
      return out;
    },
    setQuadMaterial(material) {
      quad.material = material;
    },
    restoreQuadMaterial() {
      quad.material = plainMaterial;
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}
