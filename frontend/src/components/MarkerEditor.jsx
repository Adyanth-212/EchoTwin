const AXES = [
  { key: "x", index: 0, label: "X · left/right" },
  { key: "y", index: 1, label: "Y · height" },
  { key: "z", index: 2, label: "Z · depth" },
];

export default function MarkerEditor(props) {
  const selected = props.markers.find(
    (marker) => marker.id === props.selectedId,
  );

  return (
    <div className={"marker-editor" + (props.editing ? " is-open" : "")}>
      <button
        type="button"
        className={"marker-editor-toggle" + (props.editing ? " active" : "")}
        onClick={props.onToggle}
      >
        {props.editing ? "Done placing" : "Place markers"}
      </button>

      {props.editing && selected ? (
        <div className="marker-editor-body">
          <div className="marker-editor-head">
            <label htmlFor="marker-editor-select">Marker</label>
            <select
              id="marker-editor-select"
              value={selected.id}
              onChange={(event) => props.onSelect(event.target.value)}
            >
              {props.markers.map((marker) => (
                <option key={marker.id} value={marker.id}>
                  {marker.label} · {marker.id}
                </option>
              ))}
            </select>
          </div>

          <p className="marker-editor-help">
            Click the sensor's real location on the mesh, then fine-tune in
            metres. Dragging still orbits the view.
          </p>

          {props.modelMode !== "mesh" ? (
            <button
              type="button"
              className="marker-editor-mesh"
              onClick={props.onUseMesh}
            >
              Switch to Mesh to place
            </button>
          ) : (
            <div className="marker-editor-ready">Click the mesh to place</div>
          )}

          <div className="marker-editor-coordinates">
            {AXES.map((axis) => (
              <label key={axis.key}>
                <span>{axis.label}</span>
                <input
                  type="number"
                  step="0.05"
                  value={selected.position[axis.index]}
                  onChange={(event) =>
                    props.onCoordinateChange(
                      axis.index,
                      Number(event.target.value),
                    )
                  }
                />
              </label>
            ))}
          </div>

          <div className="marker-editor-actions">
            <button type="button" onClick={props.onResetSelected}>
              Reset selected
            </button>
            <button type="button" onClick={props.onCopy}>
              Copy JSON
            </button>
          </div>

          {props.message ? (
            <div className="marker-editor-message" role="status">
              {props.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
