@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-ContextCanvas.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Keep this message when asking for help.
  pause
)
