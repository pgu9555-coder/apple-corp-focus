# Focus Machine servo firmware

Arduino Uno firmware for the treat dispenser. It speaks the same USB serial
protocol as `FocusMachineBankTest`, so the Chrome extension (v0.5.x) works with
it unchanged.

Status: compiles for the Uno with arduino-cli 1.5.1. It has not run on real
hardware yet.

## Wiring

| Uno pin | Connects to | Notes |
|---|---|---|
| D8 | Servo signal | |
| D3 | Chute exit sensor (FC-51) output | Set `SENSOR_ACTIVE_LOW` to match the sensor |
| A4 / A5 | I2C LCD SDA / SCL | Only used when `USE_LCD` is 1 |
| 5V | Servo, sensor and LCD power (breadboard rail, capacitor near the servo) | No power switch: `SERVO_ENABLE_PIN = -1` |
| GND | Servo supply ground | Grounds must be joined |

Power the servo from 4.8 to 6 V. Do not connect a 9 V battery straight to the
servo; put a 5 V regulator in between.

## LCD timer

With `USE_LCD 1` (the default) the 16x2 I2C LCD shows what the extension timer shows:

| LCD | Meaning |
|---|---|
| `Focus      24:59` | Focus time left (Quiet Flow after the first goal: time to the next reward) |
| `Break       4:59` | Break time left |
| `Leave site  0:08` / `Look back   0:08` | Warning countdown |
| `Paused` on line 2 | Session paused |
| `Rewards: 3` on line 2 | Rewards ready to collect |

Install **LiquidCrystal I2C** (Frank de Brabander) in Library Manager. If the screen stays blank, change `0x27` to `0x3F` in the `lcd(...)` line; if it shows only blocks, turn the contrast screw on the backpack. Set `USE_LCD 0` if no LCD is connected.

The LCD only displays; timing and rewards stay in the extension.

## Safe default

`LOAD_US` and `RELEASE_US` start at 0. While either one is 0 the servo never
moves. The board then reports test mode to the extension, and Collect only
flashes the built-in LED and replies `SIMULATED`.

## Test on a Mac

1. Open Terminal in the repo folder and make the script runnable (first time only):
   `chmod +x firmware/mac-upload.sh`
2. Plug the Uno in by USB. In the extension, disconnect the device if it is connected.
3. Compile, upload and open the serial monitor:
   `./firmware/mac-upload.sh servo monitor`
   The first run installs arduino-cli (Homebrew if present), the Uno core and the Servo library.
4. In the monitor, type `s` and press Enter. It should print `MODE=test (servo locked)`.

Arduino IDE 2 works too: open `FocusMachineServo.ino`, choose Arduino Uno and
the `/dev/cu.usbmodem…` port, install the Servo library, then Upload. Set the
Serial Monitor to 115200 baud.

## Calibrate the two servo positions

Do this with the horn off the rotor (or the mechanism empty), servo power on.

| Command | Effect |
|---|---|
| `p1500` | Power the servo and hold a 1500 µs pulse (544 to 2400 allowed) |
| `x` | Release the servo and cut its power |
| `i` | Sensor state: `IR=clear` or `IR=blocked` |
| `s` | Mode, pulse settings, fault state |

1. Send `p` values until the pocket sits under the magazine. Record that value as `LOAD_US`.
2. Find the value that puts the pocket over the outlet, 120° away. Record it as `RELEASE_US`.
3. Send `x`. Write both numbers into the top of `FocusMachineServo.ino` and upload again.
4. `s` should now print `MODE=live`.
5. Check the sensor with `i`: an empty chute must read `IR=clear`, and a hand-held treat must read `IR=blocked`.

## Full test with the extension

1. Quit the serial monitor (Ctrl+C), since it holds the USB port.
2. In Chrome, open the extension and connect the device.
3. Earn a reward (use a short focus length), then press Collect.

| Device reply | What happened | Extension shows |
|---|---|---|
| `DISPENSED` | The sensor saw a treat pass | Confirmed |
| `ERR CHUTE_BLOCKED` | The chute was blocked before the start, so nothing moved | Unconfirmed |
| `ERR NO_PASSAGE` | No treat broke the IR beam within 10 s: out of treats. LCD shows "No treats left / Please refill" | Unconfirmed: "machine is out of treats" |
| `ERR CHUTE_JAM` | Blocked for 300 ms; servo power was cut | Unconfirmed |
| `ERR FAULT_RESET_REQUIRED` | An earlier jam has not been cleared | Unconfirmed |

After a jam, disconnect servo power, clear the chute, then press the Uno's reset button.

A claim ID is saved in EEPROM before the servo moves. A repeated or interrupted
claim never moves the servo a second time.
