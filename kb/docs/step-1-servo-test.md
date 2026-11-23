# Step 1: Move one servo (regular ESP32 + PCA9685)

## Wiring (power off while connecting)
ESP32 -> PCA9685 signal:
- 3V3 -> VCC
- GND -> GND
- GPIO21 -> SDA
- GPIO22 -> SCL

Servo power (NOT from the ESP32):
- 5V adapter + -> PCA9685 screw terminal V+
- 5V adapter - -> screw terminal GND
- Capacitor across V+ and GND (long leg +, stripe marks -)
- Shared ground with the ESP32 via the GND signal wire above

Servo: plug into channel 0 (brown/black = GND, red = middle, orange/yellow = signal). Match the colours to the pin labels.
Power the ESP32 from USB and the servos from the adapter.

## Software
1. Install Arduino IDE.
2. Boards Manager: install "esp32 by Espressif", select ESP32 Dev Module.
3. Library Manager: install "Adafruit PWM Servo Driver Library".
4. Upload:

```cpp
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

#define SERVOMIN 150   // conservative limits, adjust later
#define SERVOMAX 450

void setAngle(int ch, int angle) {
  int pulse = map(angle, 0, 180, SERVOMIN, SERVOMAX);
  pwm.setPWM(ch, 0, pulse);
}

void setup() {
  Wire.begin(21, 22);
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  delay(10);
  setAngle(0, 90);
  delay(1500);
}

void loop() {
  setAngle(0, 45);  delay(1000);
  setAngle(0, 135); delay(1000);
  setAngle(0, 90);  delay(1000);
}
```

## Safety and troubleshooting
- First run without the servo horn attached; fit it after the servo centres at 90 degrees.
- Servo buzzing at the ends: narrow the limits (e.g. 170-430).
- ESP32 resets or servo jitters: usually power. Check adapter, shared grounds, capacitor.
- Unplug the adapter before changing wiring.

## Next
Add servos 2 and 3 on channels 1 and 2, then a stop button, then a simple wave.
