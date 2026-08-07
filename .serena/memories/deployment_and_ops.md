# Деплой и операционные заметки

## Деплой
- Cloudflare Pages, публичный репозиторий, защита Basic Auth через `functions/_middleware.js` (логин `family`, пароль env `DASH_PASSWORD`).
- Пуш в `main` → Cloudflare пересобирает за 1–2 мин.
- Кнопка «Обновить данные» на дашборде → `functions/api/refresh.js` → GitHub workflow_dispatch (env `GH_REFRESH_TOKEN`) → Action прогоняет `scripts/build_data.py` и коммитит свежие docs/full_data.json + docs/stale.json.

## Git-флоу (важно!)
- Пуш делает ПОЛЬЗОВАТЕЛЬ из PowerShell на своей машине (у песочницы нет доступа к GitHub и прав на .git на D:).
- Частый конфликт: Actions-бот коммитит docs/full_data.json. Разрешение:
  `git pull --no-rebase --no-edit origin main` → при конфликте `git checkout --theirs docs/full_data.json; git add; git commit --no-edit` → `git push`.
- Иногда застревает `.git/index.lock` (создаёт песочница, удалить не может) → на Windows: `Remove-Item .git\index.lock`.
- ПОРЯДОК при изменении и кода, и данных: сперва запушить изменения скриптов/index.html, ПОТОМ триггерить пересборку данных (иначе Action использует старые скрипты).

## Ограничения песочницы (Linux sandbox)
- bash макс ~44с; `/tmp` не шарится между вызовами; персистят только маунты.
- Python 3.10 — нет `datetime.UTC`, использовать `datetime.timezone.utc`.
- BigQuery креды: SA-ключ в `credentials/family-market-analytics-*.json`, env `GOOGLE_APPLICATION_CREDENTIALS`.
- Пути bash: D:\Dashbord_FAMILY MARKET → /sessions/.../mnt/Dashbord_FAMILY MARKET/.

## Проверки перед деплоем
- Извлечь `<script>` из index.html и `node --check`.
- Сверять JS-классификатор isTech с флагом t в stale.json (должно 0 расхождений).
- ECharts/ExcelJS — только jsdelivr/unpkg (cdnjs давал 503).