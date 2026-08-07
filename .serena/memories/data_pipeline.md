# Пайплайн данных (scripts/)

Оркестратор `build_data.py` запускает по очереди и мержит в `docs/full_data.json`, а stale — в отдельный `docs/stale.json`:
1. `fetch_data.py` → `docs/full_data.json` (продажи-агрегаты).
2. `fetch_page3.py` → /tmp/page3.json (перемещения, OOS, неликвиды, кросс, списания). Экспортирует переиспользуемые константы: `NORM`, `keep`, `cs_sc`, `cs_tt`, `SC`, `TT`, `MX`.
3. `fetch_matrix.py` → /tmp/matrix.json (ассортиментная матрица напрямую из Google Sheets «Ассортиментная матрица (полная)», 9 колонок).
4. `fetch_incoming.py` → /tmp/incoming.json (приходы/закупки).
5. `fetch_stale.py` → `docs/stale.json` (товары без движения).

## Таблицы BigQuery (проект family-market-analytics)
- `family_market.turnover_transactions` (TT) — продажи по чекам.
- `family_market.turnover_monthly` (TM) — оборачиваемость помесячно (start/end qty, cost).
- `family_market.assortment_matrix_full` (MX) — актуальная матрица; ЧИСТЫЕ категории/поставщики. Источник истины по категорийности.
- `returns_system.stock_current` (SC) — текущий снимок остатков (qty_in_stock, cost_price).
- `family_market.incoming_transactions` (IN) — приходы (есть barcode/qty).
- `family_market.torgsoft_incoming_ref_2026` (REF) — эталон приходов на уровне накладных (row_key, doc_date, doc_number, amount, amount_retail, supplier, store; НЕТ barcode/qty). Магазины/поставщики закупок берём отсюда — точнее.
- `writeoffs.writeoffs_report`, `family_market.culinary_writeoffs` — списания.

## Staging
- `_dash_tx26` (продажи, создаёт fetch_data.py), `_dash_in26` (приходы). Флаг env `SKIP_STAGING=1` — переиспользовать staging (обход лимита песочницы ~44с).

## Ключевые агрегаты в full_data.json
kpi (revenue/gp/margin/receipts/skus/units/offmatrix_rev), monthly, by_category, by_store, by_supplier (все с qty), cat_month/store_month/supplier_month/prod_month, abc, turnover*, products, culinary, moves*, oos, dead*, matrix, in_* (приходы).

Домен-правила нормализации — в `mem:domain_rules`.