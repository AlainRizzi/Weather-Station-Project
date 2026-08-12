/*
  ============================================================
  ESP32 + AUTONICS THD-WD1-T
  RS485 / Modbus RTU -> Backend HTTP API
  ============================================================

  CONFIRMED SENSOR SETTINGS FROM YOUR SCAN:
    Slave ID : 9
    Baud     : 9600
    Format   : 8N1
    Function : 0x04 Read Input Registers

    Register 0x0000 = Temperature / 100
    Register 0x0001 = Humidity / 100

  ESP32 <-> RS485:
    GPIO16 = RX2 <- RO
    GPIO17 = TX2 -> DI
    GPIO4  = DE + /RE

  THD-WD1-T:
    Brown = +24 V
    Blue  = 0 V
    Black = A(+)
    White = B(-)

  Required libraries:
    - ModbusMaster by Doc Walker
    - ArduinoJson by Benoit Blanchon

  ESP32 board package required.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ModbusMaster.h>
#include <time.h>

// ============================================================
// WIFI
// ============================================================

const char *WIFI_SSID = "Alain";

// Put your Wi-Fi password locally here.
// Do not publish/share the completed sketch with the password.
const char *WIFI_PASSWORD = "CharbelRizzi@1998!";

// ============================================================
// BACKEND
// ============================================================

// IMPORTANT:
// Use a normal URL string.
// Do NOT use Markdown format such as [https://...](https://...)

const char *API_URL_RAILWAY =
    "https://weather-station-project-production.up.railway.app/readings";

const char *API_URL_LOCAL =
    "http://192.168.1.100:8000/readings";

// Select backend:
const char *API_URL = API_URL_RAILWAY;

const char *STATION_NAME =
    "akkar-weather-station";

// Send one measurement every 30 seconds
const unsigned long SAMPLE_INTERVAL_MS = 30000;

// ============================================================
// MODBUS CONFIGURATION
// ============================================================

// CONFIRMED BY YOUR SCANNER
const uint8_t MODBUS_SLAVE_ID = 9;
const uint32_t MODBUS_BAUDRATE = 9600;

// ESP32 UART2
#define RS485_RX_PIN 16
#define RS485_TX_PIN 17

// MAX485 DE and /RE tied together
#define RS485_DE_RE_PIN 4

ModbusMaster modbus;

// ============================================================
// NTP
// ============================================================

const time_t NTP_SYNC_FLOOR = 1577836800;
// 2020-01-01 UTC

// ============================================================
// RS485 DIRECTION CONTROL
// ============================================================

void preTransmission()
{
  // DE = HIGH  -> transmitter enabled
  // /RE = HIGH -> receiver disabled
  digitalWrite(RS485_DE_RE_PIN, HIGH);

  delayMicroseconds(100);
}

void postTransmission()
{
  delayMicroseconds(100);

  // DE = LOW  -> transmitter disabled
  // /RE = LOW -> receiver enabled
  digitalWrite(RS485_DE_RE_PIN, LOW);

  delayMicroseconds(100);
}

// ============================================================
// MODBUS ERROR PRINTING
// ============================================================

void printModbusError(uint8_t result)
{
  Serial.printf(
      "Modbus error: 0x%02X - ",
      result
  );

  switch (result)
  {
    case ModbusMaster::ku8MBSuccess:
      Serial.println("Success");
      break;

    case ModbusMaster::ku8MBIllegalFunction:
      Serial.println("Illegal function");
      break;

    case ModbusMaster::ku8MBIllegalDataAddress:
      Serial.println("Illegal data address");
      break;

    case ModbusMaster::ku8MBIllegalDataValue:
      Serial.println("Illegal data value");
      break;

    case ModbusMaster::ku8MBSlaveDeviceFailure:
      Serial.println("Slave device failure");
      break;

    case ModbusMaster::ku8MBInvalidSlaveID:
      Serial.println("Invalid slave ID in response");
      break;

    case ModbusMaster::ku8MBInvalidFunction:
      Serial.println("Invalid function in response");
      break;

    case ModbusMaster::ku8MBResponseTimedOut:
      Serial.println("Response timeout");
      break;

    case ModbusMaster::ku8MBInvalidCRC:
      Serial.println("Invalid CRC");
      break;

    default:
      Serial.println("Unknown error");
      break;
  }
}

// ============================================================
// WIFI CONNECTION
// ============================================================

bool connectWiFi()
{
  if (WiFi.status() == WL_CONNECTED)
  {
    return true;
  }

  Serial.println();
  Serial.printf(
      "Connecting to WiFi '%s'",
      WIFI_SSID
  );

  WiFi.mode(WIFI_STA);

  WiFi.begin(
      WIFI_SSID,
      WIFI_PASSWORD
  );

  unsigned long start =
      millis();

  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");

    if (millis() - start > 30000)
    {
      Serial.println();
      Serial.println(
          "WiFi connection timeout."
      );

      WiFi.disconnect();

      return false;
    }
  }

  Serial.println();
  Serial.println("WiFi connected.");

  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  return true;
}

// ============================================================
// NTP TIME
// ============================================================

bool waitForNtpSync()
{
  Serial.print(
      "Waiting for NTP time sync"
  );

  unsigned long start =
      millis();

  while (true)
  {
    time_t now;
    time(&now);

    if (now >= NTP_SYNC_FLOOR)
    {
      Serial.println(" synced.");
      return true;
    }

    if (millis() - start > 20000)
    {
      Serial.println();
      Serial.println(
          "NTP synchronization timeout."
      );

      return false;
    }

    Serial.print(".");
    delay(500);
  }
}

// ============================================================
// CREATE ISO-8601 TIMESTAMP
// ============================================================

bool getIsoTimestamp(String &timestamp)
{
  time_t now;

  time(&now);

  if (now < NTP_SYNC_FLOOR)
  {
    return false;
  }

  struct tm timeInfo;

  localtime_r(
      &now,
      &timeInfo
  );

  char datePart[24];
  char timezonePart[8];

  strftime(
      datePart,
      sizeof(datePart),
      "%Y-%m-%dT%H:%M:%S",
      &timeInfo
  );

  strftime(
      timezonePart,
      sizeof(timezonePart),
      "%z",
      &timeInfo
  );

  /*
     strftime gives:
       +0300

     ISO-8601 preferred form:
       +03:00
  */

  String tz =
      String(timezonePart);

  if (tz.length() == 5)
  {
    tz =
        tz.substring(0, 3) +
        ":" +
        tz.substring(3);
  }

  timestamp =
      String(datePart) + tz;

  return true;
}

// ============================================================
// READ THD-WD1-T
// ============================================================

bool readSensor(
    float &temperature,
    float &humidity)
{
  /*
    THD-WD1-T:

    Slave      = 9    <-- CONFIRMED
    Function   = 04
    Start      = 0000
    Registers  = 2

    Response:

    ID 04 04 TEMP_H TEMP_L HUM_H HUM_L CRC CRC
  */

  modbus.clearResponseBuffer();

  uint8_t result =
      modbus.readInputRegisters(
          0x0000,
          2
      );

  if (result !=
      ModbusMaster::ku8MBSuccess)
  {
    printModbusError(result);

    return false;
  }

  // ----------------------------------------------------------
  // Register 0 = temperature
  // ----------------------------------------------------------

  uint16_t rawTemperatureUnsigned =
      modbus.getResponseBuffer(0);

  // Temperature may be negative
  int16_t rawTemperature =
      (int16_t)rawTemperatureUnsigned;

  // ----------------------------------------------------------
  // Register 1 = humidity
  // ----------------------------------------------------------

  uint16_t rawHumidity =
      modbus.getResponseBuffer(1);

  // ----------------------------------------------------------
  // Scale values
  // ----------------------------------------------------------

  temperature =
      rawTemperature / 100.0f;

  humidity =
      rawHumidity / 100.0f;

  // ----------------------------------------------------------
  // Serial diagnostics
  // ----------------------------------------------------------

  Serial.println();
  Serial.println(
      "================================"
  );

  Serial.println(
      "THD-WD1-T READING"
  );

  Serial.println(
      "================================"
  );

  Serial.printf(
      "Slave ID       : %u\n",
      MODBUS_SLAVE_ID
  );

  Serial.printf(
      "Baud           : %lu\n",
      MODBUS_BAUDRATE
  );

  Serial.printf(
      "Raw temperature: 0x%04X (%d)\n",
      rawTemperatureUnsigned,
      rawTemperature
  );

  Serial.printf(
      "Raw humidity   : 0x%04X (%u)\n",
      rawHumidity,
      rawHumidity
  );

  Serial.printf(
      "Temperature    : %.2f C\n",
      temperature
  );

  Serial.printf(
      "Humidity       : %.2f %%RH\n",
      humidity
  );

  Serial.println(
      "================================"
  );

  // ----------------------------------------------------------
  // Basic validity checks
  // ----------------------------------------------------------

  if (temperature < -19.9f ||
      temperature > 60.0f)
  {
    Serial.println(
        "WARNING: temperature outside sensor range."
    );
  }

  if (humidity < 0.0f ||
      humidity > 99.9f)
  {
    Serial.println(
        "WARNING: humidity outside sensor range."
    );
  }

  return true;
}

// ============================================================
// SEND TO BACKEND
// ============================================================

bool sendReading(
    float temperature,
    float humidity)
{
  // ----------------------------------------------------------
  // Ensure Wi-Fi
  // ----------------------------------------------------------

  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println(
        "WiFi disconnected. Reconnecting..."
    );

    if (!connectWiFi())
    {
      Serial.println(
          "POST skipped: WiFi unavailable."
      );

      return false;
    }
  }

  // ----------------------------------------------------------
  // Timestamp
  // ----------------------------------------------------------

  String isoTime;

  if (!getIsoTimestamp(isoTime))
  {
    Serial.println(
        "System clock invalid. Trying NTP again..."
    );

    if (!waitForNtpSync() ||
        !getIsoTimestamp(isoTime))
    {
      Serial.println(
          "POST skipped: no valid timestamp."
      );

      return false;
    }
  }

  // ----------------------------------------------------------
  // Build JSON
  // ----------------------------------------------------------

  JsonDocument doc;

  doc["station_name"] =
      STATION_NAME;

  doc["time"] =
      isoTime;

  doc["temperature_c"] =
      temperature;

  doc["humidity_pct"] =
      humidity;

  String payload;

  serializeJson(
      doc,
      payload
  );

  Serial.println();
  Serial.println(
      "Sending to backend:"
  );

  Serial.println(payload);

  // ----------------------------------------------------------
  // HTTP POST
  // ----------------------------------------------------------

  HTTPClient http;

  if (!http.begin(API_URL))
  {
    Serial.println(
        "HTTP initialization failed."
    );

    return false;
  }

  http.setConnectTimeout(10000);
  http.setTimeout(10000);

  http.addHeader(
      "Content-Type",
      "application/json"
  );

  int httpCode =
      http.POST(payload);

  bool success = false;

  if (httpCode > 0)
  {
    Serial.printf(
        "POST %s -> HTTP %d\n",
        API_URL,
        httpCode
    );

    String response =
        http.getString();

    if (response.length() > 0)
    {
      Serial.print(
          "Backend response: "
      );

      Serial.println(response);
    }

    if (httpCode >= 200 &&
        httpCode < 300)
    {
      success = true;
    }
    else
    {
      Serial.println(
          "Backend returned a non-success status."
      );
    }
  }
  else
  {
    Serial.printf(
        "POST failed: %s\n",
        HTTPClient::errorToString(httpCode).c_str()
    );
  }

  http.end();

  return success;
}

// ============================================================
// SETUP
// ============================================================

void setup()
{
  Serial.begin(115200);

  delay(1500);

  Serial.println();
  Serial.println(
      "================================"
  );

  Serial.println(
      "AUTONICS THD-WD1-T + ESP32"
  );

  Serial.println(
      "================================"
  );

  // ==========================================================
  // RS485 direction control
  // ==========================================================

  pinMode(
      RS485_DE_RE_PIN,
      OUTPUT
  );

  // Start in receive mode
  digitalWrite(
      RS485_DE_RE_PIN,
      LOW
  );

  // ==========================================================
  // UART2
  // ==========================================================

  Serial2.begin(
      MODBUS_BAUDRATE,
      SERIAL_8N1,
      RS485_RX_PIN,
      RS485_TX_PIN
  );

  // ==========================================================
  // Modbus
  // ==========================================================

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

  Serial.println();
  Serial.println(
      "Confirmed Modbus configuration:"
  );

  Serial.printf(
      "Slave ID : %u\n",
      MODBUS_SLAVE_ID
  );

  Serial.printf(
      "Baud     : %lu\n",
      MODBUS_BAUDRATE
  );

  Serial.println(
      "Format   : 8N1"
  );

  Serial.println(
      "Function : 0x04"
  );

  Serial.println(
      "Registers: 0x0000 + 0x0001"
  );

  Serial.printf(
      "UART2 RX : GPIO%d\n",
      RS485_RX_PIN
  );

  Serial.printf(
      "UART2 TX : GPIO%d\n",
      RS485_TX_PIN
  );

  Serial.printf(
      "DE+/RE   : GPIO%d\n",
      RS485_DE_RE_PIN
  );

  /*
    Datasheet requires at least 2 seconds
    after sensor power-up before communication.
  */

  delay(2500);

  // ==========================================================
  // Wi-Fi
  // ==========================================================

  connectWiFi();

  // ==========================================================
  // Beirut timezone + NTP
  // ==========================================================

  configTzTime(
      "EET-2EEST,M3.5.0/3,M10.5.0/4",
      "pool.ntp.org",
      "time.google.com"
  );

  waitForNtpSync();

  Serial.println();
  Serial.printf(
      "Starting sensor loop every %lu ms.\n",
      SAMPLE_INTERVAL_MS
  );

  Serial.println();
}

// ============================================================
// LOOP
// ============================================================

void loop()
{
  unsigned long cycleStart =
      millis();

  float temperature = 0.0f;
  float humidity = 0.0f;

  // ==========================================================
  // Read sensor
  // ==========================================================

  if (readSensor(
          temperature,
          humidity))
  {
    // ========================================================
    // Send reading
    // ========================================================

    if (sendReading(
            temperature,
            humidity))
    {
      Serial.println(
          "Reading sent successfully."
      );
    }
    else
    {
      Serial.println(
          "Sensor read succeeded, but POST failed."
      );
    }
  }
  else
  {
    Serial.println(
        "No POST: Modbus reading failed."
    );
  }

  // ==========================================================
  // Maintain 30-second sampling interval
  // ==========================================================

  unsigned long elapsed =
      millis() - cycleStart;

  if (elapsed < SAMPLE_INTERVAL_MS)
  {
    delay(
        SAMPLE_INTERVAL_MS -
        elapsed
    );
  }
}