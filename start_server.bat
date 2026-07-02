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
  echo Assabile server could not start. Check that Python 3 is installed and available as python or py.
  pause
  exit /b 1
)
%PYTHON_CMD% server.py
if errorlevel 1 (
  echo.
  echo Assabile server could not start. Check that Python 3 is installed and available as python or py.
  pause
)
