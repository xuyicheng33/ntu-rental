@echo off
setlocal EnableExtensions

REM NTU Rental Finder - Windows one-click updater.
REM Double-click this file from Explorer.

cd /d "%~dp0\.." || (
  echo Failed to enter project root.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js LTS first: https://nodejs.org/
  pause
  exit /b 1
)

node ".\windows-updater\update-oneclick.mjs"
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
  echo Update finished successfully.
) else (
  echo Update failed with exit code %EXITCODE%.
)
echo Press any key to close this window.
pause >nul
exit /b %EXITCODE%
