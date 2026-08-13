@echo off
chcp 65001 >nul
title Family Market - обновление данных
cd /d "%~dp0"
echo Запускаю полное обновление: снимок остатков + сборка + публикация...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update_all.ps1"
echo.
echo Готово. Окно можно закрыть. Обновите сайт через Ctrl+F5 через 1-2 минуты.
pause
