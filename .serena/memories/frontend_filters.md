# Фильтры дашборда (мультиселект + каскад)

## Состояние
`S.store`, `S.cat`, `S.sup` — МАССИВЫ (пустой = «все»). `S.month` — одиночный (строка, 'all'=весь период). `S.abc` — одиночный.

Хелперы: `allSel(s)` = пустой/нет → true; `inSel(v,s)` = нет выбора ИЛИ v в массиве. Везде в фильтрах: `if(!allSel(S.cat)) rows=rows.filter(r=>inSel(r.category,S.cat))`.

## Мультиселект-компонент (Магазин/Категория/Поставщик)
Разметка: `<div class="ms" id="msStore/msCat/msSup">`. JS: `initMS()` (в load) строит три через `msBuild(key)`. Кнопка-сводка (`msSummary`: «Все …», один → имя, много → «N выбрано»), попап с поиском + чекбоксы + «Выбрать все»/«Очистить». `msSync(key)`/`msSyncAll()` обновляют вид. Изменение выбора → `S[key]` push/filter → `msSyncAll()` → `render()`.

## Каскад категория↔поставщик
`buildCascade()` из `D.products` (поля c=категория, s=поставщик) строит `CAT2SUP`/`SUP2CAT` (Map→Set). `msOptions(key)`: если выбраны категории — список поставщиков сужается до связанных (и наоборот). Store не каскадируется.

## kpiNow
`one(a)` = единственный элемент или null. Быстрый точный срез (by_store/by_category/by_supplier/monthly) только когда активен РОВНО один фильтр с РОВНО одним значением (`nf<=1` + `one()`). Иначе — агрегация по позициям (`workProducts`, exact:false). `by_supplier` теперь содержит qty+receipts (fetch_data.py) — единицы/чеки по поставщику показываются после пересборки данных.

## setFilter / чипы / сброс
`setFilter(k,v)` для store/cat/sup ставит `S[k]=[v]` (клик по графику = один выбор) + `msSync`. Чипы показывают «N выбр.» при мультивыборе, ✕ чистит весь фильтр (`S[k]=[]`). Reset: массивы в `[]` + `msSyncAll()`. Видимость по вкладкам — `FILTER_VIS`/`applyFilterVis` (см. `mem:frontend_dashboard`).

## Analytics deep-разрез
`renderDeep(dim,val)` работает с ОДНИМ значением → включается только при `one(S.cat/sup/store)!==null`.