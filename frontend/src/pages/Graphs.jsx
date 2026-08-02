import { useEffect, useMemo, useState } from "react";
import { Alert, Button, ToggleButton, Card, Dropdown, Row, Col, Spinner } from "react-bootstrap";
import {
  ChevronLeft,
  ChevronRight,
  Thermometer,
  Droplet,
  Speedometer2,
  Wind,
  Compass,
  VolumeUp,
  CloudHaze2,
} from "react-bootstrap-icons";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import dayjs from "dayjs";
import { useSearchParams } from "react-router";

import { getReadingsInRange } from "../api/client.js";
import { METRICS } from "../metrics.js";
import { useTheme } from "../theme/ThemeContext.jsx";

const RANGES = [
  { key: "24h", label: "Last 24h", shortLabel: "24h", unit: "day", bucket: "1m" },
  { key: "7d", label: "Last 7 days", shortLabel: "7d", unit: "week", bucket: "1h" },
  { key: "30d", label: "Last 30 days", shortLabel: "30d", hours: 24 * 30, bucket: "1d" },
];

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

// Matches the dataviz palette's categorical-slot-1 hue (light/dark steps)
// used elsewhere in the app, plus the light/dark gridline and axis-baseline
// chrome roles -- kept as plain JS objects (not CSS vars) since these are
// SVG props passed directly to Recharts, not DOM-styled elements.
const CHART_COLORS = {
  light: { line: "#2a78d6", grid: "#e1e0d9", crosshair: "#c3c2b7" },
  dark: { line: "#3987e5", grid: "#2c2c2a", crosshair: "#383835" },
};

// Sensor data is only retained for 30 days -- navigating further back than
// that would always show "no data available," so cap the stepper instead of
// letting the user land there.
const RETENTION_DAYS = 30;

export default function Graphs() {
  const { theme } = useTheme();
  const { line: LINE_COLOR, grid: GRID_COLOR, crosshair: CROSSHAIR_COLOR } = CHART_COLORS[theme];
  const [searchParams, setSearchParams] = useSearchParams();
  const metricKey = METRICS.some((m) => m.key === searchParams.get("metric"))
    ? searchParams.get("metric")
    : METRICS[0].key;
  const initialRange = RANGES.some((r) => r.key === searchParams.get("range"))
    ? searchParams.get("range")
    : RANGES[0].key;
  const initialRangeConfig = RANGES.find((r) => r.key === initialRange);
  const initialBack = Number.parseInt(searchParams.get("back"), 10);
  const initialBackMax = initialRangeConfig.unit
    ? Math.floor(RETENTION_DAYS / (initialRangeConfig.unit === "week" ? 7 : 1))
    : 0;
  const [range, setRange] = useState(initialRange);
  // How many periods back from "now" the 24h/7d steppers are showing.
  // 0 = today / this week, 1 = yesterday / last week, etc.
  const [periodsBack, setPeriodsBack] = useState(
    Number.isInteger(initialBack) && initialBack >= 0 ? Math.min(initialBack, initialBackMax) : 0
  );
  const [readings, setReadings] = useState(null);
  const [error, setError] = useState(null);

  const metric = METRICS.find((m) => m.key === metricKey);
  const rangeConfig = RANGES.find((r) => r.key === range);

  // If the URL had an invalid/malformed metric, range, or back value, rewrite
  // it to the resolved defaults instead of leaving the bad value visible in
  // the address bar. Runs once on mount; later changes go through
  // setMetricKey/selectRange/setPeriodsBack, which already keep the URL and
  // state in sync.
  useEffect(() => {
    const rawMetric = searchParams.get("metric");
    const rawRange = searchParams.get("range");
    const rawBack = searchParams.get("back");
    const backWasValid = Number.isInteger(Number.parseInt(rawBack, 10)) && Number.parseInt(rawBack, 10) >= 0;

    const metricInvalid = rawMetric !== null && rawMetric !== metricKey;
    const rangeInvalid = rawRange !== null && rawRange !== range;
    const backInvalid = rawBack !== null && (!backWasValid || Number.parseInt(rawBack, 10) !== periodsBack);

    if (metricInvalid || rangeInvalid || backInvalid) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (metricInvalid) next.set("metric", metricKey);
          if (rangeInvalid) next.set("range", range);
          if (backInvalid) next.set("back", String(periodsBack));
          return next;
        },
        { replace: true }
      );
    }
    // Only ever check against the URL params present at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectRange(key) {
    setRange(key);
    setPeriodsBack(0);
  }

  const { start, end } = useMemo(() => {
    if (rangeConfig.unit) {
      const anchor = dayjs().subtract(periodsBack, rangeConfig.unit);
      return {
        start: anchor.startOf(rangeConfig.unit),
        end: anchor.endOf(rangeConfig.unit),
      };
    }
    const now = dayjs();
    return { start: now.subtract(rangeConfig.hours, "hour"), end: now };
  }, [rangeConfig, periodsBack]);

  // Data is only retained for RETENTION_DAYS -- disable "Previous" once one
  // more step back would start earlier than the retention floor, so the user
  // can never land on a period with no data purely because it's aged out.
  const retentionFloor = useMemo(() => dayjs().subtract(RETENTION_DAYS, "day").startOf("day"), []);
  const canGoBack = useMemo(() => {
    if (!rangeConfig.unit) return false;
    const nextStart = dayjs()
      .subtract(periodsBack + 1, rangeConfig.unit)
      .startOf(rangeConfig.unit);
    return nextStart.isAfter(retentionFloor) || nextStart.isSame(retentionFloor);
  }, [rangeConfig, periodsBack, retentionFloor]);

  useEffect(() => {
    let active = true;

    getReadingsInRange(start.toISOString(), end.toISOString(), { bucket: rangeConfig.bucket })
      .then((data) => {
        if (active) {
          setReadings(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });

    return () => {
      active = false;
    };
  }, [start, end, rangeConfig.bucket]);

  const data = useMemo(() => {
    if (!readings) return [];
    return readings.map((r) => ({
      time: r.time,
      value: r[metricKey],
    }));
  }, [readings, metricKey]);

  function setMetricKey(key) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("metric", key);
      return next;
    });
  }

  return (
    <>
      <Row className="mb-3 g-3">
        <Col md={4}>
          <Dropdown onSelect={(key) => key && setMetricKey(key)}>
            <Dropdown.Toggle variant="outline-secondary" className="text-start d-flex align-items-center">
              <span className="me-2">{METRIC_ICONS[metricKey]}</span>
              {metric.label}
            </Dropdown.Toggle>
            <Dropdown.Menu>
              {METRICS.map((m) => (
                <Dropdown.Item key={m.key} eventKey={m.key} active={m.key === metricKey}>
                  <span className="me-2">{METRIC_ICONS[m.key]}</span>
                  {m.label}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </Col>
        <Col md={8}>
          <div className="d-flex gap-2">
            {RANGES.map((r) => (
              <ToggleButton
                key={r.key}
                id={`range-${r.key}`}
                type="radio"
                variant="outline-secondary"
                className={`flex-fill ${range === r.key ? "btn-accent" : ""}`}
                name="range"
                value={r.key}
                checked={range === r.key}
                onChange={(e) => selectRange(e.currentTarget.value)}
              >
                <span className="d-none d-sm-inline">{r.label}</span>
                <span className="d-sm-none">{r.shortLabel}</span>
              </ToggleButton>
            ))}
          </div>
        </Col>
      </Row>

      {rangeConfig.unit && (
        <Row className="mb-3 g-3 align-items-center">
          <Col xs="auto">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setPeriodsBack((p) => p + 1)}
              disabled={!canGoBack}
              aria-label={rangeConfig.unit === "day" ? "Previous day" : "Previous week"}
            >
              <ChevronLeft />
            </Button>
          </Col>
          <Col xs="auto" className="fw-semibold">
            {rangeConfig.unit === "day"
              ? periodsBack === 0
                ? `Today (${start.format("MMM D, YYYY")})`
                : periodsBack === 1
                  ? `Yesterday (${start.format("MMM D, YYYY")})`
                  : start.format("dddd, MMM D, YYYY")
              : periodsBack === 0
                ? `This week (${start.format("MMM D")} – ${end.format("MMM D, YYYY")})`
                : periodsBack === 1
                  ? `Last week (${start.format("MMM D")} – ${end.format("MMM D, YYYY")})`
                  : `${start.format("MMM D")} – ${end.format("MMM D, YYYY")}`}
          </Col>
          <Col xs="auto">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setPeriodsBack((p) => Math.max(0, p - 1))}
              disabled={periodsBack === 0}
              aria-label={rangeConfig.unit === "day" ? "Next day" : "Next week"}
            >
              <ChevronRight />
            </Button>
          </Col>
          {periodsBack !== 0 && (
            <Col xs="auto">
              <Button variant="outline-secondary" size="sm" onClick={() => setPeriodsBack(0)}>
                {rangeConfig.unit === "day" ? "Today" : "This week"}
              </Button>
            </Col>
          )}
        </Row>
      )}

      <Card className="shadow-sm">
        <Card.Body>
          {error && <Alert variant="danger">Failed to load readings: {error}</Alert>}
          {!error && !readings && (
            <div className="d-flex justify-content-center py-5">
              <Spinner animation="border" />
            </div>
          )}
          {!error && readings && data.length === 0 && (
            <Alert variant="secondary" className="mb-0">
              No data available for this time range.
            </Alert>
          )}
          {!error && readings && data.length > 0 && (
            <div style={{ width: "100%", overflow: "hidden" }}>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={data} margin={{ top: 5, right: 8, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="0" stroke={GRID_COLOR} vertical={false} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) =>
                      dayjs(t).format(range === "24h" ? "HH:mm" : range === "30d" ? "MMM D" : "MMM D HH:mm")
                    }
                    minTickGap={40}
                  />
                  <YAxis unit={metric.unit} domain={["auto", "auto"]} width={56} tick={{ fontSize: 12 }} />
                  <Tooltip
                    cursor={{ stroke: CROSSHAIR_COLOR, strokeWidth: 1 }}
                    labelFormatter={(t) =>
                      dayjs(t).format(range === "30d" ? "MMM D, YYYY" : "MMM D, YYYY HH:mm:ss")
                    }
                    formatter={(value) => [`${Number(value).toFixed(1)} ${metric.unit}`, metric.label]}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={LINE_COLOR}
                    strokeWidth={2}
                    strokeLinecap="round"
                    dot={false}
                    name={metric.label}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card.Body>
      </Card>
    </>
  );
}
