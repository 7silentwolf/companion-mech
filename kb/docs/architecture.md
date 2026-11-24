# Architecture (rrr + MechaKin)

## Layers
Smartphone app (voice, AI, action generation, validation, training, creature profiles, competitions)
-> Wi-Fi / WebSocket
-> Communication controller (ESP32-S3): Wi-Fi, display, audio, status
-> Movement controller (ESP32 or RP2040): motor execution, limits, e-stop
-> Servo driver (PCA9685) -> motors/body
Optional: safety controller monitoring current, temperature, stalls.

## Principles
1. AI processing mainly on the smartphone; local AI for simple commands, cloud AI for creative requests.
2. Communication and motor execution are separate responsibilities.
3. Movement controller runs an approved sequence independently and enforces joint, speed and acceleration limits itself.
4. Robot dimensions and joint limits live in the app as a "digital twin" (mechanical profile), calibrated against real hardware.
5. AI outputs a structured JSON movement format, never raw firmware code. All sequences are validated (limits, collisions) before execution.
6. Emergency stop overrides everything; safe behaviour on connection loss.
7. Saved actions work offline.

## Example movement instruction
```json
{
  "action_id": "dance_001",
  "action_name": "funny_dance",
  "duration_ms": 8000,
  "steps": [
    {"joint": "left_shoulder", "target_angle": 120, "duration_ms": 500},
    {"joint": "right_shoulder", "target_angle": 60, "duration_ms": 500}
  ]
}
```
Format should support simultaneous motors, timing, speed/acceleration, transitions, repeats, cancel, and status.

## Initial hardware (from rrr concept)
ESP32-S3 comms; separate ESP32/RP2040 movement; PCA9685 servo driver; metal-gear servos; colour TFT; small speaker+amp; MEMS mic; Wi-Fi; separate regulated motor and logic power. First build: head + two shoulders + two elbows (5 DOF).

## Trial 1 as built (2026-11-25)
- Phone: Expo app (`../app`). It validates every skill against the digital twin before sending, and has a STOP button on every screen.
- ESP32-S3 comms (`../firmware/mechakin_comms`): Wi-Fi (saved on the board, setup hotspot + QR), WebSocket server on port 81, LittleFS storage for modes/skills/profile/training, ST7735 face display, forwards moves over UART.
- ESP32 movement (`../firmware/mechakin_movement`): PCA9685 servos, joint + speed limits, stop button, stops on link silence. Testable alone by typing JSON into its serial monitor.
- Link: UART 115200, one JSON message per line (`app-robot-protocol.md`).
- Not yet: speaker/audio, microSD, cloud AI, acceleration curves.

## Applying to creatures
One mechanical profile per creature, shared controller platform, swappable bodies and personalities. Creatures need not share identical mechanics.
