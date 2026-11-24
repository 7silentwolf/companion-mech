# Decisions and Next Steps

## Decisions so far
- Business-first motivation; Pokemon was inspiration only.
- Audience: kids under 18; fun, not aggressive.
- Original creatures, not licensed characters.
- Mystery capsule concept is the original idea.
- Reuse the rrr smartphone-AI architecture.
- Trial 1 includes display, speaker, storage, modes loaded from storage, and training that updates saved data.
- No microphone on the robot; phone mic is used.
- Still keeping options open; idea not final.
- App stack: Expo (React Native, TypeScript), runs in Expo Go on Android during development. Android-first, iOS possible later.
- App ↔ robot: JSON over WebSocket, protocol v1 (`app-robot-protocol.md`).
- Trial 1 uses the two-board split from the start (wired per `wiring-pins.md`): ESP32-S3 comms + regular ESP32 movement over UART. First test without speaker and SD card.
- Voice v0: phone keyboard dictation + local keyword matching. Cloud AI later.
- Robot Wi-Fi is not compiled into the firmware. It's stored on the S3 and set through a setup hotspot (MechaKin-001, QR codes on the display) or from the app.
- The display shows the robot's personality: eyes with pupils (gaze, blink) and a mouth. Eye style and face colour are per mode (Friendly = cyan/happy, Gaming = orange/focused).
- The movement board enforces all safety limits itself and keeps its own copy of the joint limits, so it stays safe even if the S3 or Wi-Fi fails.

## Open decisions
1. Capsule contents: complete creature / unfolding creature / body shell on common base?
2. What is the surprise: whole creature or rarity/traits?
3. Size: 10-15 cm / 20-30 cm / 30-50 cm?
4. Competition style: physical contact / sensor scoring / hybrid?
5. Training depth: behaviour-based / programmable / both?
6. Locomotion for v1: wheels / four legs / two legs?
7. Prototype budget.
8. Final product name (check trademark).

## Current step (2026-11-25)
The full loop already worked on 2026-11-23 (`trial-1-test-log.md`). Since then, new firmware: comms-0.4.0 (face, colours, QR Wi-Fi setup, Wi-Fi saved on the board) and move-0.2.1 (PCA9685 check, replies to typed commands). Next:
0. Laptop: check the disk health and keep a backup (see `dev-setup.md`). Push after every session.
1. Flash move-0.2.1 to the movement board (it compiles; the boards were unplugged on 2026-11-25).
2. On the S3 (comms-0.4.0), save the home Wi-Fi once with the setup QR codes. The old `wifi_config.h` is gone, so it starts in setup mode.
3. Check the new face (pupils, mouth, colours) and the mode colour switch from the app.
4. Calibrate the servos in the app (Setup tab): horns off, find safe min/max, upload the profile.
5. Cardboard arm/head mock-up: test Wave, Nod, Dance.
6. Try training (Train tab) and confirm the updated skill files land on the robot (Robot tab → List files).
7. Then the speaker (MAX98357A already wired on GPIO5/6/7; firmware not written yet), later the SD card. Optional: PCA9685 OE → GPIO4 for a hardware stop.

## Later roadmap
Digital twin + validation -> JSON movement engine -> Android app -> AI action generation -> one creature prototype with simulated abilities -> two-robot arena test -> parent interviews, BIS and data-protection review, IP registration -> capsule pilot batch.

## Log
- 2026-11-18: Knowledge base created from two chat exports.
- 2026-11-23: v2. Parts bought, trial 1 scope expanded (modes, storage, training, display, speaker), step 1 wiring/code, file formats added.
- 2026-11-23: Mobile app v0.1 (connect, E-STOP, joint control, pose recording, skill editor with validation, modes, training), protocol v1, trial-1 firmware v0.1 and mock robot added.
- 2026-11-23: Added `wiring-pins.html` (pin numbers for trial 1 and the later two-controller split). Decision: files Claude makes in chat are saved into this folder so VS Code sees the same docs.
- 2026-11-23: Firmware v0.2 split into `mechakin_movement` (ESP32) + `mechakin_comms` (S3 with display eyes), per the wiring diagram. App: movement-link warning, display test, eye styles. Speaker and SD skipped for the first test.
- 2026-11-23: First full-loop test passed (see `trial-1-test-log.md`). Display fix: A0 (= DC) wasn't connected. The laptop disk showed filesystem corruption.
- 2026-11-24: Robot Wi-Fi is saved in the S3's flash, not compiled in. It's set from the setup hotspot page (MechaKin-001), from the app's Setup tab, or reset with BOOT held 3 s. `wifi_config.h` is now optional.
- 2026-11-24: Both boards flashed and the UART link confirmed working (first real compile: no errors). Display face v2: eyes with irises/pupils (gaze + blink) and mouth; per-mode face colour (`display.color`). Setup mode shows QR codes on screen (join hotspot, open setup page).
- 2026-11-25: KB brought up to date: status, current step, trial-1 progress, parts confirmed (ESP32-S3 with 8 MB PSRAM + ESP32 with CP2102), new `dev-setup.md` (tools, ports, build/flash commands, gotchas).
- 2026-11-25: GitHub had 4 zero-filled files from the 2026-11-23 corrupted-disk session. Merged, keeping intact local copies plus the test log. The lost movement change (PCA9685 detection, replies to typed commands) was rewritten as move-0.2.1.
