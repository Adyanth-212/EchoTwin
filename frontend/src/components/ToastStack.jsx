// In-page fallback for the OS notification. This always runs, on exactly the
// same triggers, whether or not notification permission was granted — which
// makes it the layer that actually gets seen when the dashboard itself is the
// thing on screen during the demo.
export default function ToastStack(props) {
  const toasts = props.toasts || [];

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} data-severity={toast.severity}>
          <div className="toast-head">
            <span className="toast-title">{toast.title}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => props.onDismiss(toast.id)}
              aria-label="Dismiss alert"
            >
              ×
            </button>
          </div>
          <div className="toast-body">{toast.body}</div>
        </div>
      ))}
    </div>
  );
}
