import { useEffect, useRef, useState } from "react";
import {
  CAMERA_FEEDS,
  DEMO_MODE,
  PERSON_MERGE_RADIUS_M,
  PERSON_TTL_MS,
  fetchCamera,
} from "../config.js";
import { ROOM } from "../roomLayout.js";

// Where each person actually is on the floor, polled from the CV producers.
//
// A count in a panel tells you how busy a room is. A position tells you where
// the problem is, which is the whole argument for a spatial twin — so this is
// the piece that makes occupancy worth showing in 3D at all.
//
// Nothing here is load-bearing: a producer that is not running, not
// calibrated, or unreachable contributes nobody and the rest of the twin is
// unaffected.

const POLL_INTERVAL_MS = 1000;
// No camera running is the normal case in development and during setup.
// Polling two dead endpoints every second floods the console with failed
// requests — enough to push everything else out of the buffer and make the
// page genuinely hard to debug. Back right off while every feed is down, and
// return to full rate the moment one answers.
const IDLE_POLL_INTERVAL_MS = 6000;

function distance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// Two cameras watching one room see the same people twice. Merge detections
// that land close together on the floor, keeping the more confident one's
// position, so a person standing in the overlap is one figure and not two.
function mergeDetections(byCamera) {
  const merged = [];
  const cameraIds = Object.keys(byCamera);

  for (let cameraIndex = 0; cameraIndex < cameraIds.length; cameraIndex += 1) {
    const cameraId = cameraIds[cameraIndex];
    const entry = byCamera[cameraId];
    const people = entry.people || [];

    for (let personIndex = 0; personIndex < people.length; personIndex += 1) {
      const person = people[personIndex];

      let matched = null;
      for (let index = 0; index < merged.length; index += 1) {
        if (
          merged[index].cameras.indexOf(cameraId) === -1 &&
          distance(merged[index], person) <= PERSON_MERGE_RADIUS_M
        ) {
          matched = merged[index];
          break;
        }
      }

      if (matched === null) {
        merged.push({
          x: person.x,
          z: person.z,
          conf: person.conf,
          cameras: [cameraId],
          seenAt: entry.seenAt,
        });
        continue;
      }

      matched.cameras.push(cameraId);
      matched.seenAt = Math.max(matched.seenAt, entry.seenAt);
      // The more confident detection wins the position outright rather than
      // averaging: averaging two views of the same person that disagree puts
      // them somewhere neither camera saw them.
      if (person.conf > matched.conf) {
        matched.x = person.x;
        matched.z = person.z;
        matched.conf = person.conf;
      }
    }
  }

  return merged;
}

// A detection outside the room is a calibration error, not a person. Keeping
// it would draw figures standing in mid-air outside the walls.
function isInsideRoom(person) {
  const halfWidth = ROOM.width / 2 + 0.5;
  const halfDepth = ROOM.depth / 2 + 0.5;
  return (
    Math.abs(person.x) <= halfWidth &&
    Math.abs(person.z) <= halfDepth &&
    Number.isFinite(person.x) &&
    Number.isFinite(person.z)
  );
}

// Identity across polls is what lets the figures glide instead of teleport.
// There is no tracker in the producer, so it is nearest-neighbour matching
// between frames — good enough for people walking around a room, and it
// degrades to a new id rather than a wrong one.
function assignIds(previous, current) {
  const available = previous.slice();
  const result = [];

  for (let index = 0; index < current.length; index += 1) {
    const person = current[index];

    let bestIndex = -1;
    let bestDistance = 1.5;
    for (let candidate = 0; candidate < available.length; candidate += 1) {
      const gap = distance(available[candidate], person);
      if (gap < bestDistance) {
        bestDistance = gap;
        bestIndex = candidate;
      }
    }

    if (bestIndex === -1) {
      result.push(Object.assign({}, person, { id: "p" + Date.now() + "-" + index }));
    } else {
      result.push(Object.assign({}, person, { id: available[bestIndex].id }));
      available.splice(bestIndex, 1);
    }
  }

  return result;
}

export default function usePeoplePositions() {
  const [people, setPeople] = useState([]);
  const [feedState, setFeedState] = useState({});
  const previousRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (DEMO_MODE) {
      return startDemoPeople(setPeople, setFeedState, previousRef);
    }

    const byCamera = {};

    async function pollOne(feed) {
      try {
        const payload = await fetchCamera(feed.path + "/positions");
        byCamera[feed.id] = {
          people: Array.isArray(payload.people) ? payload.people : [],
          seenAt: Date.now(),
        };
        return {
          online: true,
          calibrated: Boolean(payload.calibrated),
          occupancy: payload.occupancy,
        };
      } catch (error) {
        delete byCamera[feed.id];
        return { online: false, calibrated: false };
      }
    }

    async function poll() {
      const results = await Promise.all(CAMERA_FEEDS.map(pollOne));
      if (!mountedRef.current) {
        return;
      }

      const nextFeedState = {};
      for (let index = 0; index < CAMERA_FEEDS.length; index += 1) {
        nextFeedState[CAMERA_FEEDS[index].id] = results[index];
      }
      setFeedState(nextFeedState);

      // Forget cameras that have gone quiet, so their people do not linger.
      const now = Date.now();
      const cameraIds = Object.keys(byCamera);
      for (let index = 0; index < cameraIds.length; index += 1) {
        if (now - byCamera[cameraIds[index]].seenAt > PERSON_TTL_MS) {
          delete byCamera[cameraIds[index]];
        }
      }

      const merged = mergeDetections(byCamera).filter(isInsideRoom);
      const identified = assignIds(previousRef.current, merged);
      previousRef.current = identified;
      setPeople(identified);
    }

    // A self-scheduling timeout rather than setInterval, so the delay can
    // change with the feeds' state without tearing the effect down.
    let timer = null;
    let stopped = false;

    async function loop() {
      await poll();
      if (stopped || !mountedRef.current) {
        return;
      }
      const anyOnline = Object.keys(byCamera).length > 0;
      timer = setTimeout(
        loop,
        anyOnline ? POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS
      );
    }

    loop();

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  return { people: people, feeds: feedState };
}

/* ------------------------------------------------------------------ */
/* Demo feed                                                           */
/* ------------------------------------------------------------------ */

// Synthetic walkers for VITE_DEMO=1, so the 3D room is not empty when the
// dashboard is being shown with no cameras attached.
function startDemoPeople(setPeople, setFeedState, previousRef) {
  const walkers = [
    { id: "demo-1", phase: 0, speed: 0.00042, radius: 1.7, offsetZ: -0.3 },
    { id: "demo-2", phase: 2.1, speed: -0.00031, radius: 2.3, offsetZ: 0.4 },
    { id: "demo-3", phase: 4.0, speed: 0.00025, radius: 0.9, offsetZ: -1.0 },
  ];

  setFeedState({
    cam1: { online: true, calibrated: true },
    cam2: { online: true, calibrated: true },
  });

  function tick() {
    const now = Date.now();
    const next = [];
    for (let index = 0; index < walkers.length; index += 1) {
      const walker = walkers[index];
      const angle = walker.phase + now * walker.speed;
      next.push({
        id: walker.id,
        x: Math.cos(angle) * walker.radius,
        z: Math.sin(angle) * walker.radius * 0.6 + walker.offsetZ,
        conf: 0.8,
        cameras: index === 0 ? ["cam1", "cam2"] : ["cam" + ((index % 2) + 1)],
        seenAt: now,
      });
    }
    previousRef.current = next;
    setPeople(next);
  }

  tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
