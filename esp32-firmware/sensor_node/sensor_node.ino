/*
  EchoTwin ESP32 sensor node

  Local Serial collection is intentionally independent of Wi-Fi, MQTT, NTP,
  and Tailscale. The locked MQTT topic, payload, names, and 7.5 second publish
  interval remain unchanged.
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

// Venue configuration. Never commit real hotspot credentials.
#define WIFI_SSID "TODO_VENUE_HOTSPOT_SSID"
#define WIFI_PASSWORD "TODO_VENUE_HOTSPOT_PASSWORD"
#define MQTT_BROKER_HOST "TODO_LAPTOP_3_IP"
#define MQTT_BROKER_PORT 1883
#define NODE_ID "node_1"

// AHT21 is the project temperature/humidity sensor. DHT22 stays disabled.
#define ENABLE_DHT22 0

// This module was observed LOW at rest with both indicator LEDs on, matching
// its documented behavior: vibration briefly drives the digital output HIGH.
#define SW420_ACTIVE_STATE HIGH

// Set this to 1 only after the potentiometer and active level have been
// physically checked. Receiving a digital value is not calibration.
#define SW420_CALIBRATED 0

// A warning repeats when the raw pin has not changed for this long.
#define SW420_STUCK_DIAGNOSTIC_MS 15000UL

constexpr uint8_t I2C_SDA_PIN = 21;
constexpr uint8_t I2C_SCL_PIN = 22;
constexpr uint8_t SW420_PIN = 5;
constexpr uint8_t DHT22_PIN = 4;

constexpr unsigned long SERIAL_REPORT_INTERVAL_MS = 1000;
constexpr unsigned long MQTT_PUBLISH_INTERVAL_MS = 7500;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 15000;
constexpr unsigned long MQTT_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long SW420_SAMPLE_INTERVAL_US = 1000;
constexpr unsigned long SW420_DEBOUNCE_MS = 5;
constexpr unsigned long MPU_SAMPLE_INTERVAL_US = 10000;
constexpr size_t MPU_WINDOW_SAMPLES = 100;
constexpr size_t MPU_MIN_VALID_WINDOW_SAMPLES = 50;

// At 100 Hz, alpha 0.01 gives a slowly adapting per-axis gravity/orientation
// baseline. The residual vector is used for windowed vibration features.
constexpr float MPU_BASELINE_ALPHA = 0.01f;

const char *NTP_SERVER_1 = "pool.ntp.org";
const char *NTP_SERVER_2 = "time.nist.gov";

Adafruit_AHTX0 aht21;
ScioSense_ENS160 ens160(&Wire, ENS160_I2CADDR_1);  // Locked address: 0x53
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
float latestEnsEco2 = NAN;
float latestEnsTvoc = NAN;
float latestEnsAqi = NAN;
float latestMlxAmbientTemperature = NAN;
float latestMlxObjectTemperature = NAN;

float latestAccelerationX = NAN;
float latestAccelerationY = NAN;
float latestAccelerationZ = NAN;
float latestGyroX = NAN;
float latestGyroY = NAN;
float latestGyroZ = NAN;
float latestAccelerationMagnitude = NAN;
float latestVibrationRms = NAN;
float latestVibrationPeak = NAN;
float latestVibrationStdDev = NAN;

float accelerationBaselineX = 0.0f;
float accelerationBaselineY = 0.0f;
float accelerationBaselineZ = 0.0f;
bool accelerationBaselineInitialized = false;
float vibrationWindow[MPU_WINDOW_SAMPLES];
size_t vibrationWindowCount = 0;
size_t vibrationWindowIndex = 0;

int sw420LastRawState = HIGH;
int sw420StableState = HIGH;
unsigned long sw420LastRawChangeMs = 0;
unsigned long sw420LastWarningMs = 0;
unsigned long sw420HighCountWindow = 0;
unsigned long sw420LowCountWindow = 0;
unsigned long sw420TransitionCountWindow = 0;
unsigned long sw420EventCountWindow = 0;
bool sw420TripLatchedWindow = false;
bool sw420TripLatchedMqtt = false;
int latestSw420TripState = 0;

unsigned long lastMpuSampleUs = 0;
unsigned long lastSw420SampleUs = 0;
unsigned long lastSerialReportMs = 0;
unsigned long lastMqttPublishMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
bool wifiAttemptStarted = false;
bool networkPlaceholdersReported = false;
bool ntpRequested = false;
uint32_t serialSampleId = 0;

char mqttTopic[96];

bool isPlaceholder(const char *value) {
  return value == nullptr || value[0] == '\0' || strncmp(value, "TODO_", 5) == 0;
}

void printInitStatus(const char *name, bool success) {
  Serial.print(success ? "[INIT OK]   " : "[INIT FAIL] ");
  Serial.println(name);
}

void printJsonFloat(float value, uint8_t decimals = 4) {
  if (isfinite(value)) {
    Serial.print(value, decimals);
  } else {
    Serial.print("null");
  }
}

bool buildIso8601Timestamp(char *destination, size_t destinationSize) {
  time_t now = time(nullptr);
  if (now < 1700000000) {
    return false;
  }
  struct tm utcTime;
  gmtime_r(&now, &utcTime);
  return strftime(destination, destinationSize, "%Y-%m-%dT%H:%M:%SZ", &utcTime) > 0;
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

void manageWifi() {
  if (isPlaceholder(WIFI_SSID) || isPlaceholder(WIFI_PASSWORD)) {
    if (!networkPlaceholdersReported) {
      Serial.println("[NETWORK] Wi-Fi placeholders are not configured.");
      Serial.println("[NETWORK] Local sensor sampling and Serial logging remain active.");
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

void initializeAht21() {
  aht21Ready = aht21.begin(&Wire);
  printInitStatus("AHT21 @ 0x38", aht21Ready);
}

void initializeEns160() {
  ens160Ready = ens160.begin();
  if (ens160Ready) ens160Ready = ens160.setMode(ENS160_OPMODE_STD);
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
    mpu6050.setFilterBandwidth(MPU6050_BAND_44_HZ);
  }
  printInitStatus("MPU-6050 @ 0x68 (100 Hz rolling vibration window)", mpu6050Ready);
}

void initializeSw420() {
  pinMode(SW420_PIN, INPUT);
  sw420LastRawState = digitalRead(SW420_PIN);
  sw420StableState = sw420LastRawState;
  sw420LastRawChangeMs = millis();
  sw420LastWarningMs = millis();
  printInitStatus("SW-420 digital input on GPIO5 (not automatically calibrated)", true);
}

void initializeDht22() {
#if ENABLE_DHT22
  dht22.begin();
  dht22Started = true;
#else
  Serial.println("[INIT SKIP] DHT22 disabled by ENABLE_DHT22=0; AHT21 is authoritative.");
#endif
}

void sampleMpu6050() {
  if (!mpu6050Ready) return;
  unsigned long nowUs = micros();
  if (nowUs - lastMpuSampleUs < MPU_SAMPLE_INTERVAL_US) return;
  lastMpuSampleUs = nowUs;

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
      !isfinite(gy) || !isfinite(gz)) return;

  latestAccelerationX = ax;
  latestAccelerationY = ay;
  latestAccelerationZ = az;
  latestGyroX = gx;
  latestGyroY = gy;
  latestGyroZ = gz;
  latestAccelerationMagnitude = sqrtf(ax * ax + ay * ay + az * az);

  if (!accelerationBaselineInitialized) {
    accelerationBaselineX = ax;
    accelerationBaselineY = ay;
    accelerationBaselineZ = az;
    accelerationBaselineInitialized = true;
  } else {
    accelerationBaselineX += MPU_BASELINE_ALPHA * (ax - accelerationBaselineX);
    accelerationBaselineY += MPU_BASELINE_ALPHA * (ay - accelerationBaselineY);
    accelerationBaselineZ += MPU_BASELINE_ALPHA * (az - accelerationBaselineZ);
  }

  float dynamicX = ax - accelerationBaselineX;
  float dynamicY = ay - accelerationBaselineY;
  float dynamicZ = az - accelerationBaselineZ;
  float dynamicMagnitude = sqrtf(dynamicX * dynamicX + dynamicY * dynamicY +
                                 dynamicZ * dynamicZ);
  vibrationWindow[vibrationWindowIndex] = dynamicMagnitude;
  vibrationWindowIndex = (vibrationWindowIndex + 1) % MPU_WINDOW_SAMPLES;
  if (vibrationWindowCount < MPU_WINDOW_SAMPLES) vibrationWindowCount++;
}

void sampleSw420() {
  unsigned long nowUs = micros();
  if (nowUs - lastSw420SampleUs < SW420_SAMPLE_INTERVAL_US) return;
  lastSw420SampleUs = nowUs;

  int rawState = digitalRead(SW420_PIN);
  if (rawState == HIGH) sw420HighCountWindow++; else sw420LowCountWindow++;

  unsigned long nowMs = millis();
  if (rawState != sw420LastRawState) {
    sw420LastRawState = rawState;
    sw420LastRawChangeMs = nowMs;
    sw420TransitionCountWindow++;
  }
  if (rawState != sw420StableState &&
      nowMs - sw420LastRawChangeMs >= SW420_DEBOUNCE_MS) {
    int previousStableState = sw420StableState;
    sw420StableState = rawState;
    if (previousStableState != SW420_ACTIVE_STATE &&
        sw420StableState == SW420_ACTIVE_STATE) {
      sw420EventCountWindow++;
      sw420TripLatchedWindow = true;
      sw420TripLatchedMqtt = true;
    }
  }
  if (nowMs - sw420LastRawChangeMs >= SW420_STUCK_DIAGNOSTIC_MS &&
      nowMs - sw420LastWarningMs >= SW420_STUCK_DIAGNOSTIC_MS) {
    sw420LastWarningMs = nowMs;
    Serial.print("[SW420 WARN] Raw signal remains ");
    Serial.print(sw420LastRawState == HIGH ? "HIGH" : "LOW");
    Serial.print(". Adjust the physical potentiometer and verify SW420_ACTIVE_STATE=");
    Serial.println(SW420_ACTIVE_STATE == HIGH ? "HIGH" : "LOW");
  }
}

void calculateVibrationWindow() {
  // Do not report the seeded first sample as a fake zero-valued vibration
  // result. Wait for at least half a second of real observations.
  if (vibrationWindowCount < MPU_MIN_VALID_WINDOW_SAMPLES) {
    latestVibrationRms = NAN;
    latestVibrationPeak = NAN;
    latestVibrationStdDev = NAN;
    return;
  }
  double sum = 0.0;
  double sumSquares = 0.0;
  float peak = 0.0f;
  for (size_t index = 0; index < vibrationWindowCount; index++) {
    float value = vibrationWindow[index];
    sum += value;
    sumSquares += static_cast<double>(value) * value;
    if (value > peak) peak = value;
  }
  double mean = sum / vibrationWindowCount;
  double variance = sumSquares / vibrationWindowCount - mean * mean;
  if (variance < 0.0) variance = 0.0;
  latestVibrationRms = sqrtf(static_cast<float>(sumSquares / vibrationWindowCount));
  latestVibrationPeak = peak;
  latestVibrationStdDev = sqrtf(static_cast<float>(variance));
}

void updateAht21() {
  if (!aht21Ready) {
    latestAhtTemperature = NAN;
    latestAhtHumidity = NAN;
    Serial.println("[WARN] AHT21 unavailable; skipping.");
    return;
  }
  sensors_event_t humidityEvent;
  sensors_event_t temperatureEvent;
  aht21.getEvent(&humidityEvent, &temperatureEvent);
  latestAhtTemperature = temperatureEvent.temperature;
  latestAhtHumidity = humidityEvent.relative_humidity;
  if (!isfinite(latestAhtTemperature) || !isfinite(latestAhtHumidity)) {
    latestAhtTemperature = NAN;
    latestAhtHumidity = NAN;
    Serial.println("[WARN] AHT21 returned an invalid reading; using null.");
  }
}

void updateEns160() {
  if (!ens160Ready) {
    latestEnsEco2 = NAN;
    latestEnsTvoc = NAN;
    latestEnsAqi = NAN;
    Serial.println("[WARN] ENS160 unavailable; skipping.");
    return;
  }
  if (isfinite(latestAhtTemperature) && isfinite(latestAhtHumidity)) {
    ens160.set_envdata(latestAhtTemperature, latestAhtHumidity);
  }
  if (!ens160.measure(false)) {
    latestEnsEco2 = NAN;
    latestEnsTvoc = NAN;
    latestEnsAqi = NAN;
    Serial.println("[WARN] ENS160 has no new measurement; using null.");
    return;
  }
  latestEnsEco2 = static_cast<float>(ens160.geteCO2());
  latestEnsTvoc = static_cast<float>(ens160.getTVOC());
  latestEnsAqi = static_cast<float>(ens160.getAQI());
}

void updateMlx90614() {
  if (!mlx90614Ready) {
    latestMlxAmbientTemperature = NAN;
    latestMlxObjectTemperature = NAN;
    Serial.println("[WARN] MLX90614 unavailable; skipping.");
    return;
  }
  latestMlxAmbientTemperature = mlx90614.readAmbientTempC();
  latestMlxObjectTemperature = mlx90614.readObjectTempC();
  if (!isfinite(latestMlxAmbientTemperature) ||
      !isfinite(latestMlxObjectTemperature)) {
    latestMlxAmbientTemperature = NAN;
    latestMlxObjectTemperature = NAN;
    Serial.println("[WARN] MLX90614 returned an invalid reading; using null.");
  }
}

void printReadableSensorReport() {
  Serial.println();
  Serial.println("---------------- sensor cycle ----------------");
  Serial.print("[AHT21] temperature=");
  if (isfinite(latestAhtTemperature)) Serial.print(latestAhtTemperature, 2); else Serial.print("null");
  Serial.print(" C, humidity=");
  if (isfinite(latestAhtHumidity)) Serial.print(latestAhtHumidity, 2); else Serial.print("null");
  Serial.println(" %");

  Serial.print("[ENS160] eCO2=");
  if (isfinite(latestEnsEco2)) Serial.print(latestEnsEco2, 0); else Serial.print("null");
  Serial.print(" ppm, TVOC=");
  if (isfinite(latestEnsTvoc)) Serial.print(latestEnsTvoc, 0); else Serial.print("null");
  Serial.print(" ppb, AQI=");
  if (isfinite(latestEnsAqi)) Serial.println(latestEnsAqi, 0); else Serial.println("null");

  Serial.print("[MLX90614] ambient=");
  if (isfinite(latestMlxAmbientTemperature)) Serial.print(latestMlxAmbientTemperature, 2); else Serial.print("null");
  Serial.print(" C, object/surface=");
  if (isfinite(latestMlxObjectTemperature)) Serial.print(latestMlxObjectTemperature, 2); else Serial.print("null");
  Serial.println(" C");

  Serial.print("[MPU6050] accel XYZ=");
  printJsonFloat(latestAccelerationX, 3); Serial.print(", ");
  printJsonFloat(latestAccelerationY, 3); Serial.print(", ");
  printJsonFloat(latestAccelerationZ, 3); Serial.print(" m/s^2; gyro XYZ=");
  printJsonFloat(latestGyroX, 3); Serial.print(", ");
  printJsonFloat(latestGyroY, 3); Serial.print(", ");
  printJsonFloat(latestGyroZ, 3); Serial.print(" rad/s; vibration RMS=");
  printJsonFloat(latestVibrationRms, 4); Serial.println(" m/s^2");

  Serial.print("[SW420] raw="); Serial.print(sw420LastRawState);
  Serial.print(", stable="); Serial.print(sw420StableState);
  Serial.print(", vibration_trip(latched)="); Serial.print(latestSw420TripState);
  Serial.print(", events="); Serial.print(sw420EventCountWindow);
  Serial.print(", HIGH samples="); Serial.print(sw420HighCountWindow);
  Serial.print(", LOW samples="); Serial.print(sw420LowCountWindow);
  Serial.print(", raw transitions="); Serial.println(sw420TransitionCountWindow);
  Serial.println("------------------------------------------------");
}

void printStructuredSerialRecord() {
  serialSampleId++;
  Serial.print("[SERIAL_DATA]{\"schema_version\":\"1.0\",\"node_id\":\"");
  Serial.print(NODE_ID);
  Serial.print("\",\"sample_id\":"); Serial.print(serialSampleId);
  Serial.print(",\"device_uptime_ms\":"); Serial.print(millis());
  Serial.print(",\"status\":{");
  Serial.print("\"aht21_ready\":"); Serial.print(aht21Ready ? "true" : "false");
  Serial.print(",\"ens160_ready\":"); Serial.print(ens160Ready ? "true" : "false");
  Serial.print(",\"mlx90614_ready\":"); Serial.print(mlx90614Ready ? "true" : "false");
  Serial.print(",\"mpu6050_ready\":"); Serial.print(mpu6050Ready ? "true" : "false");
  Serial.print(",\"mpu_window_samples\":"); Serial.print(vibrationWindowCount);
  Serial.print(",\"sw420_ready\":true");
  Serial.print(",\"sw420_calibrated\":"); Serial.print(SW420_CALIBRATED ? "true" : "false");
  Serial.print(",\"dht22_enabled\":"); Serial.print(ENABLE_DHT22 ? "true" : "false");
  Serial.print(",\"wifi_connected\":"); Serial.print(WiFi.status() == WL_CONNECTED ? "true" : "false");
  Serial.print(",\"mqtt_connected\":"); Serial.print(mqttClient.connected() ? "true" : "false");
  char timestamp[25];
  Serial.print(",\"ntp_synchronized\":");
  Serial.print(buildIso8601Timestamp(timestamp, sizeof(timestamp)) ? "true" : "false");
  Serial.print("}");

  Serial.print(",\"aht21_temperature_c\":"); printJsonFloat(latestAhtTemperature);
  Serial.print(",\"aht21_relative_humidity_pct\":"); printJsonFloat(latestAhtHumidity);
  Serial.print(",\"ens160_eco2_ppm\":"); printJsonFloat(latestEnsEco2, 0);
  Serial.print(",\"ens160_tvoc_ppb\":"); printJsonFloat(latestEnsTvoc, 0);
  Serial.print(",\"ens160_aqi\":"); printJsonFloat(latestEnsAqi, 0);
  Serial.print(",\"mlx90614_ambient_temperature_c\":"); printJsonFloat(latestMlxAmbientTemperature);
  Serial.print(",\"mlx90614_object_temperature_c\":"); printJsonFloat(latestMlxObjectTemperature);
  Serial.print(",\"mpu6050_acceleration_x_mps2\":"); printJsonFloat(latestAccelerationX);
  Serial.print(",\"mpu6050_acceleration_y_mps2\":"); printJsonFloat(latestAccelerationY);
  Serial.print(",\"mpu6050_acceleration_z_mps2\":"); printJsonFloat(latestAccelerationZ);
  Serial.print(",\"mpu6050_gyroscope_x_rad_s\":"); printJsonFloat(latestGyroX);
  Serial.print(",\"mpu6050_gyroscope_y_rad_s\":"); printJsonFloat(latestGyroY);
  Serial.print(",\"mpu6050_gyroscope_z_rad_s\":"); printJsonFloat(latestGyroZ);
  Serial.print(",\"acceleration_magnitude_mps2\":"); printJsonFloat(latestAccelerationMagnitude);
  Serial.print(",\"vibration_rms_mps2\":"); printJsonFloat(latestVibrationRms);
  Serial.print(",\"vibration_peak_mps2\":"); printJsonFloat(latestVibrationPeak);
  Serial.print(",\"vibration_stddev_mps2\":"); printJsonFloat(latestVibrationStdDev);
  Serial.print(",\"sw420_raw_state\":"); Serial.print(sw420LastRawState);
  Serial.print(",\"sw420_trip_state\":"); Serial.print(latestSw420TripState);
  Serial.print(",\"sw420_event_count\":"); Serial.print(sw420EventCountWindow);
  Serial.print(",\"sw420_high_count\":"); Serial.print(sw420HighCountWindow);
  Serial.print(",\"sw420_low_count\":"); Serial.print(sw420LowCountWindow);
  Serial.print(",\"sw420_transition_count\":"); Serial.print(sw420TransitionCountWindow);
  Serial.print(",\"sw420_active_state\":"); Serial.print(SW420_ACTIVE_STATE);
  Serial.println("}");
}

void emitSerialReport() {
  updateAht21();
  updateEns160();
  updateMlx90614();
  calculateVibrationWindow();
  latestSw420TripState =
      (sw420TripLatchedWindow || sw420StableState == SW420_ACTIVE_STATE) ? 1 : 0;
  printReadableSensorReport();
  printStructuredSerialRecord();
  sw420HighCountWindow = 0;
  sw420LowCountWindow = 0;
  sw420TransitionCountWindow = 0;
  sw420EventCountWindow = 0;
  sw420TripLatchedWindow = false;
}

void publishLatestReadings() {
  publishReading("temperature", latestAhtTemperature);
  publishReading("humidity", latestAhtHumidity);
  publishReading("eco2", latestEnsEco2);
  publishReading("tvoc", latestEnsTvoc);
  publishReading("aqi", latestEnsAqi);
  publishReading("surface_temp", latestMlxObjectTemperature);
  // Locked vibration_magnitude means rolling gravity-compensated accel RMS.
  publishReading("vibration_magnitude", latestVibrationRms);
  float mqttTripState =
      (sw420TripLatchedMqtt || sw420StableState == SW420_ACTIVE_STATE) ? 1.0f : 0.0f;
  if (publishReading("vibration_trip", mqttTripState)) {
    sw420TripLatchedMqtt = false;
  }
#if ENABLE_DHT22
  if (dht22Started) {
    publishReading("temperature_backup", dht22.readTemperature());
    publishReading("humidity_backup", dht22.readHumidity());
  }
#endif
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("========================================");
  Serial.println("EchoTwin ESP32 sensor node starting");
  Serial.println("========================================");
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  // MLX90614 uses 100 kHz SMBus timing; keep the verified shared-bus speed.
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
  mqttClient.setSocketTimeout(1);
  Serial.print("[CONFIG] node_id="); Serial.println(NODE_ID);
  Serial.print("[CONFIG] MQTT topic="); Serial.println(mqttTopic);
  Serial.println("[CONFIG] Serial JSON interval=1000 ms; MQTT interval=7500 ms.");
  Serial.println("[CONFIG] MQTT vibration_magnitude=1 s gravity-compensated acceleration RMS (m/s^2).");
  if (isPlaceholder(MQTT_BROKER_HOST)) {
    Serial.println("[NETWORK] MQTT broker placeholder is not configured.");
  }

  sampleMpu6050();
  sampleSw420();
  emitSerialReport();
  lastSerialReportMs = millis();
  lastMqttPublishMs = millis();
}

void loop() {
  // Local sensing is always serviced before optional network work.
  sampleMpu6050();
  sampleSw420();
  unsigned long now = millis();
  if (now - lastSerialReportMs >= SERIAL_REPORT_INTERVAL_MS) {
    lastSerialReportMs = now;
    emitSerialReport();
  }
  if (now - lastMqttPublishMs >= MQTT_PUBLISH_INTERVAL_MS) {
    lastMqttPublishMs = now;
    publishLatestReadings();
  }
  manageWifi();
  manageMqtt();
  delay(1);
}
