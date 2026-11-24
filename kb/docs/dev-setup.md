# Development setup (laptop, boards, app)

How the development laptop is set up for MechaKin, and the commands that build, flash and run everything. Last checked 2026-11-25.

## Laptop (Ubuntu 26.04)
| Tool | Where | Notes |
|---|---|---|
| Node.js 24 LTS | `~/.local/node/current/bin` | No sudo. Run `export PATH=~/.local/node/current/bin:$PATH` in each new terminal |
| Arduino IDE 2.3.11 | `~/.local/arduino-ide/` | Start with `~/.local/arduino-ide/arduino-ide --no-sandbox` (Ubuntu blocks its sandbox). Menu entry in `~/.local/share/applications/arduino-ide.desktop` |
| arduino-cli 1.6 (bundled with the IDE) | `~/.local/arduino-ide/resources/app/lib/backend/resources/arduino-cli` | Use with `--config-file ~/.arduinoIDE/arduino-cli.yaml` so it shares the IDE's boards and libraries |
| USB serial access | user is in the `dialout` group | Needed to upload. Takes effect after logging out and in |

### Installed Arduino packages
- Boards: **esp32 by Espressif 3.3.12** (also Arduino AVR 1.8.8, installed automatically and unused).
- Libraries: Adafruit PWM Servo Driver 3.0.3, ArduinoJson 7.4.3, WebSockets (Markus Sattler) 2.7.2, Adafruit ST7735 and ST7789 1.12.0, Adafruit GFX 2.0.0. Also pulled in automatically: Adafruit BusIO, Adafruit seesaw, SD.

## The two boards (identified with esptool)
| Board | USB chip | Linux port | Sketch | FQBN |
|---|---|---|---|---|
| ESP32-S3, 8 MB embedded PSRAM (comms) | CH343 (1a86:55d3) | `/dev/ttyACM0` | `firmware/mechakin_comms` | `esp32:esp32:esp32s3` |
| ESP32 (movement) | CP2102 (10c4:ea60) | `/dev/ttyUSB0` | `firmware/mechakin_movement` | `esp32:esp32:esp32` |

The S3 is plugged into its CH343 UART port, so **USB CDC On Boot stays Disabled** (the default). Port names can swap if the boards are plugged in a different order. Check with `arduino-cli board list`.

Both sketches compile without errors or warnings (2026-11-24). Movement uses 28% of flash, comms 82% of the 1.25 MB app partition. If comms outgrows it, choose a bigger partition scheme.

## Build and flash from a terminal
```bash
CLI=~/.local/arduino-ide/resources/app/lib/backend/resources/arduino-cli
CFG=~/.arduinoIDE/arduino-cli.yaml
cd companion-mech/firmware

# movement board
$CLI --config-file $CFG compile --fqbn esp32:esp32:esp32 mechakin_movement
$CLI --config-file $CFG upload  --fqbn esp32:esp32:esp32 --port /dev/ttyUSB0 mechakin_movement

# comms board
$CLI --config-file $CFG compile --fqbn esp32:esp32:esp32s3 mechakin_comms
$CLI --config-file $CFG upload  --fqbn esp32:esp32:esp32s3 --port /dev/ttyACM0 mechakin_comms

# serial monitor (Ctrl+C to quit)
$CLI --config-file $CFG monitor -p /dev/ttyACM0 --config baudrate=115200
```
Or open the same `.ino` files in the IDE and use the Upload button.

Expected boot messages:
- Movement: `MechaKin movement controller move-0.2.1`, `PCA9685 found at 0x40`, … `Ready`
- Comms: `MechaKin comms controller comms-0.4.0`, then `Connected. Robot IP: …` (or `Wi-Fi setup mode`), then `Movement link OK`

## Robot Wi-Fi (no re-flashing)
The S3 keeps the Wi-Fi in flash. With none saved, or if it can't join, the display shows QR codes for hotspot **MechaKin-001** (password `mechakin123`) and the setup page `http://192.168.4.1`. Other ways: the app's Setup tab → Robot Wi-Fi, or hold BOOT for 3 s to forget it. Details in `firmware/README.md`.

## App
```bash
export PATH=~/.local/node/current/bin:$PATH
cd companion-mech/app
npm install          # first time
npx expo start       # scan the QR with Expo Go (Android), same Wi-Fi as the laptop
npm test && npm run typecheck
```
Connect in the Robot tab: robot IP (on the display) and port **81**.

Mock robot (no hardware): `cd tools/mock-robot && npm install && PORT=8090 npm start`, then use port 8090 in the app. The default 8081 clashes with the Expo dev server. `npm run smoke` runs the protocol test.

Setup-screen QR codes: `tools/qr-gen` (only needed if the hotspot name or password changes).

## Gotchas seen so far
- **Laptop disk corruption (2026-11-23):** the disk (`/dev/sda2`, ext4) showed "Bad message" errors and bad bitmap checksums. 4 files reached GitHub as zero bytes. To do: back up, check SMART health (Disks app), run `e2fsck -f` from a live USB, test the RAM (Memtest86+), and replace the disk if SMART shows errors. Push after every session. Quick check that no tracked file got zeroed: `git fsck --full`, and look for files full of NUL bytes before committing.
- Display shows only grainy static: DC (labelled **A0**) not connected, or a bad header solder joint.
- Opening the movement board's serial port resets it. Wait about 3 s before typing commands. Typed commands get a reply like `{"type":"ack","ok":true,"cmd":"set_joint"}`.
- The IDE 2 Serial Monitor is slow on this laptop. `arduino-cli monitor` or a small Python script works better.
- Don't run two compiles (IDE + command line) at the same time. It can damage the build cache.
- The IDE's first launch downloads ~400 MB (AVR boards and built-in libraries) and looks frozen. Wait for it.
- The ESP32 boards package download can time out on GitHub. Click Install again; finished parts are kept. For slow links, add `network: connection_timeout: 600s` to `~/.arduinoIDE/arduino-cli.yaml`.
- Upload stuck on "Connecting…": hold the board's BOOT button.
- `git push` uses a GitHub classic token (`repo` scope) saved with `credential.helper store` (2026-11-25). If pasting the token gives "contains carriage return", save it with `git credential approve` after stripping `\r`.
- The robot's Wi-Fi must be 2.4 GHz.
