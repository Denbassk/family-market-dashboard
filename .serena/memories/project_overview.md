# Family Market — дашборд ритейл-аналитики

Статический дашборд для украинской сети «Family Market» (~36–38 магазинов). Один HTML-файл + JSON-данные, деплой на Cloudflare Pages с Basic Auth.

## Стек
- `docs/index.html` — весь фронтенд (ECharts через jsdelivr + unpkg fallback; ExcelJS через jsdelivr). Состояние в объекте `S`. Без сборки/фреймворков.
- `docs/full_data.json` — основные агрегаты (продажи, категории, магазины, поставщики, оборачиваемость, матрица, приходы, перемещения, кулинария).
- `docs/stale.json` — отдельный файл «товары без движения» (~9 МБ, грузится лениво при открытии вкладки «Перемещения»).
- `scripts/*.py` — сбор данных из BigQuery + Google Sheets, оркестратор `build_data.py`.
- `functions/_middleware.js` — Basic Auth (логин `family`, пароль из env `DASH_PASSWORD`). `functions/api/refresh.js` — триггер пересборки через GitHub workflow_dispatch (env `GH_REFRESH_TOKEN`).
- GitHub Actions пересобирает данные и коммитит `docs/full_data.json` + `docs/stale.json`.

## Вкладки дашборда
Обзор (overview), Отчёты (report — свой конструктор), Аналитика (analytics), Позиции (products), «Дефицит·неликвиды·списания» (frozen), Перемещения (moves — включает инструмент «Товары без движения»), «Кулинария и выпечка» (culinary), Матрица (matrix).

Подробности: `mem:data_pipeline`, `mem:frontend_dashboard`, `mem:domain_rules`, `mem:deployment_and_ops`.