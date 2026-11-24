# Wiring and pin numbers

Pin numbers are suggestions. Check them against your own boards' pinout diagrams before wiring, because the labels printed on the board are what matter. Power off while connecting. Never power servos from the ESP32 pins. Join all grounds.

## Stage A: movement board wiring (regular ESP32 + PCA9685)

These pins are also the movement board's pins in Stage B: `firmware/mechakin_movement` (PIN_SDA 21, PIN_SCL 22, PIN_ESTOP 27). The single-board firmware was replaced by the two-board one.

| From (ESP32) | To | Note |
|---|---|---|
| 3V3 | PCA9685 VCC | logic power |
| GND | PCA9685 GND | shared ground |
| GPIO21 | PCA9685 SDA | I2C data |
| GPIO22 | PCA9685 SCL | I2C clock |
| GPIO27 | Stop button leg 1 | other leg to GND, no resistor (internal pull-up) |
| GND | Stop button leg 2 | |

Servo power (not from the ESP32):
- 5V adapter + to the PCA9685 screw terminal V+
- 5V adapter - to the screw terminal GND
- 470-1000uF capacitor across V+ and GND (long leg +, stripe marks -)
- Servos on channels 0 (head), 1 (right shoulder), 2 (right elbow)

Optional, not used by the firmware yet: PCA9685 OE pin to GPIO4. Driving OE high disables all servo outputs, giving a hardware-level stop. Add it later if wanted.

## Stage B: later split into two controllers

Movement ESP32 (regular ESP32 + PCA9685) keeps the Stage A wiring and adds the UART link. If the movement board is a WROVER module, GPIO16/17 are used for memory, so pick different UART pins.

| Movement ESP32 | ESP32-S3 | Note |
|---|---|---|
| GPIO16 (RX) | GPIO17 (TX) | crossed |
| GPIO17 (TX) | GPIO18 (RX) | crossed |
| GND | GND | shared ground |

Both boards use 3.3V signals, so no level shifter is needed.

## ESP32-S3 comms side (Stage B)

| Part | Part pin | S3 pin |
|---|---|---|
| Display (1.8 in SPI) | VCC | 3V3 |
| Display | GND | GND |
| Display | SCK | GPIO12 |
| Display | MOSI (SDA) | GPIO11 |
| Display | CS | GPIO10 |
| Display | DC | GPIO9 |
| Display | RST | GPIO8 |
| I2S amp (MAX98357A) | VIN | 5V |
| I2S amp | GND | GND |
| I2S amp | BCLK | GPIO5 |
| I2S amp | LRC | GPIO6 |
| I2S amp | DIN | GPIO7 |
| SD card | SCK | GPIO12 (shared with display) |
| SD card | MOSI | GPIO11 (shared with display) |
| SD card | MISO | GPIO14 |
| SD card | CS | GPIO13 |
| SD card | VCC, GND | 3V3 (or 5V if the module needs it), GND |

Notes:
- Display backlight: connect the display's LED / BL / BLK pin to 3V3, or the screen stays dark. (It isn't in the table above.)
- Display pin names differ between modules. On ours **A0 = DC** (→ GPIO9), SDA = MOSI, SCL = SCK, RES = RST. If A0 isn't connected, the screen shows only grainy static. "SDA" on many displays means MOSI, and some call CS "CE".
- The speaker (3W, 4 ohm) connects to the amp's output terminals. Keep speaker wires away from servo wires to reduce noise.
- Wire the SD card and display on the shared SPI lines one at a time, and test each before adding the next.

## Assembly order
1. Movement ESP32 + PCA9685 + one servo (no horn), then servos 2 and 3.
2. Stop button, then confirm it stops the servos.
3. ESP32-S3 alone: Wi-Fi connects and prints its IP.
4. UART link between the two boards (Stage B).
5. Display, then speaker, then SD card, one at a time.
6. Cardboard arm mock-up: head and shoulder/elbow, test a wave.
