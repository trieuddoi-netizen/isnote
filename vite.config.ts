import { defineConfig } from "vite";

// base "./" so the build works from any sub-path (GitHub Pages, a USB stick, etc.).
export default defineConfig({ base: "./", build: { target: "es2022", chunkSizeWarningLimit: 4000 } });
