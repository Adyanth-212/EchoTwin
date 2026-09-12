import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Vector3 } from "three";

// Optional per-marker GLB, sized so its largest dimension matches `fit`
// metres. Lets a real AC unit or camera model stand in for the built-in
// primitive without anyone having to get the export scale right.
export default function MarkerModel(props) {
  const gltf = useGLTF(props.url, "/draco/");
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const scale = useMemo(() => {
    const bounds = new Box3().setFromObject(scene);
    const size = bounds.getSize(new Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (largest <= 0) {
      return 1;
    }
    return (props.fit || 0.5) / largest;
  }, [scene, props.fit]);

  return <primitive object={scene} scale={scale} />;
}
