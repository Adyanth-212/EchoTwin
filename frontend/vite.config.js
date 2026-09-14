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
    env.VITE_BACKEND_HOST || "localhost:8000";

  const httpTarget = "http://" + backendHost;
  const wsTarget = "ws://" + backendHost;

  // Each CV producer serves the floor positions of the people it can see
  // straight from the camera laptop (see cv/producer.py). Those do not go
  // through the backend: its /cv schema is fixed and has no room for them,
  // and that file belongs to another branch. Proxying them here keeps the
  // browser same-origin, exactly like the backend calls.
  const cameraHosts = {
    "/cam1": env.VITE_CAM1_HOST || "localhost:8010",
    "/cam2": env.VITE_CAM2_HOST || "localhost:8011",
  };

  const cameraProxy = {};
  for (const prefix of Object.keys(cameraHosts)) {
    cameraProxy[prefix] = {
      target: "http://" + cameraHosts[prefix],
      changeOrigin: true,
      rewrite: (path) => path.replace(new RegExp("^" + prefix), ""),
      // A camera laptop that is not running is the normal case during
      // development; do not let it take the dev server's logs with it.
      configure: (proxy) => {
        proxy.on("error", () => {});
      },
    };
  }

  return {
    plugins: [react()],
    server: {
      // Listen on all interfaces so a phone on the same hotspot can load
      // the dashboard and the QR-code mobile view.
      host: true,
      proxy: {
        // Optional sidecar keeps maintenance experiments off the demo API.
        "/api/maintenance": {
          target: "http://" + (env.VITE_MAINTENANCE_HOST || backendHost),
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
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
        ...cameraProxy,
      },
    },
  };
});
