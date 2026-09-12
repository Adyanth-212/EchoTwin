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
