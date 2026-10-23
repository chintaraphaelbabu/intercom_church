# Release APK install check — v0.1.0 / OnePlus Nord CE 5 (Android 16)

## Source APK inspected
`android/app/build/outputs/apk/release/app-release-unsigned.apk` (84 MB, built 22-10-2026 17:00)

## aapt dump badging (v36.0.0)
- package: `com.churchcomms.operator`
- versionCode=`1`, versionName=`0.1.0`
- sdkVersion=`30` (minSdk 30) → device OK (Android 16 >= 30)
- targetSdkVersion=`36` → matches Android 16 / compileSdk 36
- compileSdkVersion=`36`, platformBuildVersionCode=`36`
- native-code: `arm64-v8a`, `armeabi-v7a`, `armeabi`, `mips`, `mips64`, `x86`, `x86_64`
- supports-screens: small/normal/large/xlarge; supports-any-density=true
- permissions include CAMERA, RECORD_AUDIO, BLUETOOTH (maxSdk 30), FOREGROUND_SERVICE, INTERNET, etc.

## Architecture vs device
OnePlus Nord CE 5: `arm64-v8a` (device) + Android 16. APK includes `arm64-v8a` and `armeabi-v7a`; multi-arch present. No architecture blocker.

## Signing state
- Filename is `app-release-unsigned.apk` → **unsigned**.
- `META-INF/` present but no `CERT.RSA`/`CERT.DSA`; not signed with release keystore.
- `docs/setup.md` §3: correct release file is `release/church-comms-operator-<version>.apk`, produced by `tools/build-release-apk.ps1` (creates `android/keystore/` + `keystore.properties`).
- `android/keystore/` does **not** exist → release signing key missing; cannot sign existing unsigned APK with original key.
- **Blocker**: Android 16 refuses install of unsigned APK from file manager (only signed/debug with adb install -t, or via app store). GitHub release upload is likely this unsigned artifact — install will fail with "App not installed" / parsing error / no signature.

## Alignment
- `zipalign -c -v 4`: all entries OK (4-byte aligned).
- `zipalign -c -P 16 -v 4`: exit 0, `Verification successful` → 16 KB page alignment passes (required for Android 15+/targetSdk 36).
- No alignment blocker.

## Version / code
- versionCode `1`, versionName `0.1.0`. Matches v0.1.0 tag expectation (no git tag found, but build metadata consistent).

## docs/setup.md install requirements (§3, §5)
- Build signed APK via `tools/build-release-apk.ps1`.
- APK must be signed; updates require same keystore.
- 16 KB page alignment verified by script (line 117-120).
- Battery optimisation / background activity needed on OnePlus/OxygenOS (line 78-80). Not an install blocker.

## Fixability assessment
- **Sign**: fixable if `android/keystore/` exists or can be recreated (`-RecreateKey`), but new key = new app identity; updates over existing v0.1.0 install will not work — users must uninstall/reinstall.
- **Align**: already passes.
- **Multi-arch**: already includes arm64-v8a + armeabi-v7a.
- **Real fix**: rebuild with `build-release-apk.ps1` using original `android/keystore/`; if key lost, document as device/blocker for updates.

## Verdict
**Not fixable from this file alone — blocker is missing release signing key / unsigned artifact.** The APK at the inspected path is the intermediate unsigned build output, not the signed release required by `docs/setup.md`. OnePlus Nord CE 5 / Android 16 is compatible (arch, SDK, alignment). Install fails because APK is unsigned.

## 1-line proposed fix (if keystore preserved)
`powershell -ExecutionPolicy Bypass -File tools\build-release-apk.ps1` (requires existing `android/keystore/`; else `-RecreateKey` with uninstall/reinstall disclaimer).
