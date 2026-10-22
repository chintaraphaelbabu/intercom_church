#requires -Version 5.1
<#
  Keeps the laptop awake while a Church Comms room is active.

  The launcher starts this script and passes the path to a sentinel file.
  While the file exists the script asks Windows to keep the system awake
  (the display may still sleep). When the launcher removes the file, the
  script clears the request and exits.

  This intentionally does not change the user's power plan. Closing the
  launcher or the room ending releases the request immediately.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$FlagFile
)

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class ChurchCommsPower {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

try {
  Add-Type -TypeDefinition $signature -ErrorAction Stop
} catch {
  # Add-Type fails if the type already exists in this process; that is fine.
}

$ES_CONTINUOUS = [uint32]"0x80000000"
$ES_SYSTEM_REQUIRED = [uint32]"0x00000001"

try {
  while (Test-Path -LiteralPath $FlagFile) {
    [ChurchCommsPower]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
    Start-Sleep -Seconds 20
  }
} finally {
  [ChurchCommsPower]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
}
