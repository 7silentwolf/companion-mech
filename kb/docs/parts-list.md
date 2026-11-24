# Parts List (updated 2026-11-25)
Prices are rough estimates. Search terms work on Amazon.in or Robu.in.

## Bought for trial 1
- Jumper wire ribbon, capacitors, 3 micro servos
- Servo driver board (PCA9685 style), I2S amplifier board, 1.8 inch TFT display (128x160)
- 2 ESP32 boards, confirmed 2026-11-24: **ESP32-S3** with 8 MB embedded PSRAM, CH343 USB chip (comms), and a **regular ESP32** with CP2102 USB chip (movement)
- USB data cables for both boards (working, both flashed)
- Stop button, wired to the movement board

## Still check or buy (from photo review)
1. 5V 3A power adapter + DC jack screw terminal (needed before servo test; servos must not run from ESP32 pins)
2. 3W 4 ohm speaker (not in hand yet; first test runs without sound)
3. microSD module + 16GB card (not in hand yet; first test uses the S3's flash)
4. Breadboard
5. Optional spare servos
6. Soldering iron/solder if headers are loose in the bags (or ask the shop)

## Checks
- Capacitor value (470-1000uF, 16V+)
- Amp listing/chip: MAX98357A, I2S, 3W Class D
- Never power servos from the ESP32 pins; join all grounds

## Decision log
- Amplifier: MAX98357A (digital I2S) over PAM8403 (analog; ESP32-S3 has no DAC).
- No on-robot microphone for now.
