# Пайплайн данных (scripts/) — актуально на 2026-08

Оркестратор `build_data.py` (его же гоняет GitHub Action `.github/workflows/update.yml` и локальный `update_all.ps1`):
0. `sync_matrix.py` — НОВОЕ: Google-лист «Ассортиментная матрица (полная)» → перезапись BQ `assortment_matrix_full` (WRITE_TRUNCATE, защита MIN_ROWS>=1500). Делает матрицу единым источником категорий/поставщиков. Обёрнут в try/except (не рушит сборку).
1. `fetch_data.py` → docs/full_data.json (продажи-агрегаты, KPI, monthly/by_*, *_month, turnover*, heatmap, sup_store, culinary). Создаёт staging `_dash_tx26`.
2. `fetch_page3.py` → /tmp/page3.json (перемещения/moves, oos, неликвиды/dead*, cross, writeoffs). Мержится в full_data.json.
3. `fetch_matrix.py` → матрица для вкладки «Матрица» (читает тот же Google-лист).
4. `fetch_incoming.py` → приходы/закупки.
5. `fetch_stale.py` → docs/stale.json («товары без движения», ~15МБ, ленивая загрузка).

## Источник ОСТАТКОВ — важно (миграция сделана)
- Раньше: `returns_system.stock_current` — УСТАРЕЛА/удалялась. Больше НЕ используется.
- Сейчас: `family_market.stock_matrix` — свежий физический СНИМОК Торгсофта (barcode, product_name, store, quantity, price_retail, cost_price, snapshot_date, supplier, article). Дату брать `MAX(snapshot_date)`, фильтр `quantity>=0.001` (вес), себестоимость `quantity*COALESCE(cost_price,0)`. Загружается локально `scripts/load_stock.py` из Excel в `reports_stock/*.xlsx`.
- Мигрированы: `fetch_page3.py` (moves/oos/dead, общий шаблон `stock_cte()`, нормализация store через `cs_tt`) и `fetch_stale.py`. Имена магазинов в stock_matrix — СЫРЫЕ имена Торгсофта, совпадают с КЛЮЧАМИ NORM (39 объектов: 38 ключей + служебный «Полевая-Склад»), а не с каноническими значениями. Нормализация обязательна.
- С 2026-08-21 NORM/WHOLESALE живут в `scripts/domain.py` — единственный источник, его импортируют fetch_data.py, fetch_page3.py и fetch_stale.py. Раньше у fetch_stale был свой словарь на 7 ключей, и имена точек в stale.json расходились с дашбордом. Подробности, замеры и почему канона нет в BigQuery — `mem:domain_stores`.
- ОБОРАЧИВАЕМОСТЬ (turnover*) осознанно на `turnover_monthly` (avg_stock=средний запас за период; для коэффициента оборота корректнее снимка). turnover_monthly НЕ годится для текущего остатка.

## Эталонные таблицы для сверки (добавлены пользователем, разрез только поставщик+сумма)
- `torgsoft_outgoing_ref` — эталон ВОЗВРАТОВ (агрегат по поставщику).
- `torgsoft_sales_ref` — эталон ПРОДАЖ по чекам (агрегат, НЕ до конца загружен данными).
- `outgoing_to_supplier_transactions` — ВОЗВРАТЫ с разрезом по позициям.
- `torgsoft_incoming_ref_2026` (REF) — эталон ПРИХОДОВ (уровень накладных, без barcode). Уже в fetch_incoming.
ПРОБЛЕМА: цифры по чекам не сходятся с эталоном — нужна сверка/маппинг с эталонами по приходам/возвратам/продажам. См. `mem:open_tasks`.

Домен-правила — `mem:domain_rules`. Деплой/обновление — `mem:deployment_and_ops`.