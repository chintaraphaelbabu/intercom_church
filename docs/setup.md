# Setup: Director laptop and Operator phones

This is the whole installation, written for someone who has not built the
project before. It takes one laptop and one Android phone to get talking.

## What you need

- Windows 11 laptop on the church Wi-Fi. Node.js 24 or newer installed once
  from <https://nodejs.org/>.
- Android phone (Android 11 or newer) on the same Wi-Fi.
- Wired headset for each Operator. Bluetooth works but adds latency.

No accounts, cloud service, or internet connection is needed after the first
build. Audio stays on the church LAN.

## 1. Build the Director side (one time)

From the repository folder:

```powershell
npm install
npm run build
```

The launcher also builds automatically if `server/dist` or `server/web-dist`
is missing.

## 2. Start the Director laptop

Double-click `tools\start-church-comms.bat`.

- Windows asks for administrator permission **once** so the launcher can add
  inbound firewall rules: TCP 8765 (control server), TCP 7880 and 7881,
  UDP 7882 (LiveKit). Later launches reuse the rules and do not prompt.
- The launcher downloads the pinned LiveKit server on first run, starts it and
  the control server, writes a log under `logs\`, and opens
  `http://localhost:8765/` in the browser.
- Keep the console window open. Closing it stops LiveKit and the control server.
- While a room is active the launcher stops Windows from sleeping. When the
  last room ends, normal sleep behaviour returns. The screen may still turn off.
- The firewall rules apply to the Private and Domain network profiles. If the
  church Wi-Fi is classified as Public, set it to Private in Windows Settings,
  then run `tools\start-church-comms.bat` again.

If the browser does not open, go to `http://localhost:8765/` manually.

## 3. Install the Operator app

Build the signed APK on the laptop:

```powershell
powershell -ExecutionPolicy Bypass -File tools\build-release-apk.ps1
```

The file appears at `release\church-comms-operator-<version>.apk`. The script
creates `android\keystore\` on first use; keep that folder and its
`android\keystore.properties` file because future updates must be signed with
the same key. Both are gitignored and never committed.

Install it in either way:

- **USB:** enable Developer options and USB debugging, connect the phone, then:
  `powershell -ExecutionPolicy Bypass -File tools\build-release-apk.ps1 -Install`
- **File transfer:** copy the APK to the phone and open it. Android asks to
  allow installation from the file manager or browser; allow it for that app.

The APK is built for `arm64-v8a` and `armeabi-v7a`, and is checked for 16 KB
page-size alignment on Android 15 and newer.

## 4. First run on the phone

1. Connect the phone to the same Wi-Fi as the laptop.
2. Open **Church Comms** and allow microphone and notification permission when
   asked. Both are needed for background audio.
3. Wait for the laptop to appear in the room list. Discovery uses mDNS
   (`_church-comms._tcp.local`), so do not type an address.
4. Choose the room, enter a name, and pick a free camera number.
5. On Xiaomi/OnePlus/Oppo phones, open **Settings → Battery help** in the app
   and follow the steps. OxygenOS may otherwise stop the app when the screen is
   locked. At minimum: set battery optimisation to **Don't optimise**, and allow
   background activity.

## 5. Run a service

1. Director: open the page, create the room (default `MEDIA`), use **Mixer
   View** to check the headset and set volumes, then **Go Live**.
2. Operators join and choose their camera number.
3. Director: switch to **Live View** and turn open mic on.
4. Operators hold **Push to Talk** to speak and release to stop. A short
   vibration confirms the press.
5. Director: **End room** closes it immediately. Operators return to the join
   screen with "Room closed by director".

If the Director's browser closes unexpectedly, Operators see a five-minute
countdown and can keep talking to each other. Reopen the Director page on the
same laptop within five minutes to cancel it. After five minutes the room is
destroyed.

## Troubleshooting

| Symptom | Check |
|---|---|
| Phone shows no laptop | Both devices on the same Wi-Fi; guest/AP isolation is off; mDNS is allowed. Use **Advanced** only if the network blocks mDNS. |
| Laptop appears, control server unreachable | Windows firewall rule TCP 8765; the launcher console still open. |
| Connected but no audio | Firewall TCP 7880/7881 and UDP 7882; the room is live; headset is plugged in; open mic is on. |
| Audio stops when the screen locks | Battery optimisation and background restrictions; see **Settings → Battery help**. |
| "Protocol mismatch" | The APK and server are different versions. Rebuild both from the same commit. |
| "SERVER_UNAVAILABLE" | The laptop or control server stopped. Rooms are in memory and do not survive a restart; start a new room. |
| Room closes after five minutes | The Director's browser was disconnected and did not return in time. |

Logs are in `logs\`. The most recent file is named
`church-comms-YYYYMMDD-HHMMSS.log`. For Android, `adb logcat -s ChurchComms.Audio
ChurchCommsDiscovery` shows route, media, and discovery messages.

## Manual checks

- `npm test` — protocol, server, web, and launcher tests.
- `npm run typecheck` and `npm run build`.
- `cd android; .\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:checkSingleWebRtcProvider`.
- `tools\build-release-apk.ps1` — signed release, 16 KB alignment, signature.
