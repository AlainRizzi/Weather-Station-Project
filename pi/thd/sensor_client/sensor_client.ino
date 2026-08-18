/*
  ESP32 + Autonics THD-WD1-T
  RS485 / Modbus RTU

  THD-WD1-T:
    Brown = +24V
    Blue  = 0V
    Black = RS485 A(+)
    White = RS485 B(-)

  MAX485 -> ESP32:
    RO    -> GPIO16 (RX2)
    DI    -> GPIO17 (TX2)
    DE+RE -> GPIO4
    GND   -> ESP32 GND

  Modbus factory settings:
    Slave ID : 1
    Baud     : 9600
    Format   : 8N1
    Function : 0x04 Input Registers
    0x0000   : Temperature x 0.01
    0x0001   : Humidity x 0.01
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ModbusMaster.h>
#include <time.h>

// ============================================================
// Wi-Fi
// ============================================================

const char *WIFI_SSID = "Alain";
const char *WIFI_PASSWORD = "CharbelRizzi@1998!";

// ============================================================
// Backend
// IMPORTANT: raw URL only - no Markdown [url](url) syntax
// ============================================================

const char *API_URL =
  "https://weather-station-project-production.up.railway.app/readings";

const char *STATION_NAME = "akkar-weather-station";

// Send every 30 seconds
const unsigned long SAMPLE_INTERVAL_MS = 30000;

// ============================================================
// THD-WD1-T Modbus configuration
// ============================================================

const uint8_t MODBUS_SLAVE_ID = 9;
const uint32_t MODBUS_BAUDRATE = 9600;

#define RS485_RX_PIN 16
#define RS485_TX_PIN 17
#define RS485_DE_PIN 4

ModbusMaster modbus;

// ============================================================
// RS485 direction control
// ============================================================

void preTransmission() {
  digitalWrite(RS485_DE_PIN, HIGH);   // Transmit mode
  delayMicroseconds(50);
}

void postTransmission() {
  delayMicroseconds(50);
  digitalWrite(RS485_DE_PIN, LOW);    // Receive mode
  delayMicroseconds(50);
}

// ============================================================
// Modbus error description
// ============================================================

void printModbusError(uint8_t result) {

  Serial.printf("Modbus error: 0x%02X - ", result);

  switch (result) {

    case ModbusMaster::ku8MBInvalidSlaveID:
      Serial.println("Invalid slave ID");
      break;

    case ModbusMaster::ku8MBInvalidFunction:
      Serial.println("Invalid function");
      break;

    case ModbusMaster::ku8MBResponseTimedOut:
      Serial.println(
        "RESPONSE TIMEOUT - check A/B, slave address, baud rate and wiring"
      );
      break;

    case ModbusMaster::ku8MBInvalidCRC:
      Serial.println(
        "Invalid CRC - check noise, baud rate and RS485 wiring"
      );
      break;

    default:
      Serial.println("Other Modbus error");
      break;
  }
}

// ============================================================
// Wi-Fi
// ============================================================

void connectWiFi() {

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("Connecting to WiFi '%s'", WIFI_SSID);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");

    if (millis() - start > 30000) {
      Serial.println("\nWiFi connection timeout. Retrying...");
      WiFi.disconnect();
      delay(1000);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      start = millis();
    }
  }

  Serial.println();
  Serial.println("WiFi connected");

  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

// ============================================================
// NTP
// ============================================================

const time_t NTP_SYNC_FLOOR = 1577836800; // 2020-01-01

void waitForNtpSync() {

  Serial.print("Waiting for NTP time sync");

  time_t now;

  while (true) {

    time(&now);

    if (now >= NTP_SYNC_FLOOR) {
      break;
    }

    Serial.print(".");
    delay(500);
  }

  Serial.println(" synced");
}

// ============================================================
// Create ISO-8601 Beirut timestamp
// ============================================================

bool addTimestamp(JsonDocument &doc) {

  time_t now;
  time(&now);

  if (now < NTP_SYNC_FLOOR) {
    Serial.println("Invalid system time");
    return false;
  }

  struct tm timeInfo;
  localtime_r(&now, &timeInfo);

  char timestamp[40];

  strftime(
    timestamp,
    sizeof(timestamp),
    "%Y-%m-%dT%H:%M:%S%z",
    &timeInfo
  );

  // strftime normally produces:
  // +0300
  //
  // Convert it to ISO-8601:
  // +03:00

  String iso = timestamp;

  if (iso.length() >= 5) {

    int position = iso.length() - 2;

    iso =
      iso.substring(0, position) +
      ":" +
      iso.substring(position);
  }

  doc["time"] = iso;

  return true;
}

// ============================================================
// Read THD-WD1-T
// ============================================================

bool readTHDSensor(JsonDocument &doc) {

  /*
    Autonics mapping:

      Function 04 - Read Input Registers

      0x0000 = Temperature
      0x0001 = Humidity

    One request reads both registers.
  */

  modbus.clearResponseBuffer();

  uint8_t result =
    modbus.readInputRegisters(0x0000, 2);

  if (result != ModbusMaster::ku8MBSuccess) {

    printModbusError(result);

    return false;
  }

  uint16_t rawTemperature =
    modbus.getResponseBuffer(0);

  uint16_t rawHumidity =
    modbus.getResponseBuffer(1);

  // Temperature can be negative, therefore signed int16_t
  int16_t signedTemperature =
    static_cast<int16_t>(rawTemperature);

  float temperature =
    signedTemperature / 100.0f;

  float humidity =
    rawHumidity / 100.0f;

  Serial.println();
  Serial.println("----- THD-WD1-T -----");

  Serial.printf(
    "Raw temperature : 0x%04X (%d)\n",
    rawTemperature,
    signedTemperature
  );

  Serial.printf(
    "Raw humidity    : 0x%04X (%u)\n",
    rawHumidity,
    rawHumidity
  );

  Serial.printf(
    "Temperature     : %.2f C\n",
    temperature
  );

  Serial.printf(
    "Humidity        : %.2f %%RH\n",
    humidity
  );

  // Basic plausibility diagnostics
  if (temperature < -19.9f || temperature > 60.0f) {
    Serial.println(
      "WARNING: Temperature outside documented THD range"
    );
  }

  if (humidity < 0.0f || humidity > 99.9f) {
    Serial.println(
      "WARNING: Humidity outside documented THD range"
    );
  }

  doc["temperature_c"] = temperature;
  doc["humidity_pct"] = humidity;

  return true;
}

// ============================================================
// POST reading
// ============================================================

void sendReading(JsonDocument &doc) {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("WiFi disconnected. Reconnecting...");

    connectWiFi();
  }

  doc["station_name"] = STATION_NAME;

  if (!addTimestamp(doc)) {
    Serial.println("POST skipped: invalid timestamp");
    return;
  }

  String payload;

  serializeJson(doc, payload);

  Serial.print("JSON: ");
  Serial.println(payload);

  HTTPClient http;

  if (!http.begin(API_URL)) {
    Serial.println("HTTP begin failed");
    return;
  }

  http.setConnectTimeout(10000);
  http.setTimeout(10000);

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  int httpCode =
    http.POST(payload);

  if (httpCode > 0) {

    Serial.printf(
      "POST -> HTTP %d\n",
      httpCode
    );

    if (httpCode < 200 || httpCode >= 300) {

      String response =
        http.getString();

      Serial.print("Backend response: ");
      Serial.println(response);
    }

  } else {

    Serial.printf(
      "POST failed: %s\n",
      http.errorToString(httpCode).c_str()
    );
  }

  http.end();
}

// ============================================================
// Setup
// ============================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("==============================");
  Serial.println("Autonics THD-WD1-T ESP32");
  Serial.println("==============================");

  // ----------------------------------------------------------
  // RS485
  // ----------------------------------------------------------

  pinMode(RS485_DE_PIN, OUTPUT);

  // Receiver enabled initially
  digitalWrite(RS485_DE_PIN, LOW);

  Serial2.begin(
    MODBUS_BAUDRATE,
    SERIAL_8N1,
    RS485_RX_PIN,
    RS485_TX_PIN
  );

  modbus.begin(
    MODBUS_SLAVE_ID,
    Serial2
  );

  modbus.preTransmission(
    preTransmission
  );

  modbus.postTransmission(
    postTransmission
  );

  Serial.printf(
    "Modbus: slave=%u, baud=%lu, format=8N1\n",
    MODBUS_SLAVE_ID,
    MODBUS_BAUDRATE
  );

  Serial.printf(
    "UART2: RX=%d TX=%d DE/RE=%d\n",
    RS485_RX_PIN,
    RS485_TX_PIN,
    RS485_DE_PIN
  );

  // THD requires time after power-up before communication.
  delay(2500);

  // ----------------------------------------------------------
  // Wi-Fi
  // ----------------------------------------------------------

  connectWiFi();

  // Beirut timezone
  configTzTime(
    "EET-2EEST,M3.5.0/3,M10.5.0/4",
    "pool.ntp.org",
    "time.google.com"
  );

  waitForNtpSync();

  Serial.println();
  Serial.printf(
    "Starting THD sensor loop every %lu ms\n",
    SAMPLE_INTERVAL_MS
  );
}

// ============================================================
// Main loop
// ============================================================

void loop() {

  unsigned long startTime =
    millis();

  JsonDocument doc;

  if (readTHDSensor(doc)) {

    sendReading(doc);

  } else {

    Serial.println(
      "No reading sent because Modbus communication failed."
    );
  }

  unsigned long elapsed =
    millis() - startTime;

  if (elapsed < SAMPLE_INTERVAL_MS) {

    delay(
      SAMPLE_INTERVAL_MS - elapsed
    );
  }
}