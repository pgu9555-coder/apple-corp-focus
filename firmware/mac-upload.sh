#!/usr/bin/env bash
# Compile and upload Focus Machine firmware to an Arduino Uno from macOS.
#
#   ./firmware/mac-upload.sh              servo firmware: compile, upload if an Uno is plugged in
#   ./firmware/mac-upload.sh servo monitor   ...then open the serial monitor (Ctrl+C to quit)
#   ./firmware/mac-upload.sh test         the old LED-only test firmware instead
#   ./firmware/mac-upload.sh monitor      only open the serial monitor
#
# Disconnect the device in the Chrome extension before uploading: only one
# program can use the USB serial port at a time.
set -euo pipefail
cd "$(dirname "$0")"

FQBN=arduino:avr:uno
MODE=${1:-servo}
SKETCH=FocusMachineServo
[ "$MODE" = test ] && SKETCH=FocusMachineBankTest

find_cli() {
  if command -v arduino-cli >/dev/null 2>&1; then command -v arduino-cli; return; fi
  if [ -x "$HOME/.local/bin/arduino-cli" ]; then echo "$HOME/.local/bin/arduino-cli"; return; fi
  echo ""
}
CLI=$(find_cli)
if [ -z "$CLI" ]; then
  echo "arduino-cli not found, installing it..."
  if command -v brew >/dev/null 2>&1; then
    brew install arduino-cli
  else
    mkdir -p "$HOME/.local/bin"
    curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | BINDIR="$HOME/.local/bin" sh
  fi
  CLI=$(find_cli)
fi
echo "Using $("$CLI" version)"

find_port() { ls /dev/cu.usbmodem* /dev/cu.usbserial* /dev/cu.wchusbserial* 2>/dev/null | head -n 1 || true; }

if [ "$MODE" = monitor ]; then
  PORT=$(find_port)
  [ -z "$PORT" ] && { echo "No Uno found. Plug it in and try again."; exit 1; }
  exec "$CLI" monitor -p "$PORT" -c baudrate=115200
fi

"$CLI" core update-index >/dev/null
"$CLI" core list | grep -q '^arduino:avr ' || "$CLI" core install arduino:avr
"$CLI" lib list | grep -q '^Servo ' || "$CLI" lib install Servo

echo "Compiling $SKETCH..."
"$CLI" compile --fqbn "$FQBN" "$SKETCH"

PORT=$(find_port)
if [ -z "$PORT" ]; then
  echo "Compiled OK. No Uno found on USB, so nothing was uploaded."
  exit 0
fi
echo "Uploading to $PORT..."
"$CLI" upload -p "$PORT" --fqbn "$FQBN" "$SKETCH"
echo "Upload done."

if [ "${2:-}" = monitor ]; then
  echo "Serial monitor at 115200. Type i, s, p1500 or x and press Enter. Ctrl+C quits."
  exec "$CLI" monitor -p "$PORT" -c baudrate=115200
fi
