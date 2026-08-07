# Фронтенд (docs/index.html)

Один файл. Данные грузятся в `D` через `load()` (fetch full_data.json). stale.json грузится лениво (`ensureStale()`).

## Состояние
`S = {month,store,cat,sup,q,abc,noOff,mxStatus,culSub,cuSel,rpDim,rpMetric,rpSource,rpMode,rpFrom,rpTo,tab,prSel}`. `noOff` = «скрыть технические».

## Ключевые функции
- `render()` — диспетчер по S.tab; вызывает `chips()` + `applyFilterVis()`, затем renderXxx().
- `kpiNow()` — точные KPI по срезу; helper `mk()` пробрасывает qty/units/receipts. Обзор показывает «Продано, ед.» = `k.qty ?? k.units`, иначе «—».
- `getBase()` / `workProducts()` — фильтрация позиций по S (cat/sup/abc/noOff/q/month).
- `tableSort(id,cols,rows,defKey,onRow,rowHtml,rowClass)` — универсальная сортируемая таблица; кладёт в `EXP[id]` для экспорта.
- `exportTable(id)` — выгрузка EXP[id] в XLSX (ExcelJS). numFmt: целые '#,##0', иначе '#,##0.00'. Кнопки `.csvbtn[data-t=...]`.
- `isTech(name)` / `TECH_SUB` — классификатор технических (зеркало fetch_stale.py, см. `mem:domain_rules`).
- `renderStale()` / `ensureStale()` — инструмент «Товары без движения» (вкладка moves): свои фильтры (stDays/stStore/stCat/stSup/stQ) + чекбокс «скрыть технические» через S.noOff (флаг r.t). Колонки: p,c,s,st,q(шт),v(₴),d(дней),last,last_in.

## Видимость фильтров по вкладкам
`FILTER_VIS` (id обёрток cMonth/cStore/cCat/cSup/cQ/cOff → список вкладок). `applyFilterVis()` скрывает нерелевантные (display:none). `chips()` показывает чип только если фильтр релевантен вкладке (`rel(id)`). Отчёты — все глобальные скрыты (свои контролы), показывается `#barHint`.
Карта: month→overview/products/analytics; store→везде кроме report; cat/sup→везде кроме report/culinary; q→везде кроме report/analytics; off→везде кроме report/culinary.

## Отчёты (конструктор)
Свои селекторы rpDim/rpMetric/rpSource(sales|incoming)/rpMode + период rpFrom/rpTo. Пивот: месяцы-колонки + qty-per-month. Кнопка «Сформировать» (rpRun). Без лимитов на кол-во позиций.

## Мобильная версия
`@media(max-width:760px)` — фильтры на всю ширину.