// MechaKin trial-1 robot firmware (single regular ESP32 + PCA9685).
// Covers build-order steps 1-3 from kb/docs/trial-1-plan.md:
//   servos with limits + e-stop, movement files from storage, phone app over Wi-Fi/WebSocket.
// Protocol: kb/docs/app-robot-protocol.md   File formats: kb/docs/mode-and-skill-format.md
//
// Libraries (Arduino Library Manager):
//   - Adafruit PWM Servo Driver Library (Adafruit)
//   - WebSockets (Markus Sattler)
//   - ArduinoJson (Benoit Blanchon), version 7.x
// Board: "ESP32 Dev Module" from "esp32 by Espressif".
//
// Wi-Fi: copy wifi_config.example.h to wifi_config.h and fill in your network.
// Without wifi_config.h the robot makes its own hotspot "MechaKin-001".
//
// SAFETY: the firmware enforces joint limits, speed limits and e-stop itself,
// even though the app validates everything first. Never power servos from the ESP32.

#include <Wire.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <Adafruit_PWMServoDriver.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

#if __has_include("wifi_config.h")
#include "wifi_config.h"
#endif
#ifndef WIFI_SSID
#define WIFI_SSID ""
#define WIFI_PASS ""
#endif

// ---------------- Settings ----------------
#define FW_VERSION "0.1.0"
#define PROTO_VERSION 1
#define AP_SSID "MechaKin-001"
#define AP_PASS "mechakin123"  // at least 8 characters
#define WS_PORT 81

#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_ESTOP 27  // push button between GPIO27 and GND

#define SERVOMIN 150  // PCA9685 pulse at 0 degrees (same as step 1 test)
#define SERVOMAX 450  // pulse at 180 degrees; narrow if servos buzz at the ends

#define HARD_MIN_ANGLE 0
#define HARD_MAX_ANGLE 180
#define HARD_MAX_DPS 400.0f
#define MAX_JOINTS 16
#define MAX_SEGMENTS 64
#define MAX_ALLOWED 24
#define MAX_FILE_BYTES 16384
#define TICK_MS 20
#define HEARTBEAT_LIMIT_MS 3000
#define STATUS_EVERY_MS 200

// ---------------- State ----------------
struct Joint {
  char name[24];
  uint8_t channel;
  float minA, maxA, homeA, maxDps;
};

struct Segment {
  uint8_t joint;
  uint32_t start, dur;
  float to;
  bool begun;
};

enum RunState { RUN_IDLE, RUN_PLAYING, RUN_ESTOP };

Adafruit_PWMServoDriver pwm(0x40);
WebSocketsServer ws(WS_PORT);

Joint joints[MAX_JOINTS];
int jointCount = 0;
float angleNow[MAX_JOINTS];
float targetA[MAX_JOINTS];
float moveDps[MAX_JOINTS];
bool limp[MAX_JOINTS];

Segment segs[MAX_SEGMENTS];
int segCount = 0;
uint32_t passMs = 0, passStart = 0;
uint8_t repeatN = 1, passIdx = 0;
char skillId[33] = "";

RunState runState = RUN_IDLE;
char robotId[33] = "robot-001";
char modeId[24] = "friendly";
float modeSpeedPct = 60;
char allowed[MAX_ALLOWED][33];
int allowedCount = -1;  // -1 = no list loaded, everything allowed

int clientCount = 0;
uint32_t lastHeard = 0, lastTick = 0, lastStatus = 0;
bool buttonDown = false;
uint32_t buttonChangedAt = 0;

// ---------------- Helpers ----------------
static float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

int jointIndex(const char *name) {
  if (!name) return -1;
  for (int i = 0; i < jointCount; i++)
    if (strcmp(joints[i].name, name) == 0) return i;
  return -1;
}

float jointLimitDps(int i) { return joints[i].maxDps * clampf(modeSpeedPct, 1, 100) / 100.0f; }

void writeServo(int i) {
  if (limp[i]) {
    pwm.setPin(joints[i].channel, 0);  // full off: servo goes limp
    return;
  }
  float a = clampf(angleNow[i], joints[i].minA, joints[i].maxA);
  uint16_t pulse = SERVOMIN + (uint16_t)((SERVOMAX - SERVOMIN) * a / 180.0f);
  pwm.setPWM(joints[i].channel, 0, pulse);
}

void addJoint(const char *name, int ch, float minA, float maxA, float homeA, float dps) {
  if (jointCount >= MAX_JOINTS || ch < 0 || ch > 15) return;
  Joint &j = joints[jointCount];
  strlcpy(j.name, name, sizeof(j.name));
  j.channel = ch;
  j.minA = clampf(min(minA, maxA), HARD_MIN_ANGLE, HARD_MAX_ANGLE);
  j.maxA = clampf(max(minA, maxA), HARD_MIN_ANGLE, HARD_MAX_ANGLE);
  j.homeA = clampf(homeA, j.minA, j.maxA);
  j.maxDps = clampf(dps, 10, HARD_MAX_DPS);
  jointCount++;
}

void setDefaultProfile() {
  jointCount = 0;
  addJoint("head", 0, 30, 150, 90, 200);
  addJoint("right_shoulder", 1, 20, 160, 90, 200);
  addJoint("right_elbow", 2, 20, 160, 90, 200);
}

// ---------------- Storage ----------------
bool validPath(const char *p) {
  if (!p) return false;
  size_t n = strlen(p);
  if (n < 8 || n > 63) return false;
  const char *prefixes[] = {"/modes/", "/skills/", "/training/", "/config/"};
  const char *rest = nullptr;
  for (const char *pre : prefixes)
    if (strncmp(p, pre, strlen(pre)) == 0) rest = p + strlen(pre);
  if (!rest) return false;
  size_t rn = strlen(rest);
  if (rn < 6 || strcmp(rest + rn - 5, ".json") != 0) return false;
  for (size_t i = 0; i < rn - 5; i++) {
    char c = rest[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  }
  return true;
}

bool readJsonFile(const char *path, JsonDocument &doc) {
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  return !err;
}

bool applyProfile(JsonDocument &doc) {
  JsonArrayConst arr = doc["joints"].as<JsonArrayConst>();
  if (arr.isNull()) return false;
  int saved = jointCount;
  Joint backup[MAX_JOINTS];
  memcpy(backup, joints, sizeof(joints));
  jointCount = 0;
  for (JsonObjectConst j : arr) {
    if (!(j["enabled"] | true)) continue;
    // Float defaults matter: ArduinoJson returns the default if the type doesn't match.
    addJoint(j["name"] | "?", j["channel"] | -1, j["min_angle"] | 90.0f, j["max_angle"] | 90.0f, j["home_angle"] | 90.0f,
             j["max_speed_dps"] | 100.0f);
  }
  if (jointCount == 0) {  // refuse an empty profile, keep the old one
    memcpy(joints, backup, sizeof(joints));
    jointCount = saved;
    return false;
  }
  for (int i = 0; i < jointCount; i++) {
    angleNow[i] = joints[i].homeA;
    targetA[i] = joints[i].homeA;
    moveDps[i] = jointLimitDps(i);
    limp[i] = (runState == RUN_ESTOP);
  }
  return true;
}

bool loadMode(const char *id) {
  char path[64];
  snprintf(path, sizeof(path), "/modes/%s.json", id);
  JsonDocument doc;
  if (!validPath(path) || !readJsonFile(path, doc)) return false;
  strlcpy(modeId, id, sizeof(modeId));
  modeSpeedPct = clampf(doc["limits"]["max_speed_pct"] | 60.0f, 1, 100);
  JsonArrayConst list = doc["allowed_skills"].as<JsonArrayConst>();
  if (list.isNull()) {
    allowedCount = -1;
  } else {
    allowedCount = 0;
    for (JsonVariantConst v : list) {
      const char *s = v.as<const char *>();
      if (s && allowedCount < MAX_ALLOWED) strlcpy(allowed[allowedCount++], s, 33);
    }
  }
  return true;
}

bool skillAllowed(const char *id) {
  if (allowedCount < 0) return true;
  for (int i = 0; i < allowedCount; i++)
    if (strcmp(allowed[i], id) == 0) return true;
  return false;
}

// ---------------- Motion ----------------
void holdAll() {
  for (int i = 0; i < jointCount; i++) {
    targetA[i] = angleNow[i];
    limp[i] = false;
  }
}

void stopMotion() {
  segCount = 0;
  skillId[0] = 0;
  holdAll();
  if (runState == RUN_PLAYING) runState = RUN_IDLE;
}

void triggerEstop(const char *why) {
  segCount = 0;
  skillId[0] = 0;
  runState = RUN_ESTOP;
  for (int i = 0; i < jointCount; i++) {
    limp[i] = true;
    writeServo(i);
  }
  Serial.printf("E-STOP (%s)\n", why);
}

// Returns nullptr on success, or an error message.
const char *startSkill(JsonVariantConst skill, bool fromStorage) {
  if (runState == RUN_ESTOP) return "E-STOP active";
  JsonArrayConst steps = skill["steps"].as<JsonArrayConst>();
  if (steps.isNull() || steps.size() == 0) return "skill has no steps";
  if (steps.size() > (size_t)MAX_SEGMENTS) return "too many steps";
  const char *id = skill["skill_id"] | "inline";
  if (fromStorage && !skillAllowed(id)) return "skill not allowed in this mode";

  // Same timeline as the app: with_previous starts together with the previous step.
  Segment tmp[MAX_SEGMENTS];
  int n = 0;
  uint32_t cursor = 0, prevStart = 0;
  for (JsonObjectConst s : steps) {
    int j = jointIndex(s["joint"] | "");
    if (j < 0) return "unknown joint";
    uint32_t dur = (uint32_t)clampf(s["duration_ms"] | 500.0f, 50, 10000);
    uint32_t start = (n > 0 && (s["with_previous"] | false)) ? prevStart : cursor;
    tmp[n] = Segment{(uint8_t)j, start, dur, clampf(s["target_angle"] | joints[j].homeA, joints[j].minA, joints[j].maxA), false};
    prevStart = start;
    cursor = max(cursor, start + dur);
    n++;
  }
  memcpy(segs, tmp, sizeof(Segment) * n);
  segCount = n;
  passMs = cursor;
  repeatN = (uint8_t)clampf(skill["repeat"] | 1.0f, 1, 10);
  passIdx = 0;
  passStart = millis();
  strlcpy(skillId, id, sizeof(skillId));
  holdAll();
  runState = RUN_PLAYING;
  return nullptr;
}

void broadcastStatus();
void broadcastJson(JsonDocument &doc);

void motionTick(float dt) {
  if (runState == RUN_PLAYING) {
    uint32_t t = millis() - passStart;
    if (t >= passMs) {
      passIdx++;
      if (passIdx >= repeatN) {
        JsonDocument done;
        done["type"] = "done";
        done["skill_id"] = skillId;
        segCount = 0;
        skillId[0] = 0;
        runState = RUN_IDLE;
        broadcastJson(done);
        broadcastStatus();
      } else {
        passStart = millis();
        t = 0;
        for (int k = 0; k < segCount; k++) segs[k].begun = false;
      }
    }
    for (int k = 0; k < segCount; k++) {
      Segment &s = segs[k];
      if (!s.begun && t >= s.start) {
        s.begun = true;
        targetA[s.joint] = s.to;
        moveDps[s.joint] = fabsf(s.to - angleNow[s.joint]) / (s.dur / 1000.0f);
      }
    }
  }
  if (runState == RUN_ESTOP) return;
  // Move each joint toward its target, never faster than its limit.
  for (int i = 0; i < jointCount; i++) {
    if (limp[i]) continue;
    float dps = min(moveDps[i], jointLimitDps(i));
    float stepDeg = dps * dt;
    float diff = targetA[i] - angleNow[i];
    if (fabsf(diff) < 0.01f) continue;
    angleNow[i] = fabsf(diff) <= stepDeg ? targetA[i] : angleNow[i] + (diff > 0 ? stepDeg : -stepDeg);
    writeServo(i);
  }
}

// ---------------- Protocol ----------------
const char *stateName() { return runState == RUN_PLAYING ? "playing" : runState == RUN_ESTOP ? "estop" : "idle"; }

void fillStatus(JsonDocument &doc) {
  doc["type"] = "status";
  doc["state"] = stateName();
  doc["mode"] = modeId;
  if (skillId[0]) doc["skill"] = skillId;
  else doc["skill"] = nullptr;
  JsonObject a = doc["angles"].to<JsonObject>();
  for (int i = 0; i < jointCount; i++) a[joints[i].name] = (int)roundf(angleNow[i]);
  doc["estop_button"] = buttonDown;
}

void sendJson(uint8_t num, JsonDocument &doc) {
  String out;
  serializeJson(doc, out);
  ws.sendTXT(num, out);
}

void broadcastJson(JsonDocument &doc) {
  String out;
  serializeJson(doc, out);
  ws.broadcastTXT(out);
}

void sendStatus(uint8_t num) {
  JsonDocument doc;
  fillStatus(doc);
  sendJson(num, doc);
}

void broadcastStatus() {
  JsonDocument doc;
  fillStatus(doc);
  broadcastJson(doc);
}

void sendAck(uint8_t num, JsonVariantConst id, const char *error) {
  if (id.isNull()) {
    if (error) {
      JsonDocument doc;
      doc["type"] = "error";
      doc["error"] = error;
      sendJson(num, doc);
    }
    return;
  }
  JsonDocument doc;
  doc["type"] = "ack";
  doc["id"] = id;
  doc["ok"] = (error == nullptr);
  if (error) doc["error"] = error;
  sendJson(num, doc);
}

void listDir(const char *dir, JsonArray out) {
  File d = LittleFS.open(dir);
  if (!d || !d.isDirectory()) return;
  File f = d.openNextFile();
  while (f) {
    if (!f.isDirectory()) {
      JsonObject o = out.add<JsonObject>();
      String p = String(dir) + "/" + f.name();
      o["path"] = p;
      o["size"] = f.size();
    }
    f = d.openNextFile();
  }
}

const char *handlePutFile(const char *path, const char *content) {
  if (!validPath(path)) return "bad path";
  if (!content) return "missing content";
  size_t len = strlen(content);
  if (len > MAX_FILE_BYTES) return "file too large";
  JsonDocument parsed;
  if (deserializeJson(parsed, content)) return "content is not valid JSON";
  if (strcmp(path, "/config/mech_profile.json") == 0) {
    stopMotion();
    if (!applyProfile(parsed)) return "profile has no usable joints";
  }
  File f = LittleFS.open(path, "w", true);
  if (!f) return "cannot write file";
  size_t written = f.print(content);
  f.close();
  if (written != len) return "write failed (storage full?)";
  if (strcmp(path, "/training/robot_profile.json") == 0) {
    const char *rid = parsed["robot_id"].as<const char *>();
    if (rid) strlcpy(robotId, rid, sizeof(robotId));
  }
  char modePath[64];
  snprintf(modePath, sizeof(modePath), "/modes/%s.json", modeId);
  if (strcmp(path, modePath) == 0) loadMode(modeId);
  Serial.printf("saved %s (%u B)\n", path, (unsigned)len);
  return nullptr;
}

void handleMessage(uint8_t num, uint8_t *payload, size_t length) {
  lastHeard = millis();
  JsonDocument msg;
  if (deserializeJson(msg, payload, length)) {
    JsonDocument err;
    err["type"] = "error";
    err["error"] = "bad json";
    sendJson(num, err);
    return;
  }
  const char *type = msg["type"] | "";
  JsonVariantConst id = msg["id"];
  const char *error = nullptr;

  if (strcmp(type, "ping") == 0 || strcmp(type, "get_status") == 0) {
    sendStatus(num);
  } else if (strcmp(type, "hello") == 0) {
    JsonDocument h;
    h["type"] = "hello";
    h["robot_id"] = robotId;
    h["fw"] = FW_VERSION;
    h["proto"] = PROTO_VERSION;
    JsonArray names = h["joints"].to<JsonArray>();
    for (int i = 0; i < jointCount; i++) names.add(joints[i].name);
    sendJson(num, h);
    sendStatus(num);
  } else if (strcmp(type, "estop") == 0) {
    triggerEstop("app");
    broadcastStatus();
  } else if (strcmp(type, "estop_release") == 0) {
    if (buttonDown) error = "release the STOP button first";
    else if (runState == RUN_ESTOP) {
      runState = RUN_IDLE;
      holdAll();
      for (int i = 0; i < jointCount; i++) writeServo(i);
      broadcastStatus();
    }
  } else if (strcmp(type, "stop") == 0) {
    stopMotion();
    broadcastStatus();
  } else if (strcmp(type, "set_joint") == 0) {
    int j = jointIndex(msg["joint"] | "");
    if (runState == RUN_ESTOP) error = "E-STOP active";
    else if (j < 0) error = "unknown joint";
    else {
      if (runState == RUN_PLAYING) stopMotion();
      targetA[j] = clampf(msg["angle"] | angleNow[j], joints[j].minA, joints[j].maxA);
      moveDps[j] = jointLimitDps(j);
      limp[j] = false;
    }
  } else if (strcmp(type, "play") == 0) {
    error = startSkill(msg["skill"], false);
    if (!error) broadcastStatus();
  } else if (strcmp(type, "play_saved") == 0) {
    char path[64];
    snprintf(path, sizeof(path), "/skills/%s.json", (const char *)(msg["skill_id"] | ""));
    JsonDocument skill;
    if (!validPath(path) || !readJsonFile(path, skill)) error = "skill not found on robot";
    else {
      error = startSkill(skill.as<JsonVariantConst>(), true);
      if (!error) broadcastStatus();
    }
  } else if (strcmp(type, "put_file") == 0) {
    error = handlePutFile(msg["path"] | "", msg["content"].as<const char *>());
  } else if (strcmp(type, "delete_file") == 0) {
    const char *path = msg["path"] | "";
    if (!validPath(path)) error = "bad path";
    else LittleFS.remove(path);
  } else if (strcmp(type, "list_files") == 0) {
    if (!id.isNull()) {
      JsonDocument ack;
      ack["type"] = "ack";
      ack["id"] = id;
      ack["ok"] = true;
      JsonArray files = ack["files"].to<JsonArray>();
      listDir("/config", files);
      listDir("/modes", files);
      listDir("/skills", files);
      listDir("/training", files);
      sendJson(num, ack);
    }
    return;
  } else if (strcmp(type, "set_mode") == 0) {
    const char *m = msg["mode_id"] | "";
    if (!loadMode(m)) error = "mode not on robot, upload it first";
    else {
      Serial.printf("mode %s\n", modeId);
      broadcastStatus();
    }
  } else {
    error = "unknown message type";
  }
  sendAck(num, id, error);
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      clientCount++;
      lastHeard = millis();
      Serial.printf("app %u connected\n", num);
      break;
    case WStype_DISCONNECTED:
      if (clientCount > 0) clientCount--;
      Serial.printf("app %u disconnected\n", num);
      if (clientCount == 0 && runState == RUN_PLAYING) stopMotion();  // safe on connection loss
      break;
    case WStype_TEXT:
      handleMessage(num, payload, length);
      break;
    default:
      break;
  }
}

// ---------------- Setup / loop ----------------
void startWifi() {
  if (strlen(WIFI_SSID) > 0) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.printf("Joining Wi-Fi %s", WIFI_SSID);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
      delay(300);
      Serial.print('.');
    }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("Connected. Robot IP: %s  port %d\n", WiFi.localIP().toString().c_str(), WS_PORT);
      return;
    }
    Serial.println("Could not join Wi-Fi, starting hotspot instead");
  }
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.printf("Hotspot %s (password %s). Robot IP: %s  port %d\n", AP_SSID, AP_PASS, WiFi.softAPIP().toString().c_str(), WS_PORT);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nMechaKin firmware " FW_VERSION);
  pinMode(PIN_ESTOP, INPUT_PULLUP);

  Wire.begin(PIN_SDA, PIN_SCL);
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  delay(10);

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");

  setDefaultProfile();
  {
    JsonDocument doc;
    if (readJsonFile("/config/mech_profile.json", doc) && applyProfile(doc)) Serial.println("Loaded profile from storage");
  }
  {
    JsonDocument doc;
    const char *rid = readJsonFile("/training/robot_profile.json", doc) ? doc["robot_id"].as<const char *>() : nullptr;
    if (rid) strlcpy(robotId, rid, sizeof(robotId));
  }
  if (!loadMode("friendly")) Serial.println("No /modes/friendly.json yet, using 60% speed");

  for (int i = 0; i < jointCount; i++) {
    angleNow[i] = joints[i].homeA;
    targetA[i] = joints[i].homeA;
    moveDps[i] = jointLimitDps(i);
    limp[i] = false;
    writeServo(i);
  }

  startWifi();
  if (MDNS.begin("mechakin")) MDNS.addService("ws", "tcp", WS_PORT);
  ws.begin();
  ws.onEvent(onWsEvent);
  lastTick = millis();
  Serial.println("Ready");
}

void checkButton() {
  bool down = digitalRead(PIN_ESTOP) == LOW;
  if (down != buttonDown && millis() - buttonChangedAt > 20) {
    buttonDown = down;
    buttonChangedAt = millis();
    if (down) {
      triggerEstop("button");
      JsonDocument ev;
      ev["type"] = "event";
      ev["name"] = "estop_button";
      broadcastJson(ev);
    }
    broadcastStatus();
  }
}

void loop() {
  ws.loop();
  checkButton();

  uint32_t now = millis();
  if (now - lastTick >= TICK_MS) {
    float dt = (now - lastTick) / 1000.0f;
    lastTick = now;
    motionTick(min(dt, 0.1f));
  }
  if (runState == RUN_PLAYING && clientCount > 0 && now - lastHeard > HEARTBEAT_LIMIT_MS) {
    Serial.println("App went quiet, stopping");
    stopMotion();
    broadcastStatus();
  }
  if (runState == RUN_PLAYING && now - lastStatus >= STATUS_EVERY_MS) {
    lastStatus = now;
    broadcastStatus();
  }
}
