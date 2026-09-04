# Вкладка «Условия поставщиков» — ПРОБЕЛ В ДОКУМЕНТАЦИИ

ВНИМАНИЕ: эта подсистема детально НЕ изучена. Здесь только то, что установлено снаружи.
Перед правками читать `docs/SUPPLIERS_SETUP.md` и сам код.

## Что известно
- Nav `data-p="suppliers"`, страница `#p_suppliers`, вход через `supEnter()` в `render()`.
- Это ЧЕТВЁРТЫЙ инлайн-скрипт в `docs/index.html`: ~125 КБ, 105 функций — почти столько же,
  сколько во всём остальном дашборде (скрипт 1: 93 КБ, 68 функций).
  Самые крупные: `formatPctValue` (292 строки), `exportExcelMarkup` (204),
  `openCompareModal` (155), `openMemoViewer` (128), `showContextMenu` (111).
- Данные: `docs/suppliers.json` (~62 КБ) + константа `SUP_API` (запись через функцию Cloudflare).
  То есть у вкладки СВОЙ источник данных, не `full_data.json`.
- Свой CSS-блок: `#p_suppliers .kpis`, `#p_suppliers .kpi` и т.д.
- Скрипты в index.html не видят переменных друг друга, поэтому форматтеры, экспорт в Excel
  и модалки здесь написаны ЗАНОВО, параллельно тем, что есть в основном скрипте.

## Связь с остальными данными
В BigQuery лежит `supplier_conditions` (105 строк): retro_percent_min/max, discount_percent,
sponsor_fee_amount, new_store_fee_amount, sku_intro_fee_amount, returns_allowed/percent/text,
markup_retail/wholesale, delivery_type. Связывается с матричными именами через
`supplier_mapping_matrix` (matrix_supplier -> conditions_supplier).
Эти же условия уже используются в таблице возвратов на «Обзоре» (колонка «Условия возврата»,
функция `retTerms()` в основном скрипте) — то есть данные частично дублируются между
вкладкой «Условия поставщиков» и `returns_terms` в full_data.json.

## Открытые вопросы (разобрать перед фазой «карточка поставщика»)
1. Что именно хранится в suppliers.json и как оно соотносится с `supplier_conditions` в BQ —
   это копия, надстройка или независимый источник?
2. Кто и как пишет через SUP_API, есть ли конфликт с пересборкой данных.
3. Не станет ли «карточка поставщика для переговоров» (см. `mem:architecture_review`)
   развитием ЭТОЙ вкладки вместо новой сущности — скорее всего да, и это правильный путь.
