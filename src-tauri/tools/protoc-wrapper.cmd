@echo off
setlocal
set "ROOT=%LOCALAPPDATA%\workshadow-protoc"
if not exist "%ROOT%\protoc.exe" (
  echo [workshadow] protoc not installed. Run: npm run tauri:setup-protoc
  exit /b 1
)
"%ROOT%\protoc.exe" -I"%ROOT%\include" %*
