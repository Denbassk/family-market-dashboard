# Полное обновление данных. Запуск: .\update_all.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root; [Environment]::CurrentDirectory = $root
$env:PYTHONUTF8 = '1'

function Step($name, $cmd) {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  & ([scriptblock]::Create($cmd))
  if ($LASTEXITCODE -ne 0) { Write-Host "ОШИБКА на шаге: $name" -ForegroundColor Red; exit 1 }
}

$last = Get-ChildItem "$root\reports_stock\*.xlsx" -EA SilentlyContinue |
        Sort-Object LastWriteTime -Desc | Select-Object -First 1
if (-not $last) { Write-Host "В reports_stock нет xlsx - выгрузите остатки" -ForegroundColor Red; exit 1 }
Write-Host "Файл остатков: $($last.Name)" -ForegroundColor Yellow

Step "Загрузка снимка в stock_matrix" 'python scripts\load_stock.py'
Step "Сборка stale.json"              'python scripts\fetch_stale.py'
Step "Сборка full_data.json"          'python scripts\fetch_data.py'

Write-Host "`n=== git ===" -ForegroundColor Cyan
git add docs/stale.json docs/full_data.json
git commit -m ("data update " + (Get-Date -Format 'yyyy-MM-dd'))
git pull --no-rebase
git push
Write-Host "`nГотово. Обновите сайт через Ctrl+F5 через 1-2 минуты." -ForegroundColor Green