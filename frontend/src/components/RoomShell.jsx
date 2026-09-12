import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Color, DoubleSide } from "three";
import { ROOM, ROOM_MODEL } from "../roomLayout.js";
import ModelFallback from "./ModelFallback.jsx";
import RoomModel from "./RoomModel.jsx";

// The splat renderer is several megabytes and is only needed after the
// Gaussian button is selected. Keep the normal dashboard bundle lean.
const GaussianRoomModel = lazy(() => import("./GaussianRoomModel.jsx"));

const BASE_FLOOR = "#131a2a";
const BASE_WALL = "#1a2236";

const STATUS_TINT = {
  green: "#3fbf7f",
  yellow: "#f2a63b",
  red: "#f2645f",
};

// A wash, not a coat of paint: the base surface colour is nudged a short way
// toward the status colour so the room reads as green/yellow/red at a glance
// while the markers on top of it stay legible.
function washed(baseHex, status, amount) {
  const base = new Color(baseHex);
  const tint = STATUS_TINT[status];
  if (!tint) {
    return base;
  }
  return base.lerp(new Color(tint), amount);
}

// The status tint has to work on a photogrammetry scan too, where the surface
// colours are photographic and must not be recoloured. So the wash is a
// separate translucent layer just above the floor plus a faint tinted light,
// rather than a material change — it reads the same over both the box room
// and a real scan.
function StatusWash(props) {
  const tint = STATUS_TINT[props.status];
  if (!tint) {
    return null;
  }

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <meshBasicMaterial
          color={tint}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>
      <hemisphereLight args={[tint, "#0e1320", 0.42]} />
    </group>
  );
}

// Built-in geometry. Used on its own when there is no scan, and as the
// fallback whenever a scan fails to load.
function BoxRoom(props) {
  const status = props.status;

  // Only a whisper of tint in the materials themselves — StatusWash above
  // carries the actual status signal, and it has to work over a scan whose
  // surfaces are photographic and must not be recoloured.
  const floorColor = useMemo(() => washed(BASE_FLOOR, status, 0.04), [status]);
  const wallColor = useMemo(() => washed(BASE_WALL, status, 0.03), [status]);

  const halfWidth = ROOM.width / 2;
  const halfDepth = ROOM.depth / 2;
  const wallHeight = ROOM.height;

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <meshStandardMaterial color={floorColor} roughness={0.95} />
      </mesh>

      {/* Back wall (-z) */}
      <mesh position={[0, wallHeight / 2, -halfDepth]}>
        <planeGeometry args={[ROOM.width, wallHeight]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={1}
          transparent
          opacity={0.62}
          side={DoubleSide}
        />
      </mesh>

      {/* Left wall (-x) */}
      <mesh
        position={[-halfWidth, wallHeight / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[ROOM.depth, wallHeight]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={1}
          transparent
          opacity={0.45}
          side={DoubleSide}
        />
      </mesh>

      {/* Right wall (+x) */}
      <mesh
        position={[halfWidth, wallHeight / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[ROOM.depth, wallHeight]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={1}
          transparent
          opacity={0.45}
          side={DoubleSide}
        />
      </mesh>

      {/* The +z side is deliberately left open so the camera can look in. */}

      <gridHelper
        args={[ROOM.width, 12, "#2b3550", "#222b42"]}
        position={[0, 0.01, 0]}
        scale={[1, 1, ROOM.depth / ROOM.width]}
      />
    </group>
  );
}

// Check the scan is actually there before asking the loader for it.
//
// Without this, the default url points at a file that does not exist until
// someone does the scan, the dev server answers with its index.html
// fallback, and GLTFLoader throws trying to parse HTML. The error boundary
// catches it and the box room appears - so the dashboard is fine - but every
// single page load prints a red uncaught error and a React component stack.
// That trains everyone to ignore the console, which is exactly when a real
// error goes unnoticed. A HEAD request costs nothing and keeps the console
// honest.
function useModelAvailable(url) {
  const [isAvailable, setIsAvailable] = useState(null);

  useEffect(() => {
    setIsAvailable(null);

    if (!url) {
      setIsAvailable(false);
      return undefined;
    }

    let cancelled = false;

    async function probe() {
      try {
        const response = await fetch(url, { method: "HEAD" });
        const contentType = response.headers.get("content-type") || "";
        // An SPA fallback answers 200 with HTML, which is not a model.
        const looksLikeModel =
          response.ok && contentType.indexOf("text/html") === -1;
        if (!cancelled) {
          setIsAvailable(looksLikeModel);
        }
      } catch (error) {
        if (!cancelled) {
          setIsAvailable(false);
        }
      }
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return isAvailable;
}

export default function RoomShell(props) {
  const status = props.status;
  const boxRoom = <BoxRoom status={status} />;
  const mode = props.mode === "gaussian" ? "gaussian" : "mesh";
  const config = ROOM_MODEL[mode];
  const [loadByMode, setLoadByMode] = useState({
    mesh: { state: "loading", progress: null },
    gaussian: { state: "loading", progress: null },
  });
  const [gaussianActivated, setGaussianActivated] = useState(false);

  const wanted = ROOM_MODEL.enabled && Boolean(config && config.url);
  const isAvailable = useModelAvailable(wanted ? config.url : null);

  useEffect(() => {
    if (!props.onModelState) {
      return;
    }
    if (!wanted) {
      props.onModelState({ mode: mode, state: "disabled" });
    } else if (isAvailable === false) {
      props.onModelState({ mode: mode, state: "missing" });
    } else if (isAvailable !== true) {
      props.onModelState({ mode: mode, state: "loading", progress: null });
    } else {
      props.onModelState({ mode: mode, ...loadByMode[mode] });
    }
  }, [isAvailable, loadByMode, mode, props.onModelState, wanted]);

  useEffect(() => {
    if (mode === "gaussian" && wanted && isAvailable === true) {
      // Do not unmount Spark when switching back to the mesh. Its sorter can
      // still be completing an asynchronous depth readback, and tearing the
      // renderer down mid-readback produces Spark's "No target" error. It is
      // also much faster to keep this 119 MB scan warm for the next toggle.
      setGaussianActivated(true);
    }
  }, [isAvailable, mode, wanted]);

  const handleMeshLoad = useCallback(() => {
    setLoadByMode((current) => ({
      ...current,
      mesh: { state: "ready", progress: 100 },
    }));
  }, []);

  const handleGaussianLoad = useCallback(() => {
    setLoadByMode((current) => ({
      ...current,
      gaussian: { state: "ready", progress: 100 },
    }));
  }, []);

  const handleGaussianProgress = useCallback((loaded, total) => {
    const progress = total > 0 ? Math.round((loaded / total) * 100) : null;
    setLoadByMode((current) => ({
      ...current,
      gaussian: { state: "loading", progress: progress },
    }));
  }, []);

  const handleGaussianError = useCallback((error) => {
    console.warn("Could not render gaussian room scan.", error);
    setLoadByMode((current) => ({
      ...current,
      gaussian: { state: "error", progress: null },
    }));
  }, []);

  const canRenderSelected = wanted && isAvailable === true;
  const selectedReady = loadByMode[mode].state === "ready";
  const showBoxRoom = !canRenderSelected || !selectedReady;

  return (
    <group>
      {/* Keep useful geometry visible during the availability probe/load. */}
      {showBoxRoom ? boxRoom : null}

      {mode === "mesh" && canRenderSelected ? (
        <ModelFallback fallback={boxRoom}>
          <Suspense fallback={null}>
            <RoomModel
              onLoad={handleMeshLoad}
              onSurfaceClick={
                props.placementEnabled ? props.onSurfaceClick : null
              }
            />
          </Suspense>
        </ModelFallback>
      ) : null}

      {/*
        Once loaded, the Gaussian renderer remains mounted but its scan is
        hidden in Mesh mode. This lets Spark finish outstanding GPU work and
        makes repeated visual quality comparisons instant.
      */}
      {gaussianActivated ? (
        <ModelFallback fallback={null}>
          <Suspense fallback={null}>
            <GaussianRoomModel
              visible={mode === "gaussian"}
              onLoad={handleGaussianLoad}
              onProgress={handleGaussianProgress}
              onError={handleGaussianError}
            />
          </Suspense>
        </ModelFallback>
      ) : null}

      <StatusWash status={status} />
    </group>
  );
}
