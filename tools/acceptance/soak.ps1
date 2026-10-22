#requires -Version 5.1
<#
  Collects a locked-screen soak sample from one Android device.

  It does NOT join a room for you: join the room and start audio first, then
  run this script. It locks the screen, samples the process and audio route
  every 30 seconds, and writes a markdown result file.

  Usage:
    powershell -ExecutionPolicy Bypass -File tools\acceptance\soak.ps1 `
      -Serial R9BN805K1GJ -Minutes 30 -Label "03-locked-screen"
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Serial,
  [Parameter(Mandatory = $true)]
  [int]$Minutes,
  [string]$Label = "soak",
  [string]$Package = "com.churchcomms.operator"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $root "docs\acceptance-results"
New-Item -ItemType Directory -Force $outDir | Out-Null
$logPath = Join-Path $outDir "$stamp-$Label-logcat.txt"
$resultPath = Join-Path $outDir "$stamp-$Label.md"

function Adb([string[]]$Arguments) {
  & adb -s $Serial @Arguments
}

Write-Output "Device: $Serial"
$model = (Adb @("shell", "getprop", "ro.product.model")) -join ""
$android = (Adb @("shell", "getprop", "ro.build.version.release")) -join ""
$pidBefore = (Adb @("shell", "pidof", $Package)) -join ""
if (-not $pidBefore) {
  throw "$Package is not running. Join a room first."
}

Adb @("logcat", "-c") | Out-Null
$logJob = Start-Job -ScriptBlock {
  param($serial, $path)
  & adb -s $serial logcat -b all -v time *> $path
} -ArgumentList $Serial, $logPath

Adb @("shell", "input", "keyevent", "26") | Out-Null
Start-Sleep -Seconds 2
$power = (Adb @("shell", "dumpsys", "power")) -join "`n"
$keyguard = (Adb @("shell", "dumpsys", "window")) -join "`n"
$screenOff = $power -match "mWakefulness=Asleep|Display Power: state=OFF"
$locked = $keyguard -match "isKeyguardShowing=true|mDreamingLockscreen=true"

$samples = @()
$deadline = (Get-Date).AddMinutes($Minutes)
$crashes = @()
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 30
  $pidNow = (Adb @("shell", "pidof", $Package)) -join ""
  $audio = (Adb @("shell", "dumpsys", "audio")) -join "`n"
  $focus = if ($audio -match "Audio Focus stack entries.*?$([regex]::Escape($Package))") { "present" }
    elseif ($audio -match $Package) { "mentioned" } else { "not found" }
  $crashBuffer = (Adb @("logcat", "-b", "crash", "-d")) -join "`n"
  if ($crashBuffer -match "FATAL EXCEPTION|ANR in $([regex]::Escape($Package))") {
    $crashes += $crashBuffer
  }
  $samples += [pscustomobject]@{
    Time = (Get-Date).ToString("HH:mm:ss")
    Pid = $pidNow
    AudioFocus = $focus
  }
  Write-Output "$((Get-Date).ToString('HH:mm:ss')) pid=$pidNow audio=$focus"
}

Stop-Job $logJob -ErrorAction SilentlyContinue
Receive-Job $logJob -ErrorAction SilentlyContinue | Out-Null
Remove-Job $logJob -Force -ErrorAction SilentlyContinue

$pidAfter = (Adb @("shell", "pidof", $Package)) -join ""
$logText = if (Test-Path $logPath) { Get-Content $logPath -Raw } else { "" }
$fatal = $logText -match "FATAL EXCEPTION"
$anr = $logText -match "ANR in"
$disconnect = $logText -match "Media connection closed|Disconnected from the control server"

$result = @"
# Acceptance sample: $Label

- Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
- Device: $model (Android $android), serial `$Serial`
- Duration: $Minutes minutes
- Package: $Package

## Setup

- Screen off at start: $screenOff
- Keyguard showing at start: $locked
- PID before: $pidBefore
- PID after: $pidAfter

## Samples

| Time | PID | Audio focus |
|---|---|---|
$(($samples | ForEach-Object { "| $($_.Time) | $($_.Pid) | $($_.AudioFocus) |" }) -join "`n")

## Result

- Process alive throughout: $([bool]($samples | Where-Object { -not $_.Pid } | Measure-Object).Count -eq 0)
- FATAL EXCEPTION in logcat: $fatal
- ANR in logcat: $anr
- Unplanned disconnect text in logcat: $disconnect
- Crash buffer hits: $($crashes.Count)

## Log

Full logcat: `$(Split-Path -Leaf $logPath)`

## Notes

Hardware result collected by `tools/acceptance/soak.ps1`. Acoustic audio quality
must still be confirmed by a person wearing the headset.
"@

$result | Set-Content -Encoding UTF8 $resultPath
Write-Output "Wrote $resultPath"
Write-Output "Wrote $logPath"
