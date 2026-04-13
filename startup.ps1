# Identical behavior to startup.sh — run from repo root: .\startup.ps1 [dev|preview]
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
Set-Location $Root

# Load .env if exists
$EnvFile = Join-Path $Root '.env'
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^(.+?)=(.+)$') {
      [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
    }
  }
}

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

# Find llama-server — prefer the Jina fork build, then generic llama.cpp, then PATH
function Find-LlamaServer {
  $candidates = @(
    (Join-Path $Root 'jina-llama.cpp\build\bin\llama-server.exe'),
    (Join-Path $Root 'llama.cpp\build\bin\llama-server.exe'),
    (Get-Command llama-server.exe -ErrorAction SilentlyContinue)?.Source
  )
  foreach ($cmd in $candidates) {
    if ($cmd -and (Test-Path $cmd)) {
      return $cmd
    }
  }
  return 'llama-server.exe'
}

$LlamaServer = Find-LlamaServer

# Model configuration (from env or defaults)
$ModelDir = if ($env:EMBEDDING_MODEL_DIR) { $env:EMBEDDING_MODEL_DIR } else { Join-Path $Root 'models' }
# Defaults match https://huggingface.co/jinaai/jina-embeddings-v4-text-retrieval-GGUF/tree/main
$ModelGgufName = if ($env:EMBEDDING_GGUF_FILENAME) { $env:EMBEDDING_GGUF_FILENAME } else { 'jina-embeddings-v4-text-retrieval-Q4_K_M.gguf' }
$MmprojGgufName = if ($env:EMBEDDING_MMPROJ_FILENAME) { $env:EMBEDDING_MMPROJ_FILENAME } else { 'mmproj-jina-embeddings-v4-retrieval-BF16.gguf' }

$ModelGguf = Join-Path $ModelDir $ModelGgufName
$MmprojGguf = Join-Path $ModelDir $MmprojGgufName

Write-Host "llama-server: $LlamaServer"
Write-Host "Model:  $ModelGguf"
Write-Host "Mmproj: $MmprojGguf"

$ChildProcesses = [System.Collections.ArrayList]::new()

# Start llama-server for multimodal embeddings (requires Jina fork + model files)
if ((Test-Path $ModelGguf) -and (Test-Path $MmprojGguf)) {
  Write-Host "Starting llama-server with jina-embeddings-v4 multimodal embeddings..."
  $null = $ChildProcesses.Add((
      Start-Process -FilePath $LlamaServer -ArgumentList @(
          '-m', $ModelGguf,
          '--mmproj', $MmprojGguf,
          '--embedding',
          '--pooling', 'none',
          '-c', '8192',
          '-ub', '8192',
          '-np', '1',
          '--port', '8080'
        ) -PassThru -NoNewWindow
    ))
  [Environment]::SetEnvironmentVariable('MULTIMODAL_EMBEDDING_URL', 'http://127.0.0.1:8080/embeddings')
}
else {
  Write-Host ""
  Write-Host "ERROR: Jina model files not found."
  Write-Host "  Expected: $ModelGguf"
  Write-Host "  Expected: $MmprojGguf"
  Write-Host ""
  Write-Host "Run .\setup-jina.ps1 (or setup-jina.sh on Linux/macOS) to build the"
  Write-Host "Jina llama.cpp fork and download model files, then re-run this script."
  Write-Host ""
  Write-Host "Continuing without embedding server — search will be unavailable."
}

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
