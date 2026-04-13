# Create repo-root .venv with Python 3.11 and embedding-host/requirements.txt (same as setup.sh)
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
Set-Location $Root

$Req = Join-Path $Root 'embedding-host\requirements.txt'
if (-not (Test-Path -LiteralPath $Req)) {
  throw "Missing requirements file: $Req"
}

$Venv = Join-Path $Root '.venv'
$PyInVenv = Join-Path $Venv 'Scripts\python.exe'

function New-Venv311 {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    & py -3.11 -m venv $Venv
    return
  }
  $py311 = Get-Command python3.11 -ErrorAction SilentlyContinue
  if ($py311) {
    & $py311.Source -m venv $Venv
    return
  }
  throw 'Python 3.11 not found. Install Python 3.11 and ensure `py -3.11` or `python3.11` is on PATH.'
}

if (-not (Test-Path -LiteralPath $PyInVenv)) {
  New-Venv311
}

& $PyInVenv -m pip install --upgrade pip
& $PyInVenv -m pip install -r $Req

Write-Host "Done. Virtual environment: $Venv"
