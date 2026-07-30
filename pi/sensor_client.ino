/*
 * Arduino IDE (ESP32) equivalent of sensor_client.py.
 * Reads the Linovision IOT-S300WS8 8-in-1 weather sensor over RS485/Modbus
 * RTU on an interval and POSTs each reading to the backend ingestion API.
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

// ---- Config (mirrors pi/.env.example) ----
const char *WIFI_SSID = "your-wifi-ssid";
const char *WIFI_PASSWORD = "your-wifi-password";

// Pick whichever backend this device targets, then set API_URL below.
const char *API_URL_CLOUDFLARE = "https://api.yourdomain.com/readings";
const char *API_URL_LOCAL = "http://192.168.1.100:8000/readings";  // Raspberry Pi LAN IP/port

const char *API_URL = API_URL_CLOUDFLARE;
const char *STATION_NAME = "";
const unsigned long SAMPLE_INTERVAL_MS = 1000;

// Manual's per-model default-address table lists S800 (8-in-1) as 46, not the
// generic default of 1 -- confirm the real address on the device (USB config
// tool, or ASCII command 0XA;MBAD=?) before trusting this value.
const uint8_t MODBUS_SLAVE_ID = 1;
const long MODBUS_BAUDRATE = 9600;

#define RS485_RX_PIN 16
#define RS485_TX_PIN 17
#define RS485_DE_PIN -1  // set to a GPIO number if your transceiver needs manual direction control

ModbusMaster modbus;

// Input register addresses (word offsets), from the IOT-S300WS8 manual
// section 4.1.2. Every field is a signed int32 spanning 2 registers
// (big-endian), true value = raw / 1000. Same fields as LINOVISION_REGISTERS
// in sensor_client.py -- extend both together if more fields are added.
struct RegisterField {
  const char *name;
  uint16_t address;
};

const RegisterField REGISTERS[] = {
  {"temperature_c", 0x0000},
  {"humidity_pct", 0x0002},
  {"pressure_hpa", 0x0004},  // manual reports Pa; converted to hPa below
  {"wind_dir_deg", 0x000C},  // average wind direction
  {"wind_speed_ms", 0x0012}, // average wind speed
  {"pm2_5_ugm3", 0x0030},
  {"pm10_ugm3", 0x0032},
  {"noise_db", 0x0048},
};
const size_t REGISTER_COUNT = sizeof(REGISTERS) / sizeof(REGISTERS[0]);

// The manual (section 4.1.2) requires PM2.5/PM10/noise to be read in
// separate requests from the main block, and the gaps between them
// (0x0020-0x002F, 0x0034-0x0047) are undefined -- a single request spanning
// 0x0000-0x0049 both risks an illegal-address exception and overflows
// ModbusMaster's 64-register response buffer. Read each contiguous block
// separately instead, matching the manual's own reference reads (p.20-21):
// the first block reads the whole defined 0x0000-0x001F run (temp through
// dumping-of-state) even though we only use a subset of those fields.
struct RegisterBlock {
  uint16_t startAddress;
  uint16_t count;
};

const RegisterBlock REGISTER_BLOCKS[] = {
  {0x0000, 0x0020},  // temp, humidity, pressure, wind, rain, heating temp, dumping state
  {0x0030, 0x0004},  // pm2_5, pm10
  {0x0048, 0x0002},  // noise
};
const size_t REGISTER_BLOCK_COUNT = sizeof(REGISTER_BLOCKS) / sizeof(REGISTER_BLOCKS[0]);

void preTransmission() {
  if (RS485_DE_PIN >= 0) digitalWrite(RS485_DE_PIN, HIGH);
}

void postTransmission() {
  if (RS485_DE_PIN >= 0) digitalWrite(RS485_DE_PIN, LOW);
}

int32_t decodeInt32(uint16_t high, uint16_t low) {
  uint32_t value = ((uint32_t)high << 16) | low;
  return (int32_t)value;
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

// Reads each register block (see REGISTER_BLOCKS) in its own Modbus
// request, then decodes each field's int32 out of the matching block's
// response. Returns false (and leaves doc unchanged) on a Modbus error.
bool readSensors(JsonDocument &doc) {
  for (size_t b = 0; b < REGISTER_BLOCK_COUNT; b++) {
    const RegisterBlock &block = REGISTER_BLOCKS[b];

    uint8_t result = modbus.readInputRegisters(block.startAddress, block.count);
    if (result != modbus.ku8MBSuccess) {
      Serial.printf("Modbus read error: 0x%02X\n", result);
      return false;
    }

    for (size_t i = 0; i < REGISTER_COUNT; i++) {
      uint16_t address = REGISTERS[i].address;
      if (address < block.startAddress || address >= block.startAddress + block.count) continue;
      uint16_t offset = address - block.startAddress;
      uint16_t high = modbus.getResponseBuffer(offset);
      uint16_t low = modbus.getResponseBuffer(offset + 1);
      int32_t raw = decodeInt32(high, low);
      doc[REGISTERS[i].name] = raw / 1000.0;
    }
  }

  doc["pressure_hpa"] = doc["pressure_hpa"].as<float>() / 100.0;  // Pa -> hPa
  return true;
}

void sendReading(JsonDocument &doc) {
  doc["station_name"] = STATION_NAME;
  // ESP32 has no RTC battery by default; sync time via NTP before relying on this.
  time_t now;
  time(&now);
  char isoTime[25];
  strftime(isoTime, sizeof(isoTime), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
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

void setup() {
  Serial.begin(115200);
  connectWiFi();
  configTime(0, 0, "pool.ntp.org");  // UTC, needed for a correct "time" field

  if (RS485_DE_PIN >= 0) {
    pinMode(RS485_DE_PIN, OUTPUT);
    digitalWrite(RS485_DE_PIN, LOW);
  }

  Serial2.begin(MODBUS_BAUDRATE, SERIAL_8N1, RS485_RX_PIN, RS485_TX_PIN);
  modbus.begin(MODBUS_SLAVE_ID, Serial2);
  modbus.preTransmission(preTransmission);
  modbus.postTransmission(postTransmission);

  Serial.printf("Starting sensor loop for station '%s' (interval=%lums)\n", STATION_NAME, SAMPLE_INTERVAL_MS);
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
