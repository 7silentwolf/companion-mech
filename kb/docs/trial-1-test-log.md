# Trial 1 Test Log

## Session 1: 2026-11-23, first full-loop test
Hardware wired per `wiring-pins.md` Stage B, without the speaker and SD card.

### Result: everything worked
Phone app → Wi-Fi → ESP32-S3 (comms + display) → UART → ESP32 (movement) → PCA9685 → servos.

| Part | Result | Notes |
|---|---|---|
| Movement ESP32 (`mechakin_movement` move-0.2.0) | Works | Chip ESP32-D0WD-V3, USB bridge CP2102 (`/dev/ttyUSB0`). PCA9685 found at 0x40. Serial commands (`set_joint`, `get_status`) acknowledged |
| ESP32-S3 (`mechakin_comms` comms-0.2.0) | Works | USB bridge CH343 (`/dev/ttyACM0`, the "UART/COM" port, so "USB CDC On Boot" isn't needed). Joins home Wi-Fi and gets its IP by DHCP (was 192.168.1.38). Hotspot fallback `MechaKin-001` also tested |
| Display (1.8" ST7735, `INITR_BLACKTAB`) | Works | First showed only grainy static because **DC (labelled A0 on this display) wasn't connected**. Fixed by wiring A0 → S3 GPIO9 |
| UART link S3 ↔ movement | Works | `movement_ok` became true after linking |
| App (Expo Go) | Works | Connect, sync, control, display test, skills, STOP |

### Lessons
- Grainy static on the TFT = power OK but no init commands reach it. Check DC/A0, CS, RST, SCK, MOSI and the header solder joints.
- Display pin names vary: A0 = DC, SDA = MOSI, SCL = SCK, RES = RST.
- Opening the movement board's serial port resets it (auto-reset circuit). Wait about 3 s before sending commands.
- The Arduino IDE 2 Serial Monitor was very slow on this laptop. Reading the port with a small Python (pyserial) script worked better.
- Don't run two compiles (IDE + command line) at the same time. It damaged the build cache.
- `wifi_config.h` is git-ignored and holds the Wi-Fi name/password. Never commit it.

### Laptop problem found (not robot related)
The laptop's main disk (`/dev/sda2`, ext4) showed spreading filesystem corruption: "Bad message" errors, bad block bitmap checksums, and a file filled with another file's content. It destroyed `~/.cache/arduino` and `~/Arduino/libraries`.
- Work-around used: libraries and builds in `/tmp` (RAM). That setup is gone after a reboot.
- To do: back up, check SMART health (Disks app), run `e2fsck -f` from a live USB, and test the RAM (Memtest86+). Replace the disk if SMART shows errors.
- Until it's fixed, push the repo to GitHub after every session.

## Next session (resume here)
1. Laptop: disk check / backup first (see above).
2. Calibrate the servos in the app (Setup tab): find safe min/max per joint, horns off first, then upload the profile.
3. Mount the servos on a cardboard arm/head mock-up and test Wave, Nod and Dance (assembly step 6 in `wiring-pins.md`).
4. Try training (Train tab) and check that the updated skill files land on the robot (Robot tab → List files).
5. Then add the speaker (MAX98357A already wired on GPIO5/6/7) and later the SD card. Firmware for sound isn't written yet.
6. Optional: wire PCA9685 OE → GPIO4 for a hardware-level stop.

## Note (2026-11-25)
Firmware changed after session 1: comms-0.4.0 (Wi-Fi saved on the board with a setup QR/hotspot, so `wifi_config.h` is no longer needed; face with pupils and mouth; colour per mode) and move-0.2.1. The "next session" list above still applies. The updated order is in `decisions-and-next-steps.md` → Current step.

## Session 2: 2026-11-26, Teach mode on the real robot
Firmware comms-0.5.0 + move-0.3.0 (flashed and confirmed over Wi-Fi). App: Teach tab via Expo Go.
- Worked: motors follow teach commands live, undo.
- Bug: a saved move "says playing but motors don't move". Cause: a taught move only stored the joints that changed, so playing it while the robot already sat in that pose changed nothing (`test1` was a one-pose move). Confirmed on the robot: the firmware plays skills fine (Wave log: shoulder 132→140→90). **Fix:** taught moves start with a "get ready" step (all joints to the start pose).
- Bug: faster/slower seemed to do nothing. They only changed the last step. **Fix:** they change the whole move, or the whole combo.
- Missing: playing a combo before saving. **Added:** Play combo, Faster, Slower (buttons, and "play it"/"faster"/"slower" while a combo is being built).
- Note: `test1` on the robot was made before the fix and has no get-ready step. Delete it and teach it again.
- The robot was left in E-STOP (app STOP) at the end of the session. Release it from the app with the robot in view.

