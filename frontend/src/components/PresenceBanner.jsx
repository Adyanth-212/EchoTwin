import { useEffect, useState } from "react";
import { restrictedHoursBreach } from "../presenceRules.js";

// Presence inside the restricted window. Checked on a timer rather than only
// when a reading arrives, so the banner appears the moment the window opens
// even if the room's readings happen to be steady.

export default function PresenceBanner(props) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const breach = restrictedHoursBreach(props.room, now);
  if (!breach) {
    return null;
  }

  return (
    <section className="presence-banner" role="alert">
      <div className="presence-banner-count">{breach.occupancy}</div>
      <div>
        <div className="presence-banner-title">
          {breach.occupancy === 1 ? "Person" : "People"} detected during
          restricted hours
        </div>
        <div className="presence-banner-detail">
          This space should be empty right now — verify who is present.
        </div>
      </div>
    </section>
  );
}
