import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-bootstrap";

import DayCard from "./DayCard.jsx";
import dayjs, { STATION_TZ } from "../stationTime.js";

const VISIBLE_DAYS = 7;
// How close to the right edge (px) counts as "still at today" for showing/hiding
// the snap-back button.
const AT_TODAY_THRESHOLD_PX = 24;

export default function DayStrip() {
  const [showTodayButton, setShowTodayButton] = useState(false);
  const scrollRef = useRef(null);

  // Oldest-to-newest, today last -- rendered left-to-right so today sits at
  // the right edge. Memoized so each DayCard gets a referentially stable
  // `date` prop across re-renders (e.g. from scroll events) -- otherwise
  // every render hands DayCard a brand-new dayjs object, which its fetch
  // effect would see as "changed" and re-fetch for no reason.
  // "Today" is the station's own calendar day (Asia/Beirut), not the
  // viewer's browser timezone -- this is the station's data, so everyone
  // looking at it should see the same "Past days" regardless of where
  // they're viewing from.
  const dates = useMemo(() => {
    const today = dayjs().tz(STATION_TZ).startOf("day");
    return Array.from({ length: VISIBLE_DAYS }, (_, i) => today.subtract(VISIBLE_DAYS - 1 - i, "day"));
  }, []);

  function scrollToToday(behavior = "smooth") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior });
  }

  // Snap to today (rightmost) on first mount.
  useEffect(() => {
    scrollToToday("auto");
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromRight = el.scrollWidth - el.scrollLeft - el.clientWidth;
    setShowTodayButton(distanceFromRight > AT_TODAY_THRESHOLD_PX);
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <h2 className="fs-4 mb-0">Past days</h2>
        {showTodayButton && (
          <Button variant="outline-secondary" size="sm" onClick={() => scrollToToday()}>
            Today
          </Button>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="d-flex gap-3 pb-2 day-strip-scroll"
        style={{ overflowX: "auto" }}
      >
        {dates.map((date) => (
          <DayCard key={date.format("YYYY-MM-DD")} date={date} />
        ))}
      </div>
    </div>
  );
}
