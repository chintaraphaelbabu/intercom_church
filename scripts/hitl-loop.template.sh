#!/bin/bash
# HITL loop — archived; original red/green screenshots saved to /tmp/screen_*.png
# Root cause found: 2-device camera-1 conflict (server validates slots).
# Adjust TAP_X / TAP_Y for actual Join button location

DEVICE1="CIHQEE4X4X8DBQYX"
DEVICE2="R9BN805K1GJ"

echo "=== Phase 1 loop: join room with Camera 1 on both devices ==="

# Tap approximate Join button area (adjust coordinates as needed)
TAP_X=540
TAP_Y=1200

echo "[1/2] Tapping Join on OnePlus (${DEVICE1})..."
adb -s ${DEVICE1} shell input tap ${TAP_X} ${TAP_Y}

echo "[2/2] Tapping Join on Samsung (${DEVICE2})..."
adb -s ${DEVICE2} shell input tap ${TAP_X} ${TAP_Y}

echo "=== Check symptoms (screenshots) ==="
sleep 2
adb -s ${DEVICE1} shell screencap -p /sdcard/screen_1.png && adb -s ${DEVICE1} pull /sdcard/screen_1.png /tmp/screen_1_device1.png
echo "Screenshot 1 saved: /tmp/screen_1_device1.png"
adb -s ${DEVICE2} shell screencap -p /sdcard/screen_2.png && adb -s ${DEVICE2} pull /sdcard/screen_2.png /tmp/screen_2_device2.png
echo "Screenshot 2 saved: /tmp/screen_2_device2.png"

echo "Pulling logcat from OnePlus..."
adb -s ${DEVICE1} logcat -d -t 20 > /tmp/logcat_1.txt

echo "Pulling logcat from Samsung..."
adb -s ${DEVICE2} logcat -d -t 20 > /tmp/logcat_2.txt

echo "=== Results ==="
echo "--- OnePlus (${DEVICE1}) ---"
findstr /i /c:"LiveKit" /c:"taken" /c:"Camera" /tmp/logcat_1.txt || echo "No matches in log 1"
echo "--- Samsung (${DEVICE2}) ---"
findstr /i /c:"LiveKit" /c:"taken" /c:"Camera" /tmp/logcat_2.txt || echo "No matches in log 2"
