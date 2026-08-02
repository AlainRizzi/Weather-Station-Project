import { useEffect, useMemo, useState } from "react";
import { Alert, Button, ButtonGroup, ToggleButton, Card, Dropdown, Row, Col, Spinner } from "react-bootstrap";
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

const RANGES = [
  { key: "24h", label: "Last 24h", unit: "day", bucket: "1m" },
  { key: "7d", label: "Last 7 days", unit: "week", bucket: "1h" },
  { key: "30d", label: "Last 30 days", hours: 24 * 30, bucket: "1d" },
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

const LINE_COLOR = "#2a78d6";
const GRID_COLOR = "#e1e0d9";
const CROSSHAIR_COLOR = "#c3c2b7";

export default function Graphs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const metricKey = METRICS.some((m) => m.key === searchParams.get("metric"))
    ? searchParams.get("metric")
    : METRICS[0].key;
  const initialRange = RANGES.some((r) => r.key === searchParams.get("range"))
    ? searchParams.get("range")
    : RANGES[0].key;
  const initialBack = Number.parseInt(searchParams.get("back"), 10);
  const [range, setRange] = useState(initialRange);
  // How many periods back from "now" the 24h/7d steppers are showing.
  // 0 = today / this week, 1 = yesterday / last week, etc.
  const [periodsBack, setPeriodsBack] = useState(Number.isInteger(initialBack) && initialBack >= 0 ? initialBack : 0);
  const [readings, setReadings] = useState(null);
  const [error, setError] = useState(null);

  const metric = METRICS.find((m) => m.key === metricKey);
  const rangeConfig = RANGES.find((r) => r.key === range);

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
      <h1 className="mb-3">Graphs</h1>

      <Row className="mb-3 g-2">
        <Col md={6}>
          <Dropdown onSelect={(key) => key && setMetricKey(key)}>
            <Dropdown.Toggle variant="outline-secondary" className="w-100 text-start d-flex align-items-center">
              <span className="me-2">{METRIC_ICONS[metricKey]}</span>
              {metric.label}
            </Dropdown.Toggle>
            <Dropdown.Menu className="w-100">
              {METRICS.map((m) => (
                <Dropdown.Item key={m.key} eventKey={m.key} active={m.key === metricKey}>
                  <span className="me-2">{METRIC_ICONS[m.key]}</span>
                  {m.label}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </Col>
        <Col md={6}>
          <ButtonGroup className="w-100">
            {RANGES.map((r) => (
              <ToggleButton
                key={r.key}
                id={`range-${r.key}`}
                type="radio"
                variant="outline-primary"
                name="range"
                value={r.key}
                checked={range === r.key}
                onChange={(e) => selectRange(e.currentTarget.value)}
              >
                {r.label}
              </ToggleButton>
            ))}
          </ButtonGroup>
        </Col>
      </Row>

      {rangeConfig.unit && (
        <Row className="mb-3 g-2 align-items-center">
          <Col xs="auto">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => setPeriodsBack((p) => p + 1)}
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
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="0" stroke={GRID_COLOR} vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => dayjs(t).format(range === "24h" ? "HH:mm" : "MMM D HH:mm")}
                  minTickGap={40}
                />
                <YAxis unit={metric.unit} domain={["auto", "auto"]} />
                <Tooltip
                  cursor={{ stroke: CROSSHAIR_COLOR, strokeWidth: 1 }}
                  labelFormatter={(t) => dayjs(t).format("MMM D, YYYY HH:mm:ss")}
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
          )}
        </Card.Body>
      </Card>
    </>
  );
}
