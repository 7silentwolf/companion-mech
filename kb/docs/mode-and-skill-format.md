# Mode, Skill and Training File Formats (draft v0.1)

Draft only. Final format depends on the motor architecture. The robot's firmware should only interpret these files, validate them, and enforce limits itself even if the app already validated them.

## Folder layout on robot storage
```
/modes/friendly.json
/modes/gaming.json
/skills/wave.json
/skills/dance_basic.json
/training/robot_profile.json
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

## Training record
```json
{
  "robot_id": "robot-001",
  "skills": {
    "wave": { "level": 2, "best_score": 82, "param_version": 3 }
  },
  "stats": { "speed": 3, "agility": 2, "intelligence": 1 }
}
```
Rules: training can improve skill parameters and stats only inside safe limits, never raise physical power past competition class limits, and the same files work in competitions (no pay-to-win).
