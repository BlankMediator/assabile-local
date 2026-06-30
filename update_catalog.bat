@echo off
setlocal
cd /d "%~dp0"
python scripts\sync_catalog.py
echo.
echo Catalogue refresh complete. Restart python server.py if it was already running.
pause
