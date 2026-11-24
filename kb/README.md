# MechaKin Knowledge Base (v2)

Working name: **MechaKin** (alternatives: Capsoids, BytePals, Zorix, Kinbotz). Check trademark availability with IP India before committing.

## Goal
A physical robotic-creature ecosystem for kids under 18 in India. A child buys a sealed mystery capsule, discovers an original robotic creature, bonds with it, trains it through a phone app, and enters friendly (non-destructive) competitions. Revenue: robots, capsules, parts/accessories, events, sponsorships, media.

## Technology backbone ("rrr")
Smartphone = AI brain and microphone. Robot = execution layer with low-cost controllers. AI never drives motors directly: request -> AI -> validated movement sequence -> movement controller. Modes (friendly, gaming...) are data files loaded from storage, not code. Training happens in the app and its results are saved to the robot as data.

## Status (2026-11-25)
Idea stage. No company yet. Trial-1 hardware is wired as the two-board layout in `docs/wiring-pins.md` (ESP32-S3 comms + display, regular ESP32 movement + PCA9685 + 3 servos + stop button). No speaker or SD card yet.
- Firmware for both boards compiles, is flashed, and the UART link between them works.
- The display shows a face (eyes with pupils, mouth, colour per mode), plus QR codes for Wi-Fi setup.
- The robot's Wi-Fi is set without re-flashing (setup hotspot page or app).
- Mobile app v0.1 (Expo) is ready. Next: save the home Wi-Fi on the robot, connect the app, and test sliders, skills, STOP and training on the real servos.

## Contents
- `docs/trial-1-plan.md` - what trial 1 includes and build order
- `docs/step-1-servo-test.md` - wiring and code for the first servo test
- `docs/mode-and-skill-format.md` - mode, skill, profile and training file formats
- `docs/app-robot-protocol.md` - WebSocket messages between app and robot, and the UART link between the boards
- `docs/dev-setup.md` - laptop tools, which board is on which port, build/flash/run commands, gotchas
- `docs/wiring-pins.html` / `wiring-pins.md` - pin-by-pin wiring for both boards, display, PCA9685, stop button (open the HTML in a browser)
- `docs/architecture.md` - combined technical architecture
- `docs/product-concept.md` - capsule, creatures, competitions, revenue
- `docs/business-ip-safety.md` - IP, child safety, compliance, costs, risks
- `docs/parts-list.md` - parts bought and still-needed items
- `docs/decisions-and-next-steps.md` - decisions, open questions, log
- Code lives next to the KB: `../app` (mobile app), `../firmware` (both boards), `../tools` (mock robot, QR generator)
- `sources/` - add the original PDFs here (Pokemon_IP_Protection.pdf, rrr.pdf)

## Caveat
Costs, BIS standards, pin mappings and legal points are unverified. Confirm with suppliers, datasheets, BIS and an Indian IP lawyer.
