#!/usr/bin/env bash
# Set up `adb reverse tcp:8088 tcp:8088` on every connected, authorized phone.
# Usage: ADB_VENDOR_KEYS=/path/to/adbkey tools/reverse-all.sh
set -euo pipefail
adb devices | awk 'NR>1 && $2=="device" {print $1}' | while read -r serial; do
  echo "reverse 8088 on $serial"
  adb -s "$serial" reverse tcp:8088 tcp:8088 >/dev/null
done
adb reverse --list || true
