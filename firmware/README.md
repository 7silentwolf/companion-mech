# Robot firmware: trial 1 (v0.1)

`mechakin_robot/` runs on **one regular ESP32 + PCA9685** and covers build-order steps 1-3:
servos with limits and e-stop, movement files on storage (LittleFS), phone app over Wi-Fi/WebSocket.
Later it splits into ESP32-S3 (Wi-Fi/display/audio) + ESP32 (servos) as in `kb/docs/architecture.md`.

> Not compiled yet. It was written without an ESP32 toolchain on hand. If the Arduino IDE shows an error, copy the error text and fix it from there.

## Do step 1 first
Get one servo moving with `kb/docs/step-1-servo-test.md`. This firmware uses **the same wiring**, plus:
- Servos on PCA9685 channels **0 = head, 1 = right_shoulder, 2 = right_elbow** (change in the app's Setup tab).
- **Stop button**: one leg to **GPIO27**, the other to **GND**. No resistor needed (internal pull-up).

## Flash
1. Arduino IDE → Boards Manager: **esp32 by Espressif**. Board: **ESP32 Dev Module**.
2. Library Manager: **Adafruit PWM Servo Driver Library**, **WebSockets** (by Markus Sattler), **ArduinoJson** (v7).
3. Copy `mechakin_robot/wifi_config.example.h` to `mechakin_robot/wifi_config.h` and put in your Wi-Fi (2.4 GHz, the same network as your phone). This file is git-ignored.
   Skip this and the robot makes a hotspot **MechaKin-001** / `mechakin123` at `192.168.4.1` instead. But then your phone leaves your home Wi-Fi, and Expo Go can't reach the laptop.
4. Open `mechakin_robot/mechakin_robot.ino`, upload, open the Serial Monitor at **115200**. It prints `Robot IP: ...`.
5. In the app: Robot tab → IP + port **81** → Connect → **Sync everything to robot**.

## What it enforces itself (even if the app is wrong)
Joint min/max (and 0-180), speed limit × mode %, E-STOP limp + latch, stop on connection loss / 3 s silence, upload path and size checks. See `kb/docs/app-robot-protocol.md`.

## Tuning
- `SERVOMIN` / `SERVOMAX` at the top: pulse range. Same as the step-1 test; narrow if servos buzz at the ends.
- After an E-STOP the servos go limp. Release from the app (Robot tab). The button must be let go first.
