import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Sentinel API runs on 127.0.0.1:8080 per configs/config.example.toml [server].
// Dev server proxies the real API paths so the SPA stays same-origin and no
// backend CORS configuration is required. Production is a static build served
// behind any reverse proxy that forwards /v1, /health, /ready, /metrics.
const API_TARGET = process.env.SENTINEL_API_TARGET ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: API_TARGET, changeOrigin: true },
      "/health": { target: API_TARGET, changeOrigin: true },
      "/ready": { target: API_TARGET, changeOrigin: true },
      "/metrics": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
