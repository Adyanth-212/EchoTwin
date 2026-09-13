/* Presence rules evaluated in the browser.
 *
 * These mirror backend/app/rules.py and backend/app/anomaly.py, which are the
 * canonical implementations. They exist here as well because the backend runs
 * on another machine and cannot always be redeployed on demand — this keeps
 * the dashboard able to show the rule while the backend is still on an older
 * build.
 *
 * That duplication is a liability, not a feature: if the thresholds change on
 * the backend they must change here too. Both checks below defer to the
 * backend whenever it has already reported the same thing, so a redeployed
 * backend produces one alert rather than two.
 */

const env = import.meta.env;

// Local wall-clock window. The browser already knows the user's timezone, so
// unlike the backend this needs no offset configuration.
export const RESTRICTED_HOURS_START =
  env.VITE_RESTRICTED_HOURS_START || "";
export const RESTRICTED_HOURS_END = env.VITE_RESTRICTED_HOURS_END || "";

// Matches OCCUPANCY_EXPLAINS_AIR_MIN_PEOPLE on the backend.
export const OCCUPANCY_EXPLAINS_AIR_MIN_PEOPLE =
  Number(env.VITE_OCCUPANCY_EXPLAINS_AIR_MIN_PEOPLE) || 5;

// What a room full of people plausibly drives up on its own. Air temperature
// is deliberately excluded: bodies do warm a room, but it is also the primary
// overheating signal and half of the combined heat-and-vibration rule.
const AIR_QUALITY_FEATURES = ["eco2", "tvoc", "aqi", "humidity"];

function parseClockTime(value) {
  const parts = String(value).split(":");
  if (parts.length !== 2) {
    return null;
  }

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

export function inRestrictedHours(now) {
  const start = parseClockTime(RESTRICTED_HOURS_START);
  const end = parseClockTime(RESTRICTED_HOURS_END);
  if (start === null || end === null || start === end) {
    return false;
  }

  const moment = now instanceof Date ? now : new Date();
  const minutes = moment.getHours() * 60 + moment.getMinutes();

  if (start < end) {
    return start <= minutes && minutes < end;
  }

  // The window crosses midnight, e.g. 22:00 -> 06:00.
  return minutes >= start || minutes < end;
}

// True when the backend already reported this, so the dashboard stays quiet
// rather than saying the same thing twice.
function backendAlreadySaid(room, fragment) {
  const suggestions = (room && room.suggestions) || [];
  for (let index = 0; index < suggestions.length; index += 1) {
    if (String(suggestions[index]).indexOf(fragment) !== -1) {
      return true;
    }
  }
  return false;
}

export function restrictedHoursBreach(room, now) {
  if (!room || !room.sensors) {
    return null;
  }

  const occupancy = room.sensors.occupancy_count;
  if (typeof occupancy !== "number" || occupancy <= 0) {
    return null;
  }
  if (!inRestrictedHours(now)) {
    return null;
  }
  if (backendAlreadySaid(room, "restricted hours")) {
    return null;
  }

  return { occupancy: occupancy };
}

export function occupancyExplainsAnomaly(room) {
  if (!room || !room.anomaly || !room.anomaly.is_anomaly) {
    return false;
  }

  const occupancy = room.sensors ? room.sensors.occupancy_count : null;
  if (typeof occupancy !== "number") {
    return false;
  }
  if (occupancy < OCCUPANCY_EXPLAINS_AIR_MIN_PEOPLE) {
    return false;
  }

  const features = Array.isArray(room.anomaly.top_features)
    ? room.anomaly.top_features
    : [];
  if (features.length === 0) {
    return false;
  }

  // Every contributing feature must be one people explain. A single vibration
  // or surface-temperature contributor means the crowd is not the whole story.
  for (let index = 0; index < features.length; index += 1) {
    if (AIR_QUALITY_FEATURES.indexOf(features[index]) === -1) {
      return false;
    }
  }
  return true;
}
