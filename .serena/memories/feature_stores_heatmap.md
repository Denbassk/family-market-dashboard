# Вкладка «Магазины» (эффективность + тепловая карта)

Nav: `data-p="stores"` (между «Дефицит» и «Перемещения»). Страница `#p_stores`. Render: `renderStores()`. FILTER_VIS: показывает только `cStore`.

## Эффективность магазинов (таблица `stf_tab`)
Собирается на фронте из готовых данных, БЕЗ нового бэкенда: `by_store` (revenue/gp/margin/receipts/skus/qty) + `turnover_store` (turnover_rate) + `dead_by_store` (dead_value) + `writeoffs_by_store` (amount). Метрики: Ср.чек=revenue/receipts, Выр/SKU=revenue/skus, Оборот дн=period.days/turnover_rate, Неликвид ₴, Списания ₴. Клик по строке = setFilter('store',…). Экспорт `stf_tab`.
NB: «Полевая магазин» — опт, сильно выделяется (ср.чек ~1282₴ против ~180₴). Ожидаемо.

## Тепловая карта (`hm_chart`, ECharts heatmap)
Данные: `D.heatmap` — новый разрез в `fetch_data.py`, per (store, dow, hr) из `turnover_transactions` напрямую (staging хранит только дату без часа). Поля: store, dow(1=Вс..7=Сб), hr(6..23), revenue, receipts. ~4460 строк.
`renderHeatmap()`: сумма по выбранным магазинам (S.store), раскладка Пн..Вс × часы 6–23, показатель `#hmMetric` (Выручка/Чеки). Пик в note. Появляется ТОЛЬКО после пересборки (в старом full_data.json heatmap нет → заглушка). Пример: пик Чт 17:00.