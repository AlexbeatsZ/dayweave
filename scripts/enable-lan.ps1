param([string]$InterfaceAlias = 'WLAN 2', [string]$NodePath = (Join-Path $PSScriptRoot '../.local/hub/runtime/node.exe'))
$ErrorActionPreference = 'Stop'
$nodePath = (Resolve-Path -LiteralPath $NodePath -ErrorAction Stop).Path
if (-not (Get-NetAdapter -Name $InterfaceAlias -ErrorAction SilentlyContinue)) { throw 'Select the Wi-Fi adapter with -InterfaceAlias.' }
$rules = @(
    @{ Name = 'Dayweave-Sync-LAN'; DisplayName = 'Dayweave encrypted LAN sync'; Protocol = 'TCP'; LocalPort = 49732 },
    @{ Name = 'Dayweave-Discovery-LAN'; DisplayName = 'Dayweave LAN discovery'; Protocol = 'UDP'; LocalPort = 5353 }
)
foreach ($rule in $rules) {
    if (Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue) { throw ('Rule already exists: ' + $rule.Name) }
}
foreach ($rule in $rules) {
    New-NetFirewallRule @rule -Direction Inbound -Action Allow -Program $nodePath -InterfaceAlias $InterfaceAlias -RemoteAddress LocalSubnet -Profile Private -Enabled True | Out-Null
}
Write-Output 'Allowed TCP 49732 and UDP 5353 for Node on the selected private Wi-Fi subnet.'
Write-Output 'Undo: Remove-NetFirewallRule -Name Dayweave-Sync-LAN,Dayweave-Discovery-LAN'
