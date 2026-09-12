# EchoTwin Review 2 offline capture and calibration workflow

This workflow produces a reliable USB Serial demonstration while Wi-Fi,
MQTT, NTP, and Tailscale are unavailable. The laptop's
`host_timestamp` is the authoritative UTC capture time. The ESP32 reports only
its monotonic `device_uptime_ms` and does not invent wall-clock time.

## One-time Windows setup

Open PowerShell and run:

```powershell
Set-Location "C:\Users\vijay\Documents\EchoTwin\esp32-firmware"

py -m venv .venv

.\.venv\Scripts\python.exe -m pip install --upgrade pip

.\.venv\Scripts\python.exe -m pip install -r tools\requirements.txt
```

The tools require only `pyserial` for capture and `paho-mqtt` for later
replay. Capturing and analyzing data require no network connection after
installation.

## Review 2 procedure

1. Wire and power the ESP32 sensor node. Use SDA GPIO21, SCL GPIO22, and the
   verified addresses AHT21 `0x38`, ENS160 `0x53`, MLX90614 `0x5A`, and
   MPU-6050 `0x68`. Connect SW-420 digital output to GPIO5 and share ground.
2. Flash the `sensor_node` PlatformIO environment:

   ```powershell
   Set-Location "C:\Users\vijay\Documents\EchoTwin\esp32-firmware"
   .\.venv\Scripts\python.exe -m platformio run -e sensor_node -t upload --upload-port COM10
   ```

   If PlatformIO is installed separately, `pio run -e sensor_node -t upload
   --upload-port COM10` is equivalent.
3. **Close PlatformIO Serial Monitor before starting the logger. Only one
   process may open COM10 at a time.** Close Arduino Serial Monitor too.
4. Mount the MPU-6050 as it will be demonstrated, keep it stationary, and
   avoid touching the table during the baseline run.
5. Capture at least 60–120 seconds of stationary baseline data:

   ```powershell
   .\.venv\Scripts\python.exe tools\serial_logger.py --port COM10 --baud 115200 --duration 120 --node-id node_1 --label stationary
   ```

6. Confirm that both timestamped files were saved under `data\`: one `.jsonl`
   file and one flattened `.csv` file. The logger flushes both files after
   every valid sample. Debug lines are ignored, and malformed structured lines
   are reported without stopping the run.
7. Analyze either capture format. For JSONL:

   ```powershell
   .\.venv\Scripts\python.exe tools\analyze_calibration.py data\<capture-file>.jsonl
   ```

   For CSV, replace the final path with `data\<capture-file>.csv`. Timestamped
   JSON and Markdown reports are written under `calibration\`.
8. Perform a separate vibration-event capture. Keep the mounting unchanged,
   then apply repeatable taps or operate the demonstration equipment:

   ```powershell
   .\.venv\Scripts\python.exe tools\serial_logger.py --port COM10 --baud 115200 --duration 60 --node-id node_1 --label vibration_events
   ```

9. The SW-420 currently staying HIGH is an unresolved hardware observation,
   not calibration. Slowly adjust its physical potentiometer while watching
   `sw420_raw_state`, HIGH/LOW sample counts, transitions, and event count.
   Repeat taps after each small adjustment until the raw state changes
   sensibly without chattering continuously.
10. Determine polarity rather than silently inverting it. If idle is HIGH and
    a tap pulls the output LOW, keep `SW420_ACTIVE_STATE LOW`. If idle is LOW
    and a tap drives it HIGH, set `SW420_ACTIVE_STATE HIGH`. Then repeat the
    capture and analysis. Set `SW420_CALIBRATED` to `1` only after the physical
    response and polarity have actually been verified; firmware never does
    this automatically.
11. Explain the results as installation-specific baseline characterization:
    the report estimates stationary acceleration axes, gyro biases, vibration
    RMS noise floor, and candidate warning/anomaly thresholds. It does not
    claim laboratory-grade vibration calibration. Absolute temperature,
    humidity, and air-quality calibration requires trusted reference
    equipment. Without references, do not apply invented offsets or correction
    factors.
12. Hand both the original JSONL and CSV files to the backend team. JSONL
    preserves the complete nested status object and authoritative laptop UTC
    timestamp; CSV is convenient for plotting and model experiments. Tell the
    backend team that `vibration_rms_mps2` maps to the locked MQTT sensor name
    `vibration_magnitude`.
13. After networking is fixed, replay the stored JSONL file:

    ```powershell
    .\.venv\Scripts\python.exe tools\replay_to_mqtt.py data\<capture-file>.jsonl --broker-host <LAPTOP_3_IP> --port 1883 --node-id node_1 --replay-speed 1.0
    ```

    Replay preserves each recorded `host_timestamp`, publishes one sensor per
    MQTT message, uses `echotwin/sensors/<node_id>`, and labels every terminal
    line `[REPLAY]`. It publishes no raw MPU axes or other invented MQTT names.
    Credentials are neither required nor stored by default.

## Vibration metric

The MPU-6050 is polled approximately every 10 ms (100 Hz) without a blocking
sampling delay. A slowly adapting low-pass baseline is maintained separately
for acceleration X, Y, and Z. Subtracting that baseline removes the static and
slowly changing gravity/orientation component. The magnitude of the remaining
dynamic vector enters a rolling window of 100 samples (approximately one
second).

The Serial record includes the latest raw axes, raw acceleration magnitude,
and window RMS, peak, and standard deviation in m/s². The locked MQTT
`vibration_magnitude` value is specifically the windowed
`vibration_rms_mps2`; it is no longer one instantaneous deviation from
standard gravity. Actual sample timing can vary slightly because this is a
cooperative Arduino loop and optional network-library calls may take time.

## SW-420 interpretation

`sw420_raw_state` is the unmodified GPIO5 level. `sw420_trip_state` is the
configured active state, debounced and latched so a brief event is visible in
the next one-second report. `sw420_event_count` counts debounced inactive-to-
active events. HIGH/LOW counts and raw transition counts describe each report
window. A periodic firmware warning means no transition was seen during the
configured diagnostic period; it instructs the operator to adjust the
potentiometer, but it does not relabel or auto-calibrate the sensor.

## Generated-data policy

Real files under `data\` and generated reports under `calibration\` are ignored
by Git. Keep the `.gitkeep` marker files only. Before any future commit, verify
that Wi-Fi credentials still contain the `TODO_` placeholders and that no
capture files are staged.
