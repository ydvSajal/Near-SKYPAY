@echo off
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy RemoteSigned -File "%SCRIPT_DIR%start-project.ps1"
