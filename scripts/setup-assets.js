// Postinstall: copy MediaPipe WASM into public/wasm and fetch the hand model
// into public/models if it is not there yet. Both are served locally so the
// app never depends on a CDN at runtime.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDst = join(root, "public/wasm");
if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log("[setup-assets] copied MediaPipe WASM -> public/wasm");
} else {
  console.warn("[setup-assets] @mediapipe/tasks-vision not installed; skipping WASM copy");
}

const modelDir = join(root, "public/models");
const modelPath = join(modelDir, "hand_landmarker.task");
if (existsSync(modelPath)) {
  console.log("[setup-assets] model already present");
} else {
  mkdirSync(modelDir, { recursive: true });
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
    console.log("[setup-assets] downloaded hand_landmarker.task -> public/models");
  } catch (err) {
    console.warn(
      `[setup-assets] could not download the model (${err.message}).\n` +
        `  Download it manually from:\n  ${MODEL_URL}\n  and save it as public/models/hand_landmarker.task`
    );
  }
}
