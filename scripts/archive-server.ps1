param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Target
)
$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath $Source -DestinationPath $Target -Force
