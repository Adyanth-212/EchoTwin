# esp32-firmware

Owner: **Akshay**. Firmware code is not written yet — this is a spec stub
so the sensor node's pinout and I2C addresses are documented before wiring
starts. See `EchoTwin_Master_Agent_Context.md` section 5 for the source of
this spec, and `schemas/mqtt_and_ws.md` for the MQTT payload shape this
firmware must publish.

## Board

Single ESP32 (Arduino/PlatformIO), one active board + one spare.

## Sensors, interfaces, addresses

| Sensor | Signal | Interface | Pin / Address |
|---|---|---|---|
| AHT21 + ENS160 (combo board) | Temp, humidity, eCO2, TVOC, AQI | I2C | GPIO 21 (SDA) / GPIO 22 (SCL); AHT21 @ 0x38, ENS160 @ 0x53 |
| MLX90614ESF-BCC | Non-contact object/equipment surface temp (35° FoV) | I2C | Same bus, @ 0x5A |
| MPU-6050 | Vibration — accelerometer + gyroscope magnitude/direction | I2C | Same bus, @ 0x68 |
| SW-420 | Vibration — binary trip, sensitivity tuned via onboard pot | Digital | GPIO 5 |
| DHT22 (optional backup) | Temp/humidity redundancy | Digital | GPIO 4 + 10kΩ pull-up if module lacks one |

All I2C sensors share one bus: SDA on GPIO 21, SCL on GPIO 22.

MQ135 was considered and dropped — ENS160 already covers air quality.

## Output contract

Publishes over MQTT to `echotwin/sensors/<node_id>`, one message per
sensor per sample cycle, matching `schemas/mqtt_and_ws.md` section 1
exactly:

```json
{
  "node_id": "string",
  "sensor": "string",
  "value": "number",
  "timestamp": "ISO8601 string"
}
```

Fixed `sensor` values this firmware must emit: `temperature`, `humidity`,
`eco2`, `tvoc`, `aqi`, `surface_temp`, `vibration_magnitude`,
`vibration_trip`, and (if the DHT22 backup is wired) `temperature_backup`,
`humidity_backup`.

## TODO (Akshay)

- [ ] PlatformIO project setup (`platformio.ini`, board config)
- [ ] I2C sensor drivers (AHT21, ENS160, MLX90614, MPU-6050)
- [ ] SW-420 digital read + debounce
- [ ] Optional DHT22 backup read
- [ ] WiFi connect to venue hotspot (Phone 1)
- [ ] MQTT publish loop to `MQTT_BROKER_HOST` (see root `.env.example`)
- [ ] Physical mounting/calibration at venue
