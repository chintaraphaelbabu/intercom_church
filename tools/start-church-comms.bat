@echo off
setlocal
title Church Production Comms
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Church Comms needs Node.js 24 or newer on this laptop.
    echo Install it from https://nodejs.org/ and run this launcher again.
    echo.
    pause
    exit /b 1
)

rem The control server and LiveKit need inbound firewall rules. Apply them once
rem with elevation; later launches reuse the existing rules without a UAC prompt.
net session >nul 2>&1
if errorlevel 1 (
    netsh advfirewall firewall show rule name="ChurchComms-Control-8765" >nul 2>&1
    if errorlevel 1 (
        echo.
        echo Windows needs administrator permission once to allow the church Wi-Fi
        echo to reach the control server and LiveKit. Accept the prompt to continue.
        echo.
        powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
        exit /b
    )
)

node tools\launch.mjs
if errorlevel 1 (
    echo.
    pause
)
