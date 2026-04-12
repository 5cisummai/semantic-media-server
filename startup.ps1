# Identical behavior to startup.sh — run from repo root: .\startup.ps1 [dev|preview]
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
Set-Location $Root

function Show-Usage {
  param([string] $ScriptName)
  Write-Host "Usage: $ScriptName {dev|preview}"
  Write-Host "  dev     - pnpm dev --host"
  Write-Host "  preview - pnpm build && pnpm preview --host"
}

$Mode = if ($args.Count -gt 0) { $args[0] } else { 'dev' }
switch ($Mode) {
  { $_ -in 'dev', 'preview' } { break }
  { $_ -in '-h', '--help' } {
    Show-Usage -ScriptName (Split-Path -Leaf $PSCommandPath)
    exit 0
  }
  default {
    Show-Usage -ScriptName (Split-Path -Leaf $PSCommandPath)
    exit 1
  }
}

# Postgres + Qdrant — start first so services are up before the apps connect
docker compose up -d

$AppDir = Join-Path $Root 'app'
$EmbedDir = Join-Path $Root 'embedding-host'

$PyExe = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $PyExe)) {
  $pyCmd = Get-Command python -ErrorAction SilentlyContinue
  $PyExe = if ($pyCmd) { $pyCmd.Source } else { 'python' }
}

$ChildProcesses = [System.Collections.ArrayList]::new()

if ($Mode -eq 'dev') {
  $null = $ChildProcesses.Add((
      Start-Process -FilePath 'pnpm' -ArgumentList @('dev', '--host') -WorkingDirectory $AppDir -PassThru -NoNewWindow
    ))
}
else {
  $null = $ChildProcesses.Add((
      Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'pnpm build && pnpm preview --host') -WorkingDirectory $AppDir -PassThru -NoNewWindow
    ))
}

$null = $ChildProcesses.Add((
    Start-Process -FilePath $PyExe -ArgumentList @(
        '-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8000'
      ) -WorkingDirectory $EmbedDir -PassThru -NoNewWindow
  ))

try {
  Wait-Process -InputObject @($ChildProcesses.ToArray())
}
finally {
  foreach ($p in $ChildProcesses) {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
