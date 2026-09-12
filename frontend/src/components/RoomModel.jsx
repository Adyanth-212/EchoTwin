import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, DoubleSide, Plane, Vector3 } from "three";
import { ROOM, ROOM_MODEL } from "../roomLayout.js";

// Renders a phone scan of the real room in place of the box geometry.
//
// A photogrammetry export has an arbitrary origin, orientation and — unless
// it came off a LiDAR sensor — an arbitrary scale. autoFit measures the
// mesh's bounding box and fits its footprint to the ROOM dimensions, which
// gets it close enough to be recognisable on the first load. The manual
// offsets in roomLayout.js then nudge it the rest of the way by hand.
export default function RoomModel(props) {
  const config = ROOM_MODEL.mesh;
  const gltf = useGLTF(config.url, "/draco/");
  const groupRef = useRef(null);

  // The GLTF scene graph is shared across every component that loads the same
  // URL, so clone before mutating anything on it.
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const fit = useMemo(() => {
    if (!config.autoFit) {
      return { scale: 1, center: new Vector3(0, 0, 0), minY: 0 };
    }

    const bounds = new Box3().setFromObject(scene);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());

    // Fit the footprint, not the height: a scan usually includes some ceiling
    // and a lot of noise above head height, and matching the floor plan is
    // what makes the markers line up with real positions.
    const widthRatio = size.x > 0 ? ROOM.width / size.x : 1;
    const depthRatio = size.z > 0 ? ROOM.depth / size.z : 1;
    const scale = Math.min(widthRatio, depthRatio);

    return { scale: scale, center: center, minY: bounds.min.y };
  }, [scene, config.autoFit]);

  // Everything above clipHeight is sliced away, which turns a sealed scan
  // into a dollhouse you can look down into. Culling back faces instead
  // would hide the near wall but take the floor with it, since the floor
  // faces the camera too.
  const clippingPlanes = useMemo(() => {
    if (config.clipHeight === null || config.clipHeight === undefined) {
      return [];
    }
    return [new Plane(new Vector3(0, -1, 0), config.clipHeight)];
  }, [config.clipHeight]);

  useLayoutEffect(() => {
    scene.traverse((child) => {
      if (child.isMesh && child.material) {
        // Scans often arrive with missing or inconsistent normals, so draw
        // both sides rather than risk a room that is invisible from outside.
        child.material.side = DoubleSide;
        child.material.clippingPlanes = clippingPlanes;
        child.material.clipShadows = true;
        child.material.needsUpdate = true;
        child.frustumCulled = false;
      }
    });
  }, [scene, clippingPlanes]);

  useEffect(() => {
    if (props.onLoad) {
      props.onLoad();
    }
  }, [props.onLoad]);

  const scale = fit.scale * (config.scale || 1);
  const offset = config.offset || [0, 0, 0];

  // Centre horizontally on the origin and drop the floor of the scan onto
  // y = 0, so the marker positions in roomLayout.js still mean what they say.
  const position = [
    -fit.center.x * scale + offset[0],
    -fit.minY * scale + offset[1],
    -fit.center.z * scale + offset[2],
  ];

  const rotation = [0, ((config.rotationY || 0) * Math.PI) / 180, 0];

  function handleSurfaceClick(event) {
    if (!props.onSurfaceClick) {
      return;
    }

    event.stopPropagation();
    const point = event.point.clone();

    // Lift the marker a little along the clicked triangle's world-space
    // normal so its geometry does not disappear inside the scanned surface.
    if (event.face && event.face.normal) {
      const normal = event.face.normal
        .clone()
        .transformDirection(event.object.matrixWorld);
      point.addScaledVector(normal, 0.16);
    }

    props.onSurfaceClick([point.x, point.y, point.z]);
  }

  return (
    <group ref={groupRef}>
      <primitive
        object={scene}
        scale={scale}
        position={position}
        rotation={rotation}
        onClick={props.onSurfaceClick ? handleSurfaceClick : undefined}
      />
    </group>
  );
}
