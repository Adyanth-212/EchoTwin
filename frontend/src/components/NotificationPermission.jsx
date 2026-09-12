// One explicit tap, never an automatic prompt on load. Browsers penalise a
// permission request that arrives with no context and no user gesture —
// Chrome throttles or hides them outright — so requestPermission() is only
// ever called from this button's click handler.
export default function NotificationPermission(props) {
  if (!props.visible) {
    return null;
  }

  return (
    <div className="notify-banner">
      <div className="notify-copy">
        Get an alert if this room's status changes — even with the tab in the
        background.
      </div>
      <button type="button" className="btn" onClick={props.onEnable}>
        Enable alerts
      </button>
      <button type="button" className="btn btn-quiet" onClick={props.onDismiss}>
        Not now
      </button>
    </div>
  );
}
