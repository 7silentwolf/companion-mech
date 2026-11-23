# Trial 1 Plan

Trial 1 is more than "servos move". It proves the whole loop on a small scale:
phone app -> robot -> modes from storage -> display + sound -> training that changes saved data.

## Decisions for trial 1
- No microphone on the robot. The phone app's mic is the robot's mic.
- Modes (friendly, gaming...) are files on the robot's storage. Firmware stays small and only runs movement files.
- Learning/training happens in the app. Results are saved to the robot as data. An ESP32 does not train neural networks itself.
- Two controllers as in rrr: ESP32-S3 (Wi-Fi, display, audio, storage) and regular ESP32 (servos, limits, e-stop), linked over UART.
- Amplifier: MAX98357A I2S 3W Class D (digital, built-in DAC). PAM8403 is analog and a poor match for the ESP32-S3, which has no DAC.

## Storage
- Built-in flash with LittleFS (about 1.5 MB usable) for small mode/skill files.
- microSD (16 GB) for sounds, many modes, training history.
- App can push new files over Wi-Fi.

## How "learning" works (realistic version)
1. Child runs a skill or practices a game; the app scores it.
2. The app adjusts that skill's parameters (timing, angles, speed) and stats inside safe limits.
3. The new version is saved to the robot's storage, so it performs better next time.
4. For custom moves the child can pose/record a sequence, and AI can generate variations. They are saved the same way.

## Build order
1. Servo moves via PCA9685 with e-stop (movement controller) -> see `step-1-servo-test.md`
2. Movement controller plays a movement file from storage
3. ESP32-S3 connects to phone over Wi-Fi/WebSocket and sends files
4. Add display (eyes and status), then speaker
5. Add modes, then app training scores updating saved files

Wire and test one part at a time. Display, audio and SD all need pins; SD and display share the SPI bus.
