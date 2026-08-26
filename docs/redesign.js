/* ============================================================
   Family Market · Redesign v2.0 — runtime enhancements
   Инициализируется после основного скрипта. Не изменяет S, render, kpiNow.
   1) Строит новый shell (sidebar + topbar) поверх старой разметки
   2) Синхронизирует новый sidebar с существующей .nav
   3) Theme toggle (dark/light) с localStorage
   4) Заменяет ECharts heatmap на SVG (легче, кастомизируемый, работает и без ECharts)
   ============================================================ */
(function(){
'use strict';

// ---------- утилиты ----------
// ВНИМАНИЕ: не объявляем глобальные $/$$ — они уже есть в основном скрипте.
// Используем локальные rd$ / rd$$
const rd$  = id => document.getElementById(id);
const rd$$ = sel => Array.from(document.querySelectorAll(sel));
const lsGet = k => { try { return localStorage.getItem(k); } catch(e){ return null; } };
const lsSet = (k,v) => { try { localStorage.setItem(k,v); } catch(e){} };

// ---------- ИКОНКИ (inline SVG symbols) ----------
const ICONS = {
  home:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  report:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M8 8h5M8 16h4"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 4 4 5-6"/></svg>`,
  cube:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-9 5-9-5V8l9-5 9 5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/></svg>`,
  box:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7 12 3 4 7v10l8 4 8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>`,
  store: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v6H4z"/><path d="M4 10v10h16V10"/><path d="M8 20v-6h8v6"/></svg>`,
  grid:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6h5l3 5v7h-3M14 18H9M2 18h2M2 12h12M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>`,
  set:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  menu:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
  sun:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  moon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  refresh:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`
};

// ---------- КОНФИГ вкладок в sidebar ----------
const NAV_CONFIG = [
  { group: 'Общее' },
  { p: 'overview',  icon: 'home',   label: 'Обзор' },
  { p: 'report',    icon: 'report', label: 'Отчёты' },
  { p: 'analytics', icon: 'chart',  label: 'Аналитика' },
  { group: 'Ассортимент' },
  { p: 'products',  icon: 'cube',   label: 'Позиции' },
  { p: 'matrix',    icon: 'grid',   label: 'Матрица' },
  { p: 'stock',     icon: 'box',    label: 'Запасы' },
  { group: 'Операции' },
  { p: 'stores',    icon: 'store',  label: 'Магазины' },
  { p: 'suppliers', icon: 'set',    label: 'Условия поставщиков' }
];

// ---------- THEME ----------
function initTheme(){
  const saved = lsGet('rd-theme');
  const prefLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = saved || (prefLight ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', theme);
}
function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  lsSet('rd-theme', t);
  updateThemeButtons();
  // Уведомить ECharts + sparkline + heatmap — обработчики выше
  window.dispatchEvent(new CustomEvent('rd-theme-change', { detail: { theme: t }}));
}
function updateThemeButtons(){
  const cur = document.documentElement.getAttribute('data-theme');
  rd$$('.rd-theme-toggle button').forEach(b => {
    b.classList.toggle('on', b.dataset.theme === cur);
  });
}

// Перерисовать все ECharts под новую тему.
// charts={} в основном скрипте объявлен как let → недоступен через window.
// Находим все инстансы через DOM + echarts.getInstanceByDom.
function reRenderCharts(){
  if (!window.echarts || !window.echarts.getInstanceByDom) return;
  try {
    // Все div-ы с классом .chart или id, начинающимся с известных префиксов
    const candidates = document.querySelectorAll('.chart, #ov_dyn, #ov_cat, #ov_store, #rp_chart, #an_abc, #an_turn, #an_turnsup, #an_margin, #an_turnstore, #fr_store, #fr_sup, #hm_chart');
    candidates.forEach(el => {
      const inst = window.echarts.getInstanceByDom(el);
      if (inst && inst.getOption && inst.setOption) {
        applyEchartsTheme(inst);
      }
    });
  } catch(e){ console.warn('re-theme charts:', e); }
}

// Хук на theme-change — с задержкой, чтобы CSS-переменные успели пересчитаться
window.addEventListener('rd-theme-change', () => {
  setTimeout(reRenderCharts, 50);
  // + перерисуем sparkline с новыми цветами
  setTimeout(() => { try { addSparklines(); } catch(e){} }, 80);
  // heatmap
  setTimeout(() => { try { if (typeof window.renderHeatmap === 'function') window.renderHeatmap(); } catch(e){} }, 100);
  // SVG ranks
  setTimeout(() => { try { if (rdGetTab() === 'overview') renderOverviewRanks(); } catch(e){} }, 100);
});

// Наши цвета — читаем из CSS-переменных (OKLCH → браузер приведёт в rgb)
function getThemeColors(){
  const s = getComputedStyle(document.documentElement);
  return {
    txt:   s.getPropertyValue('--txt').trim() || '#e4e6f0',
    muted: s.getPropertyValue('--muted').trim() || '#a0a3b5',
    faint: s.getPropertyValue('--faint').trim() || '#6b6e80',
    line:  s.getPropertyValue('--line').trim() || '#2d3044',
    acc:   s.getPropertyValue('--acc').trim() || '#4a7cff',
    acc2:  s.getPropertyValue('--acc2').trim() || '#6090ff',
    pos:   s.getPropertyValue('--a').trim() || '#2ecc71',
    warn:  s.getPropertyValue('--b').trim() || '#f1c40f',
    neg:   s.getPropertyValue('--c').trim() || '#e74c3c',
    vio:   s.getPropertyValue('--vio').trim() || '#9b59b6',
    orange:s.getPropertyValue('--orange').trim() || '#e67e22',
    bg:    s.getPropertyValue('--bg').trim() || '#0f1117',
    card:  s.getPropertyValue('--card').trim() || '#1e2130'
  };
}

// Применить наш theme к ECharts инстансу — реально перекрасить, а не только оси
function applyEchartsTheme(chart){
  if (!chart || !chart.getOption) return;
  const c = getThemeColors();
  try {
    const opt = chart.getOption();
    if (!opt) return;

    // Наша палитра для серий.
    // Bar-серии — акцент/варианты; Line-серии — pos/варианты (чтобы линия прибыли контрастировала с барами выручки).
    const paletteBar   = [c.acc, c.orange, c.vio, c.warn, c.neg, c.pos];
    const paletteLine  = [c.pos, c.orange, c.vio, c.warn, c.neg, c.acc];

    // Обновить оси
    ['xAxis','yAxis'].forEach(ax => {
      if (opt[ax]) opt[ax].forEach(a => {
        if (!a.axisLine) a.axisLine = { lineStyle: {} };
        if (!a.axisLine.lineStyle) a.axisLine.lineStyle = {};
        a.axisLine.lineStyle.color = c.line;

        if (!a.axisLabel) a.axisLabel = {};
        a.axisLabel.color = c.muted;
        a.axisLabel.fontFamily = "'Inter Tight',Inter,system-ui,sans-serif";
        a.axisLabel.fontSize = 11;

        if (!a.splitLine) a.splitLine = { lineStyle: {} };
        if (!a.splitLine.lineStyle) a.splitLine.lineStyle = {};
        a.splitLine.lineStyle.color = c.line;
        a.splitLine.lineStyle.type = 'dashed';
        a.splitLine.lineStyle.opacity = 0.4;

        if (!a.axisTick) a.axisTick = { lineStyle: {} };
        if (!a.axisTick.lineStyle) a.axisTick.lineStyle = {};
        a.axisTick.lineStyle.color = c.line;
      });
    });

    // Textstyle
    opt.textStyle = { ...(opt.textStyle||{}), color: c.txt, fontFamily: "'Inter Tight',Inter,system-ui,sans-serif" };

    // Обновить серии — цвета.
    // ВАЖНО: НЕ трогаем data-level itemStyle (там могут быть per-bar цвета
    // от основного скрипта — например полупрозрачный "неполный" месяц). Задаём
    // серийный itemStyle.color только если на серии его нет вообще, ИЛИ он не объект.
    if (Array.isArray(opt.series)) {
      let barI = 0, lineI = 0;
      opt.series.forEach(s => {
        if (s.type === 'bar') {
          const col = paletteBar[barI % paletteBar.length];
          // Серийный цвет — только если не задан индивидуально в данных
          if (!s.itemStyle) s.itemStyle = {};
          // Не перезаписываем если основной скрипт уже поставил объектный itemStyle с цветом
          const hasCustom = s.itemStyle.color && typeof s.itemStyle.color === 'string';
          if (!hasCustom || /^#[0-9a-f]{3,8}$/i.test(s.itemStyle.color)) {
            s.itemStyle.color = col;
          }
          // borderRadius — только если не задан
          if (s.itemStyle.borderRadius === undefined) {
            s.itemStyle.borderRadius = [4, 4, 0, 0];
          }
          // Полностью отключить emphasis (hover-эффект ECharts):
          // ECharts default-emphasis при наведении применяет opacity к data-элементам,
          // у которых уже задан свой itemStyle — превращая полупрозрачный бар в невидимку.
          // Проще всего запретить любые изменения при hover: подсветка идёт через tooltip.
          s.emphasis = { disabled: true };
          barI++;
        } else if (s.type === 'line') {
          const col = paletteLine[lineI % paletteLine.length];
          if (!s.itemStyle) s.itemStyle = {};
          if (!s.lineStyle) s.lineStyle = {};
          // Не перезаписывать если задан кастомный цвет
          const hasCustomItem = s.itemStyle.color && typeof s.itemStyle.color === 'string';
          if (!hasCustomItem || /^#[0-9a-f]{3,8}$/i.test(s.itemStyle.color)) {
            s.itemStyle.color = col;
          }
          const hasCustomLine = s.lineStyle.color && typeof s.lineStyle.color === 'string';
          if (!hasCustomLine || /^#[0-9a-f]{3,8}$/i.test(s.lineStyle.color)) {
            s.lineStyle.color = col;
          }
          if (s.lineStyle.width === undefined) s.lineStyle.width = 2.5;
          // symbol/symbolSize — только если не заданы
          if (s.symbol === undefined) s.symbol = 'circle';
          if (s.symbolSize === undefined) s.symbolSize = 6;
          if (s.areaStyle) {
            if (!s.areaStyle.color || typeof s.areaStyle.color === 'string') s.areaStyle.color = col;
            if (s.areaStyle.opacity === undefined) s.areaStyle.opacity = 0.15;
          }
          // Отключить emphasis и для линий, чтобы не мигали симметрично
          s.emphasis = { disabled: true };
          lineI++;
        }
        // pie/scatter — палитра через opt.color[]
      });
    }

    // Легенда
    if (opt.legend) opt.legend.forEach(l => {
      l.textStyle = { ...(l.textStyle||{}), color: c.muted, fontFamily: "'Inter Tight',Inter,system-ui,sans-serif", fontSize: 11 };
      // Сдвинуть легенду наверх, чтобы не перекрывала данные
      if (l.top === undefined && l.bottom === undefined) l.top = 0;
    });

    // Tooltip
    if (opt.tooltip) opt.tooltip.forEach(t => {
      t.backgroundColor = c.card;
      t.borderColor = c.line;
      t.textStyle = { ...(t.textStyle||{}), color: c.txt, fontFamily: "'Inter Tight',Inter,system-ui,sans-serif" };
    });

    // Дополнительная палитра для чартов, где цвета выбираются из color[]
    opt.color = paletteBar;

    chart.setOption(opt, { notMerge: false, lazyUpdate: false });
  } catch(e){ console.warn('applyEchartsTheme:', e); }
}

// ---------- SHELL: build sidebar + topbar ----------
function buildShell(){
  const body = document.body;
  const wrap = document.querySelector('.wrap');
  if (!wrap || document.querySelector('.rd-app')) return;

  // класс на body для активации CSS
  body.classList.add('rd');

  // текст заголовка
  const oldH1 = document.querySelector('.top .brand h1');
  const titleText = oldH1 ? oldH1.textContent : 'Family Market';
  const oldLogo = document.querySelector('.top .brand-logo');
  const logoSrc = oldLogo ? oldLogo.src : '';

  // wrapper
  const app = document.createElement('div');
  app.className = 'rd-app';

  // sidebar
  const side = document.createElement('aside');
  side.className = 'rd-side';
  side.id = 'rd-side';
  side.innerHTML = `
    <div class="rd-brand">
      <div class="rd-brand-logo">${logoSrc ? `<img src="${logoSrc}" alt="Family Market">` : ''}</div>
      <div>
        <div class="rd-brand-name">Family Market</div>
        <div class="rd-brand-sub">Retail Intelligence</div>
      </div>
    </div>
    ${NAV_CONFIG.map(item => {
      if (item.group) return `<div class="rd-side-group">${item.group}</div>`;
      return `<button class="rd-nav-item" data-goto="${item.p}" type="button">
        ${ICONS[item.icon] || ''}
        <span class="rd-nav-label">${item.label}</span>
      </button>`;
    }).join('')}
    <div class="rd-side-foot">
      <div class="rd-avatar">FM</div>
      <div>
        <div style="color:var(--txt);font-weight:600;font-size:12px">Управляющий</div>
        <div style="font-size:11px;color:var(--muted)">family@retail</div>
      </div>
    </div>
  `;

  // topbar
  const top = document.createElement('div');
  top.className = 'rd-top';
  top.innerHTML = `
    <button class="rd-icon-btn menu" id="rd-menu-btn" title="Меню" aria-label="Открыть меню">${ICONS.menu}</button>
    <div class="rd-top-title">
      <span class="rd-crumb">Family Market</span>
      <span class="rd-sep">›</span>
      <span class="rd-crumb-title" id="rd-crumb-cur">Обзор</span>
    </div>
    <div class="grow"></div>
    <div class="rd-updated" id="rd-updated">
      <span class="rd-dot"></span>
      <span id="rd-upd-text">загрузка…</span>
    </div>
    <div class="rd-theme-toggle" role="group" aria-label="Тема">
      <button type="button" data-theme="light" title="Светлая тема" aria-label="Светлая тема">${ICONS.sun}</button>
      <button type="button" data-theme="dark"  title="Тёмная тема"  aria-label="Тёмная тема">${ICONS.moon}</button>
    </div>
  `;

  // main column (в него положим топбар + wrap)
  const main = document.createElement('div');
  main.className = 'rd-main';
  main.style.cssText = 'min-width:0;display:flex;flex-direction:column';

  // overlay for mobile
  const overlay = document.createElement('div');
  overlay.className = 'rd-overlay';
  overlay.id = 'rd-overlay';

  // перекладываем DOM
  wrap.parentNode.insertBefore(app, wrap);
  app.appendChild(side);
  app.appendChild(main);
  main.appendChild(top);
  main.appendChild(wrap);
  document.body.appendChild(overlay);

  // ---- wire sidebar → old .nav ----
  const oldNav = document.querySelector('.nav');
  rd$$('#rd-side .rd-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.goto;
      const target = oldNav ? oldNav.querySelector(`button[data-p="${p}"]`) : null;
      if (target) target.click();
      closeMobileNav();
    });
  });

  // MutationObserver — синхронизировать активный пункт при клике по старой .nav
  // (например, из клика на графике / drill)
  if (oldNav){
    const syncActive = () => {
      const active = oldNav.querySelector('button.on');
      if (!active) return;
      const p = active.dataset.p;
      const label = active.textContent.trim();
      rd$$('#rd-side .rd-nav-item').forEach(el => {
        el.classList.toggle('on', el.dataset.goto === p);
      });
      const cur = rd$('rd-crumb-cur');
      if (cur) cur.textContent = label;
    };
    syncActive();
    const mo = new MutationObserver(syncActive);
    oldNav.querySelectorAll('button').forEach(b => {
      mo.observe(b, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // Sync updated_at из старого #upd → в новый #rd-upd-text
  const oldUpd = document.getElementById('upd');
  if (oldUpd){
    const syncUpd = () => {
      const el = rd$('rd-upd-text');
      if (!el) return;
      // берём первое коротенькое сообщение (updated_at строка)
      const t = oldUpd.innerHTML || 'загрузка…';
      const m = t.match(/обновлено:\s*<b>([^<]+)<\/b>/);
      el.innerHTML = m ? `обновлено <b>${m[1]}</b>` : (t.length > 80 ? t.slice(0,60)+'…' : t);
    };
    syncUpd();
    new MutationObserver(syncUpd).observe(oldUpd, { childList: true, subtree: true, characterData: true });
  }

  // Theme toggle
  rd$$('.rd-theme-toggle button').forEach(b => {
    b.addEventListener('click', () => setTheme(b.dataset.theme));
  });
  updateThemeButtons();

  // Mobile menu
  const menuBtn = rd$('rd-menu-btn');
  const overlayEl = rd$('rd-overlay');
  const openMobileNav = () => {
    side.classList.add('open');
    overlayEl.classList.add('on');
  };
  const closeMobileNav = () => {
    side.classList.remove('open');
    overlayEl.classList.remove('on');
  };
  if (menuBtn) menuBtn.addEventListener('click', () => {
    side.classList.contains('open') ? closeMobileNav() : openMobileNav();
  });
  overlayEl.addEventListener('click', closeMobileNav);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMobileNav();
  });
}

// ---------- SVG HEATMAP (override ECharts) ----------
// Вместо ECharts на #hm_chart рендерим SVG. Совместимо с существующим renderHeatmap:
// он ожидает контейнер #hm_chart и записывает в #hm_note.
function overrideHeatmap(){
  const oldRender = window.renderHeatmap;
  if (typeof oldRender !== 'function') return;

  window.renderHeatmap = function(){
    const D = window.D;
    const S = window.S;
    if (!D || !S) return;
    const container = document.getElementById('hm_chart');
    const noteEl = document.getElementById('hm_note');
    if (!container) return;

    const hm = D.heatmap;
    if (!hm || !hm.length){
      container.innerHTML = `<div style="padding:60px 20px;text-align:center;color:var(--muted);font-size:13px">
        <div style="font-size:32px;opacity:.5;margin-bottom:10px">📊</div>
        Тепловая карта появится после пересборки данных.<br>
        <span style="font-size:11px">Требуется поле D.heatmap (turnover_transactions)</span>
      </div>`;
      if (noteEl) noteEl.textContent = '';
      return;
    }

    // фильтр по выбранным магазинам
    const storeSel = S.store && S.store.length ? new Set(S.store) : null;
    const metric = (document.getElementById('hmMetric') || {}).value || 'revenue';

    // dow: 1=Вс..7=Сб; hours 6..23
    const days = ['','Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    const order = [2,3,4,5,6,7,1]; // Пн..Вс
    const hours = [];
    for (let h=6; h<=23; h++) hours.push(h);

    // aggregate
    const map = {};
    hm.forEach(r => {
      if (storeSel && !storeSel.has(r.store)) return;
      const key = r.dow + ':' + r.hr;
      map[key] = (map[key] || 0) + (r[metric] || 0);
    });

    // find peak
    let maxV = 0, peakKey = '';
    for (const k in map) if (map[k] > maxV){ maxV = map[k]; peakKey = k; }

    const fmt = v => {
      const a = Math.abs(v);
      if (a >= 1e6) return (v/1e6).toFixed(1)+' млн';
      if (a >= 1e3) return Math.round(v/1e3)+' тыс';
      return Math.round(v).toString();
    };

    // build grid
    container.classList.add('rd-svg-heat');
    let html = '<div class="rd-heat-grid">';
    html += '<div></div>';
    hours.forEach(h => { html += `<div class="rd-heat-h">${h}</div>`; });
    order.forEach(d => {
      html += `<div class="rd-heat-r">${days[d]}</div>`;
      hours.forEach(h => {
        const v = map[d+':'+h] || 0;
        const ratio = maxV > 0 ? v / maxV : 0;
        // цвет: OKLCH accent hue, светлота растёт с ratio
        const l = 0.20 + ratio * 0.32;
        const c = 0.02 + ratio * 0.16;
        const style = v > 0 ? `background: oklch(${l.toFixed(3)} ${c.toFixed(3)} 240)` : '';
        const peak = (d+':'+h) === peakKey && v > 0 ? ' peak' : '';
        const title = `${days[d]} ${h}:00 — ${fmt(v)}${metric==='revenue'?' ₴':' чеков'}`;
        html += `<div class="rd-heat-cell${peak}" style="${style}" title="${title}"></div>`;
      });
    });
    html += '</div>';

    // legend
    html += `<div class="rd-heat-tip">
      <span>Меньше</span>
      <span class="rd-heat-scale">
        <i style="background:oklch(0.22 0.02 240)"></i>
        <i style="background:oklch(0.32 0.06 240)"></i>
        <i style="background:oklch(0.42 0.10 240)"></i>
        <i style="background:oklch(0.50 0.14 240)"></i>
        <i style="background:oklch(0.55 0.17 240)"></i>
      </span>
      <span>Больше</span>
      ${peakKey ? `<span style="margin-left:8px">Пик: <b style="color:var(--txt)">${days[+peakKey.split(':')[0]]} ${peakKey.split(':')[1]}:00</b> — <b style="color:var(--txt)">${fmt(maxV)}${metric==='revenue'?' ₴':' ч.'}</b></span>` : ''}
    </div>`;

    container.innerHTML = html;
    if (noteEl){
      noteEl.textContent = peakKey
        ? `Наведите на ячейку для деталей. Пик: ${days[+peakKey.split(':')[0]]} ${peakKey.split(':')[1]}:00 · ${fmt(maxV)}${metric==='revenue'?' ₴/час':' чеков/час'}.`
        : 'Наведите на ячейку для деталей.';
    }
  };
}

// ---------- Безопасный доступ к глобалам основного скрипта ----------
// В основном index.html объявлено `const S = {...}`, `const D = ...` — они находятся
// в глобальном скоупе, но `const` НЕ вешает переменную на window.
// Используем прямой eval через глобальный контекст.
function rdGetGlobal(name){
  try { return (0, eval)(name); } catch(e){ return undefined; }
}
function rdGetTab(){
  const S = rdGetGlobal('S') || window.S;
  return S && S.tab;
}
function rdGetCatAgg(){
  const fn = rdGetGlobal('catAgg') || window.catAgg;
  return typeof fn === 'function' ? fn() : null;
}
function rdGetStoreAgg(){
  const fn = rdGetGlobal('storeAgg') || window.storeAgg;
  return typeof fn === 'function' ? fn() : null;
}
function rdSetFilter(k, v){
  const fn = rdGetGlobal('setFilter') || window.setFilter;
  if (typeof fn === 'function') fn(k, v);
}
function rdInSel(v, arr){
  const fn = rdGetGlobal('inSel') || window.inSel;
  return typeof fn === 'function' ? fn(v, arr) : false;
}
function rdGetD(){
  return rdGetGlobal('D') || window.D;
}
function rdGetS(){
  return rdGetGlobal('S') || window.S;
}
function rdMColor(m){
  const fn = rdGetGlobal('mColor') || window.mColor;
  if (typeof fn === 'function') return fn(m);
  return mColorFallback(m);
}

// ---------- SVG RANK LISTS (топ-категории, топ-магазины) ----------
// Заменяем ECharts на #ov_cat и #ov_store на нативные SVG-компоненты в стиле мокапа.
// Клики (setFilter) сохраняем. Данные берём из глобальных catAgg() / storeAgg().

function fmtCompact(n){
  n = +n || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e9) return s + (a/1e9).toFixed(1) + ' млрд';
  if (a >= 1e6) return s + (a/1e6).toFixed(1) + ' млн';
  if (a >= 1e3) return s + Math.round(a/1e3) + 'k';
  return s + Math.round(a);
}

function mColorFallback(m){
  // повторяет window.mColor если основной не готов
  m = +m || 0;
  if (m <= 8) return 'oklch(0.70 0.19 25)';
  if (m <= 14) return 'oklch(0.75 0.16 45)';
  if (m <= 22) return 'oklch(0.82 0.14 85)';
  if (m <= 30) return 'oklch(0.80 0.16 130)';
  return 'oklch(0.78 0.15 155)';
}

// Рендер топ-категорий как SVG rank list
function renderCatRank(){
  const el = document.getElementById('ov_cat');
  if (!el) return;
  const raw = rdGetCatAgg();
  if (!raw || !raw.length) return;
  const rows = raw.slice(0, 12);

  const max = Math.max(...rows.map(r => r.revenue || 0)) || 1;
  const S = rdGetS();
  const c = getThemeColors();

  let html = '<div class="rd-rank" role="list">';
  rows.forEach((r, i) => {
    const w = (r.revenue / max * 100).toFixed(1);
    const col = rdMColor(r.margin);
    const isSel = S && S.cat && rdInSel(r.category, S.cat);
    const mrgBg  = 'color-mix(in oklch, ' + col + ' 22%, transparent)';
    html += '<div class="rd-rank-row" data-cat="' + (r.category || '').replace(/"/g, '&quot;') + '" role="listitem"' + (isSel ? ' style="background:var(--accsoft)"' : '') + '>'
      + '<span class="rd-rk">' + String(i+1).padStart(2,'0') + '</span>'
      + '<div class="rd-lb">'
      +   '<span class="rd-name" title="' + (r.category || '') + '">' + (r.category || '—') + '</span>'
      +   '<span class="rd-mrg" style="background:' + mrgBg + ';color:' + col + '">' + (r.margin != null ? r.margin + '%' : '—') + '</span>'
      + '</div>'
      + '<span class="rd-val">' + fmtCompact(r.revenue) + '&nbsp;₴</span>'
      + '<div class="rd-rank-bar"><i style="width:' + w + '%;background:linear-gradient(90deg, ' + c.acc + ', ' + col + ')"></i></div>'
      + '</div>';
  });
  html += '</div>';

  // Уничтожаем ECharts инстанс если он есть — до подмены DOM
  if (window.echarts && window.echarts.getInstanceByDom) {
    const inst = window.echarts.getInstanceByDom(el);
    if (inst) { try { inst.dispose(); } catch(e){} }
  }

  el.classList.add('rd-svg-rank');
  el.innerHTML = html;

  // клики → фильтр
  el.querySelectorAll('.rd-rank-row').forEach(row => {
    row.addEventListener('click', () => {
      const cat = row.dataset.cat;
      if (cat) rdSetFilter('cat', cat);
    });
  });
}

// Рендер топ-магазинов как SVG rank list
function renderStoreRank(){
  const el = document.getElementById('ov_store');
  if (!el) return;
  const raw = rdGetStoreAgg();
  if (!raw || !raw.length) return;
  const rows = raw.slice(0, 20);

  const max = Math.max(...rows.map(r => r.revenue || 0)) || 1;
  const c = getThemeColors();
  const S = rdGetS();
  const D = rdGetD();
  const wholesale = new Set((D && D.wholesale_stores) || ['Полевая магазин']);

  const sub = document.getElementById('ov_store_s');
  const exact = rdGetGlobal('STORE_AGG_EXACT');
  if (sub) sub.textContent = (exact === false ? '≈ оценка · ' : '') + 'клик = фильтр';

  let html = '<div class="rd-rank" role="list">';
  rows.forEach((r, i) => {
    const w = (r.revenue / max * 100).toFixed(1);
    const isWh = wholesale.has(r.store);
    const isSel = S && S.store && rdInSel(r.store, S.store);
    const barColor = isWh
      ? 'linear-gradient(90deg,' + c.orange + ',' + c.warn + ')'
      : 'linear-gradient(90deg,' + c.acc + ',' + c.pos + ')';
    html += '<div class="rd-rank-row" data-store="' + (r.store || '').replace(/"/g, '&quot;') + '" role="listitem"' + (isSel ? ' style="background:var(--accsoft)"' : '') + '>'
      + '<span class="rd-rk">' + String(i+1).padStart(2,'0') + '</span>'
      + '<div class="rd-lb">'
      +   '<span class="rd-name" title="' + (r.store || '') + '">' + (r.store || '—') + '</span>'
      +   (isWh ? '<span class="rd-flag">опт</span>' : '')
      + '</div>'
      + '<span class="rd-val">' + fmtCompact(r.revenue) + '&nbsp;₴</span>'
      + '<div class="rd-rank-bar"><i style="width:' + w + '%;background:' + barColor + '"></i></div>'
      + '</div>';
  });
  html += '</div>';

  if (window.echarts && window.echarts.getInstanceByDom) {
    const inst = window.echarts.getInstanceByDom(el);
    if (inst) { try { inst.dispose(); } catch(e){} }
  }

  el.classList.add('rd-svg-rank');
  el.innerHTML = html;

  el.querySelectorAll('.rd-rank-row').forEach(row => {
    row.addEventListener('click', () => {
      const store = row.dataset.store;
      if (store) rdSetFilter('store', store);
    });
  });
}

function renderOverviewRanks(){
  try { renderCatRank(); } catch(e){ console.warn('rd catRank:', e); }
  try { renderStoreRank(); } catch(e){ console.warn('rd storeRank:', e); }
  try { replaceAlertIcons(); } catch(e){ console.warn('rd alertIcons:', e); }
}

// ---------- ЗАМЕНА ЭМОДЗИ В АЛЕРТАХ НА SVG-ИКОНКИ ----------
const RD_ALERT_ICONS = {
  '📉': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 18l-9.5-9.5-5 5L1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
  '🔻': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  '⚠':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01"/></svg>',
  '🧊': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4.93 4.93l14.14 14.14M2 12h20M19.07 4.93 4.93 19.07"/></svg>',
  '📦': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-9 5-9-5V8l9-5 9 5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/></svg>',
  '📊': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
};
function replaceAlertIcons(){
  document.querySelectorAll('#ov_alerts .alert .ic').forEach(el => {
    if (el.dataset.rdIcon === 'done') return;
    const emoji = el.textContent.trim();
    const svg = RD_ALERT_ICONS[emoji];
    if (svg) {
      el.innerHTML = svg;
      el.dataset.rdIcon = 'done';
      // масштабируем SVG
      const s = el.querySelector('svg');
      if (s) { s.setAttribute('width', '18'); s.setAttribute('height', '18'); }
    }
  });
}

// ---------- SPARKLINE + TREND ARROW inject в KPI ----------
// Данные — из D.monthly. Sparkline рендерится ПОД числом, во всю ширину карточки.
// Стрелка тренда (▲/▼/±) рисуется рядом со значением — Δ vs предыдущий месяц.
function addSparklines(){
  const D = window.D;
  if (!D || !D.monthly || D.monthly.length < 2) return;
  const kpis = document.querySelectorAll('#ov_kpis .kpi');
  if (!kpis.length) return;

  // Отсортируем месяцы, но исключим неполный последний (если период кончается не в последний день)
  let months = D.monthly.slice().sort((a,b) => a.mo - b.mo);
  let partial = false;
  if (D.period && D.period.end){
    const ed = String(D.period.end);
    const eMo = +ed.slice(5,7), eDay = +ed.slice(8,10);
    const dim = new Date(+ed.slice(0,4), eMo, 0).getDate();
    if (eDay < dim && months.length && months[months.length-1].mo === eMo) partial = true;
  }
  const trendMonths = partial ? months.slice(0, -1) : months;
  if (trendMonths.length < 2) return;

  const drawSpark = (values, color, gradId) => {
    if (!values.length) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const W = 100, H = 28;
    const pts = values.map((v,i) => {
      const x = (i/(values.length-1)) * W;
      const y = H - ((v - min)/range) * (H - 3) - 1.5;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const area = 'M0,' + H + ' L' + pts.split(' ').join(' L') + ' L' + W + ',' + H + ' Z';
    return '<svg class="rd-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">'
      + '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + color + '" stop-opacity=".38"/>'
      + '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/>'
      + '</linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#' + gradId + ')"/>'
      + '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'
      + '</svg>';
  };

  const arrowSvg = (dir) => {
    if (dir === 'up')   return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
    if (dir === 'down') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
  };

  const trend = (vals) => {
    if (vals.length < 2) return null;
    const last = vals[vals.length-1];
    const prev = vals[vals.length-2];
    if (!prev) return null;
    const pct = (last - prev) / prev * 100;
    const dir = pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat';
    return { pct, dir };
  };

  // удалить старые sparkline + trend
  document.querySelectorAll('#ov_kpis .rd-spark, #ov_kpis .rd-trend').forEach(s => s.remove());

  const c = getThemeColors();
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2,5);

  const injectKpi = (idx, values, color, sparkId) => {
    const kpi = kpis[idx];
    if (!kpi || !values.length) return;
    // trend
    const t = trend(values);
    if (t) {
      const vEl = kpi.querySelector('.v');
      if (vEl && !vEl.querySelector('.rd-trend')) {
        const sign = t.pct > 0 ? '+' : '';
        vEl.insertAdjacentHTML('afterend',
          '<span class="rd-trend ' + t.dir + '">' + arrowSvg(t.dir) + sign + t.pct.toFixed(1) + '%</span>'
        );
      }
    }
    // sparkline (все месяцы, включая неполный — показываем реалистичный тренд)
    kpi.insertAdjacentHTML('beforeend',
      drawSpark(values, color, sparkId));
  };

  // Первая карточка: Выручка
  injectKpi(0, trendMonths.map(m => +m.revenue || 0), c.acc, 'rd-sg-rev-' + uid);
  // Вторая: Прибыль
  if (D.monthly.some(m => 'gp' in m)) {
    injectKpi(1, trendMonths.map(m => +m.gp || 0), c.pos, 'rd-sg-gp-' + uid);
  }
}

// Хук: MutationObserver + обёртка render + перехват chart() для замены ECharts на SVG-ranks.
function hookRender(){
  // 1. MutationObserver на KPI-контейнер (sparkline + trend)
  const box = document.getElementById('ov_kpis');
  if (box) {
    let pending = false;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        try {
          if (!box.querySelector('.rd-spark')) addSparklines();
        } catch(e){ console.warn('rd kpi mo:', e); }
      });
    });
    mo.observe(box, { childList: true, subtree: false });
  }

  // 2. Перехватываем window.chart(id) — для #ov_cat / #ov_store возвращаем заглушку,
  //    основной скрипт "нарисует" в неё → мы игнорируем, потом сами отрендерим SVG.
  if (typeof window.chart === 'function') {
    const origChart = window.chart;
    const stubChart = {
      setOption: function(){ return this; },
      on: function(){ return this; },
      off: function(){ return this; },
      resize: function(){ return this; },
      dispose: function(){ return this; },
      getZr: function(){ return { on: function(){}, off: function(){} }; },
      showLoading: function(){}, hideLoading: function(){},
      getOption: function(){ return null; },
      __rdStub: true
    };
    window.chart = function(id){
      if (id === 'ov_cat' || id === 'ov_store') return stubChart;
      return origChart.apply(this, arguments);
    };
  }

  // 3. Обёртка render — SVG-ranks + перекрашивание оставшихся ECharts
  if (typeof window.render === 'function') {
    const orig = window.render;
    window.render = function(){
      const r = orig.apply(this, arguments);
      setTimeout(() => {
        try {
          if (rdGetTab() === 'overview') {
            renderOverviewRanks();
          }
          reRenderCharts();
        } catch(e){ console.warn('rd render hook:', e); }
      }, 60);
      return r;
    };
  }
}

// ---------- INIT ----------
// Тему ставим ДО DOMContentLoaded, чтобы не было flash of wrong theme
initTheme();

document.addEventListener('DOMContentLoaded', function(){
  // 1. Строим shell
  buildShell();

  // 2. Ждём, пока основной скрипт создаст window.D и window.render
  //    (это происходит после fetch full_data.json)
  const waitForApp = () => {
    if (typeof window.render === 'function' && typeof window.renderHeatmap === 'function'){
      overrideHeatmap();
      hookRender();
      // добавим первый заход спарклайнов + SVG-ranks (несколько попыток —
      // основной скрипт может отрендерить с задержкой из-за fetch)
      const kickInit = () => {
        try { addSparklines(); } catch(e){}
        try { if (rdGetTab() === 'overview') renderOverviewRanks(); } catch(e){}
      };
      setTimeout(kickInit, 200);
      setTimeout(kickInit, 600);
      setTimeout(kickInit, 1200);
      return;
    }
    setTimeout(waitForApp, 100);
  };
  waitForApp();
});

// Экспорт для отладки
window.RD = { setTheme, addSparklines };

})();
