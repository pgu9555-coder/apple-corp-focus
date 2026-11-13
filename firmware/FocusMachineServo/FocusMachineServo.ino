/* Focus Machine servo dispenser firmware (BANK protocol, 115200 baud).
   Works with the Chrome extension v0.5.x without any extension change.

   SAFE DEFAULT: until LOAD_US and RELEASE_US below are calibrated (non-zero),
   the servo never moves. The board answers HELLO with READY_BANK_TEST and
   every claim only flashes the built-in LED and replies SIMULATED.
   After calibration it answers READY_BANK and drives the real servo.

   Wiring (edit the pin constants if yours differ):
     D8  servo signal
     D3  chute exit sensor (FC-51), digital output
     I2C LCD on A4 (SDA) / A5 (SCL), only used when USE_LCD is 1
     The servo is powered straight from the 5 V rail with a capacitor across
     it, so there is no power switch (SERVO_ENABLE_PIN = -1). To add a MOSFET
     switch later, wire its gate to a free pin and set SERVO_ENABLE_PIN to it.
     Servo power must come from a 5 V (4.8-6 V) source, never straight from
     a 9 V battery. Join the servo supply ground to the Uno GND.

   LCD: with USE_LCD 1 the 16x2 I2C LCD mirrors the extension timer
   ("Focus 24:59", "Break 4:59", "Paused", rewards to collect). The
   extension sends SHOW frames; the board counts between them.

   Status: compiles for arduino:avr:uno (arduino-cli 1.5.1, Servo 1.3.0).
   Not yet run on real hardware.
*/
#include <Arduino.h>
#include <EEPROM.h>
#include <Servo.h>
#include <string.h>

// ---------------- Configuration ----------------
const uint8_t  SERVO_PIN        = 8;
const int8_t   SERVO_ENABLE_PIN = -1;    // -1 = no power switch (servo wired straight to 5 V)
const uint8_t  SENSOR_PIN       = 3;     // IR sensor OUT is wired to D3
const bool     SENSOR_ACTIVE_LOW = true; // true: LOW means a treat blocks the sensor
const bool     USE_SENSOR       = true;  // false: reply DISPENSED after the motion, unverified

// Servo pulse widths in microseconds. 0 = not calibrated (servo stays still).
// Find them with the bench commands below, horn disengaged, then type them here.
const uint16_t LOAD_US          = 0;     // pocket under the magazine
const uint16_t RELEASE_US       = 0;     // pocket over the outlet (about 120 degrees away)
const uint16_t PULSE_MIN_US     = 544;   // hard limits for any commanded pulse (Servo library range)
const uint16_t PULSE_MAX_US     = 2400;

// Timing (bench starting values from the C3 build guide; tune on the real machine)
const uint16_t POWER_SETTLE_MS  = 150;   // after enabling servo power
const uint16_t TRAVEL_MS        = 500;   // time to travel 120 degrees
const uint16_t ARM_CLEAR_MS     = 150;   // chute must read clear this long before moving
const uint16_t ARM_TIMEOUT_MS   = 1000;
const uint8_t  FILTER_MS        = 3;     // ignore sensor changes shorter than this
const uint16_t JAM_MS           = 300;   // continuously blocked this long = jam
const uint16_t RELEASE_DWELL_MS = 10000; // wait up to 10 s at the outlet for the IR beam to break;
                                         // no break in time = the machine is out of treats

#define USE_LCD 1                        // 1 = 16x2 I2C LCD shows the focus/break timer (needs the
                                         // "LiquidCrystal I2C" library); 0 = no LCD
#if USE_LCD
#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);      // common backpack address; some use 0x3F
#endif

// ---------------- Claim memory in EEPROM ----------------
// Layout: [0..1] magic "F5", [2] next slot, slots of 34 bytes from address 4:
//   [0] 0xA5 when valid, [1..32] claim id, [33] result code.
const uint8_t SLOTS = 16, SLOT_SIZE = 34;
const char R_PENDING = 'P', R_DISPENSED = 'D', R_SIMULATED = 'S', R_NO_PASSAGE = 'N', R_JAM = 'J';

Servo servo;
char input[151]; uint8_t used = 0; bool overflow = false;
unsigned long ledUntil = 0;
bool faultLatched = false;       // set by a jam; cleared only by resetting the Uno
bool benchActive = false;        // servo held by a bench 'p' command

bool calibrated() { return LOAD_US != 0 && RELEASE_US != 0; }

uint16_t crc16(const char* text) {
  uint16_t crc = 0xffff;
  while (*text) {
    crc ^= (uint16_t)(uint8_t)*text++ << 8;
    for (uint8_t i = 0; i < 8; i++) crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return crc;
}
bool claimId(const char* v) {
  if (strlen(v) != 32) return false;
  for (uint8_t i = 0; i < 32; i++) if (!((v[i] >= '0' && v[i] <= '9') || (v[i] >= 'a' && v[i] <= 'f'))) return false;
  return true;
}
bool decimal(const char* v) {
  if (!*v) return false;
  while (*v) { if (*v < '0' || *v > '9') return false; v++; }
  return true;
}
void reply(const char* seq, const char* type, const char* id, const char* value) {
  char body[116]; snprintf(body, sizeof(body), "F1|%s|%s|%s|%s", seq, type, id, value);
  char checksum[5]; snprintf(checksum, sizeof(checksum), "%04X", crc16(body));
  Serial.print(body); Serial.print('|'); Serial.println(checksum);
}

int findSlot(const char* id) {
  for (uint8_t s = 0; s < SLOTS; s++) {
    const int base = 4 + s * SLOT_SIZE;
    if (EEPROM.read(base) != 0xA5) continue;
    bool equal = true;
    for (uint8_t i = 0; i < 32; i++) if (EEPROM.read(base + 1 + i) != (uint8_t)id[i]) { equal = false; break; }
    if (equal) return base;
  }
  return -1;
}
int rememberPending(const char* id) {
  uint8_t s = EEPROM.read(2); if (s >= SLOTS) s = 0;
  const int base = 4 + s * SLOT_SIZE;
  EEPROM.update(base, 0);
  for (uint8_t i = 0; i < 32; i++) EEPROM.update(base + 1 + i, id[i]);
  EEPROM.update(base + 33, R_PENDING);
  EEPROM.update(base, 0xA5);
  EEPROM.update(2, (s + 1) % SLOTS);
  return base;
}
void setResult(int base, char code) { EEPROM.update(base + 33, code); }

// ---------------- Hardware helpers ----------------
unsigned long overlayUntil = 0;  // a status message stays on the LCD until this time
long lastShown = -1;             // last timer second drawn, so the LCD only redraws on change

void status(const char* line1, const char* line2) {
#if USE_LCD
  lcd.clear(); lcd.setCursor(0, 0); lcd.print(line1); lcd.setCursor(0, 1); lcd.print(line2);
  overlayUntil = millis() + 3000; if (!overlayUntil) overlayUntil = 1;
  lastShown = -1;
#else
  (void)line1; (void)line2;
#endif
}

// ---------------- LCD timer (SHOW frames from the extension) ----------------
// Value format MODE_SECONDS_DIRECTION_REWARDS, e.g. F_1499_D_3:
//   MODE  I idle, F focus, B break, W blocked-site warning, A look-away warning
//   DIRECTION  D counts down, U counts up, S stopped (paused or idle)
// The board keeps counting between frames; the extension resyncs every 30 s.
char dispMode = 'I', dispDir = 'S';
unsigned long dispSecs = 0, dispAt = 0;
uint8_t dispRewards = 0;

bool parseShow(const char* v) {
  if (!v[0] || !strchr("IFBWA", v[0]) || v[1] != '_') return false;
  const char* p = v + 2; unsigned long secs = 0; uint8_t n = 0;
  while (*p >= '0' && *p <= '9') { secs = secs * 10 + (uint8_t)(*p - '0'); p++; if (++n > 6) return false; }
  if (!n || *p++ != '_') return false;
  if (!*p || !strchr("DUS", *p)) return false;
  const char dir = *p++;
  if (*p++ != '_') return false;
  uint8_t rewards = 0; n = 0;
  while (*p >= '0' && *p <= '9') { rewards = rewards * 10 + (uint8_t)(*p - '0'); p++; if (++n > 2) return false; }
  if (!n || *p) return false;
  dispMode = v[0]; dispSecs = secs; dispDir = dir; dispRewards = rewards; dispAt = millis();
  return true;
}
unsigned long shownSeconds() {
  const unsigned long passed = (millis() - dispAt) / 1000;
  if (dispDir == 'D') return dispSecs > passed ? dispSecs - passed : 0;
  if (dispDir == 'U') return dispSecs + passed;
  return dispSecs;
}
void drawTimer(bool force) {
#if USE_LCD
  if (faultLatched) return;                            // keep the jam message up
  if (overlayUntil) {
    if ((long)(millis() - overlayUntil) < 0) return;   // a status message is showing
    overlayUntil = 0; force = true;
  }
  const unsigned long s = shownSeconds();
  if (!force && (long)s == lastShown) return;
  lastShown = (long)s;
  char line1[17], line2[17], clock[12];
  snprintf(clock, sizeof(clock), "%lu:%02lu", s / 60, s % 60);
  const char* label = dispMode == 'F' ? "Focus" : dispMode == 'B' ? "Break" :
                      dispMode == 'W' ? "Leave site" : dispMode == 'A' ? "Look back" : "Ready";
  if (dispMode == 'I') snprintf(line1, sizeof(line1), "%-16s", calibrated() ? "Ready" : "Ready (test)");
  else snprintf(line1, sizeof(line1), "%-10s%6s", label, clock);
  if (dispMode != 'I' && dispDir == 'S') snprintf(line2, sizeof(line2), "%-16s", "Paused");
  else snprintf(line2, sizeof(line2), "Rewards: %-7u", (unsigned)dispRewards);
  lcd.setCursor(0, 0); lcd.print(line1); lcd.setCursor(0, 1); lcd.print(line2);
#else
  (void)force;
#endif
}
bool rawBlocked() { return (digitalRead(SENSOR_PIN) == LOW) == SENSOR_ACTIVE_LOW; }

// Debounced sensor: a change counts only after it lasts FILTER_MS.
bool filtered = false, lastRaw = false; unsigned long rawSince = 0;
void resetFilter() { filtered = lastRaw = rawBlocked(); rawSince = millis(); }
bool sensorBlocked() {
  const bool raw = rawBlocked(); const unsigned long now = millis();
  if (raw != lastRaw) { lastRaw = raw; rawSince = now; }
  else if (raw != filtered && now - rawSince >= FILTER_MS) filtered = raw;
  return filtered;
}

void servoPower(bool on) {
  if (SERVO_ENABLE_PIN >= 0) digitalWrite(SERVO_ENABLE_PIN, on ? HIGH : LOW);
}
void servoStart(uint16_t firstPulse) {
  servo.writeMicroseconds(firstPulse);       // set the pulse before attaching: no startup jump
  servo.attach(SERVO_PIN, PULSE_MIN_US, PULSE_MAX_US);
  servoPower(true); delay(POWER_SETTLE_MS);
}
void servoStop() { servo.detach(); servoPower(false); digitalWrite(SERVO_PIN, LOW); }

// Chute must be clear for ARM_CLEAR_MS before any motion.
bool chuteArmed() {
  if (!USE_SENSOR) return true;
  resetFilter();
  const unsigned long start = millis(); unsigned long clearSince = start;
  while (millis() - start < ARM_TIMEOUT_MS) {
    if (sensorBlocked()) clearSince = millis();
    else if (millis() - clearSince >= ARM_CLEAR_MS) return true;
  }
  return false;
}

// One dispensing cycle. Returns R_DISPENSED, R_NO_PASSAGE or R_JAM.
char dispenseOnce() {
  status("Dispensing...", "Waiting for treat");
  servoStart(LOAD_US);
  servo.writeMicroseconds(RELEASE_US);
  resetFilter();
  bool sawBlock = false, passage = false; unsigned long blockStart = 0;
  const unsigned long start = millis();
  bool watching = false;
  while (millis() - start < (unsigned long)TRAVEL_MS + RELEASE_DWELL_MS) {
    if (!USE_SENSOR) continue;
    if (millis() - start < TRAVEL_MS) continue;         // ignore the disc moving past the sensor
    if (!watching) { resetFilter(); watching = true; }
    if (sensorBlocked()) {
      if (!sawBlock) { sawBlock = true; blockStart = millis(); }
      if (millis() - blockStart >= JAM_MS) {          // stuck treat: cut power, do not push again
        servoStop(); faultLatched = true;
        status("JAM: power off", "Clear + reset");
        return R_JAM;
      }
    } else if (sawBlock) { passage = true; break; }   // blocked then clear = one treat passed
  }
  servo.writeMicroseconds(LOAD_US);                   // return stroke
  delay(TRAVEL_MS);
  servoStop();
  if (!USE_SENSOR) { status("Done (no sensor)", ""); return R_DISPENSED; }
  if (passage) { status("Enjoy your treat", ""); return R_DISPENSED; }
  status("No treats left", "Please refill");          // nothing broke the beam within 10 s
  overlayUntil = millis() + 10000;                    // keep this message up longer
  return R_NO_PASSAGE;
}

void replyStored(const char* seq, const char* id, char code) {
  if (code == R_DISPENSED) reply(seq, "ACK", id, "DISPENSED");
  else if (code == R_SIMULATED) reply(seq, "ACK", id, "SIMULATED");
  else if (code == R_NO_PASSAGE) reply(seq, "ERR", id, "NO_PASSAGE");
  else if (code == R_JAM) reply(seq, "ERR", id, "CHUTE_JAM");
  else reply(seq, "ERR", id, "ALREADY_ATTEMPTED");    // reset mid-cycle: never repeat the motion
}

// ---------------- Protocol ----------------
void process(char* frame) {
  char* checksum = strrchr(frame, '|'); if (!checksum || strlen(checksum + 1) != 4) return; *checksum++ = 0;
  for (uint8_t i = 0; i < 4; i++) if (!((checksum[i] >= '0' && checksum[i] <= '9') || (checksum[i] >= 'A' && checksum[i] <= 'F'))) return;
  if (crc16(frame) != (uint16_t)strtoul(checksum, NULL, 16)) return;
  char* fields[5]; char* save = NULL;
  for (uint8_t i = 0; i < 5; i++) { fields[i] = strtok_r(i == 0 ? frame : NULL, "|", &save); if (!fields[i]) return; }
  if (strtok_r(NULL, "|", &save) || strcmp(fields[0], "F1") || !decimal(fields[1]) || strlen(fields[1]) > 10) return;
  const char* seq = fields[1]; const char* command = fields[2]; const char* id = fields[3]; const char* value = fields[4];
  if (strcmp(id, "0") && !claimId(id)) return;

  if (!strcmp(command, "HELLO")) { reply(seq, "ACK", id, calibrated() ? "READY_BANK" : "READY_BANK_TEST"); return; }
  if (!strcmp(command, "SHOW")) {
    if (strcmp(id, "0") || !parseShow(value)) { reply(seq, "ERR", id, "BAD_SHOW"); return; }
    drawTimer(true); reply(seq, "ACK", id, "SHOWN"); return;
  }
  if (strcmp(command, "CLAIM")) { reply(seq, "ERR", id, "UNKNOWN_COMMAND"); return; }
  if (!claimId(id) || strcmp(value, "1")) { reply(seq, "ERR", id, "BAD_CLAIM"); return; }

  const int known = findSlot(id);
  if (known >= 0) { replyStored(seq, id, (char)EEPROM.read(known + 33)); return; }

  if (!calibrated()) {                                // test mode: LED only
    const int base = rememberPending(id); setResult(base, R_SIMULATED);
    digitalWrite(LED_BUILTIN, HIGH); ledUntil = millis() + 1000;
    reply(seq, "ACK", id, "SIMULATED"); return;
  }
  if (faultLatched) { reply(seq, "ERR", id, "FAULT_RESET_REQUIRED"); return; }
  if (benchActive) { reply(seq, "ERR", id, "BENCH_MODE"); return; }
  if (!chuteArmed()) {                                 // nothing moved
    status("Sensor blocked", "Check IR sensor"); overlayUntil = millis() + 10000;
    reply(seq, "ERR", id, "CHUTE_BLOCKED"); return;
  }

  const int base = rememberPending(id);               // persist before any motion
  digitalWrite(LED_BUILTIN, HIGH);
  const char result = dispenseOnce();
  digitalWrite(LED_BUILTIN, LOW);
  setResult(base, result);
  replyStored(seq, id, result);
}

// Bench commands typed in a serial monitor (115200 baud, any line ending):
//   i        sensor state: IR=clear / IR=blocked
//   p1500    power the servo and hold this pulse (544-2400 us) to find LOAD_US / RELEASE_US
//   x        release the servo and cut its power
//   s        show mode and settings
void bench(const char* line) {
  if (!strcmp(line, "i")) { Serial.println(rawBlocked() ? F("IR=blocked") : F("IR=clear")); return; }
  if (!strcmp(line, "x")) { servoStop(); benchActive = false; Serial.println(F("SERVO=off")); return; }
  if (!strcmp(line, "s")) {
    Serial.print(F("MODE=")); Serial.print(calibrated() ? F("live") : F("test (servo locked)"));
    Serial.print(F(" LOAD_US=")); Serial.print(LOAD_US);
    Serial.print(F(" RELEASE_US=")); Serial.print(RELEASE_US);
    Serial.print(F(" FAULT=")); Serial.println(faultLatched ? F("yes") : F("no"));
    return;
  }
  if (line[0] == 'p' && decimal(line + 1) && strlen(line + 1) <= 4) {
    const uint16_t us = (uint16_t)atoi(line + 1);
    if (us < PULSE_MIN_US || us > PULSE_MAX_US) { Serial.println(F("PULSE out of range")); return; }
    if (faultLatched) { Serial.println(F("FAULT: reset the Uno first")); return; }
    if (!benchActive) { servoStart(us); benchActive = true; } else servo.writeMicroseconds(us);
    Serial.print(F("PULSE=")); Serial.println(us);
    return;
  }
  Serial.println(F("? commands: i, p<us>, x, s"));
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT); digitalWrite(LED_BUILTIN, LOW);
  if (SERVO_ENABLE_PIN >= 0) { pinMode(SERVO_ENABLE_PIN, OUTPUT); digitalWrite(SERVO_ENABLE_PIN, LOW); }
  pinMode(SERVO_PIN, OUTPUT); digitalWrite(SERVO_PIN, LOW);
  pinMode(SENSOR_PIN, INPUT_PULLUP);
  Serial.begin(115200);
  if (EEPROM.read(0) != 'F' || EEPROM.read(1) != '5') {   // new layout: wipe old claim slots
    for (uint8_t s = 0; s < SLOTS; s++) EEPROM.update(4 + s * SLOT_SIZE, 0);
    EEPROM.update(2, 0); EEPROM.update(0, 'F'); EEPROM.update(1, '5');
  }
#if USE_LCD
  lcd.init(); lcd.backlight();
#endif
  status("Apple Corps", calibrated() ? "Ready" : "Test mode");
}

void loop() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {                       // LF, CR or CRLF all end a line
      if (!overflow && used) {
        input[used] = 0;
        if (!strncmp(input, "F1|", 3)) process(input); else bench(input);
      }
      used = 0; overflow = false;
    } else {
      if (used < sizeof(input) - 1 && !overflow) input[used++] = c; else overflow = true;
    }
  }
  if (ledUntil && (long)(millis() - ledUntil) >= 0) { digitalWrite(LED_BUILTIN, LOW); ledUntil = 0; }
  drawTimer(false);
}
