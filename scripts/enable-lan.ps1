param([string]$InterfaceAlias = 'WLAN 2', [Alias('NodePath')][string]$ProgramPath = (Join-Path $PSScriptRoot '../.local/desktop/Dayweave.exe'))
$ErrorActionPreference = 'Stop'
$programPath = (Resolve-Path -LiteralPath $ProgramPath -ErrorAction Stop).Path
if (-not (Get-NetAdapter -Name $InterfaceAlias -ErrorAction SilentlyContinue)) { throw 'Select the Wi-Fi adapter with -InterfaceAlias.' }
$rules = @(
    @{ Name = 'Dayweave-Sync-LAN'; DisplayName = 'Dayweave encrypted LAN sync'; Protocol = 'TCP'; LocalPort = 49732 },
    @{ Name = 'Dayweave-Discovery-LAN'; DisplayName = 'Dayweave LAN discovery'; Protocol = 'UDP'; LocalPort = 5353 }
)
foreach ($rule in $rules) {
    if (Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue) { throw ('Rule already exists: ' + $rule.Name) }
}
foreach ($rule in $rules) {
    New-NetFirewallRule @rule -Direction Inbound -Action Allow -Program $programPath -InterfaceAlias $InterfaceAlias -RemoteAddress LocalSubnet -Profile Private -Enabled True | Out-Null
}
Write-Output 'Allowed TCP 49732 and UDP 5353 for the selected Dayweave process on the private Wi-Fi subnet.'
Write-Output 'Undo: Remove-NetFirewallRule -Name Dayweave-Sync-LAN,Dayweave-Discovery-LAN'
