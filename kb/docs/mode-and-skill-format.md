# Mode, Skill and Training File Formats (draft v0.2)

Draft only. Final format depends on the motor architecture. The robot's firmware should only interpret these files, validate them, and enforce limits itself even if the app already validated them.

## Folder layout on robot storage
```
/modes/friendly.json
/modes/gaming.json
/skills/wave.json
/skills/dance_basic.json
/training/robot_profile.json
/config/mech_profile.json   (digital twin: joints and limits)
/sounds/ (SD card)
```

## Mode file
```json
{
  "mode_id": "friendly",
  "version": 1,
  "name": "Friendly Mode",
  "limits": { "max_speed_pct": 60, "max_accel_pct": 50 },
  "idle_skill": "nod",
  "allowed_skills": ["wave", "nod", "dance_basic"],
  "display": { "eyes": "happy" },
  "sounds": { "greeting": "hello.wav" }
}
```

## Skill file
```json
{
  "skill_id": "wave",
  "version": 3,
  "duration_ms": 2000,
  "steps": [
    { "joint": "right_shoulder", "target_angle": 120, "duration_ms": 500 },
    { "joint": "right_elbow", "target_angle": 60, "duration_ms": 300 }
  ]
}
```
Must support: simultaneous motors, timing, speed/acceleration, transitions, repeats, cancel, status reporting.

v0.2 additions (implemented in the app and firmware):
- Steps run one after another. `"with_previous": true` starts a step together with the previous one (simultaneous motors).
- `"repeat": 2` plays the step list twice (1-10).
- Optional `"name"` and `"stat"` (`speed` / `agility` / `intelligence`: the stat this skill trains).
- Limits per step: 50-10000 ms, at most 64 steps, whole skill at most 60 s.
- Speed = angle change / duration. It must stay under the joint's `max_speed_dps` × the mode's `max_speed_pct`.
- Cancel = `stop` / `estop` message; status = `status` messages (see `app-robot-protocol.md`).
- Acceleration (`max_accel_pct`) is stored but not used yet. Moves are constant-speed.

## Mechanical profile (digital twin)
```json
{
  "profile_id": "trial1",
  "version": 1,
  "joints": [
    { "name": "head", "channel": 0, "min_angle": 30, "max_angle": 150, "home_angle": 90, "max_speed_dps": 200, "enabled": true }
  ]
}
```
`channel` is the PCA9685 output. `enabled: false` = not wired yet. Calibrate min/max on the real servo (Setup tab in the app).

## Training record (`/training/robot_profile.json`)
```json
{
  "robot_id": "robot-001",
  "skills": {
    "wave": { "level": 2, "best_score": 82, "param_version": 3 }
  },
  "stats": { "speed": 3, "agility": 2, "intelligence": 1 }
}
```
The app also keeps `xp` and `sessions` per skill. Level = 1 + xp/250, max 10. A stat goes up by 1 (max 10) when a skill that trains it levels up.

How the app trains (v0.2): the child plays a skill and rates it 1-5 stars (score = stars × 20). At 60+ the skill gets 5% faster and 3% bigger, and never ends up slower overall. Below 60 it gets 5% slower. Every result goes through the same limit check and auto-fix, so training can't go past joint or mode limits. When the steps change, the skill `version` and `param_version` go up.

Rules: training can improve skill parameters and stats only inside safe limits, never raise physical power past competition class limits, and the same files work in competitions (no pay-to-win).
