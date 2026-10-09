import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // Relative asset paths in builds, so dist/ works from any sub-path
  // (e.g. GitHub Pages at /hand-fx-tool/). Dev server stays at "/".
  base: command === "build" ? "./" : "/",
  // three.js + MediaPipe make one ~530 kB chunk; that's expected for this app.
  build: { chunkSizeWarningLimit: 1000 },
}));
