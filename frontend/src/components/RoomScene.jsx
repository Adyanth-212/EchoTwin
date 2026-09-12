import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { MARKERS, ROOM, ROOM_MODEL } from "../roomLayout.js";
import { SENSOR_META, formatValue } from "../config.js";
import RoomShell from "./RoomShell.jsx";
import SensorMarker from "./SensorMarker.jsx";
import EquipmentMarker from "./EquipmentMarker.jsx";
import PeopleLayer from "./PeopleLayer.jsx";
import MarkerEditor from "./MarkerEditor.jsx";

const MARKER_STORAGE_KEY = "echotwin.markerPositions.v1";

// The two exports have independent origins/scales. Frame each separately.
const SCAN_VIEWS = {
  mesh: { position: [3.2, 2.7, 3.7], target: [0, 0.65, 0] },
  gaussian: { position: [2.1, 1.8, 2.5], target: [0, 0.5, 0] },
};

function ScanControls({ mode, controlsRef, resetVersion }) {
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const view = SCAN_VIEWS[mode];
    controls.object.position.fromArray(view.position);
    controls.target.fromArray(view.target);
    controls.update();
  }, [mode, controlsRef, resetVersion]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      enableZoom
      minDistance={0.12}
      maxDistance={24}
      maxPolarAngle={Math.PI - 0.01}
    />
  );
}

function validPosition(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((coordinate) => Number.isFinite(coordinate))
  );
}

function loadMarkerPositions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MARKER_STORAGE_KEY) || "{}");
    const saved = {};
    MARKERS.forEach((marker) => {
      if (validPosition(parsed[marker.id])) {
        saved[marker.id] = parsed[marker.id];
      }
    });
    return saved;
  } catch (error) {
    return {};
  }
}

function persistMarkerPositions(positions) {
  try {
    localStorage.setItem(MARKER_STORAGE_KEY, JSON.stringify(positions));
  } catch (error) {
    // Placement remains usable for this session if storage is unavailable.
  }
}

function tidyCoordinate(value) {
  return Math.round(value * 1000) / 1000;
}

// The 3D twin is the primary view of the room, driven by the same fused
// WebSocket state as every panel on the page — not a decoration running off
// its own data.
//
// Deliberately no useFrame anywhere in this subtree: nothing animates per
// frame, so React only re-renders the scene when a message actually arrives.
// dpr is capped so a retina laptop does not render at 3x for no visible gain.

function sensorRows(sensors) {
  return [
    {
      label: "Air",
      value:
        formatValue("temperature", sensors.temperature) +
        " " +
        SENSOR_META.temperature.unit,
    },
    {
      label: "eCO₂",
      value:
        formatValue("eco2", sensors.eco2) + " " + SENSOR_META.eco2.unit,
    },
  ];
}

function peopleLabel(count) {
  return String(count) + (count === 1 ? " person" : " people");
}

function cameraRows(marker, sensors, cameraCounts) {
  const known = cameraCounts && cameraCounts[marker.id];
  if (known !== undefined && known !== null) {
    return [{ label: "Occupancy", value: peopleLabel(known) }];
  }
  // No event from this camera yet — show the room total rather than a zero
  // that would read as "nobody is there".
  return [
    {
      label: "Room total",
      value:
        sensors.occupancy_count === null || sensors.occupancy_count === undefined
          ? "—"
          : peopleLabel(sensors.occupancy_count),
    },
  ];
}

// Per-material clipping planes are off by default in three, and the scanned
// room's dollhouse cutaway needs them.
function handleCreated(state) {
  state.gl.localClippingEnabled = true;
}

function modelStateLabel(mode, modelState) {
  if (!modelState || modelState.mode !== mode) {
    return "checking";
  }
  if (modelState.state === "ready") {
    return "ready";
  }
  if (modelState.state === "loading") {
    return modelState.progress === null || modelState.progress === undefined
      ? "loading"
      : "loading " + modelState.progress + "%";
  }
  if (modelState.state === "missing") {
    return "file missing · showing fallback";
  }
  if (modelState.state === "error") {
    return "could not render · showing fallback";
  }
  return modelState.state;
}

export default function RoomScene(props) {
  const room = props.room;
  const sensors = (room && room.sensors) || {};
  const status = room ? room.status : null;
  const peopleCount = (props.people || []).length;
  const [modelMode, setModelMode] = useState(ROOM_MODEL.defaultMode);
  const [modelState, setModelState] = useState(null);
  const controlsRef = useRef(null);
  const [resetVersion, setResetVersion] = useState(0);

  function zoomView(multiplier) {
    const controls = controlsRef.current;
    if (!controls) return;
    const offset = controls.object.position.clone().sub(controls.target);
    const distance = Math.max(0.12, Math.min(24, offset.length() * multiplier));
    offset.setLength(distance);
    controls.object.position.copy(controls.target).add(offset);
    controls.update();
  }
  const [markerPositions, setMarkerPositions] = useState(loadMarkerPositions);
  const [editingMarkers, setEditingMarkers] = useState(false);
  const [selectedMarkerId, setSelectedMarkerId] = useState(MARKERS[0].id);
  const [placementMessage, setPlacementMessage] = useState("");
  const modelLabel = modelStateLabel(modelMode, modelState);

  const markers = useMemo(
    () =>
      MARKERS.map((marker) => ({
        ...marker,
        position: markerPositions[marker.id] || marker.position,
      })),
    [markerPositions],
  );

  const selectedMarker = markers.find(
    (marker) => marker.id === selectedMarkerId,
  );

  const updateMarkerPosition = useCallback((id, position) => {
    if (!validPosition(position)) {
      return;
    }
    const clean = position.map(tidyCoordinate);
    setMarkerPositions((current) => {
      const next = { ...current, [id]: clean };
      persistMarkerPositions(next);
      return next;
    });
  }, []);

  const handleSurfaceClick = useCallback(
    (position) => {
      updateMarkerPosition(selectedMarkerId, position);
      const marker = MARKERS.find((item) => item.id === selectedMarkerId);
      setPlacementMessage((marker ? marker.label : selectedMarkerId) + " moved");
    },
    [selectedMarkerId, updateMarkerPosition],
  );

  function toggleMarkerEditor() {
    const opening = !editingMarkers;
    setEditingMarkers(opening);
    setPlacementMessage("");
    if (opening) {
      setModelMode("mesh");
    }
  }

  function changeCoordinate(axis, value) {
    if (!selectedMarker || !Number.isFinite(value)) {
      return;
    }
    const next = selectedMarker.position.slice();
    next[axis] = value;
    updateMarkerPosition(selectedMarker.id, next);
    setPlacementMessage(selectedMarker.label + " adjusted");
  }

  function resetSelectedMarker() {
    setMarkerPositions((current) => {
      const next = { ...current };
      delete next[selectedMarkerId];
      persistMarkerPositions(next);
      return next;
    });
    setPlacementMessage("Restored the default position");
  }

  async function copyMarkerPositions() {
    const exported = {};
    markers.forEach((marker) => {
      exported[marker.id] = marker.position;
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
      setPlacementMessage("Coordinates copied to clipboard");
    } catch (error) {
      setPlacementMessage("Clipboard blocked — use the X/Y/Z values above");
    }
  }

  return (
    <div className="scene-wrap">
      <Canvas
        className="scene-canvas"
        dpr={[1, 1.5]}
        camera={{ position: SCAN_VIEWS[ROOM_MODEL.defaultMode].position, fov: 46, near: 0.01, far: 200 }}
        onCreated={handleCreated}
      >
        <color attach="background" args={["#0e1320"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 7, 5]} intensity={0.9} />
        <directionalLight position={[-5, 3, -4]} intensity={0.25} />

        <RoomShell
          status={status}
          mode={modelMode}
          onModelState={setModelState}
          placementEnabled={editingMarkers && modelMode === "mesh"}
          onSurfaceClick={handleSurfaceClick}
        />

        <PeopleLayer people={props.people} />

        {markers.map((marker) => {
          if (marker.kind === "equipment") {
            return (
              <EquipmentMarker
                key={marker.id}
                marker={marker}
                sensors={sensors}
                selected={editingMarkers && marker.id === selectedMarkerId}
                onSelect={editingMarkers ? setSelectedMarkerId : null}
              />
            );
          }

          const rows =
            marker.kind === "camera"
              ? cameraRows(marker, sensors, props.cameraCounts)
              : sensorRows(sensors);

          return (
            <SensorMarker
              key={marker.id}
              marker={marker}
              rows={rows}
              selected={editingMarkers && marker.id === selectedMarkerId}
              onSelect={editingMarkers ? setSelectedMarkerId : null}
            />
          );
        })}

        <ScanControls
          mode={modelMode}
          controlsRef={controlsRef}
          resetVersion={resetVersion}
        />
      </Canvas>

      <div className="scene-model-switch" role="group" aria-label="3D model type">
        <span className="scene-model-switch-label">3D view</span>
        <button
          type="button"
          className={modelMode === "mesh" ? "active" : ""}
          aria-pressed={modelMode === "mesh"}
          onClick={() => setModelMode("mesh")}
        >
          Mesh
        </button>
        <button
          type="button"
          className={modelMode === "gaussian" ? "active" : ""}
          aria-pressed={modelMode === "gaussian"}
          onClick={() => setModelMode("gaussian")}
        >
          Gaussian
        </button>
        <span
          className={
            "scene-model-state" +
            (modelState && modelState.state === "ready" ? " is-ready" : "")
          }
        >
          {modelLabel}
        </span>
      </div>

      <div className="scene-navigation" role="group" aria-label="Scan camera controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomView(0.8)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomView(1.25)}>−</button>
        <button type="button" onClick={() => setResetVersion((value) => value + 1)}>Reset view</button>
      </div>

      <MarkerEditor
        editing={editingMarkers}
        markers={markers}
        selectedId={selectedMarkerId}
        modelMode={modelMode}
        message={placementMessage}
        onToggle={toggleMarkerEditor}
        onSelect={(id) => {
          setSelectedMarkerId(id);
          setPlacementMessage("");
        }}
        onUseMesh={() => setModelMode("mesh")}
        onCoordinateChange={changeCoordinate}
        onResetSelected={resetSelectedMarker}
        onCopy={copyMarkerPositions}
      />

      <div className="scene-legend">
        <span>
          <span className="legend-swatch" /> sensor
        </span>
        <span>
          <span
            className="legend-swatch"
            style={{ background: "var(--dim)" }}
          />{" "}
          camera
        </span>
        <span>
          <span
            className="legend-swatch"
            style={{ background: "#28324b" }}
          />{" "}
          equipment
        </span>
        {peopleCount > 0 ? (
          <span>
            <span
              className="legend-swatch"
              style={{ background: "#7ee8dc", borderRadius: "50%" }}
            />{" "}
            {peopleCount === 1 ? "1 person" : peopleCount + " people"}
          </span>
        ) : null}
      </div>

      <div className="scene-hint">
        Drag to orbit · scroll to zoom · {modelMode} · {ROOM.width}m ×{" "}
        {ROOM.depth}m
      </div>
    </div>
  );
}
