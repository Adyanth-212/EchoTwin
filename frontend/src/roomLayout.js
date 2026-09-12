/* ===========================================================================
 * EDIT ME — physical layout of the real room
 * ===========================================================================
 *
 * Everything the 3D twin draws comes from this file. Adjust it by hand once
 * the sensor node, the two cameras and the monitored machine are physically
 * mounted at the venue. Nothing else needs to change.
 *
 * Units are metres. The room is centred on the origin:
 *
 *     x  runs across the width   ->  -width/2  .. +width/2
 *     y  is height above the floor  ->  0 .. height
 *     z  runs across the depth   ->  -depth/2  .. +depth/2
 *
 * The +z side is left open (no wall) so the camera can look into the room.
 * Put wall-mounted markers on the back (-z) or side walls, not on +z.
 *
 * `kind` selects the marker geometry and which live values its label shows:
 *
 *     "sensor"     -> air temperature and eCO2   (the ESP32 node)
 *     "camera"     -> that camera's occupancy count
 *     "equipment"  -> surface temperature and vibration, plus a health dot
 *
 * A camera marker's `id` must match the `camera_id` the CV producer posts
 * (cv/producer.py --camera-id), or its label falls back to the room total.
 * =========================================================================== */

export const ROOM = { width: 6, depth: 4.6, height: 3 };

/* --- Scanned room model -----------------------------------------------
 *
 * Drop a phone scan of the real room at `frontend/public/room.glb` and it
 * replaces the plain box geometry. Export GLB from Polycam, Scaniverse or
 * RoomPlan; Draco compression is fine, the decoder is served locally from
 * public/draco so nothing is fetched from a CDN at runtime.
 *
 * If the file is missing or fails to load, the box room is used instead —
 * the dashboard never breaks because a scan is absent or malformed.
 *
 * `autoFit` scales and centres the scan so its footprint matches ROOM
 * above, which gets an arbitrarily-oriented photogrammetry mesh roughly
 * right on the first try. Then nudge it with the values below.
 */
export const ROOM_MODEL = {
  enabled: true,
  defaultMode:
    import.meta.env.VITE_ROOM_MODEL_MODE === "gaussian" ? "gaussian" : "mesh",

  mesh: {
    url:
      import.meta.env.VITE_ROOM_MESH ||
      import.meta.env.VITE_ROOM_MODEL ||
      "/scans/table-mesh.glb",
    autoFit: true,
    // Extra multiplier applied after autoFit. 1 = leave it alone.
    scale: 1,
    // Metres, applied after autoFit centring.
    offset: [0, 0, 0],
    // Degrees about the vertical axis.
    rotationY: 0,
    // Dollhouse cutaway for the triangle mesh. null shows everything.
    clipHeight: 2.2,
  },

  gaussian: {
    url: import.meta.env.VITE_ROOM_SPLAT || "/scans/table-gaussian.ply",
    // Scaniverse Gaussian exports use OpenCV orientation. The renderer flips
    // X by 180 degrees, then applies these room-alignment controls.
    scale: 0.55,
    offset: [0, 0, 0],
    rotationY: 0,
    // Higher values produce a slightly sharper photographic reconstruction.
    focalAdjustment: 2,
  },
};

/* Each marker may carry an optional `model` — a path under public/ to a GLB
 * for that object (e.g. "/models/ac-unit.glb"). Without one, the simple
 * built-in geometry for its `kind` is drawn instead, and a model that fails
 * to load falls back to the same. */
export const MARKERS = [
  {
    id: "esp32_1",
    kind: "sensor",
    label: "Sensor node",
    position: [-2.9, 1.5, 0.4],
  },
  {
    id: "cam1",
    kind: "camera",
    label: "Camera 1",
    position: [-2.7, 2.6, -2.05],
  },
  {
    id: "cam2",
    kind: "camera",
    label: "Camera 2",
    position: [2.7, 2.6, -2.05],
  },
  {
    id: "equip_1",
    kind: "equipment",
    label: "AC unit",
    position: [1.8, 1.1, -2.0],
  },
];

export function findMarker(id) {
  for (let index = 0; index < MARKERS.length; index += 1) {
    if (MARKERS[index].id === id) {
      return MARKERS[index];
    }
  }
  return null;
}
