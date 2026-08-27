#!/usr/bin/env node
/**
 * Smoke-тест редизайна под разными комбинациями фильтров.
 * Проверяет: sparkline, ABC-segments, frozen ranks, store trends, restyleTables — не падают
 * при переключении фильтров на разных вкладках.
 *
 *   node tests/smoke_redesign_filters.js
 *   node tests/smoke_redesign_filters.js path/to/index.html path/to/full_data.json
 */
const fs   = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = process.argv[2] || path.join(ROOT, 'docs', 'index.html');
const DATA = process.argv[3] || path.join(ROOT, 'docs', 'full_data.json');

for (const f of [HTML, DATA]) {
  if (!fs.existsSync(f)) { console.error('нет файла: ' + f); process.exit(2); }
}

let html = fs.readFileSync(HTML, 'utf8').replace(/<script[^>]+src=https?:\/\/[^>]*><\/script>/g, '');
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

// jsdom не умеет автоматически загружать локальные <script src="redesign.js"> —
// инлайним содержимое напрямую в HTML.
const redesignJsPath = path.join(path.dirname(HTML), 'redesign.js');
const redesignCssPath = path.join(path.dirname(HTML), 'redesign.css');
// Regex ловит и redesign.js, и redesign.js?v=2026-08-27 (cache-bust)
if (fs.existsSync(redesignJsPath)) {
  const jsCode = fs.readFileSync(redesignJsPath, 'utf8');
  html = html.replace(
    /<script[^>]+src=["']redesign\.js(?:\?[^"']*)?["'][^>]*><\/script>/i,
    () => '<script>' + jsCode + '</script>'
  );
}
if (fs.existsSync(redesignCssPath)) {
  const cssCode = fs.readFileSync(redesignCssPath, 'utf8');
  html = html.replace(
    /<link[^>]+href=["']redesign\.css(?:\?[^"']*)?["'][^>]*>/i,
    () => '<style>' + cssCode + '</style>'
  );
}

let bad = 0, total = 0, skipped = 0;
const errors = [];

function assert(name, cond, extra){
  total++;
  if (cond === 'skip') { skipped++; console.log(`  --    ${name} — ${extra || 'skip'}`); return; }
  const ok = !!cond;
  if (!ok) bad++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${name}${!ok && extra ? ' — ' + extra : ''}`);
}

const vconsole = new VirtualConsole();
vconsole.on('jsdomError', e => {
  if (!/Could not parse CSS/i.test(e && e.message || '')) errors.push(e.message);
});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vconsole,
  beforeParse(w){
    const chart = () => ({
      setOption: function(){ return this; },
      on: function(){ return this; }, off: function(){ return this; },
      resize: function(){ return this; }, dispose: function(){ return this; },
      getZr: () => ({ on(){}, off(){} }),
      showLoading(){}, hideLoading(){},
      getOption: () => ({ series: [], xAxis: [], yAxis: [] })
    });
    w.echarts = {
      init: chart,
      getInstanceByDom: () => chart(),
      graphic: {}, color: {}
    };
    w.ExcelJS = { Workbook: function(){
      this.addWorksheet = () => ({ columns:[], addRow:()=>({font:{},fill:{},eachCell(){}}),
        getRow:()=>({font:{},fill:{},eachCell(){}}), eachRow(){} });
      this.xlsx = { writeBuffer: async () => new ArrayBuffer(8) };
    }};
    w.fetch = (u) => String(u).includes('full_data')
      ? Promise.resolve({ ok:true, json:()=>Promise.resolve(data), headers:{get:()=>'x'} })
      : Promise.resolve({ ok:false, status:404, json:()=>Promise.resolve({}), text:()=>Promise.resolve(''), headers:{get:()=>null} });
    w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    w.requestAnimationFrame = cb => setTimeout(cb, 0);
    w.localStorage = { _s:{}, getItem(k){return this._s[k]||null;}, setItem(k,v){this._s[k]=String(v);}, removeItem(k){delete this._s[k];}, clear(){this._s={};} };
    w.onerror = (m,s,l,c,e) => errors.push('window.onerror: ' + ((e && e.stack) || m));
    w.addEventListener('unhandledrejection', ev => errors.push('unhandledrejection: ' + ev.reason));
  }
});

const w = dom.window;

// Комбинации фильтров — только критичные (полный прогон 77 рендеров = 30+ сек в jsdom)
const filterCombos = [
  { name: 'без фильтров', setup: '' },
  { name: 'один магазин', setup: 'S.store = D.stores.slice(0,1);' },
  { name: 'один месяц', setup: 'S.month = "3";' },
  { name: 'категория', setup: 'S.cat = [D.by_category[0].category];' },
  { name: 'ABC=A', setup: 'S.abc = "A";' }
];

// Только "лёгкие" вкладки — report/products рендерят 10к строк, вешают jsdom
const tabs = ['overview', 'analytics', 'stock', 'stores', 'matrix'];

// Reset функция
const RESET = `S.month='all';S.store=[];S.cat=[];S.sup=[];S.q='';S.abc='all';S.noOff=false;`;

setTimeout(() => {
  if (!w.eval('typeof D!=="undefined" && !!D')) {
    console.error('D не загружен');
    process.exit(2);
  }

  // 1. RD API доступен
  console.log('\n== RD API ==');
  assert('window.RD существует', typeof w.RD === 'object');
  // Приоритет 1
  assert('RD.renderAbcSegments — функция', typeof w.RD?.renderAbcSegments === 'function');
  assert('RD.addRowSparklinesProducts — функция', typeof w.RD?.addRowSparklinesProducts === 'function');
  assert('RD.renderFrozenRanks — функция', typeof w.RD?.renderFrozenRanks === 'function');
  assert('RD.addStoresTrends — функция', typeof w.RD?.addStoresTrends === 'function');
  assert('RD.restyleTables — функция', typeof w.RD?.restyleTables === 'function');
  assert('RD.rdIsReady() = true', w.RD?.rdIsReady?.() === true);
  // Приоритет 2
  assert('RD.enhanceMatrix — функция', typeof w.RD?.enhanceMatrix === 'function');
  assert('RD.enhanceSuppliers — функция', typeof w.RD?.enhanceSuppliers === 'function');
  assert('RD.enhanceReport — функция', typeof w.RD?.enhanceReport === 'function');
  // Приоритет 3
  assert('RD.enhanceScatter — функция', typeof w.RD?.enhanceScatter === 'function');
  assert('RD.renderCrossNetwork — функция', typeof w.RD?.renderCrossNetwork === 'function');
  assert('RD.enableProductsVirtualScroll — функция', typeof w.RD?.enableProductsVirtualScroll === 'function');
  assert('RD.enhanceProductDrill — функция', typeof w.RD?.enhanceProductDrill === 'function');
  // Утилиты
  assert('RD.rdEmptyState — функция', typeof w.RD?.rdEmptyState === 'function');

  // rdLog — существует как функция (тихий по умолчанию, если localStorage.rd-debug != '1')
  const rdLogExists = w.eval('typeof rdLog === "function"');
  assert('rdLog определён', rdLogExists);

  // 2. Прогон вкладок под каждой комбинацией фильтров
  console.log('\n== Прогон вкладок под фильтрами ==');
  let combosRun = 0, combosFailed = 0;
  const perTabErrors = {};

  filterCombos.forEach(combo => {
    tabs.forEach(tab => {
      combosRun++;
      try {
        w.eval(`${RESET}${combo.setup}S.tab='${tab}';render();`);
        // После render — попробовать вызвать наши функции для этой вкладки
        w.eval(`
          try {
            if (RD) {
              RD.restyleTables && RD.restyleTables();
              if ('${tab}' === 'overview') RD.renderOverviewRanks && RD.renderOverviewRanks();
              if ('${tab}' === 'analytics') { RD.renderAbcSegments && RD.renderAbcSegments(); RD.enhanceParetoChart && RD.enhanceParetoChart(); }
              if ('${tab}' === 'products') RD.addRowSparklinesProducts && RD.addRowSparklinesProducts();
              if ('${tab}' === 'stock') RD.renderFrozenRanks && RD.renderFrozenRanks();
              if ('${tab}' === 'stores') RD.addStoresTrends && RD.addStoresTrends();
            }
          } catch(e) { throw new Error('RD hook: ' + e.message); }
        `);
      } catch(e) {
        combosFailed++;
        const key = `[${combo.name} / ${tab}]`;
        perTabErrors[key] = e.message;
      }
    });
  });

  assert(`Прогон ${combosRun} комбинаций фильтр×вкладка`, combosFailed === 0,
    combosFailed > 0 ? `${combosFailed} падений: ${Object.keys(perTabErrors).slice(0,3).join(', ')}` : '');

  if (combosFailed > 0) {
    console.log('\n  Детали падений (первые 5):');
    Object.entries(perTabErrors).slice(0, 5).forEach(([k, v]) => {
      console.log(`    ${k}: ${v}`);
    });
  }

  // 3. Проверка что для конкретных вкладок наши элементы появляются
  console.log('\n== Проверка появления новых элементов ==');

  // Обзор
  w.eval(`${RESET}S.tab='overview';render();`);
  w.eval(`try{ RD.renderOverviewRanks(); }catch(e){}`);
  setTimeout(() => {
    const d = w.document;
    const ovCatRank = d.querySelectorAll('#ov_cat .rd-rank-row').length;
    const ovStoreRank = d.querySelectorAll('#ov_store .rd-rank-row').length;
    assert('Обзор: SVG-ранкинг категорий (>=5 строк)', ovCatRank >= 5, `${ovCatRank}`);
    assert('Обзор: SVG-ранкинг магазинов (>=5 строк)', ovStoreRank >= 5, `${ovStoreRank}`);

    // Аналитика
    w.eval(`${RESET}S.tab='analytics';render();`);
    setTimeout(() => {
      w.eval(`try{ RD.renderAbcSegments(); }catch(e){}`);
      const abcSegs = w.document.querySelectorAll('.rd-abc-segments .rd-abc-seg').length;
      assert('Аналитика: ABC-сегмент-бар (3 сегмента)', abcSegs === 3, `${abcSegs}`);

      // Запасы
      w.eval(`${RESET}S.tab='stock';render();`);
      setTimeout(() => {
        w.eval(`try{ RD.renderFrozenRanks(); }catch(e){}`);
        const frStoreRank = w.document.querySelectorAll('#fr_store .rd-rank-row').length;
        const frSupRank = w.document.querySelectorAll('#fr_sup .rd-rank-row').length;
        assert('Запасы: SVG-ранкинг замороженного капитала по магазинам', frStoreRank >= 3, `${frStoreRank}`);
        assert('Запасы: SVG-ранкинг замороженного капитала по поставщикам', frSupRank >= 3, `${frSupRank}`);

        // Позиции
        w.eval(`${RESET}S.tab='products';render();`);
        setTimeout(() => {
          w.eval(`try{ RD.addRowSparklinesProducts(); }catch(e){}`);
          const prSparks = w.document.querySelectorAll('#pr_tab .rd-row-spark svg').length;
          if (w.eval('!!(D.prod_month && D.prod_month.length)')) {
            assert('Позиции: sparkline в строках товаров', prSparks > 0, `${prSparks}`);
          } else {
            assert('Позиции: sparkline (skip, нет prod_month)', 'skip', 'нет D.prod_month');
          }

          finish();
        }, 200);
      }, 200);
    }, 200);
  }, 300);
}, 1200);

function finish(){
  if (errors.length){
    console.log('\n  Рантайм-ошибки:');
    errors.slice(0, 15).forEach(e => console.log('    ' + e));
  }
  console.log(`\n  Проверок: ${total} · провалено: ${bad} · пропущено: ${skipped} · рантайм-ошибок: ${errors.length}`);
  process.exit(bad || errors.length ? 1 : 0);
}
