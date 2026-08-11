@echo off
title Family Market - refresh stock
cd /d "D:\Dashbord_FAMILY MARKET\family-dashboard-full\deploy_full"
if errorlevel 1 goto err

set "PYTHONUTF8=1"
set "GOOGLE_APPLICATION_CREDENTIALS=D:\Dashbord_FAMILY MARKET\family-dashboard-full\deploy_full\credentials\family-market-analytics-23fbcbcee571c.json"
set "OUT_PATH=docs\stale.json"

echo [1/3] BigQuery export (1-3 min)...
python scripts\fetch_stale.py
if errorlevel 1 goto err

echo [2/3] Commit...
git add docs/stale.json docs/index.html
git commit -m "stale: stock refresh"

echo [3/3] Push...
git pull --no-rebase --no-edit origin main
if errorlevel 1 goto conflict
git push origin main
if errorlevel 1 goto err
goto done

:conflict
echo Merge conflict - keeping local stale.json
git checkout --ours docs/stale.json
git add docs/stale.json
git commit --no-edit
git push origin main
if errorlevel 1 goto err

:done
echo.
echo ==========================================
echo  DONE. Wait 1 min, then Ctrl+Shift+R
echo ==========================================
pause
exit /b

:err
echo.
echo *** ERROR - see message above ***
pause