@echo off
rem Starts PlaylistPusher. You can also drag a track list file onto this file.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0playlistpusher.py" %*
) else (
  python "%~dp0playlistpusher.py" %*
)
if errorlevel 1 pause
