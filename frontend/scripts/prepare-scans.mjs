import { createReadStream, createWriteStream } from "node:fs";
import { access, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// GitHub can store the losslessly compressed scan. Vite serves the original
// PLY after this preparation step; existing local scan edits are preserved.
export async function prepareScan(directory = new URL("../public/scans/", import.meta.url)) {
  const source = new URL("table-gaussian.ply.gz", directory);
  const target = new URL("table-gaussian.ply", directory);
  try {
    await access(target);
    return "existing";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await access(source);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.warn("Gaussian archive absent; the viewer will use its missing-scan fallback.");
    return "missing";
  }

  const temporary = new URL("table-gaussian.ply." + process.pid + ".tmp", directory);
  try {
    console.log("Unpacking Gaussian scan (lossless)…");
    await pipeline(createReadStream(source), createGunzip(), createWriteStream(temporary, { flags: "wx" }));
    await rename(temporary, target);
    console.log("Gaussian scan ready.");
    return "prepared";
  } finally {
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepareScan();
}
