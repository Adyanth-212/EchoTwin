import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { ROOM_MODEL } from "../roomLayout.js";

// Three.js-native Gaussian rendering. SparkRenderer performs the shared
// sorting/render pass; SplatMesh owns the Scaniverse PLY data and behaves like
// a normal Object3D, so the existing markers can remain in the same Canvas.
export default function GaussianRoomModel(props) {
  const config = ROOM_MODEL.gaussian;
  const { gl, invalidate } = useThree();
  const [splat, setSplat] = useState(null);

  const spark = useMemo(
    () =>
      new SparkRenderer({
        renderer: gl,
        onDirty: invalidate,
        focalAdjustment: config.focalAdjustment,
        // Scaniverse scenes are reconstructed along camera depth, for which
        // z-depth sorting usually gives the cleanest edges.
        sortRadial: false,
      }),
    [config.focalAdjustment, gl, invalidate],
  );

  useEffect(() => {
    return () => spark.dispose();
  }, [spark]);

  useEffect(() => {
    let disposed = false;
    const next = new SplatMesh({
      url: config.url,
      // Preserve every source splat for the quality comparison.
      lod: false,
      raycastable: false,
      onProgress: (event) => {
        if (!disposed && props.onProgress) {
          props.onProgress(event.loaded || 0, event.total || 0);
        }
      },
    });

    next.frustumCulled = false;
    setSplat(next);

    next.initialized
      .then(() => {
        if (!disposed && props.onLoad) {
          props.onLoad();
        }
        invalidate();
      })
      .catch((error) => {
        if (!disposed && props.onError) {
          props.onError(error);
        }
      });

    return () => {
      disposed = true;
      next.dispose();
    };
  }, [config.url, invalidate, props.onError, props.onLoad, props.onProgress]);

  const offset = config.offset || [0, 0, 0];
  const rotationY = ((config.rotationY || 0) * Math.PI) / 180;

  return (
    <>
      <primitive object={spark} />
      {splat ? (
        <group
          position={offset}
          rotation={[0, rotationY, 0]}
          scale={config.scale || 1}
          visible={props.visible !== false}
        >
          {/* Convert the OpenCV camera frame used by the PLY to Three.js. */}
          <primitive object={splat} rotation={[Math.PI, 0, 0]} />
        </group>
      ) : null}
    </>
  );
}
