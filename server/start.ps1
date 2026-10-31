param(
    [Parameter(Mandatory = $true)][string]$Config,
    [string]$Node = 'node.exe'
)
$ErrorActionPreference = 'Stop'
$ConfigPath = (Resolve-Path -LiteralPath $Config).Path
& $Node (Join-Path $PSScriptRoot 'server.mjs') --config $ConfigPath
exit $LASTEXITCODE
