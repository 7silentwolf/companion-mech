# MechaKin app (trial 1)

The phone is the robot's brain and microphone. This app connects to the robot over Wi-Fi and does everything from the KB's trial-1 loop:
**phone app → robot → modes from storage → training that changes saved data.**

| Tab | What it does |
|---|---|
| **Robot** | Connect, pick a mode, talk to the robot (type, or dictate with the keyboard mic), quick-play skills, display (eyes) test, movement-board warning, sync files to the robot, log |
| **Teach** | Teach a move with words or buttons ("raise right hand", "a bit lower", "good", "faster", "play it", "save as jab"), fine-tune sliders, and combos ("combo jab jab cross"). No AI: fixed words, works offline |
| **Skills** | Skill library. Editor: steps, simultaneous moves, repeat, limit check, auto-fix, play, upload, JSON import/export |
| **Train** | Practice a skill, rate it 1-5 stars. The skill is tuned within safe limits, level/XP/stats update and get saved to the robot |
| **Setup** | Digital twin: joints, channels, min/home/max, speed, calibration test buttons. Mode speed limits, eyes and allowed skills. Robot Wi-Fi. Robot ID |

The red **STOP** button floats over every screen.

## Run it on your Android phone (no Android Studio needed)
1. Install **Node.js 22 or newer** (https://nodejs.org) on your laptop.
   (On this laptop Node is already installed in `~/.local/node`. Run `export PATH=~/.local/node/current/bin:$PATH` first.)
2. Install **Expo Go** from the Play Store on your phone.
3. Put the laptop and phone on the **same Wi-Fi**.
4. In this folder:
   ```
   npm install
   npx expo start
   ```
5. Scan the QR code with Expo Go. Save a file on the laptop and the app reloads.

If the QR code won't connect, try `npx expo start --tunnel`.

## Try it without the robot
```
cd ../tools/mock-robot
npm install
npm start
```
It prints the laptop's IP. In the app's Robot tab, enter that IP and port **8081**, then Connect. Uploaded files land in `tools/mock-robot/robot-storage/`.
`npm run smoke` runs an automatic protocol test against it.

## With the real robot
Flash both boards (see `../firmware/README.md`). The S3's serial monitor and display show the robot's IP. Enter it with port **81**. First time: tap **Sync everything to robot**.
To see the movement-board warning against the mock, run `MOVEMENT_DOWN=1 npm start`.

## Checks
```
npm test          # engine tests: validation, timeline, training, commands
npm run typecheck
```

## Code map
- `src/app/`: screens (Expo Router). `(tabs)/` holds the five tabs (Robot, Teach, Skills, Train, Setup), `skill/[id].tsx` the skill editor
- `src/lib/teach.ts`: Teach mode: word understanding, pose corrections, undo, faster/slower, saving moves and combos (unit-tested in `teach.test.ts`)
- `src/lib/engine.ts`: pure logic (validation against the digital twin, timeline, auto-fix, training, command parsing), unit-tested
- `src/lib/robot.tsx`: WebSocket client, acks, heartbeat, E-STOP
- `src/lib/store.tsx`: app data saved on the phone (AsyncStorage)
- `src/lib/defaults.ts`: starting profile (head + right arm, left arm disabled), skills (wave, nod, dance) and modes (friendly, gaming)

## Known limits (v0.1)
- Voice uses the keyboard's dictation and simple keyword matching (wave/hello, nod/yes, dance, stop, "gaming mode"; Teach-mode words in `src/lib/teach.ts`). Cloud AI action generation comes later.
- Combos are copies: editing a move later doesn't update combos that used it.
- Robot speed is constant within a move (no acceleration curves yet).
- Display shows eyes + status only. No sound yet (no speaker in the first test).
- A standalone APK build (outside Expo Go) needs cleartext `ws://` allowed. Add `expo-build-properties` with `android.usesCleartextTraffic: true` when you get there.
