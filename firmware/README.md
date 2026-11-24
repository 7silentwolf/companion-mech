# Robot firmware: trial 1, two boards (v0.2)

Matches **Stage B** in `kb/docs/wiring-pins.md` (and `wiring-pins.html`).

| Sketch | Board | Job |
|---|---|---|
| `mechakin_movement/` | regular ESP32 | PCA9685 servos, joint/speed limits, stop button (GPIO27), runs moves. No Wi-Fi |
| `mechakin_comms/` | ESP32-S3 | Wi-Fi + app, file storage, modes, display eyes, sends moves to the movement board over UART |

**Not used in this test:** speaker/amp, SD card. Leave them unplugged. Nothing in the code needs them.

> Not compiled yet: there was no ESP32 toolchain where this was written. If the Arduino IDE shows an error, copy the full error text and fix it from there.

## Libraries (Arduino Library Manager)
- Movement: **Adafruit PWM Servo Driver Library**, **ArduinoJson** (7.x)
- Comms: **WebSockets** (by Markus Sattler), **ArduinoJson** (7.x), **Adafruit ST7735 and ST7789 Library** (say yes to installing **Adafruit GFX** with it)
- Boards Manager: **esp32 by Espressif**

## Test order (one thing at a time)
### 1. Movement board alone
1. Board **ESP32 Dev Module**, open `mechakin_movement/mechakin_movement.ino`, upload.
2. Serial Monitor at **115200**, line ending **Newline**. You should see `Ready`. The servos go to 90° (home).
3. Type these and press Enter:
   ```
   {"type":"set_joint","joint":"head","angle":60}
   {"type":"play","skill":{"skill_id":"t","steps":[{"joint":"right_shoulder","target_angle":130,"duration_ms":800},{"joint":"right_shoulder","target_angle":90,"duration_ms":800}]}}
   {"type":"get_status"}
   ```
4. Press the stop button: servos go limp and `E-STOP (button)` prints. Let go, then type `{"type":"estop_release"}`.

### 2. Comms board alone
1. Board **ESP32S3 Dev Module**. If you use the board's USB port labelled "USB" (not "UART"), set **Tools → USB CDC On Boot → Enabled** or the Serial Monitor stays empty.
2. Upload `mechakin_comms/mechakin_comms.ino`. The first time, there is no Wi-Fi saved, so the display shows two QR pages in turn (every 7 s):
   - **1/2 Join robot Wi-Fi:** scan it with the phone camera and tap *Connect*. This joins hotspot **MechaKin-001** (password **mechakin123**, also printed on screen).
   - **2/2 Open setup page:** scan it to open the setup page, or wait for the phone's "Sign in to network" pop-up. It also works by typing `http://192.168.4.1`.
   - Tap your home Wi-Fi (2.4 GHz), type its password, then **Save and restart**.
   - Put the phone back on your home Wi-Fi. The display now shows the robot's IP, eyes, and `no movement link` (normal until step 3).
3. Display blank? Check the backlight pin: **LED/BL/BLK → 3V3**. Only grainy static? **DC (labelled A0) → GPIO9** isn't connected, or a header joint is bad. Picture shifted, noisy edge, or wrong colours? Change `TFT_TAB` at the top to `INITR_GREENTAB` or `INITR_REDTAB`.

### 3. Link the boards
Wire the UART (power off): movement **GPIO17 (TX2) → S3 GPIO18**, movement **GPIO16 (RX2) ← S3 GPIO17**, **GND ↔ GND**. Power both by USB.
The S3 prints `Movement board move-0.2.0 connected` / `Movement link OK`, and the display shows `friendly | idle`.

### 4. App
App → Robot tab → robot IP, port **81** → Connect → **Sync everything to robot**. Then try the Control sliders, Display test, a skill, and the STOP button. See `app/README.md`.

## Safety (all on the movement board, works even if Wi-Fi or the S3 fails)
- Joint min/max (and 0-180), speed ≤ joint max × mode % (60% until the S3 sends the mode).
- Stop button or app STOP: servos limp, latched until released from the app (button must be let go first). A button held at power-on starts stopped.
- Stops a move if the S3 goes quiet for 1.5 s. The S3 stops the move if the app disconnects or goes quiet for 3 s.
- The movement board keeps its own copy of the joint limits, so it boots safe.

## Changing Wi-Fi (no re-upload needed)
The S3 remembers the Wi-Fi in its own flash. To move it to another network:
- **From the app:** Setup tab → Robot Wi-Fi → name + password → Send. The robot restarts on the new network; read the new IP on its display.
- **Without the app:** if the robot can't join its saved Wi-Fi at power-on (new place, changed password), it opens the **MechaKin-001** hotspot and setup page by itself. Join it and pick the new network.
- **Forget it:** hold the S3's **BOOT** button for 3 seconds. It forgets the Wi-Fi and opens the setup hotspot.
- While in setup mode it retries the saved Wi-Fi every 30 s (when nobody is on the hotspot), so a router that was slow to start is fine.
- The QR codes are pre-made in `mechakin_comms/setup_qr.h`. If you change `AP_SSID`/`AP_PASS`, regenerate it: `cd tools/qr-gen && npm install && AP_SSID=... AP_PASS=... npm start`.
- `wifi_config.h` is optional. If present, it's only the starting default before anything is saved.

## Face on the display
White eyes with irises and pupils that look around and blink, plus a mouth. The style comes from the mode (`display.eyes`: `normal`, `happy`, `focused`, `sad`, `sleepy`). The colour of the irises and mouth comes from `display.color` (`#RRGGBB`). Default: Friendly = cyan, Gaming = orange. Change both in the app's Setup tab, then pick the mode again so it's sent.

## Tuning
- `SERVOMIN` / `SERVOMAX` (movement sketch): pulse range, same as step 1. Narrow it if servos buzz at the ends.
- Pins are set at the top of each sketch and match `kb/docs/wiring-pins.md`. If your comms board is a regular ESP32 instead of an S3, the sketch switches to safe pins (display SCK 18, MOSI 23, CS 5, DC 2, RST 4; link RX 16, TX 17).
