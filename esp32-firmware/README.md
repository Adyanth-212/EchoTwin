# EchoTwin ESP32 firmware

Owner: **Akshay**. This folder contains the first-boot I2C scanner and the
complete sensor-to-MQTT firmware for EchoTwin.

The fixed source documents are:

- [`../EchoTwin_Master_Agent_Context.md`](../EchoTwin_Master_Agent_Context.md),
  especially section 5.
- [`../schemas/mqtt_and_ws.md`](../schemas/mqtt_and_ws.md), which defines the
  MQTT topic, JSON shape, and allowed sensor names.

## Files

```text
esp32-firmware/
├── platformio.ini
├── i2c_scanner/
│   └── i2c_scanner.ino
└── sensor_node/
    └── sensor_node.ino
```

`i2c_scanner.ino` scans once at boot and explicitly reports each expected
device as present or missing. `sensor_node.ino` initializes every sensor,
prints readings even without a network, and publishes valid readings when
Wi-Fi, MQTT, and NTP time are available.

## Fixed wiring

| Device | ESP32 connection | Expected address |
|---|---|---|
| AHT21 | SDA GPIO21, SCL GPIO22 | `0x38` |
| ENS160 | SDA GPIO21, SCL GPIO22 | `0x53` |
| MLX90614 | SDA GPIO21, SCL GPIO22 | `0x5A` |
| MPU-6050 | SDA GPIO21, SCL GPIO22 | `0x68` |
| SW-420 digital output | GPIO5 | Not I2C |
| DHT22 data (optional) | GPIO4 | Not I2C |

All devices must share ESP32 ground. The DHT22 needs a 10 kOhm pull-up from
DATA to 3.3 V if its module does not already include one. ESP32 GPIO pins are
not 5 V tolerant: confirm the breakout-board voltage requirements before
powering anything, and do not feed a 5 V digital signal into GPIO4 or GPIO5.

## Required Arduino libraries

In Arduino IDE, open **Tools > Manage Libraries** and install these exact
Library Manager names:

| Library Manager name | Header used | Purpose |
|---|---|---|
| Adafruit AHTX0 | `Adafruit_AHTX0.h` | AHT21 temperature/humidity |
| ENS160 - Adafruit Fork | `ScioSense_ENS160.h` | ENS160 eCO2/TVOC/AQI |
| Adafruit MLX90614 Library | `Adafruit_MLX90614.h` | Surface and ambient temperature |
| Adafruit MPU6050 | `Adafruit_MPU6050.h` | Acceleration and gyroscope |
| DHT sensor library | `DHT.h` | Optional DHT22 backup |
| PubSubClient | `PubSubClient.h` | MQTT |

Accept installation of dependencies such as **Adafruit BusIO** and
**Adafruit Unified Sensor** when Arduino IDE prompts. Wi-Fi, Wire, and time
support come with the ESP32 Arduino board package.

PlatformIO installs the same dependencies automatically from
`platformio.ini`. Its default generic board is `esp32dev`; change `board` only
if the label on the actual ESP32 requires a different PlatformIO board ID.

## Configuration before network testing

At the top of `sensor_node/sensor_node.ino`, replace:

```cpp
#define WIFI_SSID "TODO_VENUE_HOTSPOT_SSID"
#define WIFI_PASSWORD "TODO_VENUE_HOTSPOT_PASSWORD"
#define MQTT_BROKER_HOST "TODO_LAPTOP_3_IP"
#define NODE_ID "node_1"
```

`NODE_ID` must match Aditya's backend lookup table. Do not add `room_id` to
the ESP32 payload. Do not commit real credentials; restore the TODO values
before committing changes.

The firmware publishes every 7.5 seconds to:

```text
echotwin/sensors/<node_id>
```

Each message contains exactly one reading:

```json
{
  "node_id": "node_1",
  "sensor": "temperature",
  "value": 24.125,
  "timestamp": "2026-09-11T14:32:05Z"
}
```

The only emitted sensor names are `temperature`, `humidity`, `eco2`, `tvoc`,
`aqi`, `surface_temp`, `vibration_magnitude`, `vibration_trip`,
`temperature_backup`, and `humidity_backup`.

The MLX90614 ambient reading and raw MPU-6050 axes are printed to Serial for
debugging, but they are not published because the fixed MQTT contract has no
names for them. `vibration_magnitude` is the acceleration-vector magnitude's
absolute deviation from standard gravity, in m/s^2; establish a real baseline
after mounting the sensor.

## Exact test sequence at the venue

### 1. Scan the I2C bus

Wire the four I2C devices, flash the scanner, and open Serial Monitor at
115200 baud.

Arduino IDE:

1. Open `i2c_scanner/i2c_scanner.ino`.
2. Select the matching ESP32 board and COM port.
3. Upload, then open Serial Monitor at 115200 baud.

PlatformIO terminal:

```bash
cd esp32-firmware
pio run -e i2c_scanner -t upload
pio device monitor -b 115200
```

Do not continue until the summary reports:

```text
[OK]      AHT21 @ 0x38
[OK]      ENS160 @ 0x53
[OK]      MLX90614 @ 0x5A
[OK]      MPU-6050 @ 0x68
RESULT: PASS - all 4 expected devices responded.
```

If ENS160 appears at `0x52`, check the combo board's address-selection pad or
jumper. The locked EchoTwin address is `0x53`; do not silently change the
firmware contract without telling the team.

### 2. Test all sensor readings without Wi-Fi

Flash `sensor_node/sensor_node.ino` while its network values still contain
`TODO_`. The program must continue running and print:

- A separate `[INIT OK]` or `[INIT FAIL]` line for every device.
- AHT21 temperature and humidity.
- ENS160 eCO2, TVOC, and AQI.
- MLX90614 ambient and object/surface temperatures.
- MPU-6050 acceleration XYZ, gyro XYZ, and vibration magnitude.
- SW-420 trip state as `0` or `1`.
- DHT22 backup values, or a clear warning if it is absent.

PlatformIO terminal:

```bash
cd esp32-firmware
pio run -e sensor_node -t upload
pio device monitor -b 115200
```

### 3. Configure Wi-Fi, broker, and node ID

Fill the four configuration values at the top of `sensor_node.ino`. Laptop 3
must run Mosquitto and allow inbound TCP port 1883 on the venue network.
Confirm the actual laptop IP instead of assuming the example IP in the root
`.env.example`.

The ESP32 requests UTC time from NTP after Wi-Fi connects. Until the clock is
valid, it prints sensor values but deliberately skips MQTT publishing rather
than sending a false ISO8601 timestamp.

### 4. Confirm MQTT delivery

On Laptop 3, subscribe to every EchoTwin sensor message:

```bash
mosquitto_sub -h <LAPTOP_3_IP> -p 1883 -t "echotwin/sensors/#" -v
```

Check that each payload contains exactly `node_id`, `sensor`, `value`, and
`timestamp`; `value` must be numeric and the timestamp must end in `Z`.

Then stop the hotspot or broker briefly and restore it. Sensor output must
continue during the outage, and Wi-Fi/MQTT must reconnect without resetting
the ESP32.

## Fast troubleshooting order

1. **No COM port:** try a known USB data cable, another USB port, then install
   the board's CP210x or CH340 driver.
2. **Missing I2C address:** verify common ground, SDA/SCL orientation, power,
   and address jumpers. Disconnect devices and add them back one at a time.
3. **Sensor init fails despite appearing in the scanner:** confirm the exact
   library above and reset the ESP32 after wiring changes.
4. **SW-420 always 0 or always 1:** adjust its potentiometer and, if its module
   is active-high, change `SW420_ACTIVE_STATE` from `LOW` to `HIGH`.
5. **DHT22 invalid:** wait several seconds, verify the pull-up and power, or set
   `ENABLE_DHT22` to `0` if the optional sensor is not fitted.
6. **No MQTT:** first confirm Wi-Fi and NTP messages in Serial, then verify the
   broker IP, Mosquitto status, firewall port 1883, topic, and backend mapping.
7. **ENS160 values look fixed:** allow its normal startup/warm-up period and
   avoid judging air-quality accuracy immediately after power-on.

Keep one spare ESP32, two known data cables, jumper wires, a breadboard, and a
saved Serial log available for the demo.
