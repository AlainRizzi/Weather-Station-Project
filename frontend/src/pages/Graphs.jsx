import { useEffect, useMemo, useState } from "react";
import { Alert, ButtonGroup, ToggleButton, Card, Form, Row, Col, Spinner } from "react-bootstrap";
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
  { key: "24h", label: "Last 24h", hours: 24 },
  { key: "7d", label: "Last 7 days", hours: 24 * 7 },
  { key: "30d", label: "Last 30 days", hours: 24 * 30 },
];

export default function Graphs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const metricKey = METRICS.some((m) => m.key === searchParams.get("metric"))
    ? searchParams.get("metric")
    : METRICS[0].key;
  const [range, setRange] = useState(RANGES[0].key);
  const [readings, setReadings] = useState(null);
  const [error, setError] = useState(null);

  const metric = METRICS.find((m) => m.key === metricKey);

  useEffect(() => {
    let active = true;
    const hours = RANGES.find((r) => r.key === range).hours;
    const end = dayjs();
    const start = end.subtract(hours, "hour");

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
  }, [range]);

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
                onChange={(e) => setRange(e.currentTarget.value)}
              >
                {r.label}
              </ToggleButton>
            ))}
          </ButtonGroup>
        </Col>
      </Row>

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
                  tickFormatter={(t) => dayjs(t).format("MMM D HH:mm")}
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
