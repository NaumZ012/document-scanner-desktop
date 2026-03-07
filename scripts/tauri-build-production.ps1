# Build the Tauri production installer with Azure and analyzer config from .env.
# Run from repo root: .\scripts\tauri-build-production.ps1
# This sets AZURE_*_BUILD and AZURE_CU_ANALYZER_*_BUILD so the built app works
# on client PCs without a .env (same values as your .env lines 1-8).

$ErrorActionPreference = "Stop"
# PSScriptRoot = .../document-scanner-desktop/scripts; repo root = parent of scripts
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root ".env"))) {
  Write-Error ".env not found at $root. Create it with AZURE_OCR_* and AZURE_CU_ANALYZER_*."
}
Set-Location $root

function Read-EnvFile {
  param([string]$Path)
  $vars = @{}
  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -le 0) { return }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
    if ($key -ne "") { $vars[$key] = $value }
  }
  return $vars
}

$envVars = Read-EnvFile (Join-Path $root ".env")

# Azure + analyzers: set *_BUILD so Rust bakes them into the binary
$buildVars = @(
  "AZURE_OCR_KEY",
  "AZURE_OCR_ENDPOINT",
  "AZURE_CU_ANALYZER_FAKTURA",
  "AZURE_CU_ANALYZER_SMETKA",
  "AZURE_CU_ANALYZER_GENERIC",
  "AZURE_CU_ANALYZER_PLATA"
)
foreach ($name in $buildVars) {
  $value = $envVars[$name]
  if ($value) {
    [Environment]::SetEnvironmentVariable("${name}_BUILD", $value, "Process")
    Write-Host "Set ${name}_BUILD for production build"
  }
}

# Updater signing: use key file only when it exists and no password is set (unencrypted key).
# With a password, signing is skipped on Windows (Tauri bug). With no password, we pass the key and Tauri signs.
$keyPathFromEnv = $envVars["TAURI_SIGNING_PRIVATE_KEY_PATH"]
$keyFilePath = $null
if ($keyPathFromEnv) {
  $keyFilePath = if ([System.IO.Path]::IsPathRooted($keyPathFromEnv)) { $keyPathFromEnv } else { Join-Path $root $keyPathFromEnv }
}
if (-not $keyFilePath -and (Test-Path (Join-Path $root "update.key") -PathType Leaf)) {
  $keyFilePath = Join-Path $root "update.key"
}
$signingPassword = $envVars["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]
if ($signingPassword) { $signingPassword = $signingPassword.Trim() }

# Clear signing env so we set only what we want
[Environment]::SetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY", $null, "Process")
[Environment]::SetEnvironmentVariable("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", $null, "Process")
Remove-Item -LiteralPath "Env:TAURI_SIGNING_PRIVATE_KEY" -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD" -ErrorAction SilentlyContinue

if ($keyFilePath -and (Test-Path -LiteralPath $keyFilePath -PathType Leaf) -and -not $signingPassword) {
  $keyPathAbsolute = (Resolve-Path -LiteralPath $keyFilePath).Path
  # Run build via a .bat so the signing key path is set in the same process that runs tauri (PowerShell->npm often drops env on Windows)
  $batPath = Join-Path $env:TEMP "tauri-build-with-key.bat"
  $batLine = "set `"TAURI_SIGNING_PRIVATE_KEY=$keyPathAbsolute`""
  $batContent = "@echo off`r`n$batLine`r`ncd /d `"$root`"`r`nnpx tauri build`r`n"
  Set-Content -LiteralPath $batPath -Value $batContent -Encoding ASCII
  Write-Host "Using signing key file: $keyPathAbsolute (no password)"
  Write-Host 'Running tauri build...'
  & cmd /c "`"$batPath`""
  $exitCode = $LASTEXITCODE
  Remove-Item -LiteralPath $batPath -Force -ErrorAction SilentlyContinue
  exit $exitCode
} elseif ($keyFilePath -and $signingPassword) {
  Write-Host 'Password-protected key: building without signing (Windows signing bug).'
  Write-Host 'Running tauri build...'
  & npx tauri build
} else {
  Write-Host 'No unencrypted key (update.key or TAURI_SIGNING_PRIVATE_KEY_PATH): building without signing.'
  Write-Host 'Running tauri build...'
  & npx tauri build
}
