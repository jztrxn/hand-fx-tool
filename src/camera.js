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

// Dev/testing: use an image or video file instead of the webcam (`?src=/dev/hand.jpg`).
// Images are drawn into a canvas with a slow drift so motion-based effects have something to do.
export async function startMediaSource(src) {
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.loop = true;

  if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(src)) {
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => {
      throw new CameraError("Test image failed to load", `Could not load ${src}`);
    });
    const canvas = document.createElement("canvas");
    // Pad portrait images to 16:9 so the stage looks like a webcam.
    canvas.height = 720;
    canvas.width = 1280;
    const ctx = canvas.getContext("2d");
    const s = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.92;
    const draw = (t) => {
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const dx = Math.sin(t / 900) * 60;
      const dy = Math.cos(t / 1300) * 20;
      const w = img.width * s;
      const h = img.height * s;
      ctx.drawImage(img, (canvas.width - w) / 2 + dx, (canvas.height - h) / 2 + dy, w, h);
      requestAnimationFrame(draw);
    };
    draw(0);
    video.srcObject = canvas.captureStream(30);
  } else {
    video.src = src;
  }

  await new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", resolve, { once: true });
    video.addEventListener("error", () => reject(new CameraError("Test video failed to load", `Could not load ${src}`)), { once: true });
  });
  await video.play();
  return { video, aspect: video.videoWidth / video.videoHeight };
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
