import { useEffect, useRef, useState } from "react";
import { AR_ENABLED } from "../config.js";

// Camera passthrough: the phone's rear camera as a full-screen background
// with the live status panel laid over it. That gives the AR effect — status
// superimposed on the actual equipment — without WebXR.
//
// getUserMedia only exists in a secure context. Over plain HTTP on a LAN
// address it fails on both iOS Safari and Android Chrome, so every failure
// path here returns the children untouched: the normal opaque mobile view.
// There is never a black screen and never an error page, and the QR flow is
// completely unaffected by this component failing.
export default function ArOverlay(props) {
  const [isActive, setIsActive] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!AR_ENABLED) {
      return undefined;
    }

    // Secure context is a hard requirement, not a warning.
    if (!window.isSecureContext) {
      return undefined;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return undefined;
    }

    let stream = null;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setIsActive(true);
      } catch (error) {
        // Permission denied, no camera, or an insecure origin the browser
        // reported late. Fall back silently.
        setIsActive(false);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  if (!AR_ENABLED) {
    return props.children;
  }

  return (
    <div className={isActive ? "ar-root" : undefined}>
      {/* The element is always mounted so the ref exists when the stream
          arrives; it is simply not shown until the camera is running. */}
      <video
        ref={videoRef}
        className="ar-video"
        autoPlay
        playsInline
        muted
        hidden={!isActive}
      />
      {isActive ? <div className="ar-scrim" /> : null}
      <div className={isActive ? "ar-content" : undefined}>
        {isActive ? <div className="ar-badge">Camera view</div> : null}
        {props.children}
      </div>
    </div>
  );
}
