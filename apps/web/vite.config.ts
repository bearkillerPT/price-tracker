import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The API's port comes from the repo root's .env (PORT), the same file the API reads
const repoRoot = path.resolve(import.meta.dirname, "../..");
const apiPort = loadEnv("development", repoRoot, "").PORT || process.env.PORT || "4380";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  // React, Radix and zod make the main chunk ~650 kB; the chart (recharts) is split out on its own
  build: { chunkSizeWarningLimit: 800 },
  server: {
    // The API runs separately in development (pnpm dev at the repo root starts both)
    // ws: the live browser streams over a WebSocket under /api
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, ws: true } },
  },
});
