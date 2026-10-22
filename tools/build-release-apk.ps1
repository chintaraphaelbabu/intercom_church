#requires -Version 5.1
<#
  Builds the signed Operator release APK, verifies its 16 KB page alignment,
  and copies it to release\church-comms-operator-<version>.apk.

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\build-release-apk.ps1
    powershell -ExecutionPolicy Bypass -File tools\build-release-apk.ps1 -Install
    powershell -ExecutionPolicy Bypass -File tools\build-release-apk.ps1 -RecreateKey

  The signing keystore and password live in android\keystore\ and
  android\keystore.properties. Both are gitignored. Keep them: Android only
  installs an update over an existing app when it is signed with the same key.
#>
param(
  [switch]$Install,
  [switch]$RecreateKey
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$android = Join-Path $root "android"
$keystoreDir = Join-Path $android "keystore"
$keystore = Join-Path $keystoreDir "church-comms-release.jks"
$propertiesFile = Join-Path $android "keystore.properties"
$alias = "churchcomms"

function Find-AndroidSdk {
  $localProperties = Join-Path $android "local.properties"
  if (Test-Path $localProperties) {
    $line = Get-Content $localProperties |
      Where-Object { $_ -match '^sdk\.dir=' } |
      Select-Object -First 1
    if ($line) {
      $value = $line.Substring("sdk.dir=".Length)
      $value = $value.Replace("\:", ":").Replace("\\", "\")
      if (Test-Path $value) {
        return $value
      }
    }
  }
  if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) {
    return $env:ANDROID_HOME
  }
  if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) {
    return $env:ANDROID_SDK_ROOT
  }
  throw "Android SDK not found. Set sdk.dir in android\local.properties or ANDROID_HOME."
}

function Find-BuildTool([string]$sdk, [string]$name) {
  $buildTools = Get-ChildItem (Join-Path $sdk "build-tools") -Directory |
    Sort-Object { [version]$_.Name } -Descending
  foreach ($tool in $buildTools) {
    $candidate = Join-Path $tool.FullName "$name.exe"
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  throw "$name.exe was not found in the Android SDK build-tools."
}

if ($RecreateKey -or -not (Test-Path $keystore)) {
  New-Item -ItemType Directory -Force $keystoreDir | Out-Null
  $password = [Convert]::ToBase64String(
    (1..24 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 })
  )
  Write-Output "Creating a release signing key at $keystore"
  & keytool -genkeypair `
    -keystore $keystore `
    -alias $alias `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -storepass $password `
    -keypass $password `
    -dname "CN=Church Production Comms, OU=Media, O=Church, L=Local, C=US" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "keytool could not create the release keystore."
  }
  @"
storeFile=keystore/church-comms-release.jks
storePassword=$password
keyAlias=$alias
keyPassword=$password
"@ | Set-Content -Encoding ASCII $propertiesFile
  Write-Output "Wrote $propertiesFile (gitignored)."
}

if (-not (Test-Path $propertiesFile)) {
  throw "android\keystore.properties is missing. Run with -RecreateKey if the keystore was lost."
}

$versionLine = Select-String -Path (Join-Path $android "app\build.gradle.kts") `
  -Pattern 'versionName\s*=\s*"([^"]+)"' | Select-Object -First 1
$version = if ($versionLine) { $versionLine.Matches[0].Groups[1].Value } else { "dev" }

Push-Location $android
try {
  Write-Output "Building the signed release APK (version $version)..."
  & .\gradlew.bat :app:assembleRelease :app:checkSingleWebRtcProvider
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle could not build the release APK."
  }
} finally {
  Pop-Location
}

$apk = Join-Path $android "app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $apk)) {
  throw "Expected APK was not produced at $apk"
}

$sdk = Find-AndroidSdk
$zipalign = Find-BuildTool $sdk "zipalign"
Write-Output "Checking 16 KB page-size alignment..."
& $zipalign -c -P 16 -v 4 $apk | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "The release APK does not pass the 16 KB page-size alignment check."
}

$apksigner = Find-BuildTool $sdk "apksigner"
& $apksigner verify --verbose $apk | Select-Object -First 6
if ($LASTEXITCODE -ne 0) {
  throw "The release APK signature could not be verified."
}

$releaseDir = Join-Path $root "release"
New-Item -ItemType Directory -Force $releaseDir | Out-Null
$target = Join-Path $releaseDir "church-comms-operator-$version.apk"
Copy-Item -Force $apk $target
Write-Output "Signed APK: $target"

if ($Install) {
  $devices = adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\sdevice$" }
  if (-not $devices) {
    throw "No Android device is connected over USB debugging."
  }
  foreach ($device in $devices) {
    $serial = ($device -split "\s+")[0]
    Write-Output "Installing on $serial..."
    & adb -s $serial install -r $target
    if ($LASTEXITCODE -ne 0) {
      throw "adb install failed on $serial."
    }
  }
  Write-Output "Installed. Open Church Comms on the phone and join the church Wi-Fi."
}
