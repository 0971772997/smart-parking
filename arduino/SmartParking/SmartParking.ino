/*
 * HE THONG BAI DAU XE THONG MINH - ESP32
 * ------------------------------------------------
 * Board: "ESP32 Dev Module". Cau hinh WiFi + PARKING_ID trong config.h
 * Chay duoc tren ca phan cung that va Wokwi (cung 1 code, chi khac config.h)
 *
 * - 4 cam bien sieu am HC-SR04: phat hien xe trong 4 o do (loc nhieu: 3 lan doc giong nhau)
 * - 4 LED RGB (NeoPixel): Xanh = trong, Do = co xe, Vang = da dat cho
 * - 2 servo: barie cong VAO / cong RA (tu dong dong sau 3s)
 * - 2 nut nhan: gia lap xe den cong VAO / cong RA
 * - LCD 20x4 I2C: so cho trong, trang thai tung o, ket noi
 * - Buzzer: bao hieu
 * - MQTT (broker.hivemq.com): gui trang thai cho app di dong, nhan lenh tu app
 * - NTP: gan thoi gian thuc (epoch) vao trang thai/su kien
 * - Serial console (115200): go lenh JSON hoac "help" de test khi chua co app
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <Adafruit_NeoPixel.h>
#include <time.h>
#include "config.h"

#include <WiFiClientSecure.h>

#ifndef WIFI_CHANNEL_CFG
#define WIFI_CHANNEL_CFG 0   // 0 = tu dong do kenh (phan cung that), Wokwi dung 6
#endif
// Broker MQTT: mac dinh broker cong khai. HiveMQ Cloud: khai bao trong config.h (cong 8883 = TLS)
#ifndef MQTT_HOST_CFG
#define MQTT_HOST_CFG "broker.hivemq.com"
#endif
#ifndef MQTT_PORT_CFG
#define MQTT_PORT_CFG 1883
#endif
#ifndef MQTT_USER_CFG
#define MQTT_USER_CFG ""
#endif
#ifndef MQTT_PASS_CFG
#define MQTT_PASS_CFG ""
#endif
#define MQTT_USE_TLS (MQTT_PORT_CFG == 8883)

#define FW_VERSION "1.2.0"

// ================== CAU HINH ==================
const char* MQTT_HOST = MQTT_HOST_CFG;
const int   MQTT_PORT = MQTT_PORT_CFG;

// Chung chi goc ISRG Root X1 (Let's Encrypt) - HiveMQ Cloud dung chung chi nay. Het han 2035.
const char* ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

const char* TOPIC_STATUS = "smartparking/" PARKING_ID "/status";  // ESP32 -> App (retained)
const char* TOPIC_EVENT  = "smartparking/" PARKING_ID "/event";   // ESP32 -> App
const char* TOPIC_CMD    = "smartparking/" PARKING_ID "/cmd";     // App   -> ESP32
const char* TOPIC_ONLINE = "smartparking/" PARKING_ID "/online";  // "1"/"0" (retained, LWT)

const long TZ_OFFSET_SEC = 7 * 3600;   // gio Viet Nam (UTC+7) - chi dung cho LCD

// ================== CHAN KET NOI ==================
#define NUM_SLOTS 4
const int TRIG_PINS[NUM_SLOTS] = {4, 16, 17, 5};
const int ECHO_PINS[NUM_SLOTS] = {34, 35, 36, 39};

#define PIN_NEOPIXEL   15
#define PIN_SERVO_IN   13
#define PIN_SERVO_OUT  14
#define PIN_BTN_IN     32
#define PIN_BTN_OUT    33
#define PIN_BUZZER     25

// ================== THONG SO ==================
const float OCCUPIED_DISTANCE_CM = 50.0;       // < 50cm => co xe
const int   SENSOR_CONFIRM_READS = 3;          // can 3 lan doc lien tiep giong nhau moi doi trang thai
const unsigned long GATE_OPEN_MS       = 3000;
const unsigned long SENSOR_INTERVAL_MS = 100;  // doc 1 cam bien moi 100ms (xoay vong)
const unsigned long HEARTBEAT_MS       = 10000;// gui trang thai dinh ky
const unsigned long DEBOUNCE_MS        = 50;   // chong doi nut nhan
const int RESERVE_MIN_MINUTES = 1;
const int RESERVE_MAX_MINUTES = 120;
const int SERVO_CLOSED = 0;
const int SERVO_OPEN   = 90;

// ================== DOI TUONG ==================
#if MQTT_USE_TLS
WiFiClientSecure  netClient;
#else
WiFiClient        netClient;
#endif
PubSubClient      mqtt(netClient);
LiquidCrystal_I2C lcd(0x27, 20, 4);
Servo             servoIn, servoOut;
Adafruit_NeoPixel pixels(NUM_SLOTS, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);

// ================== TRANG THAI ==================
enum SlotState { SLOT_FREE, SLOT_OCCUPIED, SLOT_RESERVED };

struct Slot {
  float distance = 400;
  bool occupied = false;
  int  pendingCount = 0;              // so lan doc lien tiep khac trang thai hien tai
  bool reserved = false;
  unsigned long reservedUntil = 0;    // millis()
  unsigned long occupiedSince = 0;    // millis() khi xe vao o
};
Slot slots[NUM_SLOTS];

struct Gate {
  Servo* servo;
  const char* name;
  bool isOpen = false;
  unsigned long openedAt = 0;
};
Gate gateIn  = {&servoIn,  "entry"};
Gate gateOut = {&servoOut, "exit"};

struct Stats {
  unsigned long entries = 0;   // so lan mo barie vao
  unsigned long exits = 0;     // so lan mo barie ra
  unsigned long rejected = 0;  // so lan tu choi vi het cho
} stats;

bool statusDirty = true;
unsigned long lastSensorRead = 0, lastHeartbeat = 0, lastMqttRetry = 0;
int sensorIndex = 0;
int lastBtnIn = HIGH, lastBtnOut = HIGH;
unsigned long lastBtnChange = 0;
String lcdMessage = "";
unsigned long lcdMessageUntil = 0;
String serialLine = "";

// ================== TIEN ICH ==================
SlotState slotState(int i) {
  if (slots[i].occupied) return SLOT_OCCUPIED;
  if (slots[i].reserved) return SLOT_RESERVED;
  return SLOT_FREE;
}

const char* slotStateName(SlotState s) {
  switch (s) {
    case SLOT_OCCUPIED: return "occupied";
    case SLOT_RESERVED: return "reserved";
    default:            return "free";
  }
}

int countState(SlotState s) {
  int n = 0;
  for (int i = 0; i < NUM_SLOTS; i++) if (slotState(i) == s) n++;
  return n;
}

// Thoi gian thuc (epoch UTC, giay). 0 neu chua dong bo NTP.
time_t nowEpoch() {
  time_t t = time(nullptr);
  return t > 1700000000 ? t : 0;
}

void beep(int freq, int ms) { tone(PIN_BUZZER, freq, ms); }

void showMessage(const String& msg, unsigned long ms = 2500) {
  lcdMessage = msg;
  lcdMessageUntil = millis() + ms;
  statusDirty = true;
}

float readDistanceCm(int i) {
  digitalWrite(TRIG_PINS[i], LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PINS[i], HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PINS[i], LOW);
  unsigned long us = pulseIn(ECHO_PINS[i], HIGH, 30000);
  if (us == 0) return 400;   // khong co tieng vong -> xem nhu trong
  return us / 58.0;
}

// ================== MQTT PUBLISH ==================
void publishEvent(JsonDocument& doc) {
  doc["ts"] = millis() / 1000;
  time_t t = nowEpoch();
  if (t) doc["time"] = (long long)t;
  char buf[320];
  size_t n = serializeJson(doc, buf);
  Serial.print("[EVENT] "); Serial.println(buf);
  if (mqtt.connected()) mqtt.publish(TOPIC_EVENT, (const uint8_t*)buf, n, false);
}

void publishStatus() {
  JsonDocument doc;
  doc["id"]       = PARKING_ID;
  doc["fw"]       = FW_VERSION;
  doc["total"]    = NUM_SLOTS;
  doc["free"]     = countState(SLOT_FREE);
  doc["occupied"] = countState(SLOT_OCCUPIED);
  doc["reserved"] = countState(SLOT_RESERVED);
  JsonArray arr = doc["slots"].to<JsonArray>();
  for (int i = 0; i < NUM_SLOTS; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["id"]       = i + 1;
    o["state"]    = slotStateName(slotState(i));
    o["distance"] = (int)slots[i].distance;
    if (slots[i].occupied) o["occupiedSeconds"] = (millis() - slots[i].occupiedSince) / 1000;
    if (slots[i].reserved) {
      long left = (long)(slots[i].reservedUntil - millis()) / 1000;
      o["reservedSecondsLeft"] = left > 0 ? left : 0;
    }
  }
  JsonObject gates = doc["gates"].to<JsonObject>();
  gates["entry"] = gateIn.isOpen  ? "open" : "closed";
  gates["exit"]  = gateOut.isOpen ? "open" : "closed";
  JsonObject st = doc["stats"].to<JsonObject>();
  st["entries"]  = stats.entries;
  st["exits"]    = stats.exits;
  st["rejected"] = stats.rejected;
  doc["uptime"] = millis() / 1000;
  time_t t = nowEpoch();
  if (t) doc["time"] = (long long)t;
  if (WiFi.status() == WL_CONNECTED) doc["rssi"] = WiFi.RSSI();

  char buf[1024];
  size_t n = serializeJson(doc, buf);
  if (mqtt.connected()) mqtt.publish(TOPIC_STATUS, (const uint8_t*)buf, n, true);
  Serial.print("[STATUS] "); Serial.println(buf);
}

// ================== BARIE ==================
void openGate(Gate& g, const char* by) {
  g.servo->write(SERVO_OPEN);
  if (!g.isOpen) {
    if (&g == &gateIn) stats.entries++; else stats.exits++;
  }
  g.isOpen = true;
  g.openedAt = millis();   // mo lai khi dang mo -> gia han thoi gian mo
  beep(1500, 150);
  statusDirty = true;

  JsonDocument ev;
  ev["type"] = "gate";
  ev["gate"] = g.name;
  ev["state"] = "open";
  ev["by"] = by;
  publishEvent(ev);
}

void closeGate(Gate& g, const char* by) {
  if (!g.isOpen) return;
  g.servo->write(SERVO_CLOSED);
  g.isOpen = false;
  statusDirty = true;
  JsonDocument ev;
  ev["type"] = "gate";
  ev["gate"] = g.name;
  ev["state"] = "closed";
  ev["by"] = by;
  publishEvent(ev);
}

void updateGate(Gate& g) {
  if (g.isOpen && millis() - g.openedAt >= GATE_OPEN_MS) closeGate(g, "auto");
}

void handleEntryRequest(const char* by) {
  if (countState(SLOT_FREE) > 0) {
    openGate(gateIn, by);
    showMessage("MOI XE VAO BAI!");
  } else {
    stats.rejected++;
    beep(400, 800);
    showMessage("BAI DA HET CHO!");
    JsonDocument ev;
    ev["type"] = "entry_rejected";
    ev["reason"] = "full";
    publishEvent(ev);
  }
}

void handleExitRequest(const char* by) {
  openGate(gateOut, by);
  showMessage("TAM BIET, HEN GAP!");
}

// ================== XU LY LENH (MQTT + Serial) ==================
void handleCommand(const char* json, size_t len, const char* source) {
  JsonDocument doc;
  if (deserializeJson(doc, json, len)) {
    Serial.printf("[%s] JSON khong hop le\n", source);
    return;
  }
  const char* action = doc["action"] | "";
  Serial.printf("[%s] Lenh: %s\n", source, action);

  JsonDocument ack;
  ack["type"] = "ack";
  ack["action"] = action;
  bool ok = true;
  const char* err = nullptr;

  if (strcmp(action, "open_gate") == 0) {
    const char* gate = doc["gate"] | "entry";
    if (strcmp(gate, "exit") == 0) handleExitRequest("app");
    else if (strcmp(gate, "entry") == 0) {
      // App mo cong vao: cho phep ca khi het cho trong (vd: xe da dat cho)
      openGate(gateIn, "app");
      showMessage("MOI XE VAO BAI!");
    } else { ok = false; err = "invalid_gate"; }
    ack["gate"] = gate;

  } else if (strcmp(action, "close_gate") == 0) {
    const char* gate = doc["gate"] | "entry";
    if (strcmp(gate, "exit") == 0) closeGate(gateOut, "app");
    else if (strcmp(gate, "entry") == 0) closeGate(gateIn, "app");
    else { ok = false; err = "invalid_gate"; }
    ack["gate"] = gate;

  } else if (strcmp(action, "reserve") == 0) {
    int id = doc["slot"] | 0;
    int minutes = doc["minutes"] | 15;
    if (id < 1 || id > NUM_SLOTS)            { ok = false; err = "invalid_slot"; }
    else if (minutes < RESERVE_MIN_MINUTES || minutes > RESERVE_MAX_MINUTES) { ok = false; err = "invalid_minutes"; }
    else if (slotState(id - 1) != SLOT_FREE) { ok = false; err = "slot_not_free"; }
    else {
      slots[id - 1].reserved = true;
      slots[id - 1].reservedUntil = millis() + (unsigned long)minutes * 60000UL;
      ack["minutes"] = minutes;
      showMessage("O " + String(id) + " DA DUOC DAT");
      beep(1800, 80);
    }
    ack["slot"] = id;

  } else if (strcmp(action, "extend_reservation") == 0) {
    int id = doc["slot"] | 0;
    int minutes = doc["minutes"] | 15;
    if (id < 1 || id > NUM_SLOTS || !slots[id - 1].reserved) { ok = false; err = "not_reserved"; }
    else if (minutes < RESERVE_MIN_MINUTES || minutes > RESERVE_MAX_MINUTES) { ok = false; err = "invalid_minutes"; }
    else {
      slots[id - 1].reservedUntil += (unsigned long)minutes * 60000UL;
      ack["minutes"] = minutes;
    }
    ack["slot"] = id;

  } else if (strcmp(action, "cancel_reservation") == 0) {
    int id = doc["slot"] | 0;
    if (id < 1 || id > NUM_SLOTS || !slots[id - 1].reserved) { ok = false; err = "not_reserved"; }
    else slots[id - 1].reserved = false;
    ack["slot"] = id;

  } else if (strcmp(action, "reset_stats") == 0) {
    stats = Stats();

  } else if (strcmp(action, "get_status") == 0) {
    // trang thai se duoc gui lai ngay ben duoi
  } else {
    ok = false; err = "unknown_action";
  }

  ack["ok"] = ok;
  if (!ok) ack["error"] = err;
  if (!doc["requestId"].isNull()) ack["requestId"] = doc["requestId"];
  publishEvent(ack);
  statusDirty = true;
}

void onMqttMessage(char* topic, byte* payload, unsigned int len) {
  handleCommand((const char*)payload, len, "MQTT");
}

void printHelp() {
  Serial.println(F(
    "\n=== LENH SERIAL ===\n"
    "  help | status | in | out | wifi\n"
    "  Hoac go lenh JSON giong app, vd:\n"
    "  {\"action\":\"reserve\",\"slot\":2,\"minutes\":15}\n"
    "  {\"action\":\"cancel_reservation\",\"slot\":2}\n"
    "  {\"action\":\"open_gate\",\"gate\":\"exit\"}\n"));
}

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (serialLine.length() < 300) serialLine += c; continue; }
    String line = serialLine; serialLine = "";
    line.trim();
    if (!line.length()) continue;
    if (line.startsWith("{"))     handleCommand(line.c_str(), line.length(), "SERIAL");
    else if (line == "help")      printHelp();
    else if (line == "status")    publishStatus();
    else if (line == "in")        handleEntryRequest("serial");
    else if (line == "out")       handleExitRequest("serial");
    else if (line == "wifi")      Serial.printf("WiFi: %s  IP: %s  RSSI: %d  MQTT: %s\n",
                                    WiFi.status() == WL_CONNECTED ? "OK" : "MAT",
                                    WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                                    mqtt.connected() ? "OK" : "MAT");
    else Serial.println("Lenh khong ro, go 'help'");
  }
}

// ================== KET NOI ==================
void connectWiFi() {
  lcd.setCursor(0, 3); lcd.print("Ket noi WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID_CFG, WIFI_PASSWORD_CFG, WIFI_CHANNEL_CFG);
  Serial.printf("[WiFi] Dang ket noi '%s'", WIFI_SSID_CFG);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED)
    Serial.println("[WiFi] Chua ket noi - van chay offline, se thu lai");
}

// Theo doi WiFi: log khi ket noi, thu ket noi lai neu mat qua lau
void ensureWiFi() {
  static bool wasConnected = false;
  static unsigned long lastWifiRetry = 0;
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != wasConnected) {
    wasConnected = connected;
    if (connected) {
      Serial.println("[WiFi] Da ket noi: " + WiFi.localIP().toString());
      configTime(0, 0, "pool.ntp.org", "time.google.com");   // dong bo NTP (UTC)
    } else {
      Serial.println("[WiFi] Mat ket noi");
    }
    statusDirty = true;
  }
  if (!connected && millis() - lastWifiRetry > 20000) {
    lastWifiRetry = millis();
    Serial.println("[WiFi] Thu ket noi lai...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID_CFG, WIFI_PASSWORD_CFG, WIFI_CHANNEL_CFG);
  }
}

void ensureMqtt() {
  if (WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  if (millis() - lastMqttRetry < 5000) return;
  lastMqttRetry = millis();

  String clientId = "esp32-" PARKING_ID "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.printf("[MQTT] Dang ket noi %s:%d%s... ", MQTT_HOST, MQTT_PORT, MQTT_USE_TLS ? " (TLS)" : "");
  const char* user = strlen(MQTT_USER_CFG) ? MQTT_USER_CFG : nullptr;
  const char* pass = strlen(MQTT_PASS_CFG) ? MQTT_PASS_CFG : nullptr;
  if (mqtt.connect(clientId.c_str(), user, pass, TOPIC_ONLINE, 1, true, "0")) {
    Serial.println("OK");
    mqtt.publish(TOPIC_ONLINE, "1", true);
    mqtt.subscribe(TOPIC_CMD, 1);
    statusDirty = true;
  } else {
    Serial.printf("loi rc=%d\n", mqtt.state());
  }
}

// ================== CAM BIEN ==================
void updateSensor(int i) {
  slots[i].distance = readDistanceCm(i);
  bool occ = slots[i].distance < OCCUPIED_DISTANCE_CM;
  if (occ == slots[i].occupied) { slots[i].pendingCount = 0; return; }
  if (++slots[i].pendingCount < SENSOR_CONFIRM_READS) return;   // chua chac chan -> cho them

  slots[i].pendingCount = 0;
  slots[i].occupied = occ;
  statusDirty = true;

  JsonDocument ev;
  ev["type"] = "slot_changed";
  ev["slot"] = i + 1;
  if (occ) {
    slots[i].occupiedSince = millis();
    if (slots[i].reserved) {            // xe da vao dung o da dat
      slots[i].reserved = false;
      ev["reservationFulfilled"] = true;
    }
  } else {
    ev["parkedSeconds"] = (millis() - slots[i].occupiedSince) / 1000;
  }
  ev["state"] = slotStateName(slotState(i));
  publishEvent(ev);
}

// ================== HIEN THI ==================
void updatePixels() {
  for (int i = 0; i < NUM_SLOTS; i++) {
    uint32_t c;
    switch (slotState(i)) {
      case SLOT_OCCUPIED: c = pixels.Color(255, 0, 0);   break;
      case SLOT_RESERVED: c = pixels.Color(255, 160, 0); break;
      default:            c = pixels.Color(0, 255, 0);   break;
    }
    pixels.setPixelColor(i, c);
  }
  pixels.show();
}

// Ghi 1 dong LCD, tu dong them khoang trang cho du 20 ky tu (khong can lcd.clear -> khong nhap nhay)
void lcdLine(int row, const char* text) {
  char buf[21];
  snprintf(buf, sizeof(buf), "%-20s", text);
  lcd.setCursor(0, row);
  lcd.print(buf);
}

void updateLcd() {
  char line[32];
  lcdLine(0, "BAI DO XE THONG MINH");

  snprintf(line, sizeof(line), "Trong:%d Xe:%d Dat:%d",
           countState(SLOT_FREE), countState(SLOT_OCCUPIED), countState(SLOT_RESERVED));
  lcdLine(1, line);

  char s[21] = "";
  for (int i = 0; i < NUM_SLOTS; i++) {
    char c = slotState(i) == SLOT_OCCUPIED ? 'X' : (slotState(i) == SLOT_RESERVED ? 'R' : '-');
    char part[6];
    snprintf(part, sizeof(part), "O%d:%c ", i + 1, c);
    strncat(s, part, sizeof(s) - strlen(s) - 1);
  }
  lcdLine(2, s);

  if (lcdMessage.length() && millis() < lcdMessageUntil) {
    lcdLine(3, lcdMessage.c_str());
  } else {
    time_t t = nowEpoch();
    if (t) {
      t += TZ_OFFSET_SEC;
      struct tm tmv;
      gmtime_r(&t, &tmv);
      snprintf(line, sizeof(line), "%02d:%02d  App:%s", tmv.tm_hour, tmv.tm_min,
               mqtt.connected() ? "ONLINE" : "OFFLINE");
    } else {
      snprintf(line, sizeof(line), "App: %s", mqtt.connected() ? "ONLINE" : "OFFLINE");
    }
    lcdLine(3, line);
  }
}

// ================== SETUP / LOOP ==================
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== SMART PARKING " FW_VERSION " - ID: " PARKING_ID " ===");

  for (int i = 0; i < NUM_SLOTS; i++) {
    pinMode(TRIG_PINS[i], OUTPUT);
    pinMode(ECHO_PINS[i], INPUT);
  }
  pinMode(PIN_BTN_IN, INPUT_PULLUP);
  pinMode(PIN_BTN_OUT, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  servoIn.attach(PIN_SERVO_IN);
  servoOut.attach(PIN_SERVO_OUT);
  servoIn.write(SERVO_CLOSED);
  servoOut.write(SERVO_CLOSED);

  pixels.begin();
  pixels.setBrightness(80);
  pixels.clear();
  pixels.show();

  lcd.init();
  lcd.backlight();
  lcdLine(0, "BAI DO XE THONG MINH");
  lcdLine(1, "Phien ban " FW_VERSION);

  connectWiFi();
#if MQTT_USE_TLS
  netClient.setCACert(ROOT_CA);
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(1024);

  // Doc tat ca cam bien lan dau (khong can loc)
  for (int i = 0; i < NUM_SLOTS; i++) {
    slots[i].distance = readDistanceCm(i);
    slots[i].occupied = slots[i].distance < OCCUPIED_DISTANCE_CM;
    if (slots[i].occupied) slots[i].occupiedSince = millis();
  }
  beep(2000, 100);
  printHelp();
}

void loop() {
  ensureWiFi();
  ensureMqtt();
  mqtt.loop();
  handleSerial();

  // 1. Doc cam bien (xoay vong tung o)
  if (millis() - lastSensorRead >= SENSOR_INTERVAL_MS) {
    lastSensorRead = millis();
    updateSensor(sensorIndex);
    sensorIndex = (sensorIndex + 1) % NUM_SLOTS;
  }

  // 2. Het han dat cho
  for (int i = 0; i < NUM_SLOTS; i++) {
    if (slots[i].reserved && (long)(millis() - slots[i].reservedUntil) >= 0) {
      slots[i].reserved = false;
      statusDirty = true;
      JsonDocument ev;
      ev["type"] = "reservation_expired";
      ev["slot"] = i + 1;
      publishEvent(ev);
    }
  }

  // 3. Nut nhan (phat hien canh xuong + chong doi)
  int bIn = digitalRead(PIN_BTN_IN), bOut = digitalRead(PIN_BTN_OUT);
  if ((bIn != lastBtnIn || bOut != lastBtnOut) && millis() - lastBtnChange >= DEBOUNCE_MS) {
    lastBtnChange = millis();
    if (bIn == LOW && lastBtnIn == HIGH && !gateIn.isOpen)    handleEntryRequest("button");
    if (bOut == LOW && lastBtnOut == HIGH && !gateOut.isOpen) handleExitRequest("button");
    lastBtnIn = bIn; lastBtnOut = bOut;
  }

  // 4. Tu dong dong barie
  updateGate(gateIn);
  updateGate(gateOut);

  // 5. Het thong bao tren LCD
  if (lcdMessage.length() && millis() >= lcdMessageUntil) { lcdMessage = ""; statusDirty = true; }

  // 6. Cap nhat hien thi + gui trang thai
  if (statusDirty || millis() - lastHeartbeat >= HEARTBEAT_MS) {
    statusDirty = false;
    lastHeartbeat = millis();
    updatePixels();
    updateLcd();
    publishStatus();
  }

  delay(10);
}
