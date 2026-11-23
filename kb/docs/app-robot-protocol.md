# App ↔ Robot Protocol (v1)

How the phone app talks to the robot. Implemented by `app/src/lib/robot.tsx` (app), `firmware/mechakin_robot` (ESP32) and `tools/mock-robot` (test robot).

## Transport
- WebSocket, plain `ws://<robot-ip>:81`, JSON text messages.
- Robot joins your Wi-Fi (from `wifi_config.h`) and prints its IP on the serial monitor. If it can't, it makes a hotspot `MechaKin-001` (password `mechakin123`) at `192.168.4.1`.
- Any message may carry `"id"`. The robot then answers with `{"type":"ack","id":..,"ok":true}` or `{"ok":false,"error":"..."}`.

## Safety rules (robot side, always)
- Joint angles clamped to the profile's `min_angle`/`max_angle`, and those to 0-180.
- Speed per joint never above `max_speed_dps × mode.max_speed_pct`. Profile speed is capped at 400 °/s.
- E-STOP (app message or physical button on GPIO27) turns all servo outputs off (limp) and blocks every move until `estop_release`. Release is refused while the button is held.
- Connection loss: if the last app disconnects, or the app goes quiet for 3 s while a skill plays, the robot stops and holds position. The app pings every 1 s.
- Uploads: only `/modes/`, `/skills/`, `/training/`, `/config/` + `name.json` (a-z 0-9 _ -), at most 16 KB, must be valid JSON.

## App → robot
| type | fields | what it does |
|---|---|---|
| `hello` | `app`, `proto` | Robot replies with `hello` + `status` |
| `ping` / `get_status` | | Robot replies with `status` (also the heartbeat) |
| `estop` | | Emergency stop, motors limp |
| `estop_release` | | Leave E-STOP, hold current angles |
| `stop` | | Stop the skill, hold position |
| `set_joint` | `joint`, `angle` | Move one joint (speed-limited). Stops any skill |
| `play` | `skill` (skill JSON) | Play a skill sent inline (editor/testing). Limits apply; mode allow-list does not |
| `play_saved` | `skill_id` | Play `/skills/<id>.json` from storage. Must be in the mode's `allowed_skills` |
| `put_file` | `path`, `content` (JSON as a string) | Save a file. `/config/mech_profile.json` takes effect at once |
| `delete_file` | `path` | Delete a file |
| `list_files` | | Ack carries `files: [{path, size}]` |
| `set_mode` | `mode_id` | Load `/modes/<id>.json` (speed limit, allowed skills) |

## Robot → app
| type | fields |
|---|---|
| `hello` | `robot_id`, `fw`, `proto`, `joints` (names) |
| `status` | `state` (`idle`/`playing`/`estop`), `mode`, `skill`, `angles` {joint: deg}, `estop_button` |
| `ack` | `id`, `ok`, `error?`, (`files` for list_files) |
| `done` | `skill_id`: skill finished all repeats |
| `event` | `name` (e.g. `estop_button`) |
| `error` | `error`: for messages without `id` |

`status` is sent on every change, in reply to each ping, and every 200 ms while playing.

## Example session
```
app  → {"type":"hello","app":"mechakin","proto":1,"id":1}
robot→ {"type":"hello","robot_id":"robot-001","fw":"0.1.0","proto":1,"joints":["head","right_shoulder","right_elbow"]}
robot→ {"type":"status","state":"idle","mode":"friendly","skill":null,"angles":{"head":90,...},"estop_button":false}
robot→ {"type":"ack","id":1,"ok":true}
app  → {"type":"put_file","path":"/skills/wave.json","content":"{\"skill_id\":\"wave\",...}","id":2}
app  → {"type":"play_saved","skill_id":"wave","id":3}
robot→ {"type":"done","skill_id":"wave"}
```

## Later (trial 1 split into two boards)
When the ESP32-S3 (Wi-Fi, display, audio, storage) and regular ESP32 (servos) split, the S3 keeps this protocol to the phone and forwards movement commands to the movement controller over UART. The movement controller keeps the same safety rules.
