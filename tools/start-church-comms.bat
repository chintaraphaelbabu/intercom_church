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

node tools\launch.mjs
if errorlevel 1 (
    echo.
    pause
)
