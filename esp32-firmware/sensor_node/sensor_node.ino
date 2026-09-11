/*
  EchoTwin ESP32 sensor node

  Install these libraries with Arduino Library Manager:
  - Adafruit AHTX0
  - ENS160 - Adafruit Fork
  - Adafruit MLX90614 Library
  - Adafruit MPU6050
  - DHT sensor library (Adafruit)
  - PubSubClient (Nick O'Leary)

  Library Manager will also install Adafruit BusIO and Adafruit Unified Sensor
  where required.
*/

#include <Adafruit_AHTX0.h>
#include <Adafruit_MLX90614.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <PubSubClient.h>
#include <ScioSense_ENS160.h>
#include <WiFi.h>
#include <Wire.h>
#include <math.h>
#include <string.h>
#include <time.h>

// ---------------------------------------------------------------------------
// Venue configuration - fill these in before MQTT testing.
// Never commit real hotspot credentials to GitHub.
// ---------------------------------------------------------------------------
#define WIFI_SSID "TODO_VENUE_HOTSPOT_SSID"
#define WIFI_PASSWORD "TODO_VENUE_HOTSPOT_PASSWORD"
#define MQTT_BROKER_HOST "TODO_LAPTOP_3_IP"
#define MQTT_BROKER_PORT 1883

// TODO: Rename this to the node_id agreed with the backend team.
#define NODE_ID "node_1"

// Set to 0 if the optional DHT22 is not connected.
#define ENABLE_DHT22 1

// Most SW-420 modules pull their digital output LOW when triggered.
// Change to HIGH at the venue if Serial output shows the opposite behavior.
#define SW420_ACTIVE_STATE LOW

// ---------------------------------------------------------------------------
// Fixed wiring and timing
// ---------------------------------------------------------------------------
constexpr uint8_t I2C_SDA_PIN = 21;
constexpr uint8_t I2C_SCL_PIN = 22;
constexpr uint8_t SW420_PIN = 5;
constexpr uint8_t DHT22_PIN = 4;

constexpr unsigned long SAMPLE_INTERVAL_MS = 7500;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 15000;
constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long SW420_DEBOUNCE_MS = 50;
constexpr float STANDARD_GRAVITY_MPS2 = 9.80665f;

const char *NTP_SERVER_1 = "pool.ntp.org";
const char *NTP_SERVER_2 = "time.nist.gov";

// ---------------------------------------------------------------------------
// Sensor and network objects
// ---------------------------------------------------------------------------
Adafruit_AHTX0 aht21;
ScioSense_ENS160 ens160(&Wire, ENS160_I2CADDR_1);  // 0x53
Adafruit_MLX90614 mlx90614;
Adafruit_MPU6050 mpu6050;
DHT dht22(DHT22_PIN, DHT22);

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

bool aht21Ready = false;
bool ens160Ready = false;
bool mlx90614Ready = false;
bool mpu6050Ready = false;
bool dht22Started = false;

float latestAhtTemperature = NAN;
float latestAhtHumidity = NAN;

int sw420LastRawState = HIGH;
int sw420StableState = HIGH;
unsigned long sw420LastChangeMs = 0;

unsigned long lastSampleMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
bool wifiAttemptStarted = false;
bool networkPlaceholdersReported = false;
bool ntpRequested = false;

char mqttTopic[96];

// ---------------------------------------------------------------------------
// General helpers
// ---------------------------------------------------------------------------
bool isPlaceholder(const char *value) {
  return value == nullptr || value[0] == '\0' ||
         strncmp(value, "TODO_", 5) == 0;
}

void printInitStatus(const char *name, bool success) {
  Serial.print(success ? "[INIT OK]   " : "[INIT FAIL] ");
  Serial.println(name);
}

bool buildIso8601Timestamp(char *destination, size_t destinationSize) {
  time_t now = time(nullptr);

  // Any current date is safely later than 2023-11-14. A smaller value means
  // NTP has not set the ESP32 clock yet.
  if (now < 1700000000) {
    return false;
  }

  struct tm utcTime;
  gmtime_r(&now, &utcTime);
  return strftime(destination, destinationSize, "%Y-%m-%dT%H:%M:%SZ",
                  &utcTime) > 0;
}

bool publishReading(const char *sensorName, float value) {
  if (!isfinite(value)) {
    Serial.print("[WARN] Invalid reading skipped: ");
    Serial.println(sensorName);
    return false;
  }

  if (!mqttClient.connected()) {
    return false;
  }

  char timestamp[25];
  if (!buildIso8601Timestamp(timestamp, sizeof(timestamp))) {
    Serial.print("[WARN] NTP time unavailable; MQTT publish skipped: ");
    Serial.println(sensorName);
    return false;
  }

  char payload[224];
  int length = snprintf(
      payload, sizeof(payload),
      "{\"node_id\":\"%s\",\"sensor\":\"%s\",\"value\":%.3f,\"timestamp\":\"%s\"}",
      NODE_ID, sensorName, value, timestamp);

  if (length < 0 || static_cast<size_t>(length) >= sizeof(payload)) {
    Serial.print("[WARN] MQTT payload buffer too small for: ");
    Serial.println(sensorName);
    return false;
  }

  bool published = mqttClient.publish(mqttTopic, payload);
  Serial.print(published ? "[MQTT] " : "[WARN] MQTT publish failed: ");
  Serial.print(sensorName);
  if (published) {
    Serial.print(" -> ");
    Serial.println(payload);
  } else {
    Serial.println();
  }

  return published;
}

// ---------------------------------------------------------------------------
// Non-blocking Wi-Fi, time, and MQTT connection management
// ---------------------------------------------------------------------------
void manageWifi() {
  if (isPlaceholder(WIFI_SSID) || isPlaceholder(WIFI_PASSWORD)) {
    if (!networkPlaceholdersReported) {
      Serial.println("[NETWORK] Wi-Fi placeholders are not configured.");
      Serial.println("[NETWORK] Sensor readings will still print to Serial.");
      networkPlaceholdersReported = true;
    }
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (!ntpRequested) {
      configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
      ntpRequested = true;
      Serial.println("[TIME] NTP synchronization requested (UTC).");
    }
    return;
  }

  unsigned long now = millis();
  if (wifiAttemptStarted && now - lastWifiAttemptMs < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  wifiAttemptStarted = true;
  lastWifiAttemptMs = now;
  Serial.print("[WIFI] Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void manageMqtt() {
  if (mqttClient.connected()) {
    mqttClient.loop();
    return;
  }

  if (WiFi.status() != WL_CONNECTED || isPlaceholder(MQTT_BROKER_HOST)) {
    return;
  }

  unsigned long now = millis();
  if (now - lastMqttAttemptMs < MQTT_RETRY_INTERVAL_MS) {
    return;
  }

  lastMqttAttemptMs = now;
  String clientId = String("echotwin-") + NODE_ID;

  Serial.print("[MQTT] Connecting to ");
  Serial.print(MQTT_BROKER_HOST);
  Serial.print(":");
  Serial.println(MQTT_BROKER_PORT);

  if (mqttClient.connect(clientId.c_str())) {
    Serial.println("[MQTT] Connected.");
  } else {
    Serial.print("[MQTT] Connection failed, state=");
    Serial.println(mqttClient.state());
  }
}

// ---------------------------------------------------------------------------
// Sensor initialization
// ---------------------------------------------------------------------------
void initializeAht21() {
  aht21Ready = aht21.begin(&Wire);
  printInitStatus("AHT21 @ 0x38", aht21Ready);
}

void initializeEns160() {
  ens160Ready = ens160.begin();

  if (ens160Ready) {
    ens160Ready = ens160.setMode(ENS160_OPMODE_STD);
  }

  printInitStatus("ENS160 @ 0x53 (standard mode)", ens160Ready);
}

void initializeMlx90614() {
  mlx90614Ready = mlx90614.begin(0x5A, &Wire);
  printInitStatus("MLX90614 @ 0x5A", mlx90614Ready);
}

void initializeMpu6050() {
  mpu6050Ready = mpu6050.begin(0x68, &Wire);

  if (mpu6050Ready) {
    mpu6050.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu6050.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu6050.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }

  printInitStatus("MPU-6050 @ 0x68", mpu6050Ready);
}

void initializeSw420() {
  pinMode(SW420_PIN, INPUT);
  sw420LastRawState = digitalRead(SW420_PIN);
  sw420StableState = sw420LastRawState;
  sw420LastChangeMs = millis();
  printInitStatus("SW-420 digital input on GPIO5", true);
}

void initializeDht22() {
#if ENABLE_DHT22
  dht22.begin();
  dht22Started = true;

  // The DHT library has no hardware-probe call. Its first valid measurement is
  // the only reliable presence check, and DHT22 needs roughly two seconds.
  delay(2100);
  float temperature = dht22.readTemperature();
  float humidity = dht22.readHumidity();
  printInitStatus("DHT22 on GPIO4 (first reading)",
                  isfinite(temperature) && isfinite(humidity));
#else
  Serial.println("[INIT SKIP] DHT22 disabled by ENABLE_DHT22=0");
#endif
}

// ---------------------------------------------------------------------------
// Sensor reading functions
// ---------------------------------------------------------------------------
void updateSw420Debounce() {
  int rawState = digitalRead(SW420_PIN);

  if (rawState != sw420LastRawState) {
    sw420LastRawState = rawState;
    sw420LastChangeMs = millis();
  }

  if (millis() - sw420LastChangeMs >= SW420_DEBOUNCE_MS) {
    sw420StableState = rawState;
  }
}

void readAht21() {
  if (!aht21Ready) {
    Serial.println("[WARN] AHT21 unavailable; skipping.");
    return;
  }

  sensors_event_t humidityEvent;
  sensors_event_t temperatureEvent;
  aht21.getEvent(&humidityEvent, &temperatureEvent);

  float temperature = temperatureEvent.temperature;
  float humidity = humidityEvent.relative_humidity;

  if (!isfinite(temperature) || !isfinite(humidity)) {
    Serial.println("[WARN] AHT21 returned an invalid reading; skipping.");
    return;
  }

  latestAhtTemperature = temperature;
  latestAhtHumidity = humidity;

  Serial.print("[AHT21] temperature=");
  Serial.print(temperature, 2);
  Serial.print(" C, humidity=");
  Serial.print(humidity, 2);
  Serial.println(" %");

  publishReading("temperature", temperature);
  publishReading("humidity", humidity);
}

void readEns160() {
  if (!ens160Ready) {
    Serial.println("[WARN] ENS160 unavailable; skipping.");
    return;
  }

  if (isfinite(latestAhtTemperature) && isfinite(latestAhtHumidity)) {
    ens160.set_envdata(latestAhtTemperature, latestAhtHumidity);
  }

  if (!ens160.measure(false)) {
    Serial.println("[WARN] ENS160 has no new measurement; skipping this cycle.");
    return;
  }

  float eco2 = static_cast<float>(ens160.geteCO2());
  float tvoc = static_cast<float>(ens160.getTVOC());
  float aqi = static_cast<float>(ens160.getAQI());

  Serial.print("[ENS160] eCO2=");
  Serial.print(eco2, 0);
  Serial.print(" ppm, TVOC=");
  Serial.print(tvoc, 0);
  Serial.print(" ppb, AQI=");
  Serial.println(aqi, 0);

  publishReading("eco2", eco2);
  publishReading("tvoc", tvoc);
  publishReading("aqi", aqi);
}

void readMlx90614() {
  if (!mlx90614Ready) {
    Serial.println("[WARN] MLX90614 unavailable; skipping.");
    return;
  }

  float ambientTemperature = mlx90614.readAmbientTempC();
  float objectTemperature = mlx90614.readObjectTempC();

  if (!isfinite(ambientTemperature) || !isfinite(objectTemperature)) {
    Serial.println("[WARN] MLX90614 returned an invalid reading; skipping.");
    return;
  }

  Serial.print("[MLX90614] ambient=");
  Serial.print(ambientTemperature, 2);
  Serial.print(" C, object/surface=");
  Serial.print(objectTemperature, 2);
  Serial.println(" C");

  // The fixed MQTT vocabulary has surface_temp only. Ambient temperature is
  // still printed for debugging but is not published under an invented name.
  publishReading("surface_temp", objectTemperature);
}

void readMpu6050() {
  if (!mpu6050Ready) {
    Serial.println("[WARN] MPU-6050 unavailable; skipping.");
    return;
  }

  sensors_event_t accelerationEvent;
  sensors_event_t gyroEvent;
  sensors_event_t temperatureEvent;
  mpu6050.getEvent(&accelerationEvent, &gyroEvent, &temperatureEvent);

  float ax = accelerationEvent.acceleration.x;
  float ay = accelerationEvent.acceleration.y;
  float az = accelerationEvent.acceleration.z;
  float gx = gyroEvent.gyro.x;
  float gy = gyroEvent.gyro.y;
  float gz = gyroEvent.gyro.z;

  if (!isfinite(ax) || !isfinite(ay) || !isfinite(az) || !isfinite(gx) ||
      !isfinite(gy) || !isfinite(gz)) {
    Serial.println("[WARN] MPU-6050 returned an invalid reading; skipping.");
    return;
  }

  float accelerationMagnitude = sqrtf(ax * ax + ay * ay + az * az);
  float vibrationMagnitude = fabsf(accelerationMagnitude - STANDARD_GRAVITY_MPS2);

  Serial.print("[MPU6050] accel XYZ=");
  Serial.print(ax, 3);
  Serial.print(", ");
  Serial.print(ay, 3);
  Serial.print(", ");
  Serial.print(az, 3);
  Serial.print(" m/s^2; gyro XYZ=");
  Serial.print(gx, 3);
  Serial.print(", ");
  Serial.print(gy, 3);
  Serial.print(", ");
  Serial.print(gz, 3);
  Serial.print(" rad/s; vibration=");
  Serial.print(vibrationMagnitude, 3);
  Serial.println(" m/s^2");

  publishReading("vibration_magnitude", vibrationMagnitude);
}

void readSw420() {
  int tripState = (sw420StableState == SW420_ACTIVE_STATE) ? 1 : 0;

  Serial.print("[SW420] vibration_trip=");
  Serial.println(tripState);
  publishReading("vibration_trip", static_cast<float>(tripState));
}

void readDht22() {
#if ENABLE_DHT22
  if (!dht22Started) {
    return;
  }

  float temperature = dht22.readTemperature();
  float humidity = dht22.readHumidity();

  if (!isfinite(temperature) || !isfinite(humidity)) {
    Serial.println("[WARN] DHT22 absent or returned invalid data; skipping.");
    return;
  }

  Serial.print("[DHT22] temperature_backup=");
  Serial.print(temperature, 2);
  Serial.print(" C, humidity_backup=");
  Serial.print(humidity, 2);
  Serial.println(" %");

  publishReading("temperature_backup", temperature);
  publishReading("humidity_backup", humidity);
#endif
}

void readAllSensors() {
  Serial.println();
  Serial.println("---------------- sensor cycle ----------------");
  readAht21();
  readEns160();
  readMlx90614();
  readMpu6050();
  readSw420();
  readDht22();
  Serial.println("------------------------------------------------");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("========================================");
  Serial.println("EchoTwin ESP32 sensor node starting");
  Serial.println("========================================");

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);

  initializeAht21();
  initializeEns160();
  initializeMlx90614();
  initializeMpu6050();
  initializeSw420();
  initializeDht22();

  snprintf(mqttTopic, sizeof(mqttTopic), "echotwin/sensors/%s", NODE_ID);
  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqttClient.setBufferSize(256);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(2);

  Serial.print("[CONFIG] node_id=");
  Serial.println(NODE_ID);
  Serial.print("[CONFIG] MQTT topic=");
  Serial.println(mqttTopic);
  if (isPlaceholder(MQTT_BROKER_HOST)) {
    Serial.println("[NETWORK] MQTT broker placeholder is not configured.");
  }

  // Read immediately so hardware testing is not blocked by Wi-Fi setup.
  readAllSensors();
  lastSampleMs = millis();
}

void loop() {
  updateSw420Debounce();
  manageWifi();
  manageMqtt();

  unsigned long now = millis();
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    readAllSensors();
  }

  delay(5);
}
