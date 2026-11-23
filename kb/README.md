# MechaKin Knowledge Base (v2)

Working name: **MechaKin** (alternatives: Capsoids, BytePals, Zorix, Kinbotz). Check trademark availability with IP India before committing.

## Goal
A physical robotic-creature ecosystem for kids under 18 in India. A child buys a sealed mystery capsule, discovers an original robotic creature, bonds with it, trains it through a phone app, and enters friendly (non-destructive) competitions. Revenue: robots, capsules, parts/accessories, events, sponsorships, media.

## Technology backbone ("rrr")
Smartphone = AI brain and microphone. Robot = execution layer with low-cost controllers. AI never drives motors directly: request -> AI -> validated movement sequence -> movement controller. Modes (friendly, gaming...) are data files loaded from storage, not code. Training happens in the app and its results are saved to the robot as data.

## Status (2026-11-23)
Idea stage. No company yet. All parts for trial 1 have been bought. Current step: Step 1, one servo moving via ESP32 + PCA9685.

## Contents
- `docs/trial-1-plan.md` - what trial 1 includes and build order
- `docs/step-1-servo-test.md` - wiring and code for the first servo test
- `docs/mode-and-skill-format.md` - mode, skill, profile and training file formats
- `docs/app-robot-protocol.md` - WebSocket messages between app and robot
- `docs/architecture.md` - combined technical architecture
- `docs/product-concept.md` - capsule, creatures, competitions, revenue
- `docs/business-ip-safety.md` - IP, child safety, compliance, costs, risks
- `docs/parts-list.md` - parts bought and still-needed items
- `docs/decisions-and-next-steps.md` - decisions, open questions, log
- `sources/` - add the original PDFs here (Pokemon_IP_Protection.pdf, rrr.pdf)

## Caveat
Costs, BIS standards, pin mappings and legal points are unverified. Confirm with suppliers, datasheets, BIS and an Indian IP lawyer.
