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

## Teach mode (v1, 2026-11-25, no AI)
The child teaches a move step by step, and the app saves it as a skill file (data, not code). The firmware plays it like any skill and still enforces its limits.
- Words or buttons: "raise right hand", "not too high", "a bit lower", "bend elbow", "straighten", "punch", "guard", "look left", "elbow to 60 degrees", "more".
- The robot moves on every correction (clamped to the joint limits). "Good" keeps the pose as the next step. "Undo", "faster"/"slower" (never past the mode's speed limit), "play it", "save as jab".
- Every taught move starts with a "get ready" step: all joints go to the pose where teaching began, so the move plays the same from anywhere. Without it, a move played while the robot already sat in its pose did nothing (found in testing, 2026-11-26).
- "Faster"/"slower" change the whole move (or the whole combo while one is being built).
- Combos: "combo jab jab cross" (or tap the moves) joins saved moves into one skill. Before saving: Play combo, Faster, Slower.
- Saved moves join every mode, are uploaded to the robot, and can be trained with stars.
- Later: AI only translates free sentences into these same commands (roadmap: AI action generation).

## Feeling alive (2026-11-25)
The robot shows life on its own: it looks around, yawns and sleeps when left alone, wakes up when someone comes, reacts to training and teaching, and keeps a mood and energy level. All on the robot. Details in `firmware/README.md` → Alive.

## Build order
1. Servo moves via PCA9685 with e-stop (movement controller) -> see `step-1-servo-test.md`
2. Movement controller plays a movement file from storage
3. ESP32-S3 connects to phone over Wi-Fi/WebSocket and sends files
4. Add display (eyes and status), then speaker
5. Add modes, then app training scores updating saved files

### Progress (2026-11-25)
| Step | Status |
|---|---|
| 1. Servos + e-stop on the movement controller | Done and tested 2026-11-23 (`trial-1-test-log.md`). Calibration still to do |
| 2. Movement files from storage | Done: skills/modes/profile live in the S3's LittleFS. The movement board keeps its own copy of the joint limits |
| 3. S3 ↔ phone over Wi-Fi/WebSocket | Done and tested 2026-11-23 (connect, sync, control, skills, STOP). Wi-Fi now set by setup hotspot/QR |
| 4. Display, then speaker | Display tested 2026-11-23; face v2 + setup QR added 2026-11-24. Speaker: amp wired on GPIO5/6/7, no speaker or firmware yet |
| 5. Modes, then training updating saved files | Done in app and firmware, plus Teach mode v1 (teach moves and combos by words). Training and Teach on the real robot still to test |

Not in the first test: speaker/amp audio, microSD (sounds, training history). Storage uses the S3's internal flash for now.

Wire and test one part at a time. Display, audio and SD all need pins; SD and display share the SPI bus.
