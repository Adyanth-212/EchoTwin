import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Camera capture belongs on the camera Mac. Other devices can run Vite
// without a Unix shell or Terminal.app; explicit opt-out also works on Macs.
if (process.platform !== "darwin" || process.env.ECHOTWIN_START_CAMERAS === "0") {
  console.log("Camera auto-start skipped; remote camera feeds can still be used.");
} else {
  const result = spawnSync("/bin/zsh", [
    fileURLToPath(new URL("../../cv/run_cameras.sh", import.meta.url)),
  ], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.warn("Camera auto-start did not complete. Start the producers on the camera laptop; the dashboard will continue.");
  }
}
