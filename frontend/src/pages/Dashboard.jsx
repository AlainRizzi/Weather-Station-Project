import { useEffect, useState } from "react";
import { Card, Col, Row, Spinner, Alert } from "react-bootstrap";
import { Thermometer, Droplet, Speedometer2, Wind, Compass, VolumeUp, CloudHaze2 } from "react-bootstrap-icons";
import { Link } from "react-router";

import { getLatestReading } from "../api/client.js";
import DayStrip from "../components/DayStrip.jsx";
import dayjs, { STATION_TZ } from "../stationTime.js";

function StatCard({ icon, label, value, unit, metricKey }) {
  return (
    <Col xs={12} sm={6} md={4} lg={3}>
      <Card as={Link} to={`/graphs?metric=${metricKey}`} className="mb-3 shadow-sm text-decoration-none text-body">
        <Card.Body className="d-flex align-items-center">
          <div className="fs-2 me-3 text-accent">{icon}</div>
          <div>
            <div className="text-muted small">{label}</div>
            <div className="fs-4 fw-semibold">
              {value ?? "--"} {unit}
            </div>
          </div>
        </Card.Body>
      </Card>
    </Col>
  );
}

export default function Dashboard() {
  const [reading, setReading] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getLatestReading()
      .then((data) => setReading(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  if (error) return <Alert variant="danger">Failed to load latest reading: {error}</Alert>;
  if (!loaded) return <Spinner animation="border" />;
  if (!reading) return <Alert variant="secondary">No readings yet.</Alert>;

  return (
    <>
      <p className="text-muted">
        Last updated {dayjs(reading.time).tz(STATION_TZ).format("MMM D, YYYY HH:mm:ss")}
      </p>
      <Row>
        <StatCard icon={<Thermometer />} label="Temperature" value={reading.temperature_c} unit="°C" metricKey="temperature_c" />
        <StatCard icon={<Droplet />} label="Humidity" value={reading.humidity_pct} unit="%" metricKey="humidity_pct" />
        <StatCard icon={<Speedometer2 />} label="Pressure" value={reading.pressure_hpa} unit="hPa" metricKey="pressure_hpa" />
        <StatCard icon={<Wind />} label="Wind Speed" value={reading.wind_speed_ms} unit="m/s" metricKey="wind_speed_ms" />
        <StatCard icon={<Compass />} label="Wind Direction" value={reading.wind_dir_deg} unit="°" metricKey="wind_dir_deg" />
        <StatCard icon={<VolumeUp />} label="Noise" value={reading.noise_db} unit="dB" metricKey="noise_db" />
        <StatCard icon={<CloudHaze2 />} label="PM2.5" value={reading.pm2_5_ugm3} unit="µg/m³" metricKey="pm2_5_ugm3" />
        <StatCard icon={<CloudHaze2 />} label="PM10" value={reading.pm10_ugm3} unit="µg/m³" metricKey="pm10_ugm3" />
      </Row>

      <div className="mt-4">
        <DayStrip />
      </div>
    </>
  );
}
