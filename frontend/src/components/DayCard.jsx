import { useEffect, useMemo, useState } from "react";
import { Card, Spinner } from "react-bootstrap";
import {
  Thermometer,
  Droplet,
  Speedometer2,
  Wind,
  Compass,
  VolumeUp,
  CloudHaze2,
} from "react-bootstrap-icons";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import { Link } from "react-router";

import { getReadingsInRange } from "../api/client.js";
import { METRICS } from "../metrics.js";

const METRIC_ICONS = {
  temperature_c: <Thermometer />,
  humidity_pct: <Droplet />,
  pressure_hpa: <Speedometer2 />,
  wind_speed_ms: <Wind />,
  wind_dir_deg: <Compass />,
  noise_db: <VolumeUp />,
  pm2_5_ugm3: <CloudHaze2 />,
  pm10_ugm3: <CloudHaze2 />,
};

// Fixed order, matches METRICS array order -- never cycled or reassigned
// per-render. Validated with scripts/validate_palette.js (adjacent-pairs
// mode): all pass. Dark-mode values are the palette's matching dark steps.
const METRIC_COLORS_LIGHT = {
  temperature_c: "#2a78d6",
  humidity_pct: "#eb6834",
  pressure_hpa: "#1baf7a",
  wind_speed_ms: "#eda100",
  wind_dir_deg: "#e87ba4",
  noise_db: "#008300",
  pm2_5_ugm3: "#4a3aa7",
  pm10_ugm3: "#e34948",
};

function average(values) {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return null;
  return nonNull.reduce((sum, v) => sum + v, 0) / nonNull.length;
}

export default function DayCard({ date }) {
  const [result, setResult] = useState(null); // { forDate, readings, error }
  const loaded = result?.forDate === date.format("YYYY-MM-DD");
  const readings = loaded ? result.readings : null;
  const error = loaded ? result.error : null;

  useEffect(() => {
    let active = true;
    const forDate = date.format("YYYY-MM-DD");

    getReadingsInRange(date.startOf("day").toISOString(), date.endOf("day").toISOString(), {
      bucket: "1h",
    })
      .then((data) => {
        if (active) setResult({ forDate, readings: data, error: null });
      })
      .catch((e) => {
        if (active) setResult({ forDate, readings: null, error: e.message });
      });

    return () => {
      active = false;
    };
  }, [date]);

  const averages = useMemo(() => {
    if (!readings) return null;
    const result = {};
    for (const m of METRICS) {
      result[m.key] = average(readings.map((r) => r[m.key]));
    }
    return result;
  }, [readings]);

  const daysBack = dayjs().startOf("day").diff(date.startOf("day"), "day");
  const graphsHref = `/graphs?range=24h&back=${daysBack}`;

  return (
    <Card
      as={Link}
      to={graphsHref}
      className="shadow-sm flex-shrink-0 text-decoration-none text-body day-card"
    >
      <Card.Body>
        <Card.Title className="fs-6 mb-3">{date.format("ddd, MMM D")}</Card.Title>

        {!loaded && (
          <div className="d-flex justify-content-center py-4">
            <Spinner animation="border" size="sm" />
          </div>
        )}
        {loaded && error && (
          <div className="text-danger small">Failed to load.</div>
        )}
        {loaded && !error && readings && readings.length === 0 && (
          <div className="text-muted small">No data for this day.</div>
        )}
        {loaded && !error && readings && readings.length > 0 && (
          <div className="d-flex flex-column gap-2">
            {METRICS.map((m) => (
              <div key={m.key} className="d-flex align-items-center gap-2">
                <span className="text-muted" style={{ width: 18 }}>
                  {METRIC_ICONS[m.key]}
                </span>
                <span className="small text-muted" style={{ width: 46 }}>
                  {averages[m.key] === null ? "--" : `${averages[m.key].toFixed(1)}${m.unit}`}
                </span>
                <div style={{ width: 100, height: 24 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={readings}>
                      <XAxis dataKey="time" hide />
                      <YAxis dataKey={m.key} hide domain={["auto", "auto"]} />
                      <Line
                        type="monotone"
                        dataKey={m.key}
                        stroke={METRIC_COLORS_LIGHT[m.key]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
