param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$SetupJinaArgs
)

$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
Set-Location $Root

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'pnpm not found on PATH. Install pnpm and try again.'
}

Write-Host '[1/2] Installing app dependencies...'
& pnpm --dir (Join-Path $Root 'app') install

Write-Host '[2/2] Running Jina model setup...'
& (Join-Path $Root 'setup-jina.sh') @SetupJinaArgs

Write-Host 'Setup complete.'
