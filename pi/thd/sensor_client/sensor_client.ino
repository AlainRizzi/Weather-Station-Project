/*
 * Arduino IDE (ESP32) equivalent of thd_sensor_client.py.
 * Reads the Autonics THD-WD1-T temperature/humidity sensor over
 * RS485/Modbus RTU on an interval and POSTs each reading to the backend
 * ingestion API.
 *
 * Required libraries (Arduino IDE > Tools > Manage Libraries):
 *   - ModbusMaster (by Doc Walker)
 *   - ArduinoJson (by Benoit Blanchon)
 * Board support: install "esp32" via Boards Manager (uses WiFi.h/HTTPClient.h
 * from the ESP32 core).
 *
 * Wiring: ESP32 UART2 (RX2=GPIO16, TX2=GPIO17) -> RS485 transceiver -> A/B
 * to the sensor's RS-485-A / RS-485-B lines. If your transceiver needs a
 * driver-enable pin (no auto direction control), set RS485_DE_PIN below.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ModbusMaster.h>

// ---- Config (mirrors pi/thd/.env.example) ----
const char *WIFI_SSID = "Alain";
const char *WIFI_PASSWORD = "CharbelRizzi@1998!";

// Pick whichever backend this device targets, then set API_URL below.
const char *API_URL_RAILWAY = "https://weather-station-project-production.up.railway.app/readings";
const char *API_URL_LOCAL = "http://192.168.1.100:8000/readings";  // Raspberry Pi LAN IP/port

const char *API_URL = API_URL_RAILWAY;
const char *STATION_NAME = "akkar-weather-station";
const unsigned long SAMPLE_INTERVAL_MS = 30000;

// Factory default is 1 (upper address terminal OPEN, SW1=1) -- see the
// manual's communication address setting table if this unit's rotary
// switch/terminal has been set differently.
const uint8_t MODBUS_SLAVE_ID = 1;
const long MODBUS_BAUDRATE = 9600;

#define RS485_RX_PIN 16
#define RS485_TX_PIN 17
#define RS485_DE_PIN 4  // MAX485 module: DE/RE tied together, driven from this GPIO

ModbusMaster modbus;

// Input register addresses from the THD manual's "Modbus mapping table"
// (300001/300002 in Modicon 3xxxx convention, i.e. 0-indexed input
// registers). Each value is a single 16-bit register, signed, true value =
// raw * 0.01 -- unlike the Linovision sensor, these are NOT 32-bit pairs.
struct RegisterField {
  const char *name;
  uint16_t address;
};

const RegisterField REGISTERS[] = {
  {"temperature_c", 0x0000},
  {"humidity_pct", 0x0001},
};
const size_t REGISTER_COUNT = sizeof(REGISTERS) / sizeof(REGISTERS[0]);

void preTransmission() {
  if (RS485_DE_PIN >= 0) digitalWrite(RS485_DE_PIN, HIGH);
}

void postTransmission() {
  if (RS485_DE_PIN >= 0) digitalWrite(RS485_DE_PIN, LOW);
}

int16_t decodeInt16(uint16_t raw) {
  return (int16_t)raw;
}

void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" connected");
}

// Reads temperature and humidity in one Modbus request (both registers are
// contiguous, 0x0000-0x0001). Returns false (and leaves doc unchanged) on a
// Modbus error.
bool readSensors(JsonDocument &doc) {
  uint8_t result = modbus.readInputRegisters(0x0000, REGISTER_COUNT);
  if (result != modbus.ku8MBSuccess) {
    Serial.printf("Modbus read error: 0x%02X\n", result);
    return false;
  }

  for (size_t i = 0; i < REGISTER_COUNT; i++) {
    uint16_t raw = modbus.getResponseBuffer(REGISTERS[i].address);
    doc[REGISTERS[i].name] = decodeInt16(raw) * 0.01;
  }

  return true;
}

void sendReading(JsonDocument &doc) {
  doc["station_name"] = STATION_NAME;
  // ESP32 has no RTC battery by default; sync time via NTP before relying on
  // this. localtime() here resolves to the station's own civil time (Beirut,
  // DST-aware per the TZ rule set in setup()), not UTC -- the %z at the end
  // writes the real, current offset (+02:00 or +03:00) instead of a
  // hardcoded "Z" that would misrepresent this as UTC.
  time_t now;
  time(&now);
  char isoTime[26];
  strftime(isoTime, sizeof(isoTime), "%Y-%m-%dT%H:%M:%S%z", localtime(&now));
  doc["time"] = isoTime;

  String payload;
  serializeJson(doc, payload);

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  int httpCode = http.POST(payload);

  if (httpCode > 0) {
    Serial.printf("POST %s -> %d\n", API_URL, httpCode);
  } else {
    Serial.printf("POST failed: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

// 2020-01-01 00:00:00 UTC -- an arbitrary plausible-time floor. configTime()
// only starts NTP sync asynchronously; time(&now) would otherwise return the
// ESP32's default epoch (1970) until sync actually completes, so every
// reading POSTed before that finishes would carry a bogus timestamp.
const time_t NTP_SYNC_FLOOR = 1577836800;

void waitForNtpSync() {
  Serial.print("Waiting for NTP time sync");
  time_t now;
  time(&now);
  while (now < NTP_SYNC_FLOOR) {
    delay(500);
    Serial.print(".");
    time(&now);
  }
  Serial.println(" synced");
}

void setup() {
  Serial.begin(115200);
  connectWiFi();
  // Asia/Beirut's POSIX TZ rule: EET = UTC+2 standard, EEST = UTC+3 during
  // DST, which runs from the last Sunday of March to the last Sunday of
  // October (M3.5.0/3 .. M10.5.0/4) -- matches Lebanon's actual DST
  // schedule, so localtime() below always reflects the correct current
  // offset instead of a fixed one that would be wrong half the year.
  configTzTime("EET-2EEST,M3.5.0/3,M10.5.0/4", "pool.ntp.org");
  waitForNtpSync();

  if (RS485_DE_PIN >= 0) {
    pinMode(RS485_DE_PIN, OUTPUT);
    digitalWrite(RS485_DE_PIN, LOW);
  }

  Serial2.begin(MODBUS_BAUDRATE, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
  modbus.begin(MODBUS_SLAVE_ID, Serial2);
  modbus.preTransmission(preTransmission);
  modbus.postTransmission(postTransmission);

  Serial.printf("Starting THD sensor loop for station '%s' (interval=%lums)\n", STATION_NAME, SAMPLE_INTERVAL_MS);
}

void loop() {
  unsigned long start = millis();

  JsonDocument doc;
  if (readSensors(doc)) {
    sendReading(doc);
  }

  unsigned long elapsed = millis() - start;
  if (elapsed < SAMPLE_INTERVAL_MS) {
    delay(SAMPLE_INTERVAL_MS - elapsed);
  }
}
