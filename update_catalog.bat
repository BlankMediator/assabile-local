@echo off
setlocal
cd /d "%~dp0"
set "PYTHON_CMD="
python --version >nul 2>nul
if %errorlevel%==0 set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
  py -3 --version >nul 2>nul
  if %errorlevel%==0 set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
  echo Catalogue refresh failed. Check that Python 3 is installed and available as python or py.
  pause
  exit /b 1
)
%PYTHON_CMD% scripts\sync_catalog.py
if errorlevel 1 (
  echo.
  echo Catalogue refresh failed. Check that Python 3 is installed and available as python or py.
  pause
  exit /b 1
)
echo.
echo Catalogue refresh complete. Restart python server.py if it was already running.
pause
