# companion-mech

Working name: **MechaKin**: a physical robotic-creature ecosystem for kids in India (mystery capsule → bond → train via phone app → friendly competitions).

## Repository layout
- [`kb/`](kb/README.md): knowledge base: product concept, architecture, trial plans, parts, IP/safety notes, protocol, decisions log.
- [`app/`](app/README.md): mobile app (Expo / React Native). Connect, E-STOP, joint control, skills, modes, training.
- [`firmware/`](firmware/README.md): trial-1 firmware: ESP32-S3 comms (Wi-Fi, display) + ESP32 movement (PCA9685, stop button).
- [`tools/mock-robot/`](tools/mock-robot/mock-robot.mjs): fake robot to test the app without hardware.

## Start here
1. Wire and run the one-servo test: `kb/docs/step-1-servo-test.md`
2. Run the app on your phone against the mock robot: `app/README.md`
3. Flash both boards (`firmware/README.md` test order) and drive the real servos from the app
