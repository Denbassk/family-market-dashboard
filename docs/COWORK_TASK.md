# Задача: перевести остатки на новую таблицу stock_matrix

## Суть проблемы
Вкладка "Товары без движения" уже переведена на свежий снимок Торгсофта и
показывает данные на 2026-08-11 (53 640 позиций, 25.45 млн). Остальные вкладки
по-прежнему берут остатки из старых источников и показывают данные месячной
и более давности.

## Где именно старые остатки
1. `stock_current` - таблица УДАЛЕНА из BigQuery. Любой запрос к ней даёт
   "404 Not found: family-market-analytics:family_market.stock_current".
   Поэтому скрипт падает и на сайт уезжает последний удачный JSON (старый).
2. `turnover_monthly` (поля end_qty / sales_qty) - это РАСЧЁТНАЯ помесячная
   агрегация, а не снимок. Она не видит товар, по которому вообще не было
   движения, и отстаёт на закрытый период. Для остатков использовать нельзя.
   Проверено: all=69 698 строк, end_qty>0 = 64 255, из них sales_qty=0 = 41 818 -
   цифры не бьются со снимком (3 408 штрихкодов, 63 197 строк).

## Что использовать вместо этого
Таблица `family-market-analytics.family_market.stock_matrix`.
Поля: barcode, product_name, store, quantity, price_retail, cost_price,
snapshot_date, source_file, loaded_at.
Заполняется скриптом `scripts\load_stock.py` из Excel Торгсофта.
Актуальную дату брать так, а не хардкодом:
```sql
SELECT MAX(snapshot_date) FROM `family-market-analytics.family_market.stock_matrix`
```
Фильтр строк: `quantity >= 0.001` (есть весовой товар с дробным остатком).
Себестоимость: `quantity * COALESCE(cost_price, 0)`.
Поставщик: последний приход из `incoming_transactions` по barcode
(ROW_NUMBER OVER (PARTITION BY barcode ORDER BY doc_date DESC) = 1).
Продажи и дата последней продажи: `turnover_transactions`
(поля barcode, store, transaction_datetime).

## Эталон
Готовая рабочая реализация - `scripts\fetch_stale.py`. Оттуда брать без изменений:
нормализацию названий магазинов (словарь NORM: Полевая 83 -> Полевая-Магазин,
Героїв Сталінграда/Сталінграду -> Байрона), функцию is_tech (флаг технических
позиций), динамическое определение имён колонок через get_table().schema
вместо хардкода - в BigQuery уже ловили "Unrecognized name: sale_qty" и
"Unrecognized name: dt".

## Что переписать
Файл `scripts\fetch_data.py` (и `fetch_page3.py`, если он ещё вызывается).
Затронутые ключи в docs\full_data.json и вкладки, которые от них зависят:
- dead_items, dead_by_store, dead_by_supplier, dead_total -> "Дефицит, неликвиды"
- oos (дефицит, остаток 0 при наличии продаж) -> там же
- moves, moves_summary -> "Перемещения"
- turnover, turnover_store, turnover_supplier -> "Аналитика", "Магазины"
В `docs\index.html` в подзаголовке под шапкой заменить текст
"остатки stock_current" на "остатки stock_matrix (снимок Торгсофта)".

## Чего НЕ трогать
`scripts\fetch_stale.py`, `docs\stale.json` и блок TSD-экспорта в index.html
(переменная window.STALE_F, функции pick/doXlsx/doTxt) - там всё уже исправлено.
Структуру JSON и имена ключей сохранять: фронтенд под них написан.
Оборот и прибыль по-прежнему считаются из turnover_transactions -
меняются ТОЛЬКО остатки и всё, что от них производно.

## Критерий приёмки
После `python scripts\fetch_data.py` сумма замороженного капитала и число
позиций на вкладке "Дефицит, неликвиды" должны сходиться с вкладкой
"Товары без движения" при одинаковых фильтрах (порог дней и магазин),
а дата данных совпадать с MAX(snapshot_date).