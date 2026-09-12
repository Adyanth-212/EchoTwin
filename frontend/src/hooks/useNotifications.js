import { useCallback, useEffect, useRef, useState } from "react";
import {
  STATUS_ORDER,
  TREND_ALERT_MINUTES,
  sensorLabel,
} from "../config.js";

// Alerting for someone who is not looking at the tab.
//
// This is the browser Notification API, deliberately not Web Push: real push
// would need a service worker, VAPID keys and a backend push endpoint. The
// Notification API gets the same visible result — an OS-level alert while the
// tab is in the background — with none of that.
//
// Three layers, each independent of the one above it, so a denied permission
// prompt never makes the feature look absent:
//   1. OS notification   (only when permission was granted)
//   2. in-page toast     (always, on exactly the same triggers)
//   3. a short tone      (unless muted or prefers-reduced-motion is set)

const DEBOUNCE_MS = 20000;
const TOAST_TTL_MS = 8000;
const MAX_TOASTS = 4;
const DISMISS_KEY = "echotwin.notify.banner.dismissed";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch (error) {
    // Private mode, or storage blocked entirely. The banner just reappears.
    return false;
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch (error) {
    // Nothing to do — remembering the dismissal is a convenience, not state
    // anything depends on.
  }
}

function statusLevel(status) {
  const level = STATUS_ORDER[status];
  return level === undefined ? 0 : level;
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {
    return false;
  }
}

function supportsNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function currentPermission() {
  if (!supportsNotifications()) {
    return "unsupported";
  }
  return window.Notification.permission;
}

// A short, flat two-note beep. Synthesised rather than shipped as a file so
// there is no asset to load and nothing to fail on a bad network.
function playTone(contextRef) {
  try {
    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }
    if (!contextRef.current) {
      contextRef.current = new AudioContextClass();
    }
    const context = contextRef.current;
    if (context.state === "suspended") {
      context.resume();
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.11);

    // Ramped rather than switched, so it reads as a chime and not a click.
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      context.currentTime + 0.26
    );

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.28);
  } catch (error) {
    // Audio is the least important layer; never let it break the others.
  }
}

function describeFeatures(features) {
  if (!Array.isArray(features) || features.length === 0) {
    return null;
  }
  const labels = [];
  for (let index = 0; index < features.length; index += 1) {
    labels.push(sensorLabel(features[index]).toLowerCase());
  }
  return "flagged by: " + labels.join(", ");
}

function describeTrend(trend) {
  if (!trend || trend.time_to_threshold_minutes === null) {
    return null;
  }
  if (trend.time_to_threshold_minutes === undefined || !trend.metric) {
    return null;
  }
  const minutes = Math.round(trend.time_to_threshold_minutes);
  return (
    sensorLabel(trend.metric) +
    " reaching threshold in ~" +
    minutes +
    " min"
  );
}

const EMPTY_EPISODE = {
  notifiedLevel: 0,
  anomalyNotified: false,
  trendNotified: false,
  trendMetric: null,
  tripNotified: false,
};

export default function useNotifications(options) {
  const settings = options || {};
  const room = settings.room;
  const roomId = settings.roomId;
  const suggestions = settings.suggestions;
  // The QR/mobile view takes toasts only — a permission prompt on a page
  // someone just scanned into is too heavy.
  const osNotificationsAllowed = settings.osNotificationsAllowed !== false;

  const [toasts, setToasts] = useState([]);
  const [permission, setPermission] = useState(currentPermission);
  const [bannerDismissed, setBannerDismissed] = useState(readDismissed);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const previousRef = useRef(null);
  const episodeRef = useRef(Object.assign({}, EMPTY_EPISODE));
  const lastNotifyAtRef = useRef(0);
  const audioContextRef = useRef(null);
  const toastIdRef = useRef(1);
  const suggestionsRef = useRef(suggestions);
  const soundEnabledRef = useRef(soundEnabled);

  // Kept in refs so the transition effect can read the latest value without
  // taking them as dependencies and re-running on every suggestion poll.
  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const pushToast = useCallback((severity, title, body) => {
    const id = toastIdRef.current;
    toastIdRef.current += 1;

    setToasts((previous) => {
      const next = previous.concat([
        { id: id, severity: severity, title: title, body: body },
      ]);
      return next.slice(-MAX_TOASTS);
    });

    setTimeout(() => {
      setToasts((previous) =>
        previous.filter((toast) => toast.id !== id)
      );
    }, TOAST_TTL_MS);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const requestPermission = useCallback(async () => {
    if (!supportsNotifications()) {
      setPermission("unsupported");
      return;
    }
    try {
      // Called only from a click handler — never from an effect on mount.
      // Chrome throttles or silently drops prompts raised without a gesture.
      const result = await window.Notification.requestPermission();
      setPermission(result);
      writeDismissed();
      setBannerDismissed(true);
      // The same click is also the gesture that unlocks audio playback.
      if (audioContextRef.current === null) {
        playTone(audioContextRef);
      }
    } catch (error) {
      setPermission(currentPermission());
    }
  }, []);

  const dismissBanner = useCallback(() => {
    writeDismissed();
    setBannerDismissed(true);
  }, []);

  // ---------------------------------------------------------------
  // Transition detection
  // ---------------------------------------------------------------

  useEffect(() => {
    if (!room) {
      return;
    }

    const previous = previousRef.current;
    previousRef.current = room;

    // The first message is a starting point, not a transition. Seed the
    // episode state from it so a page opened while the room is already red
    // does not immediately alert about a state that was there all along.
    if (previous === null) {
      episodeRef.current = {
        notifiedLevel: statusLevel(room.status),
        anomalyNotified: Boolean(room.anomaly && room.anomaly.is_anomaly),
        trendNotified: false,
        trendMetric: room.trend ? room.trend.metric : null,
        tripNotified: Boolean(
          room.sensors && room.sensors.vibration_trip
        ),
      };
      return;
    }

    const episode = episodeRef.current;
    const previousLevel = statusLevel(previous.status);
    const nextLevel = statusLevel(room.status);

    const previousAnomaly = Boolean(
      previous.anomaly && previous.anomaly.is_anomaly
    );
    const nextAnomaly = Boolean(room.anomaly && room.anomaly.is_anomaly);

    const previousTrip = Boolean(
      previous.sensors && previous.sensors.vibration_trip
    );
    const nextTrip = Boolean(room.sensors && room.sensors.vibration_trip);

    const previousTrendMinutes =
      previous.trend && previous.trend.time_to_threshold_minutes !== undefined
        ? previous.trend.time_to_threshold_minutes
        : null;
    const nextTrendMinutes =
      room.trend && room.trend.time_to_threshold_minutes !== undefined
        ? room.trend.time_to_threshold_minutes
        : null;
    const nextTrendMetric = room.trend ? room.trend.metric : null;

    // --- episode resets: recovery re-arms each trigger ------------------

    if (nextLevel < episode.notifiedLevel) {
      episode.notifiedLevel = nextLevel;
    }
    if (!nextAnomaly) {
      episode.anomalyNotified = false;
    }
    if (nextTrendMinutes === null || nextTrendMetric !== episode.trendMetric) {
      episode.trendNotified = false;
      episode.trendMetric = nextTrendMetric;
    }
    if (!nextTrip) {
      episode.tripNotified = false;
    }

    // --- recovery is good news: a quiet toast, nothing more -------------

    if (nextLevel < previousLevel) {
      pushToast(
        "green",
        roomId + " recovered",
        "Status improved to " + room.status + "."
      );
      return;
    }

    // --- worsening triggers --------------------------------------------

    const reasons = [];
    let severity = room.status === "red" ? "red" : "yellow";
    let anomalyTriggered = false;

    if (nextLevel > previousLevel && nextLevel > episode.notifiedLevel) {
      episode.notifiedLevel = nextLevel;
      reasons.push("status");
    }

    if (nextAnomaly && !previousAnomaly && !episode.anomalyNotified) {
      episode.anomalyNotified = true;
      anomalyTriggered = true;
      reasons.push("anomaly");
    }

    const trendIsNew =
      nextTrendMinutes !== null &&
      nextTrendMinutes <= TREND_ALERT_MINUTES &&
      (previousTrendMinutes === null || !episode.trendNotified);

    if (trendIsNew && !episode.trendNotified) {
      episode.trendNotified = true;
      episode.trendMetric = nextTrendMetric;
      reasons.push("trend");
    }

    if (nextTrip && !previousTrip && !episode.tripNotified) {
      episode.tripNotified = true;
      reasons.push("trip");
      if (severity !== "red") {
        severity = "yellow";
      }
    }

    if (reasons.length === 0) {
      return;
    }

    // --- body text: most specific thing that actually fired -------------

    const featureText = anomalyTriggered
      ? describeFeatures(room.anomaly ? room.anomaly.top_features : [])
      : null;
    const trendText = describeTrend(room.trend);
    const suggestionText =
      Array.isArray(suggestionsRef.current) && suggestionsRef.current.length > 0
        ? suggestionsRef.current[0]
        : null;

    const parts = [];
    if (featureText) {
      parts.push(featureText);
    } else if (trendText && reasons.indexOf("trend") !== -1) {
      parts.push(trendText);
    } else if (suggestionText) {
      parts.push(suggestionText);
    } else {
      parts.push("Room status is now " + room.status + ".");
    }

    if (reasons.indexOf("trip") !== -1) {
      parts.push("Vibration trip sensor triggered.");
    }

    const title = roomId + " — status: " + room.status;
    const body = parts.join(" ");

    // The toast always fires; only the OS notification and the tone are
    // rate-limited, so nothing on screen is ever silently swallowed.
    pushToast(severity, title, body);

    const now = Date.now();
    if (now - lastNotifyAtRef.current < DEBOUNCE_MS) {
      return;
    }
    lastNotifyAtRef.current = now;

    if (
      osNotificationsAllowed &&
      supportsNotifications() &&
      window.Notification.permission === "granted"
    ) {
      try {
        const notification = new window.Notification(title, {
          body: body,
          // One entry per room in the OS tray: a newer alert replaces the
          // older one instead of stacking up.
          tag: roomId,
          renotify: true,
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch (error) {
        // Some in-app browsers expose Notification but throw on construction.
      }
    }

    if (soundEnabledRef.current && !prefersReducedMotion()) {
      playTone(audioContextRef);
    }
  }, [room, roomId, pushToast, osNotificationsAllowed]);

  const bannerVisible =
    osNotificationsAllowed &&
    supportsNotifications() &&
    permission === "default" &&
    !bannerDismissed;

  return {
    toasts: toasts,
    dismissToast: dismissToast,
    permission: permission,
    requestPermission: requestPermission,
    bannerVisible: bannerVisible,
    dismissBanner: dismissBanner,
    soundEnabled: soundEnabled,
    setSoundEnabled: setSoundEnabled,
  };
}
