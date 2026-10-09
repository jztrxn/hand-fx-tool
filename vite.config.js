import { defineConfig } from "vite";

export default defineConfig({
  // three.js + MediaPipe make one ~530 kB chunk; that's expected for this app.
  build: { chunkSizeWarningLimit: 1000 },
});
