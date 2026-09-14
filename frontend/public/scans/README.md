# Local 3D scans

Captured scan files are not bundled with the repository. All contents of this
directory except this guide are Git-ignored, including compressed archives.

## Formats and filenames

| Viewer | Local file | Contents |
| --- | --- | --- |
| Mesh | `table-mesh.glb` | glTF 2.0 binary mesh, preferably with embedded textures; bundled Draco decoding is available |
| Gaussian | `table-gaussian.ply` | Gaussian-splat export with position, color, opacity, scale, and rotation data; not an ordinary mesh/point-cloud PLY |
| Optional archive | `table-gaussian.ply.gz` | Gzip-compressed Gaussian PLY, automatically unpacked by frontend predev/prebuild when the raw PLY is absent |

Either representation can be used alone. With no supplied scan, the viewer is
designed to show its fallback room. To test the mesh loader with the small
synthetic sample instead, set `VITE_ROOM_MESH=/room-sample.glb` in
`frontend/.env.local` and restart Vite.

For different filenames, set `VITE_ROOM_MESH=/scans/my-room.glb` and/or
`VITE_ROOM_SPLAT=/scans/my-room.ply`. Decompress custom archive filenames
yourself; automatic preparation only handles `table-gaussian.ply.gz`.

Do not rename OBJ/FBX files to GLB: export or convert them. Keep units and
orientation consistent, inspect texture quality, and align each representation
using `ROOM_MODEL` in `frontend/src/roomLayout.js`. A visual scan does not
automatically identify sensors or calibrate camera positions.

## Backups and sharing

- Transfer scans separately to each frontend laptop. Keep original exports
  backed up outside the checkout.
- Before pulling a commit that removes formerly tracked scans, copy those
  scans outside the repository, then restore them into this ignored folder.
- An existing raw PLY takes precedence over its archive; back it up/move it
  aside before unpacking a new archive.
- Git ignore rules do not restrict runtime access: files here are served by
  the frontend and included in builds. Do not put sensitive originals here.
- Removing files in a new commit does not purge them from earlier Git history.

See the [main 3D setup instructions](../../../README.md#3d-scans-and-markers).
