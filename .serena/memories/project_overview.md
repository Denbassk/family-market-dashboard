# Family Market — дашборд ритейл-аналитики

Статический дашборд для украинской сети «Family Market» (38 магазинов + оптовая точка).
Один HTML-файл + JSON-данные, деплой на Cloudflare Pages с Basic Auth.

## Стек
- `docs/index.html` — весь фронтенд, ~6 500 строк / 321 КБ, ЧЕТЫРЕ инлайн-скрипта
  (ECharts через jsdelivr + unpkg fallback; ExcelJS через jsdelivr). Состояние в объекте `S`.
  Без сборки и фреймворков. Скрипты не видят переменных друг друга.
- `docs/full_data.json` — основные агрегаты, ~6,9 МБ / 53 ключа (gzip ~1,7 МБ).
- `docs/stale.json` — «товары без движения», ~15 МБ, лениво при открытии «Перемещений».
- `docs/suppliers.json` + `functions/api/...` — данные вкладки «Условия поставщиков»,
  отдельная подсистема, см. `mem:feature_suppliers_tab` и `docs/SUPPLIERS_SETUP.md`.
- `scripts/*.py` — сбор из BigQuery + Google Sheets, оркестратор `build_data.py`.
- `tests/check_dashboard.js` — 36 автопроверок без браузера (jsdom). См. `mem:deployment_and_ops`.
- `functions/_middleware.js` — Basic Auth (логин `family`, пароль из env `DASH_PASSWORD`).
  `functions/api/refresh.js` — триггер пересборки через GitHub workflow_dispatch (`GH_REFRESH_TOKEN`).
- GitHub Actions пересобирает данные и коммитит `docs/full_data.json` + `docs/stale.json`.

## Вкладки (8, после ревизии 2026-08-21 — см. `mem:tabs_review`)
Обзор (overview) · Отчёты (report — конструктор) · Аналитика (analytics) · Позиции (products) ·
**Запасы (stock)** — дефицит + «Товары без движения» + рекомендации по перемещению ·
Магазины (stores — эффективность + теплокарта) · Матрица (matrix) · «Условия поставщиков» (suppliers).
Кулинария и выпечка — больше не вкладка, а кнопка-пресет `#fOwnProd` в панели фильтров
(категории Кулинария + Выпечка + Хот-дог). Списания из интерфейса убраны.

## Ключевые доменные развилки (читать перед любой правкой цифр)
- Категория и поставщик — ТОЛЬКО из матрицы, едины НА НАЗВАНИЕ товара.
- «Полевая магазин» (она же «Полевая 83») — ОПТ: в выручке остаётся, из среднего чека убрана.
- Поставщики: матрица = бренд, Торгсофт = контрагент; перевод обязателен.
- Выручка считается по прейскуранту, скидки (~0,4%) не учтены.

Подробности: `mem:data_pipeline`, `mem:domain_rules`, `mem:frontend_dashboard`,
`mem:frontend_filters`, `mem:frontend_current`, `mem:crossfilters_and_cubes`,
`mem:feature_returns`, `mem:reconciliation`, `mem:deployment_and_ops`,
`mem:architecture_review` (утверждённый план работ), `mem:open_tasks`.
