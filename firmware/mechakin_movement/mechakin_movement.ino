// MechaKin MOVEMENT controller (regular ESP32 + PCA9685 + stop button).
// Stage B in kb/docs/wiring-pins.md. Gets orders from the ESP32-S3 comms board over UART
// (one JSON message per line) and enforces every safety limit itself.
// Protocol: kb/docs/app-robot-protocol.md ("Movement link").
//
// Libraries: Adafruit PWM Servo Driver Library, ArduinoJson (7.x). Board: "ESP32 Dev Module".
//
// Testing without the S3: open the Serial Monitor (115200, "Newline") and type JSON, e.g.
//   {"type":"set_joint","joint":"head","angle":60}
//   {"type":"play","skill":{"skill_id":"t","steps":[{"joint":"head","target_angle":120,"duration_ms":800}]}}
//   {"type":"estop"}   {"type":"estop_release"}   {"type":"get_status"}

#include <Wire.h>
#include <LittleFS.h>
#include <Adafruit_PWMServoDriver.h>
#include <ArduinoJson.h>

// ---------------- Settings ----------------
#define FW_VERSION "move-0.2.1"
#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_ESTOP 27     // button between GPIO27 and GND
#define LINK_RX 16       // RX2 <- S3 TX (GPIO17)
#define LINK_TX 17       // TX2 -> S3 RX (GPIO18)
#define LINK_BAUD 115200

#define SERVOMIN 150  // pulse at 0 degrees (same as step-1 test)
#define SERVOMAX 450  // pulse at 180 degrees; narrow if servos buzz at the ends

#define HARD_MIN_ANGLE 0
#define HARD_MAX_ANGLE 180
#define HARD_MAX_DPS 400.0f
#define DEFAULT_SPEED_PCT 60.0f  // until the comms board sends the mode's limit
#define MAX_JOINTS 16
#define MAX_SEGMENTS 64
#define MAX_LINE 8192
#define TICK_MS 20
#define LINK_SILENCE_MS 1500  // stop if the comms board goes quiet while playing
#define STATUS_EVERY_MS 200
#define PROFILE_PATH "/profile.json"
#define PCA9685_ADDR 0x40

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

Adafruit_PWMServoDriver pwm(PCA9685_ADDR);
bool pcaFound = false;  // did the PCA9685 answer on I2C at boot?

Joint joints[MAX_JOINTS];
int jointCount = 0;
float angleNow[MAX_JOINTS], targetA[MAX_JOINTS], moveDps[MAX_JOINTS];
bool limp[MAX_JOINTS];

Segment segs[MAX_SEGMENTS];
int segCount = 0;
uint32_t passMs = 0, passStart = 0;
uint8_t repeatN = 1, passIdx = 0;
char skillId[33] = "";

RunState runState = RUN_IDLE;
float speedPct = DEFAULT_SPEED_PCT;
uint32_t lastHeard = 0, lastTick = 0, lastStatus = 0;
bool buttonDown = false;
uint32_t buttonChangedAt = 0;
bool stateDirty = true;

// Line readers for the link (Serial2) and the USB serial monitor (Serial).
struct LineReader {
  Stream *s;
  char buf[MAX_LINE];
  size_t len;
  bool overflow;
};
LineReader linkReader = {&Serial2, {0}, 0, false};
LineReader usbReader = {&Serial, {0}, 0, false};

// ---------------- Helpers ----------------
static float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }

int jointIndex(const char *name) {
  if (!name) return -1;
  for (int i = 0; i < jointCount; i++)
    if (strcmp(joints[i].name, name) == 0) return i;
  return -1;
}

float jointLimitDps(int i) { return joints[i].maxDps * clampf(speedPct, 1, 100) / 100.0f; }

void writeServo(int i) {
  if (limp[i]) {
    pwm.setPin(joints[i].channel, 0);  // output fully off: servo goes limp
    return;
  }
  float a = clampf(angleNow[i], joints[i].minA, joints[i].maxA);
  pwm.setPWM(joints[i].channel, 0, SERVOMIN + (uint16_t)((SERVOMAX - SERVOMIN) * a / 180.0f));
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

// Returns false (and keeps the old profile) if the new one has no usable joints.
bool applyProfile(JsonVariantConst doc) {
  JsonArrayConst arr = doc["joints"].as<JsonArrayConst>();
  if (arr.isNull()) return false;
  Joint backup[MAX_JOINTS];
  memcpy(backup, joints, sizeof(joints));
  int savedCount = jointCount;
  jointCount = 0;
  for (JsonObjectConst j : arr) {
    if (!(j["enabled"] | true)) continue;
    // Float defaults matter: ArduinoJson returns the default if the type doesn't match.
    addJoint(j["name"] | "?", j["channel"] | -1, j["min_angle"] | 90.0f, j["max_angle"] | 90.0f, j["home_angle"] | 90.0f,
             j["max_speed_dps"] | 100.0f);
  }
  if (jointCount == 0) {
    memcpy(joints, backup, sizeof(joints));
    jointCount = savedCount;
    return false;
  }
  for (int i = 0; i < jointCount; i++) {
    // Keep the current angle for joints that still exist, so nothing jumps.
    int old = -1;
    for (int k = 0; k < savedCount; k++)
      if (strcmp(backup[k].name, joints[i].name) == 0 && backup[k].channel == joints[i].channel) old = k;
    float a = old >= 0 ? angleNow[old] : joints[i].homeA;
    angleNow[i] = clampf(a, joints[i].minA, joints[i].maxA);
  }
  for (int i = 0; i < jointCount; i++) {
    targetA[i] = angleNow[i];
    moveDps[i] = jointLimitDps(i);
    limp[i] = (runState == RUN_ESTOP);
    writeServo(i);
  }
  return true;
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
  stateDirty = true;
}

void triggerEstop(const char *why) {
  segCount = 0;
  skillId[0] = 0;
  runState = RUN_ESTOP;
  for (int i = 0; i < jointCount; i++) {
    limp[i] = true;
    writeServo(i);
  }
  stateDirty = true;
  Serial.printf("E-STOP (%s)\n", why);
}

const char *startSkill(JsonVariantConst skill) {
  if (runState == RUN_ESTOP) return "E-STOP active";
  JsonArrayConst steps = skill["steps"].as<JsonArrayConst>();
  if (steps.isNull() || steps.size() == 0) return "skill has no steps";
  if (steps.size() > (size_t)MAX_SEGMENTS) return "too many steps";

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
  strlcpy(skillId, skill["skill_id"] | "inline", sizeof(skillId));
  holdAll();
  runState = RUN_PLAYING;
  stateDirty = true;
  return nullptr;
}

void sendLine(Stream &out, JsonDocument &doc) {
  serializeJson(doc, out);
  out.print('\n');
}

void sendDone() {
  JsonDocument d;
  d["type"] = "done";
  d["skill_id"] = skillId;
  sendLine(Serial2, d);
}

void motionTick(float dt) {
  if (runState == RUN_PLAYING) {
    uint32_t t = millis() - passStart;
    if (t >= passMs) {
      passIdx++;
      if (passIdx >= repeatN) {
        sendDone();
        segCount = 0;
        skillId[0] = 0;
        runState = RUN_IDLE;
        stateDirty = true;
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
  for (int i = 0; i < jointCount; i++) {
    if (limp[i]) continue;
    float stepDeg = min(moveDps[i], jointLimitDps(i)) * dt;  // never faster than the limit
    float diff = targetA[i] - angleNow[i];
    if (fabsf(diff) < 0.01f) continue;
    angleNow[i] = fabsf(diff) <= stepDeg ? targetA[i] : angleNow[i] + (diff > 0 ? stepDeg : -stepDeg);
    writeServo(i);
  }
}

// ---------------- Messages ----------------
const char *stateName() { return runState == RUN_PLAYING ? "playing" : runState == RUN_ESTOP ? "estop" : "idle"; }

void sendStatus(Stream &out) {
  JsonDocument doc;
  doc["type"] = "status";
  doc["state"] = stateName();
  if (skillId[0]) doc["skill"] = skillId;
  else doc["skill"] = nullptr;
  JsonObject a = doc["angles"].to<JsonObject>();
  for (int i = 0; i < jointCount; i++) a[joints[i].name] = (int)roundf(angleNow[i]);
  doc["estop_button"] = buttonDown;
  doc["speed_pct"] = speedPct;
  sendLine(out, doc);
}

void sendHello(Stream &out) {
  JsonDocument h;
  h["type"] = "hello";
  h["fw"] = FW_VERSION;
  h["pca9685"] = pcaFound;
  JsonArray names = h["joints"].to<JsonArray>();
  for (int i = 0; i < jointCount; i++) names.add(joints[i].name);
  sendLine(out, h);
}

void handleLine(Stream &out, const char *line, size_t len) {
  lastHeard = millis();
  JsonDocument msg;
  if (deserializeJson(msg, line, len)) {
    JsonDocument e;
    e["type"] = "error";
    e["error"] = "bad json";
    sendLine(out, e);
    return;
  }
  const char *type = msg["type"] | "";
  JsonVariantConst id = msg["id"];
  const char *error = nullptr;

  if (strcmp(type, "ping") == 0 || strcmp(type, "get_status") == 0) {
    sendStatus(out);
  } else if (strcmp(type, "hello") == 0) {
    sendHello(out);
    sendStatus(out);
  } else if (strcmp(type, "estop") == 0) {
    triggerEstop("comms");
  } else if (strcmp(type, "estop_release") == 0) {
    if (buttonDown) error = "release the STOP button first";
    else if (runState == RUN_ESTOP) {
      runState = RUN_IDLE;
      holdAll();
      for (int i = 0; i < jointCount; i++) writeServo(i);
      stateDirty = true;
    }
  } else if (strcmp(type, "stop") == 0) {
    stopMotion();
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
    error = startSkill(msg["skill"].as<JsonVariantConst>());
  } else if (strcmp(type, "set_speed") == 0) {
    speedPct = clampf(msg["pct"] | DEFAULT_SPEED_PCT, 1, 100);
    stateDirty = true;
  } else if (strcmp(type, "set_profile") == 0) {
    stopMotion();
    if (!applyProfile(msg["profile"].as<JsonVariantConst>())) error = "profile has no usable joints";
    else {
      File f = LittleFS.open(PROFILE_PATH, "w", true);
      if (f) {
        serializeJson(msg["profile"], f);
        f.close();
      }
      Serial.printf("profile updated: %d joints\n", jointCount);
    }
  } else {
    error = "unknown message type";
  }

  if (!id.isNull()) {
    JsonDocument ack;
    ack["type"] = "ack";
    ack["id"] = id;
    ack["ok"] = (error == nullptr);
    if (error) ack["error"] = error;
    sendLine(out, ack);
  } else if (error) {
    JsonDocument e;
    e["type"] = "error";
    e["error"] = error;
    sendLine(out, e);
  } else if (&out == &Serial && strcmp(type, "ping") != 0 && strcmp(type, "get_status") != 0 && strcmp(type, "hello") != 0) {
    // Typed in the serial monitor without an id: confirm it was understood.
    JsonDocument ack;
    ack["type"] = "ack";
    ack["ok"] = true;
    ack["cmd"] = type;
    sendLine(out, ack);
  }
}

void pollReader(LineReader &r) {
  while (r.s->available()) {
    char c = (char)r.s->read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (!r.overflow && r.len > 0) handleLine(*r.s, r.buf, r.len);
      r.len = 0;
      r.overflow = false;
    } else if (r.len < MAX_LINE - 1) {
      r.buf[r.len++] = c;
    } else {
      r.overflow = true;  // drop over-long lines
    }
  }
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
      sendLine(Serial2, ev);
    }
    stateDirty = true;
  }
}

// ---------------- Setup / loop ----------------
void setup() {
  Serial.begin(115200);
  Serial2.setRxBufferSize(MAX_LINE);
  Serial2.begin(LINK_BAUD, SERIAL_8N1, LINK_RX, LINK_TX);
  delay(200);
  Serial.println("\nMechaKin movement controller " FW_VERSION);
  pinMode(PIN_ESTOP, INPUT_PULLUP);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.beginTransmission(PCA9685_ADDR);
  pcaFound = (Wire.endTransmission() == 0);
  if (pcaFound) Serial.println("PCA9685 found at 0x40");
  else Serial.println("PCA9685 NOT found at 0x40: check SDA->GPIO21, SCL->GPIO22, VCC->3V3, GND. Servos won't move.");
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  delay(10);

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
  setDefaultProfile();
  for (int i = 0; i < jointCount; i++) angleNow[i] = joints[i].homeA;
  bool loaded = false;
  File f = LittleFS.open(PROFILE_PATH, "r");
  if (f) {
    JsonDocument doc;
    if (!deserializeJson(doc, f)) loaded = applyProfile(doc.as<JsonVariantConst>());
    f.close();
  }
  Serial.println(loaded ? "Loaded saved profile" : "Using default profile (head ch0, right_shoulder ch1, right_elbow ch2)");

  for (int i = 0; i < jointCount; i++) {
    angleNow[i] = joints[i].homeA;
    targetA[i] = joints[i].homeA;
    moveDps[i] = jointLimitDps(i);
    limp[i] = false;
    writeServo(i);
  }
  // A held button at power-on starts in E-STOP.
  if (digitalRead(PIN_ESTOP) == LOW) {
    buttonDown = true;
    triggerEstop("button held at boot");
  }
  sendHello(Serial2);
  lastTick = millis();
  Serial.println("Ready. Waiting for the comms board on RX2/TX2.");
}

void loop() {
  pollReader(linkReader);
  pollReader(usbReader);
  checkButton();

  uint32_t now = millis();
  if (now - lastTick >= TICK_MS) {
    float dt = (now - lastTick) / 1000.0f;
    lastTick = now;
    motionTick(min(dt, 0.1f));
  }
  if (runState == RUN_PLAYING && now - lastHeard > LINK_SILENCE_MS) {
    Serial.println("Comms board went quiet, stopping");
    stopMotion();
  }
  // Report changes at once, and every 200 ms while playing.
  if (stateDirty || (runState == RUN_PLAYING && now - lastStatus >= STATUS_EVERY_MS)) {
    stateDirty = false;
    lastStatus = now;
    sendStatus(Serial2);
  }
}
