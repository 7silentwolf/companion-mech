# App ↔ Robot Protocol (v1)

How the phone app talks to the robot. Implemented by `app/src/lib/robot.tsx` (app), `firmware/mechakin_comms` (ESP32-S3, talks to the app), `firmware/mechakin_movement` (ESP32, servos) and `tools/mock-robot` (test robot).

## Transport
- WebSocket, plain `ws://<robot-ip>:81`, JSON text messages.
- The robot joins the Wi-Fi saved in its flash and shows its IP on the display and serial monitor. With none saved, or if it can't join, it opens setup hotspot `MechaKin-001` (password `mechakin123`) at `192.168.4.1`: a web setup page on port 80, and this protocol still works on port 81. Holding the S3's BOOT button for 3 s forgets the saved Wi-Fi.
- Any message may carry `"id"`. The robot then answers with `{"type":"ack","id":..,"ok":true}` or `{"ok":false,"error":"..."}`.

## Safety rules (robot side, always)
- Joint angles clamped to the profile's `min_angle`/`max_angle`, and those to 0-180.
- Speed per joint never above `max_speed_dps × mode.max_speed_pct`. Profile speed is capped at 400 °/s.
- E-STOP (app message or physical button on the movement board's GPIO27) turns all servo outputs off (limp) and blocks every move until `estop_release`. Release is refused while the button is held.
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
| `set_mode` | `mode_id` | Load `/modes/<id>.json` (speed limit, allowed skills, eyes) |
| `get_wifi` | | Ack carries `ssid`, `connected`, `setup_mode`, `ip` |
| `set_wifi` | `ssid`, `pass` | Save new Wi-Fi (name 1-32 chars, password empty or 8-63), then the robot restarts and joins it |
| `set_eyes` | `eyes` | Show an eye style on the display until the next mode change (`happy`, `normal`, `focused`, `sad`, `sleepy`) |

## Robot → app
| type | fields |
|---|---|
| `hello` | `robot_id`, `fw`, `movement_fw`, `wifi` (network name, '' in setup mode), `proto`, `joints` (names) |
| `status` | `state` (`idle`/`playing`/`estop`), `mode`, `skill`, `angles` {joint: deg}, `estop_button`, `movement_ok`, `eyes` |
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

## Movement link (S3 ↔ movement ESP32, UART 115200, one JSON message per line)
The S3 keeps the app protocol above and owns storage and modes. It forwards `estop`, `estop_release`, `stop`, `set_joint` and `play` to the movement board (`play_saved` becomes `play` with the skill read from flash). It swaps app ids for its own link ids and relays the movement board's ack back to the app (2 s timeout).

S3 → movement, in addition to the forwarded messages:
| type | fields | |
|---|---|---|
| `hello` | | Movement replies `hello` {`fw`, `joints`} + `status` |
| `ping` | | Every 500 ms. Movement replies `status`. 1.5 s of silence stops a playing move |
| `set_speed` | `pct` | Mode speed limit (movement default 60% until set) |
| `set_profile` | `profile` | Joint limits. Movement saves its own copy to flash |

Movement → S3: `status` (on change, every 200 ms while playing, and per ping), `ack`, `done`, `event`, `error`, `hello` (also sent on boot, and the S3 then re-sends the profile and speed). The S3 adds `mode`, `movement_ok` and `eyes` before passing `status` to the app.

You can type these lines into the movement board's USB Serial Monitor to test it without the S3.
