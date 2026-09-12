import { useEffect, useRef, useState } from "react";
import { CAMERA_FEEDS, DEMO_MODE, formatAgo } from "../config.js";

// The frame the model actually ran on, with its detection boxes drawn.
//
// Without this there is no way to tell whether YOLO is boxing people or
// boxing a coat rack — the counts and the figures in the 3D room look
// equally confident either way. Seeing the boxes is how you know the
// pipeline is real, and it is the first thing anyone asks to see.
//
// Frames are polled as plain <img> requests rather than streamed. An MJPEG
// stream holds a connection open and freezes on a dead producer without
// saying so; a failed request is unambiguous, and the browser keeps showing
// the previous frame while the next one loads, so it does not flicker.

const FRAMES_PER_SECOND = 2;
const ENABLED_KEY = "echotwin.camera.feeds";

function readEnabled() {
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== "0";
  } catch (error) {
    return true;
  }
}

function writeEnabled(isEnabled) {
  try {
    window.localStorage.setItem(ENABLED_KEY, isEnabled ? "1" : "0");
  } catch (error) {
    // Remembering the toggle is a convenience, nothing depends on it.
  }
}

function CameraTile(props) {
  const [tick, setTick] = useState(0);
  const [isOnline, setIsOnline] = useState(null);
  const [lastFrameAt, setLastFrameAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const startedRef = useRef(Date.now());

  useEffect(() => {
    if (!props.enabled) {
      return undefined;
    }
    const timer = setInterval(() => {
      setTick((value) => value + 1);
    }, 1000 / FRAMES_PER_SECOND);
    return () => clearInterval(timer);
  }, [props.enabled]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!props.enabled) {
    return null;
  }

  // A producer that has started but has not yet run its first inference
  // answers 503, which is not an error worth shouting about.
  const isStarting = isOnline === null && now - startedRef.current < 4000;

  return (
    <figure className="camera-tile">
      <div className="camera-tile-frame">
        <img
          className="camera-tile-image"
          src={props.path + "/frame.jpg?t=" + tick}
          alt={"Live view from " + props.id + " with detection boxes"}
          onLoad={() => {
            setIsOnline(true);
            setLastFrameAt(Date.now());
          }}
          onError={() => setIsOnline(false)}
          data-hidden={String(isOnline !== true)}
        />

        {isOnline !== true ? (
          <div className="camera-tile-placeholder">
            {isStarting
              ? "Connecting…"
              : "No feed — is the producer running on this camera?"}
          </div>
        ) : null}
      </div>

      <figcaption className="camera-tile-caption">
        <span className="camera-tile-name">{props.id}</span>
        {isOnline === true && lastFrameAt !== null ? (
          <span className="camera-tile-age num">
            {formatAgo(lastFrameAt, now)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

export default function CameraFeed() {
  const [isEnabled, setIsEnabled] = useState(readEnabled);

  function toggle() {
    const next = !isEnabled;
    setIsEnabled(next);
    writeEnabled(next);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Camera views</span>
        <button
          type="button"
          className="icon-toggle"
          data-on={String(isEnabled)}
          onClick={toggle}
        >
          {isEnabled ? "Pause feeds" : "Show feeds"}
        </button>
      </div>

      {DEMO_MODE ? (
        <p className="panel-empty">
          No camera feed in demo mode — the readings above are synthetic.
        </p>
      ) : !isEnabled ? (
        <p className="panel-empty">
          Feeds paused. They are the heaviest thing on the network here, so
          this is worth leaving off until someone asks to see them.
        </p>
      ) : (
        <div className="camera-grid">
          {CAMERA_FEEDS.map((feed) => (
            <CameraTile
              key={feed.id}
              id={feed.id}
              path={feed.path}
              enabled={isEnabled}
            />
          ))}
        </div>
      )}
    </section>
  );
}
