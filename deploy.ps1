# ============================================================
#  Family Market Dashboard — деплой в ПРИВАТНЫЙ репозиторий GitHub
#  Данные остаются приватными. Pro покупать не нужно.
#  Выполняй по шагам (не запускай весь файл сразу — есть интерактивные шаги).
# ============================================================

# --- Настройки (поменяй при желании) ---
$RepoName = "family-market-dashboard"
$ProjectDir = "D:\Dashbord_FAMILY MARKET\family-dashboard-full\deploy_full"
# Путь к твоему service account JSON от BigQuery (поменяй!):
$SaKeyPath = "D:\path\to\service-account.json"

# ------------------------------------------------------------
# ШАГ 1. Перейти в папку проекта
cd $ProjectDir

# ШАГ 2. Удалить незавершённую папку .git (осталась от предыдущей попытки)
if (Test-Path .git) { Remove-Item -Recurse -Force .git }

# ШАГ 3. Установить git и GitHub CLI, если их ещё нет.
#        После установки ПЕРЕЗАПУСТИ PowerShell и продолжи с шага 4.
winget install --id Git.Git -e --source winget
winget install --id GitHub.cli -e --source winget

# ШАГ 4. Авторизация в GitHub (откроется браузер, выбери HTTPS)
gh auth login

# ШАГ 5. Имя и почта для коммитов
git config --global user.name "dan"
git config --global user.email "denbassk@gmail.com"

# ШАГ 6. Инициализация репозитория и первый коммит
git init -b main
git add .
git commit -m "Family Market dashboard: initial commit"

# ШАГ 7. Создать ПРИВАТНЫЙ репозиторий и запушить одним действием
gh repo create $RepoName --private --source=. --remote=origin --push

# ШАГ 8. Добавить секрет с ключом BigQuery (для GitHub Actions)
#        В PowerShell нет оператора '<' — читаем файл через Get-Content и передаём по конвейеру.
$U = gh api user --jq .login
Get-Content -Raw $SaKeyPath | gh secret set GCP_SA_KEY --repo "$U/$RepoName"

# ШАГ 9. Разрешить Actions запись (нужно для авто-коммита обновлённых данных)
gh api -X PUT "repos/$U/$RepoName/actions/permissions/workflow" -f default_workflow_permissions=write

# ШАГ 10. Проверка: запустить пересборку данных вручную и посмотреть лог
gh workflow run update.yml
gh run watch

# ============================================================
# ПРОСМОТР ДАШБОРДА ЛОКАЛЬНО (данные не покидают компьютер)
# ============================================================
# python -m http.server -d docs 8000
# затем открой в браузере:  http://localhost:8000
#
# (Опционально) чтобы заработала кнопка «Обновить сейчас» в дашборде,
# впиши свой логин и имя репо вверху <script> в docs/index.html:
#   const GH_OWNER="ТВОЙ_ЛОГИН", GH_REPO="family-market-dashboard", ...
