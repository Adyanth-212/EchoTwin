import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Everything the browser needs is served from the Vite origin and proxied
// from here, so the backend's CORS allow-list never comes into play. That
// matters because the dashboard is opened from a phone on the venue LAN,
// whose origin is not in the backend's allow-list and cannot be added
// (the backend config is owned by another branch).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendHost =
    env.VITE_BACKEND_HOST || "sanjays-macbook-air.tail833b77.ts.net:8000";

  const httpTarget = "http://" + backendHost;
  const wsTarget = "ws://" + backendHost;

  return {
    plugins: [react()],
    server: {
      // Listen on all interfaces so a phone on the same hotspot can load
      // the dashboard and the QR-code mobile view.
      host: true,
      proxy: {
        "/api": {
          target: httpTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        "/ws": {
          target: wsTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
