/* Generates the QR codes that get stuck on the physical equipment and at the
 * room entrance. Scanning one opens the phone-first status view for that
 * exact target:
 *
 *   http://<host>/?view=mobile&room=corridor_a&target=equip_1
 *
 * The host is an argument or an env var, not a constant, because the venue
 * address is not known until the hotspot is up:
 *
 *   node scripts/make-qr.mjs 192.168.1.50:5173
 *   QR_HOST=192.168.1.50:5173 node scripts/make-qr.mjs
 *
 * Output goes to scripts/qr/ — one PNG per marker plus one for the room, each
 * named after the marker so it is obvious which sticker goes where, plus a
 * print sheet that lays them all out with their labels underneath.
 */

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// qrcode is a devDependency of the frontend package, so resolve it from there
// rather than expecting a second install at the repo root.
let QRCode = null;
try {
  QRCode = require("qrcode");
} catch (error) {
  try {
    QRCode = require("../frontend/node_modules/qrcode");
  } catch (innerError) {
    console.error(
      "Could not load the 'qrcode' package. Run `npm install` in frontend/ first."
    );
    process.exit(1);
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = join(scriptDir, "qr");

const host = process.argv[2] || process.env.QR_HOST || "localhost:5173";
const roomId = process.argv[3] || process.env.QR_ROOM || "corridor_a";

// Read the marker list straight out of the layout the dashboard uses, so the
// stickers and the 3D scene can never drift apart.
const layoutUrl = pathToFileURL(
  join(scriptDir, "..", "frontend", "src", "roomLayout.js")
);
const layout = await import(layoutUrl.href);

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildUrl(targetId) {
  const base = "http://" + host + "/?view=mobile&room=" + encodeURIComponent(roomId);
  if (!targetId) {
    return base;
  }
  return base + "&target=" + encodeURIComponent(targetId);
}

const jobs = [
  {
    id: "room",
    label: roomId + " (room entrance)",
    url: buildUrl(null),
    fileName: slugify(roomId) + "--room-entrance.png",
  },
];

for (const marker of layout.MARKERS) {
  jobs.push({
    id: marker.id,
    label: marker.label + " (" + marker.id + ")",
    url: buildUrl(marker.id),
    fileName: slugify(marker.id) + "--" + slugify(marker.label) + ".png",
  });
}

await mkdir(outputDir, { recursive: true });

for (const job of jobs) {
  const buffer = await QRCode.toBuffer(job.url, {
    type: "png",
    width: 600,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  await writeFile(join(outputDir, job.fileName), buffer);
  console.log(job.fileName + "  ->  " + job.url);
}

// A print sheet, so the codes can be printed with their labels underneath in
// one pass rather than matched up by filename at the printer.
const cards = jobs
  .map((job) => {
    return (
      '    <figure><img src="' +
      job.fileName +
      '" alt="QR code for ' +
      job.label +
      '"><figcaption>' +
      job.label +
      "</figcaption></figure>"
    );
  })
  .join("\n");

const sheet =
  "<!doctype html>\n" +
  '<html lang="en">\n' +
  "<head>\n" +
  '  <meta charset="utf-8">\n' +
  "  <title>EchoTwin QR stickers — " + roomId + "</title>\n" +
  "  <style>\n" +
  "    body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }\n" +
  "    h1 { font-size: 18px; }\n" +
  "    p.host { font-size: 12px; color: #555; }\n" +
  "    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 20px; }\n" +
  "    figure { margin: 0; text-align: center; break-inside: avoid; }\n" +
  "    img { width: 100%; max-width: 220px; height: auto; }\n" +
  "    figcaption { font-size: 13px; font-weight: 600; margin-top: 6px; }\n" +
  "  </style>\n" +
  "</head>\n" +
  "<body>\n" +
  "  <h1>EchoTwin — " + roomId + "</h1>\n" +
  '  <p class="host">Codes point at http://' + host + " — regenerate if that address changes.</p>\n" +
  '  <div class="grid">\n' +
  cards +
  "\n  </div>\n" +
  "</body>\n" +
  "</html>\n";

await writeFile(join(outputDir, "print-sheet.html"), sheet);

console.log("");
console.log("Wrote " + jobs.length + " codes to scripts/qr/");
console.log("Open scripts/qr/print-sheet.html to print them with labels.");
