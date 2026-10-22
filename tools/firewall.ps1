#requires -Version 5.1
<#
  Adds the Windows Firewall rules Church Comms needs on the Director's laptop.

  Usage (from an elevated PowerShell):
    powershell -ExecutionPolicy Bypass -File tools\firewall.ps1

  The launcher runs this through start-church-comms.bat, which self-elevates.
  Rules are idempotent: running this twice does not create duplicates.
#>
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
  Write-Error "Firewall rules need an elevated PowerShell. Right-click start-church-comms.bat and choose Run as administrator, or run this script from an elevated prompt."
  exit 2
}

$rules = @(
  @{ Name = "ChurchComms-Control-8765"; Direction = "inbound"; Protocol = "TCP"; LocalPort = 8765 },
  @{ Name = "ChurchComms-LiveKit-7880"; Direction = "inbound"; Protocol = "TCP"; LocalPort = 7880 },
  @{ Name = "ChurchComms-LiveKit-7881"; Direction = "inbound"; Protocol = "TCP"; LocalPort = 7881 },
  @{ Name = "ChurchComms-LiveKit-7882"; Direction = "inbound"; Protocol = "UDP"; LocalPort = 7882 }
)

foreach ($rule in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
  if ($null -eq $existing) {
    New-NetFirewallRule `
      -DisplayName $rule.Name `
      -Direction $rule.Direction `
      -Action Allow `
      -Protocol $rule.Protocol `
      -LocalPort $rule.LocalPort `
      -Profile Private, Domain `
      -Description "Church Production Comms ($($rule.Protocol) $($rule.LocalPort))" | Out-Null
    Write-Output "Added firewall rule $($rule.Name)."
  } else {
    Set-NetFirewallRule -DisplayName $rule.Name -Enabled True -Action Allow -Profile Private, Domain | Out-Null
    Write-Output "Firewall rule $($rule.Name) already exists; enabled."
  }
}

$livekitExe = Join-Path $Root "tools\livekit\livekit-server.exe"
if (Test-Path $livekitExe) {
  $programRuleName = "ChurchComms-LiveKit-Program"
  $existing = Get-NetFirewallRule -DisplayName $programRuleName -ErrorAction SilentlyContinue
  if ($null -eq $existing) {
    New-NetFirewallRule `
      -DisplayName $programRuleName `
      -Direction Inbound `
      -Action Allow `
      -Program $livekitExe `
      -Profile Private, Domain `
      -Description "Church Production Comms LiveKit server" | Out-Null
    Write-Output "Added firewall rule $programRuleName."
  } else {
    Set-NetFirewallRule -DisplayName $programRuleName -Enabled True -Action Allow -Profile Private, Domain | Out-Null
    Write-Output "Firewall rule $programRuleName already exists; enabled."
  }

  # Earlier manual troubleshooting created block rules for the same executable.
  # Block rules win over allow rules, so remove only those that point at this
  # exact program and are explicitly blocking.
  $blocking = Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue |
    Where-Object {
      $filter = $_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
      $filter -and $filter.Program -and ($filter.Program -ieq $livekitExe)
    }
  foreach ($rule in $blocking) {
    Remove-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue
    Write-Output "Removed blocking firewall rule $($rule.DisplayName)."
  }
}

Write-Output "Church Comms firewall rules are in place for the Private and Domain profiles."
Write-Output "If the church Wi-Fi is classified as Public, set it to Private or add the same rules for the Public profile."
