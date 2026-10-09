// getUserMedia + <video> setup. Resolves once the first frame is ready.

export class CameraError extends Error {
  constructor(title, message) {
    super(message);
    this.title = title;
  }
}

export async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      "Camera not available",
      "This browser cannot access a camera here. Camera access needs HTTPS or localhost and a modern browser (Chrome, Safari, Firefox)."
    );
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    });
  } catch (err) {
    throw toCameraError(err);
  }

  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;

  await new Promise((resolve, reject) => {
    if (video.readyState >= 2) return resolve();
    video.addEventListener("loadeddata", resolve, { once: true });
    video.addEventListener("error", () => reject(new CameraError("Camera error", "The video stream could not be started.")), { once: true });
  });
  await video.play();

  const aspect = video.videoWidth / video.videoHeight;
  return { video, aspect, stream };
}

function toCameraError(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return new CameraError(
        "Camera permission denied",
        "Hand FX needs your camera. Allow camera access for this site in the browser's address bar (and in System Settings → Privacy & Security → Camera on macOS), then reload."
      );
    case "NotFoundError":
    case "OverconstrainedError":
      return new CameraError("No camera found", "No usable webcam was detected. Connect a camera and reload.");
    case "NotReadableError":
    case "AbortError":
      return new CameraError(
        "Camera is busy",
        "The camera could not be started. It may be in use by another app (Zoom, FaceTime, OBS…). Close it and reload."
      );
    default:
      return new CameraError("Camera error", err?.message || String(err));
  }
}
