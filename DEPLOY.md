# Family Market · Redesign v2.0 — Инструкция по деплою

**Этап 1**: Редизайн-обёртка с полной обратной совместимостью.
Вся JS-логика (S, render, kpiNow, фильтры, экспорт) — без изменений.
Меняется только: HTML-скелет, CSS-темы (тёмная + светлая), навигация (sidebar), SVG heatmap.

---

## 📦 Что изменилось

| Файл | Действие | Описание |
|------|----------|----------|
| `docs/index.html` | **отредактирован** | добавлены `<link>` на `redesign.css`, `<script>` на `redesign.js`, ранняя установка темы (10 строк в `<head>`). Основной код НЕ ИЗМЕНЁН. |
| `docs/redesign.css` | **новый** | 700+ строк CSS с OKLCH-темами, sidebar, topbar, mobile drawer, SVG heatmap стили. |
| `docs/redesign.js` | **новый** | Runtime-обёртка: строит sidebar, синхронизирует со старой .nav, переключает темы, заменяет ECharts heatmap на SVG. |
| `tests/smoke_redesign.js` | **новый** | Smoke-тест: проверяет что редизайн не сломал существующую разметку и логику. |

**Итого**: 4 файла. Ничего не удалено. Все существующие тесты (`tests/check_dashboard.js`) должны пройти без изменений.

---

## 🌿 Стратегия отката

**Уровень 1** (быстрый): переключить тему через кнопку в шапке (не рестор дизайна, но снимает всю визуальную нагрузку → тестовая ветка → mainline).

**Уровень 2** (одна команда — откат к оригиналу):
```bash
git checkout main -- docs/index.html
rm docs/redesign.css docs/redesign.js tests/smoke_redesign.js
git commit -am "revert: rollback to pre-redesign"
git push
```

**Уровень 3** (полный откат через ветки):
```bash
git checkout main             # main-ветка нетронута
git branch -D redesign        # удалить redesign ветку локально
```

---

## 🚀 Деплой (шаг за шагом)

### 1. Клонируйте репо локально (если ещё нет)
```bash
git clone https://github.com/Denbassk/family-market-dashboard.git
cd family-market-dashboard
```

### 2. Создайте ветку `redesign`
```bash
git checkout -b redesign
```

### 3. Скачайте 4 файла из этого проекта и положите на место:
- `docs/index.html` → в `docs/index.html` (перезаписать)
- `docs/redesign.css` → **новый** в `docs/redesign.css`
- `docs/redesign.js` → **новый** в `docs/redesign.js`
- `tests/smoke_redesign.js` → **новый** в `tests/smoke_redesign.js`

*(Дизайнер даст архив, распакуйте в корень проекта)*

### 4. Прогоните существующие тесты (важно!)
```bash
npm i jsdom                          # если ещё не установлен
node tests/check_dashboard.js        # старый набор — должен пройти как раньше
node tests/smoke_redesign.js         # новый smoke-тест — все OK
```

Ожидаемый результат:
- `check_dashboard.js`: **0 провалов, 0 рантайм-ошибок** (пропущенные — норма, если данные не пересобраны)
- `smoke_redesign.js`: **0 провалов**

### 5. Коммит + пуш
```bash
git add docs/index.html docs/redesign.css docs/redesign.js tests/smoke_redesign.js DEPLOY.md
git commit -m "feat: redesign v2.0 — OKLCH темы, sidebar, mobile drawer, SVG heatmap

- HTML/CSS обёртка поверх существующей разметки
- Тёмная + светлая тема (переключатель в шапке)
- Sidebar с иконками вместо ряда вкладок
- Sparkline на KPI-карточках Обзора
- SVG heatmap (легче + кастомизируется под тему)
- Полная mobile-версия с drawer navigation
- Совместимость: 0 изменений в S, render, kpiNow, фильтрах, экспорте
- Тесты: check_dashboard.js без правок, добавлен smoke_redesign.js"

git push -u origin redesign
```

### 6. Cloudflare Pages создаст preview-URL

Cloudflare Pages **автоматически** создаст preview-деплой для этой ветки, вида:
```
https://redesign.family-market-dashboard.pages.dev
```
или (для новых аккаунтов):
```
https://<hash>.family-market-dashboard.pages.dev
```

Ищите ссылку в:
- письме от Cloudflare
- вкладке **Deployments** в панели Cloudflare Pages
- комментарии от бота Cloudflare под коммитом на GitHub

### 7. Проверьте preview URL

Откройте preview на:
- ✅ Desktop (Chrome, Firefox, Safari)
- ✅ Mobile (iOS Safari, Android Chrome)
- ✅ Проверьте все 8 вкладок
- ✅ Проверьте переключатель тёмная / светлая
- ✅ Проверьте фильтры (магазин, категория, поставщик, месяц)
- ✅ Проверьте экспорт в Excel
- ✅ Тепловая карта (может показать fallback до пересборки — это норма)

### 8. Запустите пересборку данных (для тепловой карты)

Если поле `D.heatmap` отсутствует (старый full_data.json) — тепловая карта покажет заглушку.
Нажмите в интерфейсе кнопку **«🔄 Обновить данные»** ИЛИ вручную:
- GitHub → Actions → **update-dashboard** → **Run workflow**

После завершения (~5 минут) `docs/full_data.json` обновится, Cloudflare редиплой — heatmap оживёт.

### 9. Если всё ок → мерж в main
```bash
# на GitHub:
# 1. Открыть Pull Request из ветки redesign в main
# 2. Убедиться что все автопроверки прошли (если есть)
# 3. Squash & merge → мерж в main
# 4. Cloudflare автоматически задеплоит на production URL
```

**ИЛИ** через CLI:
```bash
git checkout main
git merge redesign
git push
```

### 10. Если что-то пошло не так — откат

**Вариант A** — быстрый откат последнего мержа:
```bash
git revert -m 1 HEAD              # создаёт commit-обратку
git push
```

**Вариант B** — жёсткий откат к предыдущему состоянию:
```bash
git log --oneline                 # найти хэш коммита ДО мержа
git reset --hard <old-hash>
git push --force                  # ⚠ осторожно, переписывает историю
```

**Вариант C** — оставить в main, но временно вернуть старый UI:
Просто удалить/закомментировать 3 строки в `docs/index.html`:
```html
<!-- <link rel="stylesheet" href="redesign.css"> -->
<!-- <script src="redesign.js" defer></script> -->
<!-- <script>...ранняя тема...</script> -->
```
Всё остальное продолжит работать как раньше.

---

## 🧪 Проверочный чек-лист после деплоя

- [ ] Логотип и название на месте
- [ ] Все 8 вкладок кликаются (sidebar → страница переключается)
- [ ] На мобильном (< 900px) — кнопка "меню" в шапке, sidebar как drawer
- [ ] Переключатель тем работает и запоминается (перезагрузка сохраняет)
- [ ] Фильтры (магазин, категория, поставщик) — мультивыбор работает
- [ ] Активные фильтры показываются как chips под фильтрами
- [ ] Клик по столбцу таблицы сортирует
- [ ] Кнопка **⬇ Excel** экспортирует xlsx-файл (проверить открытие в LibreOffice/Excel)
- [ ] Клик по строке таблицы `pr_tab` открывает drill-панель
- [ ] Клик по чарту (магазин / категория) применяет фильтр
- [ ] Раздел «Товары без движения» (вкладка «Запасы»): 6 фильтров работают
- [ ] Раздел «Условия поставщиков» (последняя вкладка): открывается модалка
- [ ] Тепловая карта: показывает данные (если D.heatmap есть) или заглушку

---

## 📊 Известные ограничения

1. **ECharts** остались на всех графиках кроме heatmap (согласно ТЗ). Их цвета подхватывают тему при переключении, но выглядят чуть менее органично, чем чистый OKLCH. При желании можно во второй итерации мигрировать ECharts-темы под наши токены.

2. **Модалка «Поставщики»** — её стили (`#p_suppliers`) написаны в отдельном блоке `<style>` внутри `docs/index.html`. Они переопределены новыми токенами, но некоторые нюансы (fond, border-radius) могут отличаться от общего стиля. Отладим на этапе 2.

3. **Sparkline** — только на первых 2 KPI Обзора (Выручка, Прибыль). Можно расширить на все, если понадобится.

4. **Command palette (⌘K)** — не включена в этапе 1. Планируется в этапе 2 вместе с полным переосмыслением вкладок «Отчёты», «Матрица» и «Условия поставщиков».

---

## 🎨 Дизайн-заметки

- **Палитра OKLCH** — единая светлота/хрома, вариация только по hue. Обеспечивает равномерный контраст.
- **Шрифт** — Inter Tight с OpenType-фичами (ss01, cv11) и `tabular-nums` для цифр в KPI и таблицах.
- **Motion** — единый easing `cubic-bezier(.32,.72,0,1)` и duration `.24s` для всех переходов.
- **Reduce motion** — уважает `prefers-reduced-motion` (у пользователей с настроенной опцией).
- **Print** — sidebar и topbar скрываются, страница печатается в приличном виде.

---

## 📞 Вопросы?

Если что-то работает не так, как ожидалось:
1. Откройте DevTools (F12) → Console — нет ли ошибок?
2. Проверьте что все 4 файла на месте: `docs/index.html`, `docs/redesign.css`, `docs/redesign.js`, `tests/smoke_redesign.js`
3. Прогоните `node tests/smoke_redesign.js` — он покажет, что именно не так.

Готов вернуться и допилить — просто напишите что нужно поправить.
