@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Existing.ps1"
if errorlevel 1 (
  echo.
  echo Update failed. Keep this message when asking for help.
  pause
)
