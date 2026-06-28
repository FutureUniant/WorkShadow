# Install protoc + google well-known protos to an ASCII-only path (avoids Windows
# Unicode path issues when building lance-* crates in this repo).
# Run automatically via `npm run tauri` / `npm run tauri:setup-protoc`.

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$grpcBin = Join-Path $root "node_modules\grpc-tools\bin"
$dest = Join-Path $env:LOCALAPPDATA "workshadow-protoc"
$include = Join-Path $dest "include"

if (-not (Test-Path (Join-Path $grpcBin "protoc.exe"))) {
  throw "grpc-tools protoc not found. Run: npm install"
}

New-Item -ItemType Directory -Path $include -Force | Out-Null
Copy-Item (Join-Path $grpcBin "protoc.exe") (Join-Path $dest "protoc.exe") -Force
Copy-Item (Join-Path $grpcBin "google") (Join-Path $include "google") -Recurse -Force

$ver = & (Join-Path $dest "protoc.exe") --version
Write-Host "protoc ready at $dest ($ver)"
