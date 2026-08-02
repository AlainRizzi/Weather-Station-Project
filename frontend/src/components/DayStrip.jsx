import { useEffect, useRef, useState } from "react";
import { Button } from "react-bootstrap";
import dayjs from "dayjs";

import DayCard from "./DayCard.jsx";

const INITIAL_DAYS = 7;
const LOAD_MORE_DAYS = 7;
// How close to the right edge (px) counts as "still at today" for showing/hiding
// the snap-back button.
const AT_TODAY_THRESHOLD_PX = 24;

export default function DayStrip() {
  const today = dayjs().startOf("day");
  const [daysBack, setDaysBack] = useState(INITIAL_DAYS - 1);
  const [showTodayButton, setShowTodayButton] = useState(false);
  const scrollRef = useRef(null);

  // Oldest-to-newest, today last -- rendered left-to-right so today sits at
  // the right edge.
  const dates = Array.from({ length: daysBack + 1 }, (_, i) => today.subtract(daysBack - i, "day"));

  function scrollToToday(behavior = "smooth") {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior });
  }

  // Snap to today (rightmost) on first mount and whenever more days are loaded,
  // so newly-added cards on the left don't shift the visible scroll position.
  useEffect(() => {
    scrollToToday("auto");
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromRight = el.scrollWidth - el.scrollLeft - el.clientWidth;
    setShowTodayButton(distanceFromRight > AT_TODAY_THRESHOLD_PX);
  }

  function loadMore() {
    const el = scrollRef.current;
    const prevScrollWidth = el?.scrollWidth ?? 0;
    setDaysBack((d) => d + LOAD_MORE_DAYS);
    // Preserve visual scroll position after new (older) cards are prepended.
    requestAnimationFrame(() => {
      if (el) el.scrollLeft += el.scrollWidth - prevScrollWidth;
    });
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
        className="d-flex gap-3 pb-2"
        style={{ overflowX: "auto" }}
      >
        <div className="d-flex align-items-center flex-shrink-0">
          <Button variant="outline-secondary" size="sm" onClick={loadMore}>
            Load 7 more
          </Button>
        </div>
        {dates.map((date) => (
          <DayCard key={date.format("YYYY-MM-DD")} date={date} />
        ))}
      </div>
    </div>
  );
}
