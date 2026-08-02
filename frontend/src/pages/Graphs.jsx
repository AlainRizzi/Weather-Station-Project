import { useEffect, useMemo, useState } from "react";
import { Alert, Button, ButtonGroup, ToggleButton, Card, Form, Row, Col, Spinner } from "react-bootstrap";
import { ChevronLeft, ChevronRight } from "react-bootstrap-icons";
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
  { key: "24h", label: "Last 24h", unit: "day" },
  { key: "7d", label: "Last 7 days", unit: "week" },
  { key: "30d", label: "Last 30 days", hours: 24 * 30 },
];

export default function Graphs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const metricKey = METRICS.some((m) => m.key === searchParams.get("metric"))
    ? searchParams.get("metric")
    : METRICS[0].key;
  const [range, setRange] = useState(RANGES[0].key);
  // How many periods back from "now" the 24h/7d steppers are showing.
  // 0 = today / this week, 1 = yesterday / last week, etc.
  const [periodsBack, setPeriodsBack] = useState(0);
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

    getReadingsInRange(start.toISOString(), end.toISOString())
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
  }, [start, end]);

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
          <Form.Select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
            {METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Form.Select>
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
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => dayjs(t).format(range === "24h" ? "HH:mm" : "MMM D HH:mm")}
                  minTickGap={40}
                />
                <YAxis unit={metric.unit} domain={["auto", "auto"]} />
                <Tooltip
                  labelFormatter={(t) => dayjs(t).format("MMM D, YYYY HH:mm:ss")}
                  formatter={(value) => [`${value} ${metric.unit}`, metric.label]}
                />
                <Line type="monotone" dataKey="value" stroke="#0d6efd" dot={false} name={metric.label} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card.Body>
      </Card>
    </>
  );
}
