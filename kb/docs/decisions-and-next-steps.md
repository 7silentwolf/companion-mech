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

## Open decisions
1. Capsule contents: complete creature / unfolding creature / body shell on common base?
2. What is the surprise: whole creature or rarity/traits?
3. Size: 10-15 cm / 20-30 cm / 30-50 cm?
4. Competition style: physical contact / sensor scoring / hybrid?
5. Training depth: behaviour-based / programmable / both?
6. Locomotion for v1: wheels / four legs / two legs?
7. Prototype budget.
8. Final product name (check trademark).

## Current step
Step 1: servo test (see `step-1-servo-test.md`). Then servos 2-3, stop button, simple wave, then the build order in `trial-1-plan.md`.
Then follow the test order in `firmware/README.md` (movement board alone → comms board alone → link → app). Before the hardware is ready, test the app with `tools/mock-robot`.

## Later roadmap
Digital twin + validation -> JSON movement engine -> Android app -> AI action generation -> one creature prototype with simulated abilities -> two-robot arena test -> parent interviews, BIS and data-protection review, IP registration -> capsule pilot batch.

## Log
- 2026-11-18: Knowledge base created from two chat exports.
- 2026-11-23: v2. Parts bought, trial 1 scope expanded (modes, storage, training, display, speaker), step 1 wiring/code, file formats added.
- 2026-11-23: Mobile app v0.1 (connect, E-STOP, joint control, pose recording, skill editor with validation, modes, training), protocol v1, trial-1 firmware v0.1 and mock robot added.
- 2026-11-23: Added `wiring-pins.html` (pin numbers for trial 1 and the later two-controller split). Decision: files Claude makes in chat are saved into this folder so VS Code sees the same docs.
- 2026-11-23: Firmware v0.2 split into `mechakin_movement` (ESP32) + `mechakin_comms` (S3 with display eyes), per the wiring diagram. App: movement-link warning, display test, eye styles. Speaker and SD skipped for the first test.
- 2026-11-24: Robot Wi-Fi is saved in the S3's flash, not compiled in. It's set from the setup hotspot page (MechaKin-001), from the app's Setup tab, or reset with BOOT held 3 s. `wifi_config.h` is now optional.
