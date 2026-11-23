# Parts List (updated 2026-11-23)
Prices are rough estimates. Search terms work on Amazon.in or Robu.in.

## Bought for trial 1
- Jumper wire ribbon, capacitors, 3 micro servos
- Servo driver board (PCA9685 style), I2S amplifier board, 1.8 inch TFT display (128x160)
- 2 ESP32-type boards (confirm one is ESP32-S3 and one regular ESP32; if both are regular ESP32 the plan still works for the first test)

## Still check or buy (from photo review)
1. 5V 3A power adapter + DC jack screw terminal (needed before servo test; servos must not run from ESP32 pins)
2. 3W 4 ohm speaker
3. microSD module + 16GB card
4. Breadboard
5. Push button (emergency stop)
6. USB data cables for both ESP32 boards (Micro-USB or USB-C as per board)
7. Optional spare servos
8. Soldering iron/solder if headers are loose in the bags (or ask the shop)

## Checks
- Capacitor value (470-1000uF, 16V+)
- Amp listing/chip: MAX98357A, I2S, 3W Class D
- Never power servos from the ESP32 pins; join all grounds

## Decision log
- Amplifier: MAX98357A (digital I2S) over PAM8403 (analog; ESP32-S3 has no DAC).
- No on-robot microphone for now.
