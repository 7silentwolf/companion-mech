// MechaKin COMMS controller (ESP32-S3): Wi-Fi + app WebSocket, storage (LittleFS),
// modes, 1.8" ST7735 display (eyes + status), and the UART link to the movement ESP32.
// Stage B in kb/docs/wiring-pins.md. Speaker and SD card are not used yet.
// Protocol: kb/docs/app-robot-protocol.md
//
// Libraries: WebSockets (Markus Sattler), ArduinoJson (7.x),
//            Adafruit ST7735 and ST7789 Library (+ Adafruit GFX Library).
// Board: "ESP32S3 Dev Module". If you use the board's native USB port for the
// serial monitor, set Tools > USB CDC On Boot > Enabled.
//
// Wi-Fi: no need to re-upload for a new network. The robot remembers the Wi-Fi in flash.
//   - No saved network / can't join: it opens hotspot "MechaKin-001" (pw mechakin123).
//     Join it with your phone; a setup page opens (or browse to 192.168.4.1).
//   - From the app: Setup tab > Robot Wi-Fi.
//   - Hold the S3's BOOT button for 3 s to forget the saved Wi-Fi.
// wifi_config.h (optional, git-ignored) only sets a starting default.

#include <WiFi.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <SPI.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>

#if __has_include("wifi_config.h")
#include "wifi_config.h"
#endif
#ifndef WIFI_SSID
#define WIFI_SSID ""
#define WIFI_PASS ""
#endif

// ---------------- Settings ----------------
#define FW_VERSION "comms-0.3.0"
#define PROTO_VERSION 1
#define AP_SSID "MechaKin-001"
#define AP_PASS "mechakin123"
#define WS_PORT 81
#define PIN_WIFI_RESET 0         // the board's BOOT button
#define WIFI_RESET_HOLD_MS 3000
#define WIFI_JOIN_TIMEOUT_MS 15000
#define SETUP_RETRY_MS 30000     // in setup mode, retry the saved network this often (if nobody is on the hotspot)

#if CONFIG_IDF_TARGET_ESP32S3
// Pins from kb/docs/wiring-pins.md (ESP32-S3)
#define TFT_SCK 12
#define TFT_MOSI 11
#define TFT_CS 10
#define TFT_DC 9
#define TFT_RST 8
#define LINK_RX 18  // <- movement TX2 (GPIO17)
#define LINK_TX 17  // -> movement RX2 (GPIO16)
#else
// Fallback if the comms board is a regular ESP32 (GPIO6-11 are flash pins there!)
#define TFT_SCK 18
#define TFT_MOSI 23
#define TFT_CS 5
#define TFT_DC 2
#define TFT_RST 4
#define LINK_RX 16
#define LINK_TX 17
#endif

// If the picture is shifted, has a noisy border, or red/blue are swapped,
// try INITR_GREENTAB or INITR_REDTAB (depends on the display's tab colour).
#define TFT_TAB INITR_BLACKTAB
#define USE_DISPLAY 1  // set to 0 to run without the display

#define LINK_BAUD 115200
#define MAX_LINE 8192
#define MAX_ALLOWED 24
#define MAX_FILE_BYTES 16384
#define MAX_PENDING 16
#define LINK_TIMEOUT_MS 2000
#define LINK_PING_MS 500
#define MOVEMENT_LOST_MS 2000
#define APP_SILENCE_MS 3000

// ---------------- State ----------------
WebSocketsServer ws(WS_PORT);
HardwareSerial &Link = Serial1;  // UART1, pins set in setup()
#if USE_DISPLAY
Adafruit_ST7735 tft(&SPI, TFT_CS, TFT_DC, TFT_RST);
#endif

char robotId[33] = "robot-001";
char modeId[24] = "friendly";
float modeSpeedPct = 60;
char allowed[MAX_ALLOWED][33];
int allowedCount = -1;  // -1 = no list, everything allowed
char modeEyes[16] = "happy";
char eyesOverride[16] = "";
String ipText = "";

// Latest status from the movement board.
char mvState[12] = "idle";
char mvSkill[33] = "";
bool mvButton = false;
JsonDocument mvAngles;  // {joint: angle}
char mvFw[24] = "?";
JsonDocument mvJoints;  // ["head", ...]
uint32_t mvLastHeard = 0;
bool mvEverHeard = false;

int clientCount = 0;
uint32_t appLastHeard = 0, lastLinkPing = 0, lastHelloTry = 0;

struct Pending {
  bool used;
  uint32_t linkId;
  uint8_t client;
  int32_t appId;
  uint32_t sentAt;
};
Pending pending[MAX_PENDING];
uint32_t nextLinkId = 1;

char linkBuf[MAX_LINE];
size_t linkLen = 0;
bool linkOverflow = false;

bool displayDirty = true;

// ---------------- Helpers ----------------
static float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
bool movementOk() { return mvEverHeard && millis() - mvLastHeard < MOVEMENT_LOST_MS; }
const char *currentEyes() { return eyesOverride[0] ? eyesOverride : modeEyes; }

void sendJson(uint8_t num, JsonDocument &doc) {
  String out;
  serializeJson(doc, out);
  ws.sendTXT(num, out);
}

void broadcastJson(JsonDocument &doc) {
  if (clientCount == 0) return;
  String out;
  serializeJson(doc, out);
  ws.broadcastTXT(out);
}

void sendLink(JsonDocument &doc) {
  serializeJson(doc, Link);
  Link.print('\n');
}

void sendLinkType(const char *type) {
  JsonDocument d;
  d["type"] = type;
  sendLink(d);
}

void ackApp(uint8_t num, int32_t appId, const char *error) {
  JsonDocument doc;
  doc["type"] = "ack";
  doc["id"] = appId;
  doc["ok"] = (error == nullptr);
  if (error) doc["error"] = error;
  sendJson(num, doc);
}

void fillStatus(JsonDocument &doc) {
  doc["type"] = "status";
  doc["state"] = mvState;
  doc["mode"] = modeId;
  if (mvSkill[0]) doc["skill"] = mvSkill;
  else doc["skill"] = nullptr;
  doc["angles"] = mvAngles.as<JsonObjectConst>();
  doc["estop_button"] = mvButton;
  doc["movement_ok"] = movementOk();
  doc["eyes"] = currentEyes();
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

void listDir(const char *dir, JsonArray out) {
  File d = LittleFS.open(dir);
  if (!d || !d.isDirectory()) return;
  File f = d.openNextFile();
  while (f) {
    if (!f.isDirectory()) {
      JsonObject o = out.add<JsonObject>();
      o["path"] = String(dir) + "/" + f.name();
      o["size"] = f.size();
    }
    f = d.openNextFile();
  }
}

void sendSpeedToMovement() {
  JsonDocument d;
  d["type"] = "set_speed";
  d["pct"] = modeSpeedPct;
  sendLink(d);
}

bool loadMode(const char *id) {
  char path[64];
  snprintf(path, sizeof(path), "/modes/%s.json", id);
  JsonDocument doc;
  if (!validPath(path) || !readJsonFile(path, doc)) return false;
  strlcpy(modeId, id, sizeof(modeId));
  modeSpeedPct = clampf(doc["limits"]["max_speed_pct"] | 60.0f, 1, 100);
  strlcpy(modeEyes, doc["display"]["eyes"] | "happy", sizeof(modeEyes));
  eyesOverride[0] = 0;
  JsonArrayConst list = doc["allowed_skills"].as<JsonArrayConst>();
  if (list.isNull()) allowedCount = -1;
  else {
    allowedCount = 0;
    for (JsonVariantConst v : list) {
      const char *s = v.as<const char *>();
      if (s && allowedCount < MAX_ALLOWED) strlcpy(allowed[allowedCount++], s, 33);
    }
  }
  sendSpeedToMovement();
  displayDirty = true;
  return true;
}

bool skillAllowed(const char *id) {
  if (allowedCount < 0) return true;
  for (int i = 0; i < allowedCount; i++)
    if (strcmp(allowed[i], id) == 0) return true;
  return false;
}

// Send the stored profile to the movement board. Returns the link id (0 = none).
uint32_t pushProfile(bool withId) {
  JsonDocument prof;
  if (!readJsonFile("/config/mech_profile.json", prof)) return 0;
  JsonDocument d;
  d["type"] = "set_profile";
  d["profile"] = prof.as<JsonVariantConst>();
  uint32_t lid = 0;
  if (withId) {
    lid = nextLinkId++;
    d["id"] = lid;
  }
  sendLink(d);
  return lid;
}

// ---------------- Forwarding to the movement board ----------------
bool addPending(uint32_t linkId, uint8_t client, int32_t appId) {
  for (auto &p : pending) {
    if (!p.used) {
      p = Pending{true, linkId, client, appId, millis()};
      return true;
    }
  }
  return false;
}

// Forward an app message. Replies to the app when the movement board acks.
void forward(uint8_t num, JsonDocument &msg) {
  JsonVariantConst appIdV = msg["id"];
  bool hasId = !appIdV.isNull();
  int32_t appId = appIdV | 0;
  if (!movementOk() && hasId) {
    // Still send it (the board may be booting), but tell the app straight away.
    msg.remove("id");
    sendLink(msg);
    ackApp(num, appId, "movement board not answering (check UART wires TX->RX, GND)");
    return;
  }
  if (hasId) {
    uint32_t lid = nextLinkId++;
    msg["id"] = lid;
    if (!addPending(lid, num, appId)) {
      ackApp(num, appId, "busy, try again");
      return;
    }
  }
  sendLink(msg);
}

void checkPendingTimeouts() {
  for (auto &p : pending) {
    if (p.used && millis() - p.sentAt > LINK_TIMEOUT_MS) {
      p.used = false;
      ackApp(p.client, p.appId, "movement board did not answer");
    }
  }
}


// ---------------- Wi-Fi (saved in flash, changeable without re-uploading) ----------------
Preferences prefs;
WebServer portal(80);
DNSServer dns;
bool setupMode = false;  // hotspot + setup page are running
uint32_t restartAt = 0;  // when > 0: restart at this millis()
uint32_t bootDownSince = 0;
uint32_t lastSetupRetry = 0;
char wifiSsid[33] = "";
char wifiPass[65] = "";

void loadWifiCreds() {
  prefs.begin("wifi", false);
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  prefs.end();
  if (ssid.length() == 0) {  // nothing saved yet: use wifi_config.h if present
    ssid = WIFI_SSID;
    pass = WIFI_PASS;
  }
  strlcpy(wifiSsid, ssid.c_str(), sizeof(wifiSsid));
  strlcpy(wifiPass, pass.c_str(), sizeof(wifiPass));
}

// Returns nullptr on success, or what is wrong.
const char *saveWifiCreds(const char *ssid, const char *pass) {
  if (!ssid || !ssid[0] || strlen(ssid) > 32) return "Wi-Fi name must be 1-32 characters";
  if (!pass) pass = "";
  size_t pl = strlen(pass);
  if (pl > 63 || (pl > 0 && pl < 8)) return "password must be 8-63 characters (or empty for an open network)";
  prefs.begin("wifi", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  strlcpy(wifiSsid, ssid, sizeof(wifiSsid));
  strlcpy(wifiPass, pass, sizeof(wifiPass));
  Serial.printf("Saved Wi-Fi \"%s\"\n", ssid);
  return nullptr;
}

void clearWifiCreds() {
  prefs.begin("wifi", false);
  prefs.clear();
  prefs.end();
  Serial.println("Forgot saved Wi-Fi");
}

void scheduleRestart(uint32_t inMs) {
  sendLinkType("stop");  // never restart in the middle of a move
  restartAt = millis() + inMs;
}

String htmlEscape(const String &in) {
  String out;
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (c == '<') out += "&lt;";
    else if (c == '>') out += "&gt;";
    else if (c == '&') out += "&amp;";
    else if (c == '"') out += "&quot;";
    else if (c == '\'') out += "&#39;";
    else out += c;
  }
  return out;
}

const char *PAGE_HEAD =
    "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>MechaKin Wi-Fi</title><style>body{font-family:sans-serif;max-width:420px;margin:20px auto;padding:0 16px;color:#1b2233}"
    "h1{font-size:22px}button,input{font-size:17px;padding:10px;width:100%;box-sizing:border-box;margin:4px 0;border-radius:8px;"
    "border:1px solid #ccd}.net{background:#eef2fb;text-align:left}.go{background:#3b5bdb;color:#fff;border:0;font-weight:bold}"
    "small{color:#667}</style></head><body><h1>MechaKin Wi-Fi setup</h1>";

void portalRoot() {
  String page = PAGE_HEAD;
  page += "<p>Pick your Wi-Fi (2.4 GHz) and type its password. The robot saves it and restarts.</p>";
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    String name = WiFi.SSID(i);
    if (name.length() == 0) continue;
    bool dup = false;
    for (int k = 0; k < i; k++)
      if (WiFi.SSID(k) == name) dup = true;
    if (dup) continue;
    String esc = htmlEscape(name);
    page += "<button type='button' class='net' data-n=\"" + esc + "\" onclick=\"document.getElementById('s').value=this.dataset.n;"
            "document.getElementById('p').focus()\">" + esc + " <small>(" + String(WiFi.RSSI(i)) + " dBm)</small></button>";
  }
  WiFi.scanDelete();
  if (n <= 0) page += "<p><small>No networks found. Type the name below.</small></p>";
  page += "<form method='POST' action='/save'><input id='s' name='ssid' placeholder='Wi-Fi name' maxlength='32' required>"
          "<input id='p' name='pass' type='password' placeholder='Password' maxlength='63'>"
          "<button class='go' type='submit'>Save and restart</button></form>"
          "<p><a href='/'>Scan again</a></p></body></html>";
  portal.send(200, "text/html", page);
}

void portalSave() {
  String ssid = portal.arg("ssid");
  String pass = portal.arg("pass");
  const char *err = saveWifiCreds(ssid.c_str(), pass.c_str());
  String page = PAGE_HEAD;
  if (err) {
    page += "<p style='color:#c00'>" + htmlEscape(err) + "</p><p><a href='/'>Back</a></p></body></html>";
    portal.send(400, "text/html", page);
    return;
  }
  page += "<p>Saved <b>" + htmlEscape(ssid) + "</b>. The robot is restarting and joining it.</p>"
          "<p>Now connect your phone back to that Wi-Fi. The robot's new IP appears on its display; type it in the app.</p>"
          "<p><small>If the robot can't join (wrong password?), this hotspot comes back in about 15 seconds.</small></p></body></html>";
  portal.send(200, "text/html", page);
  scheduleRestart(2000);
}

void portalRedirect() {  // captive portal: send every unknown URL to the setup page
  portal.sendHeader("Location", "http://192.168.4.1/", true);
  portal.send(302, "text/plain", "");
}

void startSetupMode() {
  setupMode = true;
  WiFi.mode(WIFI_AP_STA);  // AP for the setup page, STA so we can scan and retry
  WiFi.softAP(AP_SSID, AP_PASS);
  dns.start(53, "*", WiFi.softAPIP());
  portal.on("/", HTTP_GET, portalRoot);
  portal.on("/save", HTTP_POST, portalSave);
  portal.onNotFound(portalRedirect);
  portal.begin();
  lastSetupRetry = millis();
  ipText = "Wi-Fi setup";
  Serial.printf("Wi-Fi setup mode: join hotspot %s (password %s), open http://192.168.4.1\n", AP_SSID, AP_PASS);
  Serial.printf("The app also works on the hotspot: IP 192.168.4.1 port %d\n", WS_PORT);
}

bool joinWifi(uint32_t timeoutMs) {
  if (!wifiSsid[0]) return false;
  WiFi.begin(wifiSsid, wifiPass);
  Serial.printf("Joining Wi-Fi \"%s\"", wifiSsid);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void startWifi() {
  loadWifiCreds();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);  // ride out short router outages
  if (joinWifi(WIFI_JOIN_TIMEOUT_MS)) {
    ipText = WiFi.localIP().toString();
    Serial.printf("Connected. Robot IP: %s  port %d\n", ipText.c_str(), WS_PORT);
    return;
  }
  Serial.println(wifiSsid[0] ? "Could not join the saved Wi-Fi" : "No Wi-Fi saved yet");
  startSetupMode();
}

void wifiLoop() {
  uint32_t now = millis();
  if (setupMode) {
    dns.processNextRequest();
    portal.handleClient();
    // The router may just have been slow to start: retry the saved network now and then,
    // but only while nobody is using the hotspot (retrying disturbs the hotspot briefly).
    if (wifiSsid[0] && !restartAt && WiFi.softAPgetStationNum() == 0 && now - lastSetupRetry > SETUP_RETRY_MS) {
      lastSetupRetry = now;
      Serial.println("Retrying saved Wi-Fi");
      if (joinWifi(8000)) scheduleRestart(500);  // restart cleanly into normal mode
      lastSetupRetry = millis();
    }
  }
  // Hold BOOT for 3 s: forget the saved Wi-Fi and restart into setup mode.
  if (digitalRead(PIN_WIFI_RESET) == LOW) {
    if (!bootDownSince) bootDownSince = now ? now : 1;
    else if (now - bootDownSince > WIFI_RESET_HOLD_MS && !restartAt) {
      clearWifiCreds();
      wifiSsid[0] = 0;
      ipText = "Wi-Fi forgotten";
      displayDirty = true;
      scheduleRestart(1000);
    }
  } else {
    bootDownSince = 0;
  }
  if (restartAt && (int32_t)(now - restartAt) >= 0) {
    Serial.println("Restarting");
    Serial.flush();
    ESP.restart();
  }
}

// ---------------- Display ----------------
#if USE_DISPLAY
uint16_t eyeColor() { return strcmp(modeId, "gaming") == 0 ? ST77XX_ORANGE : ST77XX_CYAN; }

void drawEye(int cx, int cy, const char *style, bool closed, uint16_t c, bool left) {
  if (closed || strcmp(style, "sleepy") == 0) {
    tft.fillRoundRect(cx - 18, cy - 3, 36, 6, 3, c);
  } else if (strcmp(style, "happy") == 0) {
    tft.fillCircle(cx, cy + 8, 20, c);
    tft.fillCircle(cx, cy + 18, 21, ST77XX_BLACK);
  } else if (strcmp(style, "focused") == 0) {
    tft.fillRoundRect(cx - 20, cy - 8, 40, 18, 6, c);
    // slanted brow
    if (left) tft.fillTriangle(cx - 22, cy - 10, cx + 22, cy - 10, cx + 22, cy + 2, ST77XX_BLACK);
    else tft.fillTriangle(cx - 22, cy - 10, cx + 22, cy - 10, cx - 22, cy + 2, ST77XX_BLACK);
  } else if (strcmp(style, "sad") == 0) {
    tft.fillRoundRect(cx - 15, cy - 20, 30, 40, 12, c);
    if (left) tft.fillTriangle(cx - 16, cy - 21, cx + 16, cy - 21, cx - 16, cy - 6, ST77XX_BLACK);
    else tft.fillTriangle(cx - 16, cy - 21, cx + 16, cy - 21, cx + 16, cy - 6, ST77XX_BLACK);
  } else {  // "normal" and anything unknown
    tft.fillRoundRect(cx - 15, cy - 22, 30, 44, 12, c);
  }
}

void drawEyes(bool closed) {
  tft.fillRect(0, 10, 160, 92, ST77XX_BLACK);
  uint16_t c = eyeColor();
  drawEye(52, 54, currentEyes(), closed, c, true);
  drawEye(108, 54, currentEyes(), closed, c, false);
}

void drawStatusBar() {
  tft.fillRect(0, 0, 160, 10, ST77XX_BLACK);
  tft.fillRect(0, 104, 160, 24, ST77XX_BLACK);
  tft.setTextSize(1);
  if (strcmp(mvState, "playing") == 0 && mvSkill[0]) {
    tft.setTextColor(ST77XX_GREEN);
    tft.setCursor(2, 1);
    tft.print("> ");
    tft.print(mvSkill);
  }
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(2, 106);
  if (setupMode) {
    tft.setTextColor(ST77XX_YELLOW);
    tft.print("Join Wi-Fi " AP_SSID);
    tft.setCursor(2, 117);
    tft.print("pw:" AP_PASS " 192.168.4.1");
    return;
  }
  if (restartAt) {
    tft.setTextColor(ST77XX_YELLOW);
    tft.print(ipText);
    tft.setCursor(2, 117);
    tft.print("restarting...");
    return;
  }
  tft.print(ipText);
  tft.setCursor(2, 117);
  if (!movementOk()) {
    tft.setTextColor(ST77XX_YELLOW);
    tft.print("no movement link");
  } else {
    tft.print(modeId);
    tft.print(" | ");
    tft.print(mvState);
    tft.print(clientCount > 0 ? " | app" : "");
  }
}

bool lastWasEstop = false;
bool blinkClosed = false;
uint32_t nextBlinkAt = 0;

void displayInit() {
  SPI.begin(TFT_SCK, -1, TFT_MOSI, TFT_CS);
  tft.initR(TFT_TAB);
  tft.setRotation(1);  // landscape 160x128
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextColor(ST77XX_WHITE);
  tft.setTextSize(2);
  tft.setCursor(20, 50);
  tft.print("MechaKin");
  nextBlinkAt = millis() + 3000;
}

void displayLoop() {
  bool estop = strcmp(mvState, "estop") == 0;
  if (estop) {
    if (!lastWasEstop || displayDirty) {
      tft.fillScreen(ST77XX_RED);
      tft.setTextColor(ST77XX_WHITE);
      tft.setTextSize(4);
      tft.setCursor(32, 36);
      tft.print("STOP");
      tft.setTextSize(1);
      tft.setCursor(12, 90);
      tft.print(mvButton ? "release the button" : "release it in the app");
    }
    lastWasEstop = true;
    displayDirty = false;
    return;
  }
  if (lastWasEstop) {
    tft.fillScreen(ST77XX_BLACK);
    lastWasEstop = false;
    displayDirty = true;
  }
  uint32_t now = millis();
  bool blinkChanged = false;
  if (now >= nextBlinkAt) {
    blinkClosed = !blinkClosed;
    nextBlinkAt = now + (blinkClosed ? 150 : 2500 + (esp_random() % 3000));
    blinkChanged = true;
  }
  if (displayDirty || blinkChanged) drawEyes(blinkClosed);
  if (displayDirty) drawStatusBar();
  displayDirty = false;
}
#else
void displayInit() {}
void displayLoop() {}
#endif

// ---------------- Movement link ----------------
void onMovementLine(const char *line, size_t len) {
  JsonDocument m;
  if (deserializeJson(m, line, len)) return;
  mvLastHeard = millis();
  bool wasOk = mvEverHeard;
  mvEverHeard = true;
  if (!wasOk) displayDirty = true;
  const char *type = m["type"] | "";

  if (strcmp(type, "status") == 0) {
    const char *st = m["state"] | "idle";
    const char *sk = m["skill"] | "";
    bool btn = m["estop_button"] | false;
    if (strcmp(st, mvState) || strcmp(sk, mvSkill) || btn != mvButton) displayDirty = true;
    strlcpy(mvState, st, sizeof(mvState));
    strlcpy(mvSkill, sk, sizeof(mvSkill));
    mvButton = btn;
    mvAngles.clear();
    mvAngles.set(m["angles"]);
    broadcastStatus();
  } else if (strcmp(type, "hello") == 0) {
    // Movement board (re)started: give it our profile and the mode's speed limit.
    strlcpy(mvFw, m["fw"] | "?", sizeof(mvFw));
    mvJoints.clear();
    mvJoints.set(m["joints"]);
    Serial.printf("Movement board %s connected\n", mvFw);
    pushProfile(false);
    sendSpeedToMovement();
    displayDirty = true;
  } else if (strcmp(type, "ack") == 0) {
    uint32_t lid = m["id"] | 0;
    for (auto &p : pending) {
      if (p.used && p.linkId == lid) {
        p.used = false;
        ackApp(p.client, p.appId, (m["ok"] | false) ? nullptr : (m["error"] | "movement error"));
      }
    }
  } else if (strcmp(type, "done") == 0 || strcmp(type, "event") == 0 || strcmp(type, "error") == 0) {
    broadcastJson(m);  // same shape as the app protocol
  }
}

void pollLink() {
  while (Link.available()) {
    char c = (char)Link.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (!linkOverflow && linkLen > 0) onMovementLine(linkBuf, linkLen);
      linkLen = 0;
      linkOverflow = false;
    } else if (linkLen < MAX_LINE - 1) {
      linkBuf[linkLen++] = c;
    } else {
      linkOverflow = true;
    }
  }
}

// ---------------- App messages ----------------
const char *handlePutFile(uint8_t num, int32_t appId, bool hasId, const char *path, const char *content, bool &acked) {
  if (!validPath(path)) return "bad path";
  if (!content) return "missing content";
  size_t len = strlen(content);
  if (len > MAX_FILE_BYTES) return "file too large";
  JsonDocument parsed;
  if (deserializeJson(parsed, content)) return "content is not valid JSON";
  File f = LittleFS.open(path, "w", true);
  if (!f) return "cannot write file";
  size_t written = f.print(content);
  f.close();
  if (written != len) return "write failed (storage full?)";
  Serial.printf("saved %s (%u B)\n", path, (unsigned)len);

  if (strcmp(path, "/training/robot_profile.json") == 0) {
    const char *rid = parsed["robot_id"].as<const char *>();
    if (rid) strlcpy(robotId, rid, sizeof(robotId));
  }
  char modePath[64];
  snprintf(modePath, sizeof(modePath), "/modes/%s.json", modeId);
  if (strcmp(path, modePath) == 0) loadMode(modeId);

  if (strcmp(path, "/config/mech_profile.json") == 0) {
    // The movement board must accept the new limits before we report success.
    if (!movementOk()) return "saved, but movement board not answering";
    uint32_t lid = pushProfile(hasId);
    if (hasId && lid) {
      if (addPending(lid, num, appId)) acked = true;
    }
  }
  return nullptr;
}

void handleAppMessage(uint8_t num, uint8_t *payload, size_t length) {
  appLastHeard = millis();
  JsonDocument msg;
  if (deserializeJson(msg, payload, length)) {
    JsonDocument err;
    err["type"] = "error";
    err["error"] = "bad json";
    sendJson(num, err);
    return;
  }
  const char *type = msg["type"] | "";
  bool hasId = !msg["id"].isNull();
  int32_t appId = msg["id"] | 0;
  const char *error = nullptr;
  bool acked = false;  // true when the reply comes later (from the movement board)

  if (strcmp(type, "ping") == 0 || strcmp(type, "get_status") == 0) {
    sendStatus(num);
  } else if (strcmp(type, "hello") == 0) {
    JsonDocument h;
    h["type"] = "hello";
    h["robot_id"] = robotId;
    h["fw"] = FW_VERSION;
    h["movement_fw"] = mvFw;
    h["proto"] = PROTO_VERSION;
    h["wifi"] = setupMode ? "" : wifiSsid;
    h["joints"] = mvJoints.as<JsonArrayConst>();
    sendJson(num, h);
    sendStatus(num);
  } else if (strcmp(type, "estop") == 0) {
    // Never wait on an e-stop: send it at once, twice for luck.
    sendLinkType("estop");
    sendLinkType("estop");
    strlcpy(mvState, "estop", sizeof(mvState));
    displayDirty = true;
    broadcastStatus();
  } else if (strcmp(type, "estop_release") == 0 || strcmp(type, "stop") == 0 || strcmp(type, "set_joint") == 0 ||
             strcmp(type, "play") == 0) {
    forward(num, msg);
    acked = true;
  } else if (strcmp(type, "play_saved") == 0) {
    const char *sid = msg["skill_id"] | "";
    char path[64];
    snprintf(path, sizeof(path), "/skills/%s.json", sid);
    JsonDocument skill;
    if (!validPath(path) || !readJsonFile(path, skill)) error = "skill not found on robot";
    else if (!skillAllowed(sid)) error = "skill not allowed in this mode";
    else {
      JsonDocument fwd;
      fwd["type"] = "play";
      fwd["skill"] = skill.as<JsonVariantConst>();
      if (hasId) fwd["id"] = appId;
      forward(num, fwd);
      acked = true;
    }
  } else if (strcmp(type, "put_file") == 0) {
    error = handlePutFile(num, appId, hasId, msg["path"] | "", msg["content"].as<const char *>(), acked);
  } else if (strcmp(type, "delete_file") == 0) {
    const char *path = msg["path"] | "";
    if (!validPath(path)) error = "bad path";
    else LittleFS.remove(path);
  } else if (strcmp(type, "list_files") == 0) {
    if (hasId) {
      JsonDocument ack;
      ack["type"] = "ack";
      ack["id"] = appId;
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
    if (!loadMode(msg["mode_id"] | "")) error = "mode not on robot, upload it first";
    else {
      Serial.printf("mode %s\n", modeId);
      broadcastStatus();
    }
  } else if (strcmp(type, "get_wifi") == 0) {
    if (hasId) {
      JsonDocument ack;
      ack["type"] = "ack";
      ack["id"] = appId;
      ack["ok"] = true;
      ack["ssid"] = wifiSsid;
      ack["connected"] = WiFi.status() == WL_CONNECTED;
      ack["setup_mode"] = setupMode;
      ack["ip"] = setupMode ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
      sendJson(num, ack);
    }
    return;
  } else if (strcmp(type, "set_wifi") == 0) {
    error = saveWifiCreds(msg["ssid"] | "", msg["pass"] | "");
    if (!error) {
      ipText = String("joining ") + wifiSsid;
      displayDirty = true;
      scheduleRestart(1500);  // after the ack has gone out
    }
  } else if (strcmp(type, "set_eyes") == 0) {
    strlcpy(eyesOverride, msg["eyes"] | "", sizeof(eyesOverride));
    displayDirty = true;
    broadcastStatus();
  } else {
    error = "unknown message type";
  }

  if (acked) return;
  if (hasId) ackApp(num, appId, error);
  else if (error) {
    JsonDocument e;
    e["type"] = "error";
    e["error"] = error;
    sendJson(num, e);
  }
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      clientCount++;
      appLastHeard = millis();
      displayDirty = true;
      Serial.printf("app %u connected\n", num);
      break;
    case WStype_DISCONNECTED:
      if (clientCount > 0) clientCount--;
      displayDirty = true;
      Serial.printf("app %u disconnected\n", num);
      if (clientCount == 0 && strcmp(mvState, "playing") == 0) sendLinkType("stop");  // safe on connection loss
      break;
    case WStype_TEXT:
      handleAppMessage(num, payload, length);
      break;
    default:
      break;
  }
}

// ---------------- Setup / loop ----------------
void setup() {
  Serial.begin(115200);
  Link.setRxBufferSize(MAX_LINE);
  Link.begin(LINK_BAUD, SERIAL_8N1, LINK_RX, LINK_TX);
  delay(300);
  Serial.println("\nMechaKin comms controller " FW_VERSION);
  pinMode(PIN_WIFI_RESET, INPUT_PULLUP);
  displayInit();

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
  {
    JsonDocument doc;
    const char *rid = readJsonFile("/training/robot_profile.json", doc) ? doc["robot_id"].as<const char *>() : nullptr;
    if (rid) strlcpy(robotId, rid, sizeof(robotId));
  }
  if (!loadMode("friendly")) Serial.println("No /modes/friendly.json yet (sync from the app), using 60% speed");
  mvAngles.to<JsonObject>();
  mvJoints.to<JsonArray>();

  startWifi();
  if (MDNS.begin("mechakin")) MDNS.addService("ws", "tcp", WS_PORT);
  ws.begin();
  ws.onEvent(onWsEvent);
  sendLinkType("hello");
  displayDirty = true;
  Serial.println("Ready");
}

void loop() {
  ws.loop();
  wifiLoop();
  pollLink();
  checkPendingTimeouts();

  uint32_t now = millis();
  if (now - lastLinkPing >= LINK_PING_MS) {
    lastLinkPing = now;
    // Until the movement board has said hello, keep asking (it may boot later).
    if (!mvEverHeard && now - lastHelloTry > 1000) {
      lastHelloTry = now;
      sendLinkType("hello");
    } else {
      sendLinkType("ping");
    }
  }
  static bool wasOk = false;
  bool ok = movementOk();
  if (ok != wasOk) {
    wasOk = ok;
    displayDirty = true;
    broadcastStatus();
    Serial.println(ok ? "Movement link OK" : "Movement link LOST");
  }
  // App went quiet while a skill plays: stop the robot.
  if (clientCount > 0 && strcmp(mvState, "playing") == 0 && now - appLastHeard > APP_SILENCE_MS) {
    Serial.println("App went quiet, stopping");
    sendLinkType("stop");
    appLastHeard = now;
  }
  displayLoop();
}
