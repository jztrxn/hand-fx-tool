// HandLandmarker wrapper. Local WASM + model, GPU delegate with CPU fallback.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const BASE = import.meta.env.BASE_URL; // "/" by default; respects vite `base`

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;

export async function createTracker() {
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
  const make = (delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate },
      runningMode: "VIDEO",
      numHands: 2,
    });

  let landmarker;
  let delegate = "GPU";
  try {
    landmarker = await make("GPU");
  } catch (err) {
    console.warn("GPU delegate failed, falling back to CPU", err);
    delegate = "CPU";
    landmarker = await make("CPU");
  }

  let lastVideoTime = -1;
  let lastTs = 0;
  return {
    delegate,
    // Returns null when the video has no new frame since the last call.
    detect(video, nowMs) {
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return null;
      lastVideoTime = video.currentTime;
      // Timestamps must be strictly increasing in VIDEO mode.
      const ts = Math.max(nowMs, lastTs + 1);
      lastTs = ts;
      return landmarker.detectForVideo(video, ts);
    },
  };
}
