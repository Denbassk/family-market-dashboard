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

// Условный логгер: включается через localStorage.setItem('rd-debug', '1')
const rdLog = (function(){
  const enabled = (function(){ try { return localStorage.getItem('rd-debug') === '1'; } catch(e){ return false; } })();
  return enabled ? console.warn.bind(console, '[rd]') : function(){};
})();

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
  } catch(e){ rdLog('re-theme charts:', e); }
}

// Хук на theme-change — с задержкой, чтобы CSS-переменные успели пересчитаться
window.addEventListener('rd-theme-change', () => {
  setTimeout(reRenderCharts, 50);
  setTimeout(() => { try { addSparklines(); } catch(e){} }, 80);
  setTimeout(() => { try { if (typeof window.renderHeatmap === 'function') window.renderHeatmap(); } catch(e){} }, 100);
  setTimeout(() => {
    try {
      const tab = rdGetTab();
      if (tab === 'overview') renderOverviewRanks();
      if (tab === 'stock') renderFrozenRanks();
      if (tab === 'analytics') { renderAbcSegments(); enhanceParetoChart(); }
    } catch(e){}
  }, 100);
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
  } catch(e){ rdLog('applyEchartsTheme:', e); }
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
      // Из старой шапки берём три вещи, а не одну: дату данных, версию интерфейса и
      // дату последней продажи. Раньше регулярка выхватывала только «обновлено» и молча
      // выбрасывала остальное — версию интерфейса физически негде было увидеть, а именно
      // по ней отличают свежую страницу от кэша Cloudflare (18.09.2026).
      const t = oldUpd.innerHTML || 'загрузка…';
      const m  = t.match(/обновлено:\s*<b>([^<]+)<\/b>/);
      const ui = t.match(/интерфейс:\s*<b>([^<]+)<\/b>/);
      el.innerHTML = (m ? `обновлено <b>${m[1]}</b>` : (t.length > 80 ? t.slice(0,60)+'…' : t))
        + (ui ? ` <span style="opacity:.6" title="Версия интерфейса. Если после деплоя тут старая дата — браузер или Cloudflare отдают кэш: откройте адрес с ?v=2 или в приватном окне.">· UI ${ui[1].replace(/^\d{4}-/,'').replace(' UTC','')}</span>` : '');
      // полный текст (период, последняя продажа, отставание) — в подсказке по наведению
      el.title = t.replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g,' ').replace(/\s+/g, ' ').trim();
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
    // D и S объявлены в основном скрипте через let/const, поэтому свойствами window
    // они НЕ становятся: window.D тут всегда undefined, и функция выходила на этой
    // строке — теплокарта не рисовалась никогда. Берём их так же, как остальной файл.
    const D = rdGetD();
    const S = rdGetS();
    if (!D || !S) return;
    const container = document.getElementById('hm_chart');
    const noteEl = document.getElementById('hm_note');
    if (!container) return;

    const hm = D.heatmap;
    if (!hm || !hm.length){
      container.innerHTML = rdEmptyState({
        icon: 'chart',
        title: 'Тепловая карта пока недоступна',
        desc: 'Данные день × час собираются из turnover_transactions при пересборке.',
        hint: 'Нажмите «Обновить данные»'
      });
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
  // D в основном скрипте — `let D = null` до fetch, потом присваивается
  const v = rdGetGlobal('D') || window.D;
  return v || null;
}
function rdIsReady(){
  // Данные полностью загружены?
  const D = rdGetD();
  return !!(D && D.by_category && D.by_store);
}
// Ждём готовности данных и пробуем `fn()` до успеха.
// Возвращает handle таймера — можно отменить через clearInterval.
function rdWhenReady(fn, opts){
  opts = opts || {};
  const maxTries = opts.maxTries || 50;    // 50 * 200 = 10 сек
  const interval = opts.interval || 200;
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if (rdIsReady()) {
      clearInterval(iv);
      try { fn(); } catch(e){ rdLog('rd whenReady fn:', e); }
    } else if (tries >= maxTries) {
      clearInterval(iv);
      rdLog('rd whenReady: timeout waiting for D');
    }
  }, interval);
  return iv;
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
  try { renderCatRank(); } catch(e){ rdLog('rd catRank:', e); }
  try { renderStoreRank(); } catch(e){ rdLog('rd storeRank:', e); }
  try { restyleAlerts(); } catch(e){ rdLog('rd alerts:', e); }
  try { restyleTables(); } catch(e){ rdLog('rd tables:', e); }
}

// ---------- УТИЛИТА: sparkline SVG для маленьких графиков в таблицах ----------
function drawRowSpark(values, color){
  if (!values || values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 100, H = 24;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 3) - 1.5;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  const area = 'M0,' + H + ' L' + pts.split(' ').join(' L') + ' L' + W + ',' + H + ' Z';
  const gradId = 'rs-' + Math.random().toString(36).slice(2,7);
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="' + color + '" stop-opacity=".28"/>'
    + '<stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>'
    + '<path d="' + area + '" fill="url(#' + gradId + ')"/>'
    + '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'
    + '</svg>';
}

// ---------- ПОЗИЦИИ: добавить sparkline-тренд в каждую строку ----------
function addRowSparklinesProducts(){
  const tbl = document.getElementById('pr_tab');
  if (!tbl || !tbl.tBodies[0]) return;
  const D = rdGetD();
  if (!D || !D.prod_month || !D.prod_month.length) return;

  // Строим map: товар → массив выручки по месяцам
  // (одна проходка, потом кэшируем)
  if (!window.__rd_prodMonthMap) {
    const map = {};
    D.prod_month.forEach(r => {
      const p = r.p;
      if (!map[p]) map[p] = {};
      map[p][r.mo] = (map[p][r.mo] || 0) + (+r.rev || 0);
    });
    // Список месяцев
    const monthsSet = new Set();
    D.prod_month.forEach(r => monthsSet.add(r.mo));
    const months = [...monthsSet].sort((a,b) => a - b);
    window.__rd_prodMonthMap = { map, months };
  }
  const { map, months } = window.__rd_prodMonthMap;
  const c = getThemeColors();

  // Найдём индекс колонки "Товар" (первая .l колонка)
  const headers = [...tbl.tHead.querySelectorAll('th')];
  const nameColIdx = headers.findIndex(h => (h.textContent || '').trim().toLowerCase().startsWith('товар'));
  const marginColIdx = headers.findIndex(h => /маржа/i.test(h.textContent));
  if (nameColIdx < 0) return;

  // Найдём/создадим колонку "Тренд" в шапке
  let trendColIdx = headers.findIndex(h => h.dataset.rdTrendCol === '1');
  if (trendColIdx < 0) {
    // Добавляем после "Маржа" или в конец до ABC
    const abcColIdx = headers.findIndex(h => /^abc/i.test(h.textContent));
    const insertBefore = abcColIdx > 0 ? headers[abcColIdx] : null;
    const newTh = document.createElement('th');
    newTh.dataset.rdTrendCol = '1';
    newTh.style.width = '90px';
    newTh.style.cursor = 'help';
    const trendTooltip = 'Динамика выручки товара по месяцам. Цвет = маржа: зелёный ≥20% · синий 10-19% · жёлтый 5-9% · красный <5%';
    newTh.setAttribute('title', trendTooltip);
    newTh.setAttribute('aria-label', trendTooltip);
    // ⓘ рядом с текстом — сразу видно что это help-column
    newTh.innerHTML = 'ТРЕНД <span style="opacity:.55;font-size:11px;margin-left:2px" aria-hidden="true">ⓘ</span>';
    if (insertBefore) tbl.tHead.querySelector('tr').insertBefore(newTh, insertBefore);
    else tbl.tHead.querySelector('tr').appendChild(newTh);
    trendColIdx = [...tbl.tHead.querySelectorAll('th')].indexOf(newTh);
  }

  // Пробегаем строки
  const rows = [...tbl.tBodies[0].rows];
  rows.forEach(tr => {
    if (tr.dataset.rdSparkAdded === 'done') return;
    const nameCell = tr.cells[nameColIdx];
    if (!nameCell) return;
    const name = (nameCell.textContent || '').trim();
    const byMo = map[name];
    if (!byMo) {
      // Пустая ячейка тренда
      const td = document.createElement('td');
      td.className = 'num';
      tr.insertBefore(td, tr.cells[trendColIdx] || null);
      tr.dataset.rdSparkAdded = 'done';
      return;
    }
    const values = months.map(m => byMo[m] || 0);
    // Цвет по маржинальности из соседней ячейки
    let color = c.acc;
    if (marginColIdx >= 0 && tr.cells[marginColIdx]) {
      const m = parseFloat((tr.cells[marginColIdx].textContent || '').replace(',', '.'));
      if (!isNaN(m)) {
        color = m >= 20 ? c.pos : m >= 10 ? c.acc : m >= 5 ? c.warn : c.neg;
      }
    }
    const td = document.createElement('td');
    td.style.padding = '4px 8px';
    // Tooltip: показываем текстом значения по месяцам
    const MONTHS = ['','Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    const fmtV = v => {
      const a = Math.abs(v);
      if (a >= 1e6) return (v/1e6).toFixed(2) + 'M';
      if (a >= 1e3) return Math.round(v/1e3) + 'k';
      return String(Math.round(v));
    };
    const tooltip = months.map((m,i) => (MONTHS[m] || m) + ': ' + fmtV(values[i])).join(' · ');
    td.innerHTML = '<span class="rd-row-spark" title="' + tooltip + '">' + drawRowSpark(values, color) + '</span>';
    const currentTrendCell = tr.cells[trendColIdx];
    if (currentTrendCell) tr.insertBefore(td, currentTrendCell);
    else tr.appendChild(td);
    tr.dataset.rdSparkAdded = 'done';
  });
}

// ---------- АНАЛИТИКА: ABC-сегмент-бар ----------
function renderAbcSegments(){
  const D = rdGetD();
  if (!D || !D.abc || !D.abc.classes) return;
  const container = document.getElementById('an_abc_k');
  if (!container) return;

  // Ищем внешний .card (родитель an_abc_k). Наш блок кладём ПЕРЕД KPI-карточками,
  // во всю ширину, а не внутрь сетки KPI.
  const card = container.closest('.card');
  if (!card) return;
  // Не отрисовываем повторно
  if (card.querySelector('.rd-abc-wrap')) return;

  const classes = D.abc.classes;
  const total = D.abc.total_sku || classes.reduce((a,c) => a + (c.skus || 0), 0);

  const clA = classes.find(c => c.abc === 'A') || { skus: 0, revenue: 0 };
  const clB = classes.find(c => c.abc === 'B') || { skus: 0, revenue: 0 };
  const clC = classes.find(c => c.abc === 'C') || { skus: 0, revenue: 0 };

  const totalSku = clA.skus + clB.skus + clC.skus || 1;
  const wA = (clA.skus / totalSku * 100).toFixed(1);
  const wB = (clB.skus / totalSku * 100).toFixed(1);
  const wC = (clC.skus / totalSku * 100).toFixed(1);

  const fmtCompact = v => {
    v = +v || 0;
    if (v >= 1e6) return (v/1e6).toFixed(1) + ' млн';
    if (v >= 1e3) return Math.round(v/1e3) + ' тыс';
    return String(Math.round(v));
  };

  // Блок в отдельном div-обёртке, вставим ДО #an_abc_k
  const wrap = document.createElement('div');
  wrap.className = 'rd-abc-wrap';
  wrap.innerHTML =
    '<div class="rd-abc-segments" title="Клик = открыть позиции класса">'
    +   '<div class="rd-abc-seg a" data-abc="A" style="flex:' + wA + ' 1 0" title="Класс A: ' + clA.skus + ' SKU · 80% выручки · ' + fmtCompact(clA.revenue) + ' ₴">'
    +     '<div class="lbl">A · 80% выручки</div>'
    +     '<div class="val">' + fmtCompact(clA.skus) + ' SKU · ' + fmtCompact(clA.revenue) + ' ₴</div>'
    +   '</div>'
    +   '<div class="rd-abc-seg b" data-abc="B" style="flex:' + wB + ' 1 0" title="Класс B: ' + clB.skus + ' SKU · 15% выручки · ' + fmtCompact(clB.revenue) + ' ₴">'
    +     '<div class="lbl">B · 15%</div>'
    +     '<div class="val">' + fmtCompact(clB.skus) + ' SKU · ' + fmtCompact(clB.revenue) + ' ₴</div>'
    +   '</div>'
    +   '<div class="rd-abc-seg c" data-abc="C" style="flex:' + wC + ' 1 0" title="Класс C: ' + clC.skus + ' SKU · 5% выручки · ' + fmtCompact(clC.revenue) + ' ₴">'
    +     '<div class="lbl">C · 5%</div>'
    +     '<div class="val">' + fmtCompact(clC.skus) + ' SKU · ' + fmtCompact(clC.revenue) + ' ₴</div>'
    +   '</div>'
    + '</div>'
    + '<div class="rd-abc-caption">'
    +   '<span>Всего: <b>' + fmtCompact(total) + '</b> SKU · Парето: <b>' + Math.round(clA.skus/total*100) + '%</b> ассортимента даёт 80% выручки. <b>Клик по сегменту</b> = открыть позиции класса.</span>'
    + '</div>';

  // Вставляем ПЕРЕД #an_abc_k (KPI карточки останутся под нашим баром)
  container.parentNode.insertBefore(wrap, container);

  wrap.querySelectorAll('.rd-abc-seg').forEach(seg => {
    seg.addEventListener('click', () => {
      const cls = seg.dataset.abc;
      const S = rdGetS();
      if (S) {
        S.abc = cls;
        S.store = [];
        S.tab = 'products';
      }
      const syncTabs = rdGetGlobal('syncTabs') || window.syncTabs;
      if (typeof syncTabs === 'function') syncTabs();
      if (typeof window.render === 'function') window.render();
    });
  });
}

// ---------- АНАЛИТИКА: HTML overlay поверх canvas Парето ----------
// ECharts 5.5.1 упорно мигает при hover, невозможно отключить. Решение:
// 1) Убираем areaStyle из ECharts (пусть будет только линия)
// 2) Рисуем свой SVG-overlay поверх, который не связан с ECharts hover
function enhanceParetoChart(){
  if (!window.echarts || !window.echarts.getInstanceByDom) return;
  const el = document.getElementById('an_abc');
  if (!el) return;
  const chart = window.echarts.getInstanceByDom(el);
  if (!chart) return;
  if (chart.__rdEnhanced) return;

  const D = rdGetD();
  const curve = D && D.abc && D.abc.curve ? D.abc.curve : null;
  if (!curve || !curve.length) return;

  const c = getThemeColors();

  try {
    const opt = chart.getOption();
    if (!opt || !opt.series) return;

    // Отключаем areaStyle в ECharts — рисуем свой overlay
    (opt.series || []).forEach(s => {
      if (s.type === 'line' && s.areaStyle) {
        s.areaStyle = { opacity: 0 };  // невидимо, но структура сохранена
      }
      s.emphasis = { disabled: true };
      s.silent = false;   // tooltip оставим работать
    });
    chart.setOption(opt);
    chart.__rdEnhanced = true;
  } catch(e){ rdLog('rd pareto opt:', e); return; }

  // Создать или обновить SVG-overlay
  const drawOverlay = () => {
    // Убедимся что контейнер имеет position: relative
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

    let overlay = el.querySelector('.rd-pareto-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'rd-pareto-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;';
      el.appendChild(overlay);
    }

    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;

    // Получим пиксельные координаты кривой из ECharts
    // Формат curve: [[rank, cumPct], ...]
    let pts = [];
    try {
      pts = curve.map(pt => {
        const px = chart.convertToPixel({ xAxisIndex: 0 }, pt[0]);
        const py = chart.convertToPixel({ yAxisIndex: 0 }, pt[1]);
        return [px, py];
      }).filter(p => isFinite(p[0]) && isFinite(p[1]));
    } catch(e){ return; }
    if (pts.length < 2) return;

    // Найдём baseline — нижний край grid (y для value=0)
    let yBase;
    try {
      yBase = chart.convertToPixel({ yAxisIndex: 0 }, 0);
    } catch(e){ yBase = h - 30; }

    // Построим path area
    let pathD = 'M' + pts[0][0].toFixed(1) + ',' + yBase.toFixed(1);
    pts.forEach(p => { pathD += ' L' + p[0].toFixed(1) + ',' + p[1].toFixed(1); });
    pathD += ' L' + pts[pts.length-1][0].toFixed(1) + ',' + yBase.toFixed(1) + ' Z';

    // SVG контент
    overlay.innerHTML =
      '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">'
      + '<defs>'
      +   '<linearGradient id="rd-pareto-grad" x1="0" y1="0" x2="0" y2="1">'
      +     '<stop offset="0" stop-color="' + c.pos + '" stop-opacity=".22"/>'
      +     '<stop offset="1" stop-color="' + c.pos + '" stop-opacity="0"/>'
      +   '</linearGradient>'
      + '</defs>'
      + '<path d="' + pathD + '" fill="url(#rd-pareto-grad)"/>'
      + '</svg>';
  };

  // Первая отрисовка (даём чарту закончить layout)
  setTimeout(drawOverlay, 100);
  // При завершении рендера
  chart.on('finished', drawOverlay);
  // При ресайзе
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => setTimeout(drawOverlay, 50));
    ro.observe(el);
  } else {
    window.addEventListener('resize', () => setTimeout(drawOverlay, 100));
  }
}

// ---------- ЗАПАСЫ: заменить ECharts на SVG rank для frozen ----------
function renderFrozenRanks(){
  const D = rdGetD();
  if (!D) return;

  const c = getThemeColors();
  const fmtC = v => {
    v = Math.abs(+v || 0);
    if (v >= 1e6) return (v/1e6).toFixed(1) + ' млн';
    if (v >= 1e3) return Math.round(v/1e3) + ' тыс';
    return String(Math.round(v));
  };

  const buildRank = (el, rows, nameField, isStore) => {
    if (!el || !rows || !rows.length) return;
    const max = Math.max(...rows.map(r => r.dead_value || 0)) || 1;
    const setFilter = rdGetGlobal('setFilter') || window.setFilter;

    let html = '<div class="rd-rank" role="list" style="max-height:460px">';
    rows.forEach((r, i) => {
      const name = r[nameField] || '—';
      const w = (r.dead_value / max * 100).toFixed(1);
      const grad = isStore
        ? 'linear-gradient(90deg,' + c.neg + ',' + c.orange + ')'
        : 'linear-gradient(90deg,' + c.orange + ',' + c.warn + ')';
      html += '<div class="rd-rank-row" data-name="' + name.replace(/"/g,'&quot;') + '" role="listitem">'
        + '<span class="rd-rk">' + String(i+1).padStart(2,'0') + '</span>'
        + '<div class="rd-lb">'
        +   '<span class="rd-name" title="' + name + '">' + name + '</span>'
        + '</div>'
        + '<span class="rd-val">' + fmtC(r.dead_value) + '&nbsp;₴</span>'
        + '<div class="rd-rank-bar"><i style="width:' + w + '%;background:' + grad + '"></i></div>'
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
        const n = row.dataset.name;
        if (n && setFilter) setFilter(isStore ? 'store' : 'sup', n);
      });
    });
  };

  const storeEl = document.getElementById('fr_store');
  const supEl   = document.getElementById('fr_sup');
  const stores  = (D.dead_by_store || []).slice()
    .sort((a,b) => (b.dead_value||0) - (a.dead_value||0)).slice(0, 20);
  const sups    = (D.dead_by_supplier || []).slice()
    .sort((a,b) => (b.dead_value||0) - (a.dead_value||0)).slice(0, 20);
  buildRank(storeEl, stores, 'store', true);
  buildRank(supEl,   sups,   'supplier', false);
}

// ---------- МАТРИЦА: chip-фильтры + оживление KPI-карточек статусов ----------
function enhanceMatrix(){
  const D = rdGetD();
  if (!D || !D.matrix || !D.matrix.rows || !D.matrix.rows.length) return;
  const S = rdGetS();
  if (!S) return;

  const M = D.matrix;
  const H = M.cols;
  const iStatus = H.indexOf('Статус');
  const iProd = H.indexOf('Товар');
  const isTot = r => (''+(r[iProd] || '')).trim().startsWith('ИТОГО');

  // statusGroup — копия из основного скрипта
  const statusGroup = s => {
    s = s || '';
    if (s.includes('Прибыльный')) return 'Прибыльный';
    if (s.includes('Кандидат на вывод')) return 'Кандидат на вывод';
    if (s.includes('Расширить')) return 'Расширить покрытие';
    if (s.includes('Новинка')) return 'Новинка';
    return 'Нет данных';
  };

  // Считаем количество по группам
  const real = M.rows.filter(r => !isTot(r));
  const groupCounts = {};
  real.forEach(r => {
    const g = statusGroup(r[iStatus]);
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  });

  // 1) Разметить KPI-карточки атрибутом data-mx
  const kpis = document.querySelectorAll('#mx_kpis .kpi');
  const statusOrder = ['all', 'Прибыльный', 'Кандидат на вывод', 'Расширить покрытие', 'Новинка'];
  kpis.forEach((k, i) => {
    // Первая — "Всего в матрице" = all, дальше по порядку
    const st = statusOrder[i] || 'other';
    k.setAttribute('data-mx', st);
    if (S.mxStatus === st || (st === 'all' && (!S.mxStatus || S.mxStatus === 'all'))) {
      k.classList.add('rd-mx-active');
    } else {
      k.classList.remove('rd-mx-active');
    }
    // Клик = фильтр
    if (!k.dataset.rdMxWired) {
      k.addEventListener('click', () => {
        S.mxStatus = st === 'all' ? 'all' : st;
        // Синхронизируем селект (он скрыт, но основной код к нему обращается)
        const sel = document.getElementById('mxStatus');
        if (sel) sel.value = S.mxStatus;
        const render = window.render;
        if (typeof render === 'function') render();
      });
      k.dataset.rdMxWired = '1';
    }
  });

  // 2) Добавить полоску слева в строках таблицы по статусу
  const tbl = document.getElementById('mx_tab');
  if (tbl && tbl.tBodies[0]) {
    [...tbl.tBodies[0].rows].forEach(tr => {
      if (tr.dataset.rdMxDone) return;
      // Статус может быть в любой ячейке — ищем по цвету текста, установленному основным
      // скриптом (statusColor). Проще — по 'Статус' колонке.
      if (iStatus >= 0 && tr.cells[iStatus]) {
        const txt = tr.cells[iStatus].textContent || '';
        const g = statusGroup(txt);
        tr.setAttribute('data-mx-status', g);
      }
      tr.dataset.rdMxDone = '1';
    });
  }

  // 3) Chip-фильтры — вставим перед .bar (или в неё)
  const page = document.getElementById('p_matrix');
  if (!page) return;
  let chipsBox = page.querySelector('.rd-mx-chips');
  if (chipsBox) return;  // уже есть

  const bar = page.querySelector('.bar');
  if (!bar) return;

  chipsBox = document.createElement('div');
  chipsBox.className = 'rd-mx-chips';
  const chips = [
    { key: 'all',                 label: 'Все',              color: 'var(--acc)',   count: real.length },
    { key: 'Прибыльный',          label: 'Прибыльные',       color: 'var(--a)',     count: groupCounts['Прибыльный'] || 0 },
    { key: 'Кандидат на вывод',   label: 'Кандидаты вывод',  color: 'var(--c)',     count: groupCounts['Кандидат на вывод'] || 0 },
    { key: 'Расширить покрытие',  label: 'Расширить',        color: 'var(--acc2)',  count: groupCounts['Расширить покрытие'] || 0 },
    { key: 'Новинка',             label: 'Новинки',          color: 'var(--b)',     count: groupCounts['Новинка'] || 0 },
    { key: 'Нет данных',          label: 'Нет данных',       color: 'var(--faint)', count: groupCounts['Нет данных'] || 0 }
  ];
  chipsBox.innerHTML = chips.map(c => {
    const active = (S.mxStatus === c.key) || (c.key === 'all' && (!S.mxStatus || S.mxStatus === 'all'));
    return '<button type="button" class="rd-mx-chip ' + (active ? 'on' : '') + '" data-key="' + c.key + '">'
      + '<span class="dot" style="background:' + c.color + '"></span>'
      + c.label
      + '<span class="cnt">' + c.count + '</span>'
      + '</button>';
  }).join('');
  bar.parentNode.insertBefore(chipsBox, bar);

  chipsBox.querySelectorAll('.rd-mx-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      S.mxStatus = k;
      const sel = document.getElementById('mxStatus');
      if (sel) sel.value = k;
      const render = window.render;
      if (typeof render === 'function') render();
    });
  });
}

// ---------- УСЛОВИЯ ПОСТАВЩИКОВ: пилюли для процентов, badge для доставки ----------
function enhanceSuppliers(){
  const tbl = document.querySelector('#p_suppliers table');
  if (!tbl || !tbl.tBodies[0]) return;

  const headers = [...tbl.tHead.querySelectorAll('th')];
  const findCol = re => headers.findIndex(h => re.test(h.textContent || ''));
  const iRetro   = findCol(/ретро/i);
  const iDisc    = findCol(/скидка/i);
  const iSponsor = findCol(/спонсор|взнос/i);
  const iEnterFee= findCol(/оплата.*ввод|оплата.*вход/i);
  const iEnterSku= findCol(/ввод\s*ску|вход\s*sku/i);
  const iReturn  = findCol(/возврат/i);
  const iMarkOpt = findCol(/наценка.*опт/i);
  const iMarkRet = findCol(/наценка.*розн/i);
  const iDelivery= findCol(/доставк/i);

  // Класс пилюли по проценту (для ретро/скидки/наценки)
  const pctClass = raw => {
    const t = (raw || '').toString().trim().toLowerCase();
    if (!t || t === '-' || t === '—' || t === 'нет') return 'p-none';
    const n = parseFloat(t.replace(',', '.'));
    if (isNaN(n)) return 'p-none';
    if (n >= 20) return 'p-hi';
    if (n >= 10) return 'p-mid';
    return 'p-low';
  };
  const formatPct = raw => {
    const t = (raw || '').toString().trim();
    if (!t || t === '-' || t === '—' || t === 'нет') return '—';
    return t;
  };

  const rows = [...tbl.tBodies[0].rows];
  rows.forEach(tr => {
    if (tr.dataset.rdSupDone) return;

    const doPct = (i) => {
      if (i < 0) return;
      const td = tr.cells[i];
      if (!td) return;
      const raw = td.textContent.trim();
      if (td.querySelector('.rd-sup-pct, .rd-sup-badge, .rd-sup-ret')) return;
      const cls = pctClass(raw);
      td.innerHTML = '<span class="rd-sup-pct ' + cls + '">' + formatPct(raw) + '</span>';
    };
    [iRetro, iDisc, iSponsor, iEnterFee, iMarkOpt, iMarkRet].forEach(doPct);

    // Доставка → badge
    if (iDelivery >= 0 && tr.cells[iDelivery]) {
      const td = tr.cells[iDelivery];
      if (!td.querySelector('.rd-sup-badge')) {
        const raw = (td.textContent || '').trim();
        const lower = raw.toLowerCase();
        if (lower.includes('тт')) {
          td.innerHTML = '<span class="rd-sup-badge dlv-tt">ТТ</span>';
        } else if (lower.includes('рц')) {
          td.innerHTML = '<span class="rd-sup-badge dlv-rc">РЦ</span>';
        }
      }
    }

    // Возврат → пилюля со статусом
    if (iReturn >= 0 && tr.cells[iReturn]) {
      const td = tr.cells[iReturn];
      if (!td.querySelector('.rd-sup-ret')) {
        const raw = (td.textContent || '').trim();
        const lower = raw.toLowerCase();
        // Если есть готовые badge от основного скрипта — оставляем
        if (td.querySelector('.badge')) {
          // уже стилизовано
        } else if (lower === 'есть' || lower === 'да' || lower === 'yes') {
          td.innerHTML = '<span class="rd-sup-ret ret-yes">✓ Есть</span>';
        } else if (lower === 'нет' || lower === 'no') {
          td.innerHTML = '<span class="rd-sup-ret ret-no">✕ Нет</span>';
        } else if (raw) {
          td.innerHTML = '<span class="rd-sup-ret ret-conditional">' + raw + '</span>';
        }
      }
    }

    // Ввод SKU (yes/no)
    if (iEnterSku >= 0 && tr.cells[iEnterSku]) {
      const td = tr.cells[iEnterSku];
      if (!td.querySelector('.rd-sup-pct, .rd-sup-ret')) {
        const raw = (td.textContent || '').trim().toLowerCase();
        if (raw === 'есть' || raw === 'да') {
          td.innerHTML = '<span class="rd-sup-ret ret-yes">✓</span>';
        } else if (raw === 'нет') {
          td.innerHTML = '<span class="rd-sup-ret ret-no">✕</span>';
        }
      }
    }

    tr.dataset.rdSupDone = '1';
  });
}

// ---------- ОТЧЁТЫ: heatmap ячеек + sparkline итога ----------
function enhanceReport(){
  const tbl = document.getElementById('rp_tab');
  if (!tbl || !tbl.tHead || !tbl.tBodies[0]) return;

  const headers = [...tbl.tHead.querySelectorAll('th')];
  if (!headers.length) return;

  const MONTHS_SHORT = ['','Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

  // Ищем колонки-месяцы (по короткому названию)
  const monthColIdx = [];
  const monthColMo = [];
  headers.forEach((th, i) => {
    const t = (th.textContent || '').trim().split(' ')[0];
    const moIdx = MONTHS_SHORT.indexOf(t);
    if (moIdx > 0) {
      monthColIdx.push(i);
      monthColMo.push(moIdx);
    }
  });

  // Ищем колонку "Итого"
  const totalColIdx = headers.findIndex(h => /итого|всего|total/i.test(h.textContent));

  const rows = [...tbl.tBodies[0].rows];
  const c = getThemeColors();

  rows.forEach(tr => {
    if (tr.dataset.rdRpDone) return;

    const isTotalRow = (tr.cells[0] && /итого|всего/i.test(tr.cells[0].textContent || ''));
    if (isTotalRow) tr.classList.add('rd-rp-total');

    // 1) heatmap-подсветка помесячных ячеек
    if (monthColIdx.length >= 2) {
      const values = monthColIdx.map(ci => {
        const raw = (tr.cells[ci]?.textContent || '').replace(/\s/g, '').replace(',', '.');
        const n = parseFloat(raw);
        return isNaN(n) ? 0 : n;
      });
      const max = Math.max(...values);
      if (max > 0) {
        monthColIdx.forEach((ci, idx) => {
          const td = tr.cells[ci];
          if (!td) return;
          const intens = Math.max(0.05, values[idx] / max);
          td.classList.add('rd-heat-cell');
          td.style.setProperty('--intens', intens.toFixed(2));
        });
      }

      // 2) Sparkline в колонке "Итого" — только для не-итоговых строк
      if (!isTotalRow && totalColIdx >= 0 && tr.cells[totalColIdx] && !tr.cells[totalColIdx].querySelector('.rd-rp-spark')) {
        const td = tr.cells[totalColIdx];
        const rawText = td.textContent;
        // Цвет по тренду (последние 3 месяца)
        const n = values.length;
        let color = c.acc;
        if (n >= 3) {
          const avgFirst = (values[0] + values[1]) / 2;
          const avgLast  = (values[n-1] + values[n-2]) / 2;
          if (avgFirst > 0) {
            const growth = (avgLast - avgFirst) / avgFirst;
            color = growth > 0.05 ? c.pos : growth < -0.05 ? c.neg : c.acc;
          }
        }
        const spark = drawRowSpark(values, color);
        td.innerHTML = '<span class="rd-rp-spark" title="Динамика по месяцам">' + spark + '</span>' + rawText;
      }
    }

    tr.dataset.rdRpDone = '1';
  });
}

// ==============================================================
// EMPTY STATE HELPER
// ==============================================================
// Стандартный HTML для «Нет данных» с иконкой + описанием + подсказкой.
function rdEmptyState(opts){
  opts = opts || {};
  const icons = {
    'no-data': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
    'no-filter': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    'chart': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 4 4 5-6"/></svg>',
    'refresh': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    'search': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>'
  };
  const icon = icons[opts.icon] || icons['no-data'];
  return '<div class="rd-empty">'
    + '<div class="icon">' + icon + '</div>'
    + (opts.title ? '<h4>' + opts.title + '</h4>' : '')
    + (opts.desc ? '<p>' + opts.desc + '</p>' : '')
    + (opts.hint ? '<span class="hint">' + opts.hint + '</span>' : '')
    + '</div>';
}

// ==============================================================
// ПРИОРИТЕТ 3
// ==============================================================

// ---------- АНАЛИТИКА: подписи топ-пузырей на scatter «Маржа vs Выручка» ----------
function enhanceScatter(){
  // Подписи топ-5 пузырей убраны по просьбе владельца (2026-09-03): они наезжали друг на
  // друга, обрезались многоточием и брались из D.by_category — то есть из ПОЛНОГО набора,
  // не из текущего среза, поэтому при фильтре висели не над теми точками. Название
  // категории и так есть в тултипе по наведению. Функция оставлена, чтобы снять overlay
  // у тех, у кого он уже нарисован в кэше страницы.
  const el = document.getElementById('an_margin');
  if (!el) return;
  const overlay = el.querySelector('.rd-scatter-labels');
  if (overlay) overlay.remove();
}

// ---------- АНАЛИТИКА: кросс-продажи как network diagram ----------
function renderCrossNetwork(){
  const D = rdGetD();
  if (!D || !D.cross_items || !D.cross_items.length) return;
  const tableWrap = document.querySelector('#fr_cross')?.closest('.card');
  if (!tableWrap) return;

  // Toggle Таблица / Сеть
  const h3 = tableWrap.querySelector('h3');
  if (h3 && !h3.querySelector('.rd-cross-toggle')) {
    const toggle = document.createElement('span');
    toggle.className = 'rd-cross-toggle';
    toggle.innerHTML =
      '<button data-view="table" class="on">Таблица</button>'
      + '<button data-view="network">Сеть</button>';
    h3.appendChild(toggle);
    toggle.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        toggleCrossView(tableWrap, b.dataset.view);
      });
    });
  }

  // Создаём network-контейнер (скрыт по умолчанию)
  if (!tableWrap.querySelector('.rd-network-wrap')) {
    const netBox = document.createElement('div');
    netBox.className = 'rd-network-wrap';
    netBox.style.display = 'none';
    tableWrap.querySelector('.scroll')?.after(netBox);
    drawCrossNetwork(netBox, D.cross_items);
  }
}

function toggleCrossView(wrap, view){
  const scroll = wrap.querySelector('.scroll');
  const net = wrap.querySelector('.rd-network-wrap');
  if (!scroll || !net) return;
  if (view === 'network') {
    scroll.style.display = 'none';
    net.style.display = 'block';
    // Пере-отрисовать под текущий размер
    const D = rdGetD();
    drawCrossNetwork(net, D.cross_items);
  } else {
    scroll.style.display = '';
    net.style.display = 'none';
  }
}

function drawCrossNetwork(container, items){
  if (!container || !items || !items.length) return;
  const c = getThemeColors();

  // Топ-20 пар (меньше = чище)
  const top = items.slice(0, 20);
  if (!top.length) {
    container.innerHTML = rdEmptyState({
      icon: 'chart',
      title: 'Нет данных кросс-продаж',
      desc: 'Пары товаров в одном чеке появятся после пересборки данных.',
      hint: 'Обновить → BigQuery'
    });
    return;
  }

  // Собираем узлы и связи
  const nodesMap = new Map();
  const links = [];
  const maxCnt = Math.max(...top.map(x => x.cnt || 0)) || 1;
  top.forEach(pair => {
    const a = pair.a, b = pair.b;
    if (!nodesMap.has(a)) nodesMap.set(a, { id: a, cnt: 0 });
    if (!nodesMap.has(b)) nodesMap.set(b, { id: b, cnt: 0 });
    nodesMap.get(a).cnt += pair.cnt;
    nodesMap.get(b).cnt += pair.cnt;
    links.push({ source: a, target: b, cnt: pair.cnt });
  });
  const nodes = [...nodesMap.values()];
  const maxNodeCnt = Math.max(...nodes.map(n => n.cnt)) || 1;

  const W = container.clientWidth || 800;
  const H = container.clientHeight || 520;
  const cx = W / 2, cy = H / 2;

  // Раскладка: 1 хаб в центре + 2 концентрических круга (близкие/дальние)
  // Больше связей = ближе к центру, меньше = дальше
  nodes.sort((a, b) => b.cnt - a.cnt);
  const N = nodes.length;
  const inner = Math.min(6, Math.floor(N / 2));   // внутренний круг
  const outer = N - 1 - inner;                     // внешний круг
  const Rin  = Math.min(W, H) * 0.22;
  const Rout = Math.min(W, H) * 0.42;

  nodes.forEach((n, i) => {
    if (i === 0) {
      // главный хаб в центре
      n.x = cx; n.y = cy;
    } else if (i <= inner) {
      // Внутренний круг — крупнейшие соседи
      const angle = ((i - 1) / inner) * Math.PI * 2 - Math.PI / 2;
      n.x = cx + Math.cos(angle) * Rin;
      n.y = cy + Math.sin(angle) * Rin;
    } else {
      // Внешний круг
      const angle = ((i - 1 - inner) / Math.max(1, outer)) * Math.PI * 2 - Math.PI / 2 + 0.3;
      n.x = cx + Math.cos(angle) * Rout;
      n.y = cy + Math.sin(angle) * Rout;
    }
  });

  // Подпись — смещаем от узла в сторону от центра (чтобы не наезжала на соседей)
  const trunc = (s, n) => (s && s.length > n) ? s.slice(0, n) + '…' : (s || '');
  const nodeRadius = n => 5 + (n.cnt / maxNodeCnt) * 10;

  const labelPos = (n) => {
    if (n === nodes[0]) return { x: 0, y: nodeRadius(n) + 14, anchor: 'middle' };
    const dx = n.x - cx, dy = n.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / dist, ny = dy / dist;
    const r = nodeRadius(n) + 6;
    // Смещаем подпись на 8px в сторону от центра
    return {
      x: nx * (r + 4),
      y: ny * (r + 4) + 4,
      anchor: nx > 0.3 ? 'start' : nx < -0.3 ? 'end' : 'middle'
    };
  };

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';

  // Links
  links.forEach(l => {
    const s = nodesMap.get(l.source), t = nodesMap.get(l.target);
    if (!s || !t) return;
    const w = 0.5 + (l.cnt / maxCnt) * 4;
    svg += '<line class="rd-net-link" x1="' + s.x.toFixed(1) + '" y1="' + s.y.toFixed(1)
      + '" x2="' + t.x.toFixed(1) + '" y2="' + t.y.toFixed(1) + '" stroke-width="' + w.toFixed(1) + '"><title>'
      + (l.source || '') + ' ↔ ' + (l.target || '') + ' — ' + l.cnt + ' чеков</title></line>';
  });

  // Nodes
  nodes.forEach(n => {
    const r = nodeRadius(n);
    const lp = labelPos(n);
    const short = trunc(n.id, 18);
    svg += '<g class="rd-net-node" data-name="' + (n.id || '').replace(/"/g, '&quot;') + '" transform="translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')">'
      + '<circle r="' + r.toFixed(1) + '" fill="' + c.acc + '" stroke="' + c.bg + '" stroke-width="2"><title>' + (n.id || '') + ' — ' + n.cnt + ' связей</title></circle>'
      + '<text text-anchor="' + lp.anchor + '" x="' + lp.x.toFixed(1) + '" y="' + lp.y.toFixed(1) + '">' + short + '</text>'
      + '</g>';
  });

  svg += '</svg>';
  container.innerHTML = svg;

  // Клик по узлу — переход на «Позиции» с фильтром по товару (один render)
  container.querySelectorAll('.rd-net-node').forEach(g => {
    g.addEventListener('click', () => {
      const name = g.dataset.name;
      const S = rdGetS();
      if (!S || !name) return;
      S.prSel = name;
      S.q = name;
      S.tab = 'products';
      const fQ = document.getElementById('fQ');
      if (fQ) fQ.value = name;
      const syncTabs = rdGetGlobal('syncTabs') || window.syncTabs;
      if (typeof syncTabs === 'function') syncTabs();
      if (typeof window.render === 'function') window.render();
    });
    g.style.cursor = 'pointer';
  });
}

// ---------- ПОЗИЦИИ: виртуальная прокрутка ----------
// Заменяем большую таблицу на виртуальный список — рендерим только видимые строки.
// Активируется тумблером в шапке карточки, чтобы не ломать оригинал.
function enableProductsVirtualScroll(){
  const card = document.querySelector('#p_products .card.full');
  if (!card) return;
  const h3 = card.querySelector('h3');
  if (!h3 || h3.querySelector('.rd-virt-toggle')) return;

  const D = rdGetD();
  if (!D) return;

  const toggle = document.createElement('button');
  toggle.className = 'rd-virt-toggle';
  toggle.textContent = '⚡ Быстрая прокрутка';
  toggle.title = 'Виртуальная прокрутка — рендер только видимых строк, работает мгновенно на 10k+ товарах';
  h3.appendChild(toggle);

  toggle.addEventListener('click', () => {
    const on = toggle.classList.toggle('on');
    if (on) {
      renderVirtualProducts(card);
      toggle.textContent = '⚡ Быстрая прокрутка (вкл)';
    } else {
      // Убрать виртуальный контейнер, вернуть оригинальную таблицу
      const virt = card.querySelector('.rd-virt-wrap');
      if (virt) virt.remove();
      const stats = card.querySelector('.rd-virt-stats');
      if (stats) stats.remove();
      const origScroll = card.querySelector('.scroll');
      if (origScroll) origScroll.style.display = '';
      toggle.textContent = '⚡ Быстрая прокрутка';
    }
  });
}

function renderVirtualProducts(card){
  const D = rdGetD();
  const workProducts = rdGetGlobal('workProducts') || window.workProducts;
  if (!D || typeof workProducts !== 'function') return;

  // Скрыть оригинальную таблицу
  const origScroll = card.querySelector('.scroll');
  if (origScroll) origScroll.style.display = 'none';

  let rows = workProducts();
  // Добавим share
  const totRev = (D.kpi && D.kpi.revenue) || 1;
  rows = rows.map(r => ({ ...r, share: +(r.rev / totRev * 100).toFixed(2) }));

  const cols = [
    { key: 'p',     label: 'Товар',      w: '3fr',   type: 'text' },
    { key: 'c',     label: 'Категория',  w: '1.5fr', type: 'text' },
    { key: 's',     label: 'Поставщик',  w: '1.5fr', type: 'text' },
    { key: 'rev',   label: 'Выручка ₴',  w: '1fr',   type: 'num' },
    { key: 'share', label: 'Доля %',     w: '80px',  type: 'num' },
    { key: 'gp',    label: 'Прибыль ₴',  w: '1fr',   type: 'num' },
    { key: 'mrg',   label: 'Маржа',      w: '70px',  type: 'num' },
    { key: 'qty',   label: 'Кол-во',     w: '90px',  type: 'num' },
    { key: 'st',    label: 'Точек',      w: '70px',  type: 'num' },
    { key: 'abc',   label: 'ABC',        w: '60px',  type: 'badge' },
    { key: 'xyz',   label: 'XYZ',        w: '60px',  type: 'badge' }
  ];
  const gridTemplate = cols.map(c => c.w).join(' ');

  const state = { sortKey: 'rev', sortDesc: true };

  const sortRows = () => {
    const k = state.sortKey;
    rows.sort((a, b) => {
      let x = a[k], y = b[k];
      const nx = typeof x === 'number' ? x : parseFloat(x);
      const ny = typeof y === 'number' ? y : parseFloat(y);
      let r;
      if (!isNaN(nx) && !isNaN(ny)) r = nx - ny;
      else r = String(x || '').localeCompare(String(y || ''), 'ru');
      return state.sortDesc ? -r : r;
    });
  };
  sortRows();

  // Форматтеры
  const fmtF = n => Math.round(+n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
  const fmtV = n => {
    const a = Math.abs(+n || 0);
    if (a >= 1e6) return (n/1e6).toFixed(2) + ' млн';
    if (a >= 1e3) return Math.round(n/1e3) + ' тыс';
    return String(Math.round(n));
  };

  // Строим контейнер
  let container = card.querySelector('.rd-virt-wrap');
  let stats = card.querySelector('.rd-virt-stats');
  if (!container) {
    stats = document.createElement('div');
    stats.className = 'rd-virt-stats';
    card.appendChild(stats);

    container = document.createElement('div');
    container.className = 'rd-virt-wrap';
    container.innerHTML =
      '<div class="rd-virt-header" style="grid-template-columns:' + gridTemplate + '">'
      + cols.map(c => '<div data-k="' + c.key + '"' + (c.type === 'num' ? ' class="num"' : '') + '>' + c.label + '</div>').join('')
      + '</div>'
      + '<div class="rd-virt-body"></div>';
    card.appendChild(container);

    // Клик по заголовкам — сортировка
    container.querySelectorAll('.rd-virt-header > div').forEach(h => {
      h.addEventListener('click', () => {
        const k = h.dataset.k;
        if (state.sortKey === k) state.sortDesc = !state.sortDesc;
        else { state.sortKey = k; state.sortDesc = true; }
        sortRows();
        renderRows();
        updateHeaderSort();
      });
    });
  }

  const updateHeaderSort = () => {
    container.querySelectorAll('.rd-virt-header > div').forEach(h => {
      h.classList.remove('rd-virt-sorted', 'rd-virt-sorted-asc');
      if (h.dataset.k === state.sortKey) {
        h.classList.add(state.sortDesc ? 'rd-virt-sorted' : 'rd-virt-sorted-asc');
      }
    });
  };
  updateHeaderSort();

  stats.innerHTML =
    '<span>Всего: <b>' + fmtF(rows.length) + '</b> позиций</span>'
    + '<span>Выручка: <b>' + fmtV(rows.reduce((a,r) => a + (+r.rev || 0), 0)) + '</b> ₴</span>'
    + '<span>Показаны: <b id="rd-virt-visible">30</b> строк из <b>' + fmtF(rows.length) + '</b> · прокрутите для остальных</span>';

  const body = container.querySelector('.rd-virt-body');
  const ROW_H = 34;
  const BUFFER = 8;

  const renderRows = () => {
    const scrollTop = container.scrollTop - (container.querySelector('.rd-virt-header')?.offsetHeight || 0);
    const viewH = container.clientHeight;
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - BUFFER);
    const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + BUFFER);
    const totalH = rows.length * ROW_H;

    body.style.height = totalH + 'px';
    body.style.position = 'relative';

    let html = '';
    for (let i = startIdx; i < endIdx; i++) {
      const r = rows[i];
      if (!r) continue;
      const top = i * ROW_H;
      const evenCls = (i % 2 === 0) ? ' rd-virt-even' : '';
      html += '<div class="rd-virt-row' + evenCls + '" data-i="' + i + '" data-name="' + (r.p || '').replace(/"/g, '&quot;')
        + '" style="position:absolute;top:' + top + 'px;left:0;right:0;grid-template-columns:' + gridTemplate + '">';
      cols.forEach(col => {
        const val = r[col.key];
        let cell = '';
        if (col.type === 'num') {
          cell = '<div class="num">' + (val != null ? fmtF(val) : '—') + '</div>';
        } else if (col.type === 'badge') {
          const cls = col.key === 'abc' ? ('b' + val) : ('b' + (val === 'X' ? 'A' : val === 'Y' ? 'B' : 'C'));
          cell = '<div><span class="badge ' + cls + '">' + (val || '—') + '</span></div>';
        } else {
          const cls = col.key === 'p' ? '' : 'muted';
          cell = '<div class="' + cls + '" title="' + String(val || '').replace(/"/g, '&quot;') + '">' + (val || '') + '</div>';
        }
        html += cell;
      });
      html += '</div>';
    }
    body.innerHTML = html;

    const visEl = document.getElementById('rd-virt-visible');
    if (visEl) visEl.textContent = String(endIdx - startIdx);

    // Клик по строке — открыть карточку БЕЗ полного render
    // (полный render перебирает 10k товаров, лагает; drill self-sufficient — сам рисует)
    body.querySelectorAll('.rd-virt-row').forEach(row => {
      row.addEventListener('click', () => {
        const S = rdGetS();
        if (S) {
          S.prSel = row.dataset.name;
          try { enhanceProductDrill(); } catch(e){}
          // Скроллим drill в видимость
          const dr = document.getElementById('pr_drill');
          if (dr) dr.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  };

  container.addEventListener('scroll', renderRows, { passive: true });
  renderRows();
}

// ---------- ПОЗИЦИИ: новая drill-панель ----------
function enhanceProductDrill(){
  const drill = document.getElementById('pr_drill');
  if (!drill) return;
  const S = rdGetS();
  if (!S || !S.prSel) return;
  // Заменяем содержимое (только если ещё не заменяли для этого товара)
  if (drill.dataset.rdName === S.prSel) return;

  const D = rdGetD();
  if (!D || !D.products) return;

  const name = S.prSel;
  const p = (D.products || []).find(x => x.p === name);
  const frozen = (D.dead_items || []).filter(d => d.p === name);
  const storesTop = (D.store_top_products || []).filter(r => r.p === name).sort((a,b) => b.rev - a.rev);

  // История продаж по месяцам
  const monthly = (D.prod_month || []).filter(r => r.p === name).sort((a,b) => a.mo - b.mo);
  const c = getThemeColors();

  const fmt = n => {
    const a = Math.abs(+n || 0);
    if (a >= 1e6) return (n/1e6).toFixed(2) + ' млн';
    if (a >= 1e3) return Math.round(n/1e3) + ' тыс';
    return String(Math.round(+n || 0));
  };
  const fmtF = n => Math.round(+n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');

  let html = '<div class="rd-drill" data-name="' + name.replace(/"/g, '&quot;') + '">';
  html += '<div class="rd-drill-head">'
    + '<div>'
    +   '<div class="title">' + name + '</div>';
  if (p) {
    html += '<div class="meta">'
      +      '<span><span class="badge b' + p.abc + '">ABC · ' + p.abc + '</span></span>'
      +      '<span><span class="badge b' + (p.xyz === 'X' ? 'A' : p.xyz === 'Y' ? 'B' : 'C') + '">XYZ · ' + (p.xyz || '—') + '</span></span>'
      +      (p.c ? '<span>📁 ' + p.c + '</span>' : '')
      +      (p.s ? '<span>🏭 ' + p.s + '</span>' : '')
      +    '</div>';
  }
  html += '</div>'
    + '<button class="rd-drill-close" onclick="if(window.RD){const S=window.RD.rdGetS();if(S){S.prSel=null;window.render&&window.render();}}">✕ Закрыть</button>'
    + '</div>';

  if (p) {
    // Тренд последнего/предыдущего месяца
    let trendTxt = '';
    if (monthly.length >= 2) {
      const last = monthly[monthly.length-1].rev, prev = monthly[monthly.length-2].rev;
      if (prev > 0) {
        const pct = (last - prev) / prev * 100;
        const dir = pct > 2 ? 'pos' : pct < -2 ? 'neg' : '';
        const sign = pct > 0 ? '+' : '';
        trendTxt = '<span class="' + dir + '">' + sign + pct.toFixed(1) + '%</span>';
      }
    }

    html += '<div class="rd-drill-grid">'
      + '<div class="rd-drill-stat"><div class="v">' + fmt(p.rev) + ' ₴</div><div class="t">Выручка</div></div>'
      + '<div class="rd-drill-stat"><div class="v ' + (p.gp < 0 ? 'neg' : '') + '">' + fmt(p.gp) + ' ₴</div><div class="t">Прибыль</div></div>'
      + '<div class="rd-drill-stat"><div class="v ' + (p.mrg <= 5 ? 'neg' : p.mrg >= 15 ? 'pos' : '') + '">' + p.mrg + '%</div><div class="t">Маржа</div></div>'
      + '<div class="rd-drill-stat"><div class="v">' + fmt(p.qty) + '</div><div class="t">Продано, ед.</div></div>'
      + '<div class="rd-drill-stat"><div class="v">' + (p.st || '—') + '</div><div class="t">В точках</div></div>'
      + (trendTxt ? '<div class="rd-drill-stat"><div class="v">' + trendTxt + '</div><div class="t">Тренд мес.</div></div>' : '')
      + '</div>';
  }

  // Замороженный капитал
  if (frozen.length > 0) {
    const fz = frozen.reduce((a,d) => a + (+d.value || 0), 0);
    html += '<div class="rd-drill-warn">🧊 Заморожено на складах: <b>' + fmtF(fz) + ' ₴</b> в ' + frozen.length + ' точках. '
      + 'Топ: ' + frozen.slice(0, 4).map(d => d.store + ' (' + fmt(d.value) + ')').join(', ') + '</div>';
  }

  // График динамики
  if (monthly.length >= 2) {
    const MONTHS = ['','Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    const values = monthly.map(m => m.rev || 0);
    const maxV = Math.max(...values);
    const minV = Math.min(...values);
    const rangeV = maxV - minV || 1;
    const W = 100, H = 60;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - minV) / rangeV) * (H - 8) - 4;
      return { x, y, v, mo: monthly[i].mo };
    });

    // Строим SVG с осью X (метки месяцев) и Y (min/max) — крупный
    const gradId = 'rd-drill-grad-' + Math.random().toString(36).slice(2, 7);
    let pathD = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
    pts.forEach(p => { pathD += ' L' + p.x.toFixed(1) + ',' + p.y.toFixed(1); });
    const areaD = pathD + ' L' + W + ',' + H + ' L0,' + H + ' Z';

    const fmtCompact = v => {
      const a = Math.abs(+v || 0);
      if (a >= 1e6) return (v/1e6).toFixed(1) + ' млн';
      if (a >= 1e3) return Math.round(v/1e3) + 'k';
      return String(Math.round(v));
    };

    const chartSvg =
      '<svg viewBox="0 0 100 76" preserveAspectRatio="none" width="100%" height="120" style="display:block;overflow:visible">'
      + '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">'
      +   '<stop offset="0" stop-color="' + c.acc + '" stop-opacity=".28"/>'
      +   '<stop offset="1" stop-color="' + c.acc + '" stop-opacity="0"/>'
      + '</linearGradient></defs>'
      + '<path d="' + areaD + '" fill="url(#' + gradId + ')"/>'
      + '<path d="' + pathD + '" fill="none" stroke="' + c.acc + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'
      // Точки
      + pts.map(p => '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="1.6" fill="' + c.acc + '" stroke="' + c.bg + '" stroke-width="0.6" vector-effect="non-scaling-stroke"><title>' + (MONTHS[p.mo] || p.mo) + ': ' + fmtCompact(p.v) + ' ₴</title></circle>').join('')
      + '</svg>';

    // Метки месяцев под графиком
    const monthLabels =
      '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);padding:4px 0 0;font-family:\'JetBrains Mono\',monospace">'
      + pts.map(p => '<span>' + (MONTHS[p.mo] || p.mo) + '</span>').join('')
      + '</div>';

    // Мини-статистика: min / max
    const statsRow =
      '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:6px">'
      + '<span>min: <b style="color:var(--txt);font-family:\'JetBrains Mono\',monospace">' + fmtCompact(minV) + ' ₴</b></span>'
      + '<span>max: <b style="color:var(--txt);font-family:\'JetBrains Mono\',monospace">' + fmtCompact(maxV) + ' ₴</b></span>'
      + '</div>';

    html += '<div class="rd-drill-chart">'
      + '<h5>Динамика продаж · ' + (MONTHS[monthly[0].mo] || '') + ' – ' + (MONTHS[monthly[monthly.length-1].mo] || '') + '</h5>'
      + statsRow
      + chartSvg
      + monthLabels
      + '</div>';
  }

  // Топ-магазины
  if (storesTop.length) {
    const totS = storesTop.reduce((a,s) => a + (+s.rev || 0), 0);
    html += '<div class="rd-drill-stores">'
      + '<h5>Топ-магазины по продажам</h5>'
      + storesTop.slice(0, 8).map((s, i) =>
          '<div class="rd-drill-store-row">'
          + '<span class="rk">' + String(i+1).padStart(2,'0') + '</span>'
          + '<span class="name">' + s.store + '</span>'
          + '<span class="val">' + fmt(s.rev) + ' ₴ · ' + (totS ? Math.round(s.rev/totS*100) : 0) + '%</span>'
          + '</div>').join('')
      + '</div>';
  }

  html += '</div>';
  drill.innerHTML = html;
  drill.dataset.rdName = name;
}

// ---------- МАГАЗИНЫ: KPI-карточки с trend-стрелкой (для #st_kpis2) ----------
function addStoresTrends(){
  const D = rdGetD();
  if (!D) return;
  const kpisBox = document.getElementById('st_kpis2');
  if (!kpisBox) return;
  const kpis = kpisBox.querySelectorAll('.kpi');
  if (!kpis.length) return;
  if (kpisBox.dataset.rdTrended === 'done') return;

  // Собираем месячные тотальные суммы выручки/чеков по всем выбранным магазинам
  if (!D.store_month || !D.monthly) return;
  const S = rdGetS();
  const storeSel = S && S.store && S.store.length ? new Set(S.store) : null;

  const byMo = {};
  (D.store_month || []).forEach(r => {
    if (storeSel && !storeSel.has(r.store)) return;
    byMo[r.mo] = byMo[r.mo] || { rev: 0, rec: 0 };
    byMo[r.mo].rev += (+r.revenue || 0);
    byMo[r.mo].rec += (+r.receipts || 0);
  });
  const months = Object.keys(byMo).map(Number).sort((a,b) => a - b);
  if (months.length < 2) return;

  // Убираем неполный последний месяц
  let trendMos = months;
  if (D.period && D.period.end) {
    const ed = String(D.period.end);
    const eMo = +ed.slice(5,7), eDay = +ed.slice(8,10);
    const dim = new Date(+ed.slice(0,4), eMo, 0).getDate();
    if (eDay < dim && trendMos[trendMos.length-1] === eMo) trendMos = trendMos.slice(0, -1);
  }
  if (trendMos.length < 2) return;

  const c = getThemeColors();
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2,5);

  const trendOf = arr => {
    if (arr.length < 2) return null;
    const last = arr[arr.length-1], prev = arr[arr.length-2];
    if (!prev) return null;
    const pct = (last - prev) / prev * 100;
    return { pct, dir: pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat' };
  };
  const arrowSvg = dir => {
    if (dir === 'up')   return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
    if (dir === 'down') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
  };

  // 1-я карточка — обычно "Магазинов в выборке" (число, тренд не нужен)
  // 2-я — "Выручка ₴" → sparkline + тренд
  // 3-я — "Прибыль" (если есть) → sparkline + тренд
  const inject = (idx, values, color) => {
    const kpi = kpis[idx];
    if (!kpi) return;
    const t = trendOf(values);
    if (t) {
      const vEl = kpi.querySelector('.v');
      if (vEl && !kpi.querySelector('.rd-trend')) {
        const sign = t.pct > 0 ? '+' : '';
        vEl.insertAdjacentHTML('afterend',
          '<span class="rd-trend ' + t.dir + '">' + arrowSvg(t.dir) + sign + t.pct.toFixed(1) + '%</span>'
        );
      }
    }
    if (!kpi.querySelector('.rd-spark')) {
      kpi.insertAdjacentHTML('beforeend', drawRowSpark(values, color).replace('class="rd-row-spark"', 'class="rd-spark"'));
      // но drawRowSpark не оборачивает — оборачиваем сами
      // Уже вставили <svg>, добавим ему класс rd-spark
      const svg = kpi.lastElementChild;
      if (svg && svg.tagName === 'svg') svg.classList.add('rd-spark');
    }
  };

  // Найти по заголовку карточки нужные (revenue/receipts)
  const revValues = trendMos.map(m => byMo[m].rev);
  const recValues = trendMos.map(m => byMo[m].rec);
  kpis.forEach((kpi, i) => {
    const t = (kpi.querySelector('.t')?.textContent || '').toLowerCase();
    if (t.includes('выручка')) inject(i, revValues, c.acc);
    else if (t.includes('чек')) inject(i, recValues, c.pos);
  });

  kpisBox.dataset.rdTrended = 'done';
}

// ---------- ОЖИВЛЕНИЕ ТАБЛИЦ (пилюли, mini-bar, дельты) ----------
// Работает на любой таблице, найденной в DOM. По заголовку колонки определяет
// тип (маржа / доля / прибыль / условия) и подменяет содержимое ячейки.

// Класс пилюли по маржинальности
function marginPillClass(m){
  m = +m || 0;
  if (m >= 23) return 'm-hi';
  if (m >= 15) return 'm-good';
  if (m >= 9)  return 'm-mid';
  if (m >= 5)  return 'm-low';
  return 'm-bad';
}
// Класс пилюли по доле
function sharePillClass(s){
  s = +s || 0;
  if (s >= 10) return 's-hi';
  if (s >= 3)  return 's-mid';
  return 's-lo';
}
// Класс дельты (up/down/flat) по % значению
function deltaClass(pct){
  const p = +pct || 0;
  if (p > 1)  return 'up';
  if (p < -1) return 'down';
  return 'flat';
}
function arrowSvgSmall(dir){
  if (dir === 'up')   return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';
  if (dir === 'down') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
}

// Определяет тип колонки по заголовку
function detectColumnType(headerText){
  const t = (headerText || '').toLowerCase();
  if (t.includes('маржа') || t.includes('margin')) return 'margin';
  if (t.includes('доля') || t.includes('share') || t.includes('%')) return 'share';
  if (t.includes('дельта') || t.includes('δ') || t.includes('прирост') || t.includes('изменение')) return 'delta';
  if (t.includes('покрытие') || t.includes('точек') || t.includes('coverage')) return 'coverage';
  if (t.includes('условия') || t.includes('возврат') && t.includes('условия')) return 'terms';
  if (t.includes('abc')) return 'abc';
  if (t.includes('xyz')) return 'xyz';
  return null;
}

// Основная функция — пробегает по всем таблицам с data-t (экспорт-таблицы = основные аналитические)
function restyleTables(){
  const tables = document.querySelectorAll(
    '#ov_tab, #ov_ret, #pr_tab, #stf_tab, #mv_tab, #mx_tab, #st_tab, #an_loss, #fr_cross, #fr_oos, #rp_tab'
  );
  tables.forEach(tbl => {
    if (!tbl || !tbl.tHead) return;

    // 1. Определить типы всех колонок один раз
    const headers = [...tbl.tHead.querySelectorAll('th')];
    const colTypes = headers.map(th => detectColumnType(th.textContent));

    // 2. Пройтись по строкам и подменить ячейки
    const rows = tbl.tBodies[0] ? [...tbl.tBodies[0].rows] : [];
    rows.forEach((tr, ri) => {
      if (tr.dataset.rdStyled === 'done') return;

      // Топ-3 строки — цветной indicator слева (только если сортировка по вменяемой колонке)
      if (ri < 3) tr.classList.add('rd-top-' + (ri + 1));

      [...tr.cells].forEach((td, ci) => {
        const type = colTypes[ci];
        if (!type) return;
        // Не трогаем если ячейка уже содержит наши пилюли
        if (td.querySelector('.rd-pill, .rd-delta, .rd-mbar')) return;

        const raw = td.textContent.trim();
        if (!raw || raw === '—' || raw === '-') return;

        if (type === 'margin') {
          const num = parseFloat(raw.replace(',', '.'));
          if (!isNaN(num)) {
            const cls = marginPillClass(num);
            td.innerHTML = '<span class="rd-pill ' + cls + '">' + num.toFixed(1) + '%</span>';
          }
        } else if (type === 'share') {
          const num = parseFloat(raw.replace(',', '.').replace('%', ''));
          if (!isNaN(num)) {
            const cls = sharePillClass(num);
            const barW = Math.min(100, num * 3).toFixed(0);
            td.innerHTML = '<span class="rd-mbar"><i style="width:' + barW + '%"></i></span>'
              + '<span class="rd-pill ' + cls + '">' + num.toFixed(2) + '%</span>';
          }
        } else if (type === 'delta') {
          // Ожидаем формат "+12%" или "-3%" или "±0%"
          const m = raw.match(/([+\-−]?\d+(?:[.,]\d+)?)/);
          if (m) {
            const num = parseFloat(m[1].replace('−', '-').replace(',', '.'));
            const cls = deltaClass(num);
            const sign = num > 0 ? '+' : '';
            td.innerHTML = '<span class="rd-delta ' + cls + '">'
              + arrowSvgSmall(cls) + sign + num.toFixed(1) + '%</span>';
          }
        } else if (type === 'coverage') {
          // Всего розничных магазинов сети — берём из D.stores (за минусом опта),
          // fallback: D.kpi.stores, иначе 38. Автообновляется при добавлении новых точек.
          const D = rdGetD();
          let totalStores = 38;
          if (D) {
            if (Array.isArray(D.stores) && D.stores.length) {
              // Опт-магазины не считаем в покрытии
              const wholesale = new Set(D.wholesale_stores || []);
              totalStores = D.stores.filter(s => !wholesale.has(s)).length || D.stores.length;
            } else if (D.kpi && D.kpi.stores) {
              totalStores = D.kpi.stores;
            }
          }

          // Формат "36/38" — есть слэш, парсим оба числа
          const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
          if (m) {
            const cur = +m[1], max = +m[2] || totalStores;
            const pct = max ? (cur / max * 100) : 0;
            const barCls = pct >= 95 ? '' : pct >= 80 ? 'warn' : 'neg';
            td.innerHTML = '<span class="rd-mbar ' + barCls + '"><i style="width:' + pct.toFixed(0) + '%"></i></span>'
              + '<span class="rd-mbar-lbl">' + cur + '/' + max + '</span>';
          } else {
            // Одно число — покрытие
            const num = parseInt(raw, 10);
            if (!isNaN(num)) {
              const pct = totalStores ? (num / totalStores * 100) : 0;
              const barCls = pct >= 95 ? '' : pct >= 80 ? 'warn' : 'neg';
              td.innerHTML = '<span class="rd-mbar ' + barCls + '"><i style="width:' + pct.toFixed(0) + '%"></i></span>'
                + '<span class="rd-mbar-lbl">' + num + '/' + totalStores + '</span>';
            }
          }
        } else if (type === 'abc') {
          // A/B/C — цветной badge (уже стилизуется в основном коде через .bA/.bB/.bC)
          // Ничего не делаем — старый стиль уже красивый
        } else if (type === 'terms') {
          // Условия возврата — иконка + текст
          if (raw.toLowerCase().includes('разреш')) {
            td.innerHTML = '<span class="rd-pill m-good" style="min-width:auto">✓ ' + raw + '</span>';
          } else if (raw.toLowerCase().includes('запр') || raw.toLowerCase().includes('нет')) {
            td.innerHTML = '<span class="rd-pill m-bad" style="min-width:auto">✕ ' + raw + '</span>';
          } else if (raw.toLowerCase().includes('%') || raw.includes('оборот')) {
            td.innerHTML = '<span class="rd-pill m-mid" style="min-width:auto">' + raw + '</span>';
          }
        }
      });

      tr.dataset.rdStyled = 'done';
    });
  });

  // Добавляем цветной кружок к первой ячейке в некоторых таблицах категорий
  const catTables = document.querySelectorAll('#ov_tab');
  catTables.forEach(tbl => {
    const rows = tbl.tBodies[0] ? [...tbl.tBodies[0].rows] : [];
    rows.forEach(tr => {
      if (tr.dataset.rdDot === 'done') return;
      const firstCell = tr.cells[0];
      if (!firstCell || firstCell.querySelector('.rd-cat-dot')) return;
      // Ищем маржу в этой строке
      const marginCell = [...tr.cells].find(td => td.querySelector('.rd-pill[class*="m-"]'));
      if (!marginCell) return;
      const marginPill = marginCell.querySelector('.rd-pill');
      const pillCls = marginPill.className.match(/m-\w+/);
      const dotColorMap = {
        'm-hi':   'var(--a)',
        'm-good': 'oklch(0.72 0.15 155)',
        'm-mid':  'var(--b)',
        'm-low':  'var(--orange)',
        'm-bad':  'var(--c)'
      };
      const dotColor = pillCls ? (dotColorMap[pillCls[0]] || 'var(--acc)') : 'var(--acc)';
      const dot = '<span class="rd-cat-dot" style="background:' + dotColor + '"></span>';
      firstCell.innerHTML = dot + firstCell.innerHTML;
      tr.dataset.rdDot = 'done';
    });
  });
}

// ---------- КРАСИВАЯ РАЗМЕТКА АЛЕРТОВ ----------
// Основной скрипт создаёт .alert как:
//   <div class="alert al-X"><span class="ic">EMOJI</span><span>ТЕКСТ</span><span class="x">→</span></div>
// Разбираем на: SVG-иконка, заголовок, крупное значение справа, описание, CTA-ссылка.

const RD_ALERT_ICONS = {
  '📉': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 18l-9.5-9.5-5 5L1 6"/><polyline points="17 18 23 18 23 12"/></svg>',
  '🔻': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  '⚠':  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4M12 17h.01"/></svg>',
  '🧊': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4.93 4.93l14.14 14.14M2 12h20M19.07 4.93 4.93 19.07"/></svg>',
  '📦': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-9 5-9-5V8l9-5 9 5z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/></svg>',
  '📊': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
};

// Разбираем сообщение алерта на: заголовок, значение справа, описание.
// Возвращает { head, val, desc, cta }
function parseAlertMessage(html){
  // html вида: "Продажа ниже закупки: <b>53</b> позиций (оборот 202 тыс ₴). Проверьте цены/акции."
  // Простые heuristics:
  //  - до первого двоеточия — заголовок
  //  - первая <b>...</b> — значение (может быть числом с ₴, тыс, млн)
  //  - остаток предложения — описание
  //  - CTA дефолт "Разобрать →"

  // Заголовок = текст до первого ':' (без запятой)
  const colonIdx = html.indexOf(':');
  let head = '';
  let rest = html;
  if (colonIdx > 0 && colonIdx < 80) {
    head = html.slice(0, colonIdx).trim();
    rest = html.slice(colonIdx + 1).trim();
  } else {
    // фолбэк: первое слово + N слов
    head = html.split(/[.:!?]/)[0].trim().slice(0, 60);
    rest = html.slice(head.length).replace(/^[.:!?\s]+/, '');
  }
  // Убираем HTML-теги из заголовка
  head = head.replace(/<[^>]+>/g, '').trim();

  // Значение = первая <b>...</b> в rest
  let val = '';
  const bMatch = rest.match(/<b>(.*?)<\/b>/);
  if (bMatch) {
    val = bMatch[1].replace(/<[^>]+>/g, '').trim();
    // если у нас в rest есть " ₴", "млн", "SKU", "позиций" сразу после <b> — цепляем к val
    const after = rest.slice(bMatch.index + bMatch[0].length).match(/^(\s*(₴|млн\s*₴|тыс\s*₴|тыс|млн|SKU|позиций|остатков))/i);
    if (after) val += after[0];
    // Уберём эту часть из описания
    rest = rest.slice(0, bMatch.index) + rest.slice(bMatch.index + bMatch[0].length + (after ? after[0].length : 0));
  }

  const desc = rest.trim().replace(/^[.,;\s]+/, '');
  return { head, val, desc };
}

function restyleAlerts(){
  const alerts = document.querySelectorAll('#ov_alerts .alert');
  alerts.forEach(el => {
    if (el.dataset.rdStyled === 'done') return;

    const ic = el.querySelector('.ic');
    const x  = el.querySelector('.x');
    // Основной блок текста — <span> между .ic и .x
    const spans = el.querySelectorAll(':scope > span');
    let textSpan = null;
    spans.forEach(s => {
      if (s !== ic && s !== x && s.className !== 'ic' && s.className !== 'x') textSpan = s;
    });
    if (!textSpan) return;

    // Заменяем эмодзи на SVG
    if (ic) {
      const emoji = ic.textContent.trim();
      const svg = RD_ALERT_ICONS[emoji];
      if (svg) {
        ic.innerHTML = svg;
        const s = ic.querySelector('svg');
        if (s) { s.setAttribute('width', '18'); s.setAttribute('height', '18'); }
      }
    }

    // Парсим содержимое span
    const rawHtml = textSpan.innerHTML;
    const parsed = parseAlertMessage(rawHtml);

    // Определяем CTA-текст (по классу цвета)
    let ctaText = 'Разобрать';
    if (el.classList.contains('al-r')) ctaText = 'Разобрать';
    else if (el.classList.contains('al-o')) ctaText = 'Перейти';
    else if (el.classList.contains('al-y')) ctaText = 'План';

    // Строим новую разметку в этом же spanе (заменяем содержимое)
    // Но структура алерта: .ic → span (текст) → .x
    // Нам нужны 4 части: .rd-alert-head + .rd-alert-val + .rd-alert-desc + .rd-alert-cta
    // Кладём .rd-alert-head + .rd-alert-desc + .rd-alert-cta в текстовый span,
    // .rd-alert-val — отдельным элементом рядом.

    textSpan.className = 'rd-alert-body';
    textSpan.innerHTML =
        '<div class="rd-alert-head">' + (parsed.head || '') + '</div>'
      + '<div class="rd-alert-desc">' + (parsed.desc || '') + '</div>'
      + '<a class="rd-alert-cta" href="#">' + ctaText
      + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'
      + '</a>';

    // Значение справа — вставляем перед .x
    if (parsed.val && x) {
      const valSpan = document.createElement('span');
      valSpan.className = 'rd-alert-val';
      valSpan.textContent = parsed.val;
      el.insertBefore(valSpan, x);
      // Прячем стрелку
      x.style.display = 'none';
    }

    // CTA-ссылка не должна триггерить нативный переход
    const cta = textSpan.querySelector('.rd-alert-cta');
    if (cta) {
      cta.addEventListener('click', e => { e.preventDefault(); /* клик по всей карточке идёт */ });
    }

    el.dataset.rdStyled = 'done';
  });
}

// ---------- ФРЕЙМВОРК ДЛЯ БУДУЩЕГО СРАВНЕНИЯ ПЕРИОДОВ ----------
// window.RD.compare = {
//   base: {revenue, gp, ...},          // текущий период (или срез)
//   prev: {revenue, gp, ...},          // предыдущий (для сравнения)
//   series: {revenue: [], gp: []}      // помесячные значения для sparkline
// }
// Если не задано — sparkline берёт из D.monthly (как сейчас), стрелка — Δ последний/предыдущий месяц.
// В будущем можно наполнить это извне (например при выборе "vs авг 2025"), и функция addSparklines()
// перерисует KPI под сравнение.
window.RD = window.RD || {};
window.RD.compare = window.RD.compare || null;
window.RD.setCompare = function(cmp){
  window.RD.compare = cmp;
  try { addSparklines(); } catch(e){}
};

// ---------- SPARKLINE + TREND ARROW inject в KPI ----------
// Данные — из D.monthly. Sparkline рендерится ПОД числом, во всю ширину карточки.
// Стрелка тренда (▲/▼/±) рисуется рядом со значением — Δ vs предыдущий месяц.
function addSparklines(){
  // ПЕРЕПИСАНО 2026-09-03. Было: жёстко карточки №0 и №1 контейнера #ov_kpis, ряд из
  // D.monthly (сеть целиком) и стрелка всегда «последний месяц против предыдущего».
  // Стало: любая карточка с data-metric на ЛЮБОЙ вкладке, ряд текущего среза и пара
  // месяцев из глобальной панели («Сравнить с»). Ряды готовит основной скрипт в
  // window.KPI_TREND (buildTrend), потому что только он знает про фильтры и кубы.
  const T = window.KPI_TREND;
  const cards = document.querySelectorAll('.kpi[data-metric]');
  if (!cards.length) return;
  document.querySelectorAll('.kpi .rd-spark, .kpi .rd-trend').forEach(s => s.remove());
  if (!T || !T.months || T.months.length < 2) { rdLog('rd sparklines: нет KPI_TREND'); return; }

  const MON = ['','Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  const c = getThemeColors();
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  // Цвет спарклайна по смыслу метрики, а не по порядку карточки.
  const COLOR = {revenue:c.acc, gp:c.pos, margin:c.pos, qty:c.acc, receipts:c.acc,
                 skus:c.acc, avgcheck:c.pos};

  const drawSpark = (values, color, gradId) => {
    if (!values.length) return '';
    const min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    const range = (max - min) || 1, W = 100, H = 28;
    const pts = values.map((v,i) => {
      const x = (i/(values.length-1||1)) * W;
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
  const fmtNum = (v, metric) => {
    if (metric === 'margin') return (Math.round(v*10)/10) + '%';
    const a = Math.abs(v);
    if (a >= 1e6) return (v/1e6).toFixed(2) + ' млн';
    if (a >= 1e3) return Math.round(v/1e3) + ' тыс';
    return String(Math.round(v));
  };

  cards.forEach(kpi => {
    const metric = kpi.dataset.metric;
    const row = T.series && T.series[metric];
    if (!row) return;
    const values = T.months.map(m => +row[m] || 0);
    if (!values.some(v => v !== 0)) return;

    // Стрелка: пара месяцев из «Сравнить с». Для метрик, которые нельзя складывать
    // по нескольким категориям (чеки, SKU, средний чек), стрелку не рисуем — вместо
    // неё подсказка, почему.
    const soft = T.soft && T.soft[metric];
    if (T.cmp && !soft) {
      const a = +row[T.cmp.a], b = +row[T.cmp.b];
      if (isFinite(a) && isFinite(b) && b) {
        const pct = (a - b) / Math.abs(b) * 100;
        const dir = pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat';
        const vEl = kpi.querySelector('.v');
        if (vEl) {
          const sign = pct > 0 ? '+' : '';
          const title = MON[T.cmp.a] + ' ' + fmtNum(a, metric) + ' против ' + MON[T.cmp.b] + ' ' + fmtNum(b, metric)
            + (T.partial === T.cmp.a ? ' · месяц неполный' : '');
          vEl.insertAdjacentHTML('afterend',
            '<span class="rd-trend ' + dir + '" title="' + title + '">' + arrowSvg(dir) + sign + pct.toFixed(1) + '%</span>');
        }
      }
    } else if (soft) {
      const vEl = kpi.querySelector('.v');
      if (vEl) vEl.insertAdjacentHTML('afterend',
        '<span class="rd-trend flat" title="Выбрано несколько категорий или поставщиков: чеки и SKU по ним не складываются — один чек попадает сразу в несколько категорий. Сравнение месяцев для этой метрики отключено, форма линии показывает только динамику.">' + arrowSvg('flat') + '—</span>');
    }
    kpi.insertAdjacentHTML('beforeend',
      drawSpark(values, COLOR[metric] || c.acc, 'rd-sg-' + metric + '-' + uid));
  });
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
        } catch(e){ rdLog('rd kpi mo:', e); }
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

  // 3. Обёртка render — SVG-ranks + перекрашивание ECharts + оживление таблиц + фичи по вкладкам.
  //    Работает только когда D уже загружен, иначе основные функции внутри валятся.
  if (typeof window.render === 'function') {
    const orig = window.render;
    window.render = function(){
      const r = orig.apply(this, arguments);
      setTimeout(() => {
        if (!rdIsReady()) return;
        try { addSparklines(); } catch(e){ rdLog('rd sparklines:', e); }
        try {
          const tab = rdGetTab();
          if (tab === 'overview') {
            renderOverviewRanks();
          } else if (tab === 'analytics') {
            renderAbcSegments();
            enhanceParetoChart();
            enhanceScatter();
            renderCrossNetwork();
          } else if (tab === 'products') {
            addRowSparklinesProducts();
            enableProductsVirtualScroll();
            enhanceProductDrill();
          } else if (tab === 'stock') {
            renderFrozenRanks();
          } else if (tab === 'stores') {
            addStoresTrends();
          } else if (tab === 'matrix') {
            enhanceMatrix();
          } else if (tab === 'suppliers') {
            enhanceSuppliers();
          } else if (tab === 'report') {
            enhanceReport();
          }
          restyleTables();
          reRenderCharts();
        } catch(e){ rdLog('rd render hook:', e); }
      }, 60);
      return r;
    };
  }

  // 4. MutationObserver на таблицы — восстановить пилюли + фичи по вкладкам после перерисовки
  const tableIds = ['ov_tab','ov_ret','pr_tab','stf_tab','mv_tab','mx_tab','st_tab','an_loss','fr_cross','fr_oos','rp_tab'];
  tableIds.forEach(id => {
    const tbl = document.getElementById(id);
    if (!tbl) return;
    let pending = false;
    const mo = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        try {
          restyleTables();
          const tab = rdGetTab();
          if (id === 'pr_tab' && tab === 'products') addRowSparklinesProducts();
          if (id === 'mx_tab' && tab === 'matrix') enhanceMatrix();
          if (id === 'rp_tab' && tab === 'report') enhanceReport();
        } catch(e){}
      });
    });
    mo.observe(tbl, { childList: true, subtree: true });
  });

  // 5. MutationObserver на переключение вкладок (.page.on).
  //    Дублирует render-hook на случай, если основной скрипт где-то обходит нашу обёртку.
  const pageBoxes = document.querySelectorAll('.page');
  const applyTabFeatures = () => {
    if (!rdIsReady()) return;
    try {
      const tab = rdGetTab();
      if (tab === 'overview') {
        renderOverviewRanks();
      } else if (tab === 'analytics') {
        renderAbcSegments();
        enhanceParetoChart();
        enhanceScatter();
        renderCrossNetwork();
      } else if (tab === 'products') {
        addRowSparklinesProducts();
        enableProductsVirtualScroll();
        enhanceProductDrill();
      } else if (tab === 'stock') {
        renderFrozenRanks();
      } else if (tab === 'stores') {
        addStoresTrends();
      } else if (tab === 'matrix') {
        enhanceMatrix();
      } else if (tab === 'suppliers') {
        enhanceSuppliers();
      } else if (tab === 'report') {
        enhanceReport();
      }
      restyleTables();
    } catch(e){ rdLog('rd applyTabFeatures:', e); }
  };
  // При смене класса on/off на любой .page — переприменяем фичи вкладки
  pageBoxes.forEach(page => {
    const mo = new MutationObserver(() => {
      // если эта страница стала активной
      if (page.classList.contains('on')) {
        setTimeout(applyTabFeatures, 80);
      }
    });
    mo.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
  // Плюс кликаем по кнопкам навигации → тоже переприменяем
  document.querySelectorAll('.nav button[data-p], .rd-nav-item').forEach(btn => {
    btn.addEventListener('click', () => setTimeout(applyTabFeatures, 100), true);
  });
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
      // Ждём готовности данных (D.by_category и т.д.) и тогда стреляем полным набором
      rdWhenReady(() => {
        try { addSparklines(); } catch(e){ rdLog('rd init sparks:', e); }
        try { if (rdGetTab() === 'overview') renderOverviewRanks(); } catch(e){ rdLog('rd init ranks:', e); }
        try { restyleTables(); } catch(e){ rdLog('rd init tables:', e); }
      });
      return;
    }
    setTimeout(waitForApp, 100);
  };
  waitForApp();
});

// Экспорт всех ключевых функций для отладки и внешнего использования
Object.assign(window.RD, {
  setTheme,
  addSparklines,
  renderCatRank,
  renderStoreRank,
  renderOverviewRanks,
  restyleAlerts,
  restyleTables,
  reRenderCharts,
  rdGetD,
  rdGetS,
  rdIsReady,
  rdWhenReady,
  // Приоритет 1 фичи:
  addRowSparklinesProducts,
  renderAbcSegments,
  enhanceParetoChart,
  renderFrozenRanks,
  addStoresTrends,
  // Приоритет 2 фичи:
  enhanceMatrix,
  enhanceSuppliers,
  enhanceReport,
  // Приоритет 3 фичи:
  enhanceScatter,
  renderCrossNetwork,
  enableProductsVirtualScroll,
  enhanceProductDrill,
  // Утилиты:
  rdEmptyState,
});

})();
