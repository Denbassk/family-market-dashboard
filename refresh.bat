@echo off
chcp 65001 >nul
title Обновление остатков Family Market
cd /d "D:\Dashbord_FAMILY MARKET\family-dashboard-full\deploy_full"

set PYTHONUTF8=1
set GOOGLE_APPLICATION_CREDENTIALS=D:\Dashbord_FAMILY MARKET\family-dashboard-full\deploy_full\credentials\family-market-analytics-23fbcbcee571c.json
set OUT_PATH=docs\stale.json

echo [1/3] Выгрузка из BigQuery, это 1-3 минуты...
python scripts\fetch_stale.py
if errorlevel 1 goto err

echo [2/3] Коммит...
git add docs/stale.json docs/index.html
git commit -m "stale: обновление остатков %date%"

echo [3/3] Отправка на GitHub...
git pull --no-rebase --no-edit origin main
if errorlevel 1 goto conflict
git push origin main
if errorlevel 1 goto err

echo.
echo ============================================
echo  ГОТОВО. Через минуту жми Ctrl+Shift+R
echo ============================================
pause
exit /b

:conflict
echo.
echo Конфликт при pull. Беру локальную версию stale.json...
git checkout --ours docs/stale.json
git add docs/stale.json
git commit --no-edit
git push origin main
if errorlevel 1 goto err
echo ГОТОВО (после разрешения конфликта)
pause
exit /b

:err
echo.
echo *** ОШИБКА - смотри сообщение выше ***
pause