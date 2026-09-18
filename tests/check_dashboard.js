#!/usr/bin/env node
/**
 * Проверка дашборда без браузера: jsdom + заглушки echarts/ExcelJS + реальный full_data.json.
 *
 *   node tests/check_dashboard.js                    # docs/index.html + docs/full_data.json
 *   node tests/check_dashboard.js path/to/index.html path/to/full_data.json
 *
 * Что проверяется:
 *   1) все вкладки рендерятся под 8 комбинациями фильтров без единой ошибки;
 *   2) КРОСС-ФИЛЬТРЫ дают точные числа (сверка с by_store / monthly / cat_month и,
 *      если рядом лежит tests/truth.json от scripts/../tests/truth.py — с BigQuery);
 *   3) ВОЗВРАТЫ: аддитивность куба returns_fact по всем измерениям и охватам;
 *   4) РЕВИЗИЯ ВКЛАДОК: пресет «Собственное производство», фильтр магазина в отчёте
 *      по товарам, карточка среза на «Обзоре» и целостность разметки, от которой
 *      зависит НЕ ТРОГАЕМЫЙ блок TSD-экспорта (порядок select, один чекбокс «техн»).
 *
 * Код возврата 1, если хоть одна проверка провалилась или был рантайм-эксепшен.
 * Зависимость одна: npm i jsdom
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = process.argv[2] || path.join(ROOT, 'docs', 'index.html');
const DATA = process.argv[3] || path.join(ROOT, 'docs', 'full_data.json');
const TRUTH = path.join(__dirname, 'truth.json');

for (const f of [HTML, DATA]) {
  if (!fs.existsSync(f)) { console.error('нет файла: ' + f); process.exit(2); }
}
let html = fs.readFileSync(HTML, 'utf8').replace(/<script[^>]+src=[^>]*><\/script>/g, '');
// Слой редизайна (docs/redesign.js) подключён как внешний <script defer> и вырезается
// строкой выше вместе с CDN. Без него харнесс проверял только ядро и не видел ничего,
// что редизайн ломает поверх. Грузим его отдельно и исполняем как классический скрипт
// ПОСЛЕ разбора документа — ровно там, где его выполняет браузер (defer).
// Отключается переменной окружения NO_REDESIGN=1.
const RD_FILE = path.join(path.dirname(HTML), 'redesign.js');
const REDESIGN = (!process.env.NO_REDESIGN && fs.existsSync(RD_FILE)) ? fs.readFileSync(RD_FILE, 'utf8') : null;
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const truth = fs.existsSync(TRUTH) ? JSON.parse(fs.readFileSync(TRUTH, 'utf8')) : null;

const errors = [];
const results = [];
// state: true = OK, false = FAIL, 'skip' = проверить нечем (данные ещё не пересобраны)
const add = (name, ok, got, exp) => { results.push({ name, ok: ok === 'skip' ? 'skip' : !!ok, got, exp }); };
const skip = (name, why) => results.push({ name, ok: 'skip', got: why, exp: '' });

// Свой «виртуальный консоль»: jsdom не умеет разбирать современный CSS и на каждый запуск
// печатает «Could not parse CSS stylesheet» — это шум, а не проблема дашборда. Настоящие
// ошибки страницы ловятся через window.onerror и unhandledrejection ниже.
const vconsole = new VirtualConsole();
vconsole.on('jsdomError', e => {
  if (!/Could not parse CSS/i.test(e && e.message || '')) errors.push('jsdom: ' + (e.stack || e.message));
});
['log', 'info', 'warn', 'debug', 'error', 'dir', 'table', 'trace', 'group', 'groupEnd',
 'groupCollapsed', 'count', 'assert', 'time', 'timeEnd', 'timeLog'].forEach(k => vconsole.on(k, () => {}));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vconsole,
  beforeParse(w) {
    const chart = () => ({ setOption(){}, on(){}, off(){}, resize(){}, dispose(){}, clear(){},
      getZr: () => ({ on(){} }), showLoading(){}, hideLoading(){} });
    w.echarts = { init: chart, getInstanceByDom: () => null, graphic: {}, color: {} };
    w.ExcelJS = { Workbook: function () {
      const sheet = { columns: [], addRow: () => ({ font:{}, fill:{}, eachCell(){} }),
        getRow: () => ({ font:{}, fill:{}, eachCell(){} }), eachRow(){} };
      this.addWorksheet = () => sheet;
      this.xlsx = { writeBuffer: async () => new ArrayBuffer(8) };
    } };
    w.fetch = (u) => String(u).includes('full_data')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(data), headers: { get: () => 'x' } })
      : Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}),
          text: () => Promise.resolve(''), headers: { get: () => null } });
    w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){},
      addEventListener(){}, removeEventListener(){} });
    w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    w.onerror = (m, s, l, c, e) => errors.push('window.onerror: ' + ((e && e.stack) || m));
    w.addEventListener('unhandledrejection', ev => errors.push('unhandledrejection: ' + ev.reason));
  },
});
const w = dom.window;

const CLEAR = `S.month='all';S.store=[];S.cat=[];S.sup=[];S.q='';S.abc='all';S.noOff=false;`;

function tabsSuite() {
  const tabs = ['overview','report','analytics','products','stock','stores','matrix'];
  const combos = [
    ['без фильтров', ''],
    ['один магазин', `S.store=[D.stores[0]];`],
    ['три магазина', `S.store=D.stores.slice(0,3);`],
    ['месяц + магазин', `S.month='3';S.store=[D.stores[0]];`],
    ['категория + поставщик', `S.cat=[D.by_category[0].category];S.sup=[D.by_supplier[0].supplier];`],
    ['магазин + категория + месяц', `S.month='5';S.store=D.stores.slice(0,2);S.cat=[D.by_category[1].category];`],
    ['поиск + скрыть технические', `S.q='пиво';S.noOff=true;`],
    ['ABC=A + магазин', `S.abc='A';S.store=[D.stores[2]];`],
  ];
  let n = 0, failed = 0;
  for (const [name, setup] of combos) for (const t of tabs) {
    try { w.eval(`${CLEAR}${setup}S.tab='${t}';render();`); n++; }
    catch (e) { failed++; errors.push(`[${name} / ${t}] ` + (e.stack || e)); }
  }
  add(`Рендер всех вкладок (${n} прогонов, ${combos.length} комбинаций фильтров)`, !failed, n - failed, n);
}

function crossSuite() {
  w.eval(`window.__T = ${JSON.stringify(truth || {})};`);
  const rows = w.eval(`(function(){
    var T=window.__T, out=[], has=Object.keys(T).length>0;
    var CUBE=!!(D.prod_store&&D.products&&D.stores);
    var NOCUBE='нет куба prod_store — пересоберите данные';
    var CLEAR=function(){${CLEAR}};
    var off=function(a,b){return b?Math.abs(a-b)/b*100:(a?100:0);};
    var wpRev=function(){return workProducts().reduce(function(s,p){return s+(+p.rev||0);},0);};
    var byStore={}; D.by_store.forEach(function(r){byStore[r.store]=r.revenue;});
    var s1=(T.s1||D.stores[0]), s2=(T.s2||D.stores[1]);
    var push=function(n,ok,g,e){out.push([n,ok==='skip'?'skip':!!ok,g,e]);};
    // проверки, которым нужен куб позиция×магазин: без него они не провалены, а НЕПРОВЕРЯЕМЫ
    var pushCube=function(n,ok,g,e){ CUBE?push(n,ok,g,e):push(n,'skip',NOCUBE,''); };

    CLEAR(); S.store=[s1];
    pushCube('Позиции: один магазин == by_store', off(wpRev(),byStore[s1])<0.05, Math.round(wpRev()), byStore[s1]);

    CLEAR(); S.store=[s1,s2];
    var two=wpRev(), ref2=byStore[s1]+byStore[s2];
    pushCube('Позиции: два магазина == сумма by_store', off(two,ref2)<0.05, Math.round(two), ref2);
    push('Позиции: два магазина НЕ равны всей сети', Math.abs(two-D.kpi.revenue)>1000, Math.round(two), D.kpi.revenue);
    var k=kpiNow();
    push('KPI: два магазина == сумма by_store', off(k.revenue,ref2)<0.05, k.revenue, ref2);
    push('KPI: два магазина помечен как точный срез', k.exact===true, k.exact, true);
    var rec=D.by_store.filter(function(r){return r.store===s1||r.store===s2;})
                      .reduce(function(a,r){return a+(r.receipts||0);},0);
    push('KPI: чеки по магазинам складываются', k.receipts===rec, k.receipts, rec);

    CLEAR(); var all=0; D.stores.forEach(function(s){S.store=[s];all+=wpRev();});
    CLEAR();
    pushCube('Позиции: сумма по всем точкам == выручка сети', off(all,D.kpi.revenue)<0.05, Math.round(all), D.kpi.revenue);

    CLEAR(); S.store=[s1];
    var ca=catAgg().reduce(function(a,r){return a+r.revenue;},0);
    pushCube('Категории: при выбранном магазине == by_store', off(ca,byStore[s1])<0.05, Math.round(ca), byStore[s1]);

    // средний чек: опт («Полевая магазин») не должен смешиваться с розницей
    CLEAR();
    var WH=(D.wholesale_stores||['Полевая магазин']);
    var wh=D.by_store.filter(function(r){return WH.indexOf(r.store)>=0;});
    if(wh.length){
      var retR=0,retC=0,allR=0,allC=0;
      D.by_store.forEach(function(r){allR+=r.revenue;allC+=r.receipts;
        if(WH.indexOf(r.store)<0){retR+=r.revenue;retC+=r.receipts;}});
      var ac=avgCheck(kpiNow());
      push('Средний чек считается по рознице, без опта', ac&&off(ac.v,retR/retC)<0.1, ac?Math.round(ac.v):null, Math.round(retR/retC));
      push('Средний чек НЕ равен смешанному с оптом', ac&&Math.abs(ac.v-allR/allC)>1, ac?Math.round(ac.v):null, Math.round(allR/allC));
      push('Средний чек подписан «без опта»', ac&&ac.note==='без опта', ac&&ac.note, 'без опта');
      // выбран только оптовый магазин — показываем его собственный чек и помечаем «опт»
      S.store=[wh[0].store]; var acw=avgCheck(kpiNow());
      push('Выбран только опт — свой чек с пометкой «опт»',
        acw&&acw.note==='опт'&&off(acw.v,wh[0].revenue/wh[0].receipts)<0.1, acw&&acw.note, 'опт');
      CLEAR();
    } else { push('Средний чек: оптовых точек в данных нет', 'skip', 'нет wholesale_stores', ''); }

    CLEAR(); var c2=[D.by_category[0].category,D.by_category[1].category];
    var one=0; c2.forEach(function(c){S.cat=[c];one+=kpiNow().revenue;});
    S.cat=c2; var many=kpiNow().revenue;
    push('KPI: мультивыбор категорий аддитивен', off(one,many)<0.05, Math.round(many), Math.round(one));
    push('KPI: чеки по двум категориям скрыты (не складываются)', kpiNow().receipts===undefined, kpiNow().receipts, undefined);
    CLEAR();

    if(CUBE){
      var acc={}; D.prod_store.forEach(function(r){var s=D.stores[r[1]];acc[s]=(acc[s]||0)+r[2];});
      var worst=0,wn='';
      Object.keys(byStore).forEach(function(s){var d=off(acc[s]||0,byStore[s]);if(d>worst){worst=d;wn=s;}});
      push('Куб prod_store == by_store по всем точкам (макс. '+worst.toFixed(3)+'% · '+wn+')', worst<0.05, +worst.toFixed(3), 0);
    } else {
      push('Куб prod_store == by_store по всем точкам', 'skip', NOCUBE, '');
    }

    // Сверка с BigQuery имеет смысл, только если truth.json посчитан по ТОМУ ЖЕ периоду,
    // что описан в проверяемом full_data.json. Staging _dash_tx26 пересобирается Action'ом
    // по своему расписанию, и между сборкой JSON и запуском truth.py в него доезжают новые
    // дни продаж — тогда итоги за весь период расходятся на 1–2% и четыре проверки падают
    // при исправном дашборде. Расходятся периоды — не врём «провалено», а честно пропускаем.
    var DEND=(D.period||{}).end, TEND=T.period_end;
    if(has&&!TEND){
      push('Сверка срезов с BigQuery','skip','truth.json собран прежней версией скрипта (нет period_end) — пересчитайте: python tests/truth.py','');
      has=false;
    }
    if(has&&TEND&&DEND&&TEND!==DEND){
      push('Сверка срезов с BigQuery','skip','truth.json посчитан по '+TEND+', а данные по '+DEND+' — пересчитайте: python tests/truth.py','');
      has=false;
    }
    if(has&&CUBE){
      CLEAR(); S.cat=[T.cat]; S.sup=[T.sup];
      var both=storeAgg().reduce(function(a,r){return a+r.revenue;},0);
      CLEAR(); S.sup=[T.sup];
      var supOnly=storeAgg().reduce(function(a,r){return a+r.revenue;},0);
      push('Магазины: категория+поставщик != только поставщик', Math.abs(both-supOnly)>1, Math.round(both), Math.round(supOnly));
      push('Магазины: категория+поставщик == BigQuery', off(both,T.cat_sup_rev)<0.1, Math.round(both), T.cat_sup_rev);
      push('Магазины: только поставщик == BigQuery', off(supOnly,T.sup_rev)<0.1, Math.round(supOnly), T.sup_rev);
      CLEAR(); S.store=[T.s1]; S.cat=[T.cat];
      push('Позиции: магазин+категория == BigQuery', off(wpRev(),T.store_cat_rev)<0.1, Math.round(wpRev()), T.store_cat_rev);
      CLEAR(); S.store=[T.s1]; S.sup=[T.sup];
      push('Позиции: магазин+поставщик == BigQuery', off(wpRev(),T.store_sup_rev)<0.1, Math.round(wpRev()), T.store_sup_rev);
      CLEAR(); S.month=String(T.mo); S.store=[T.s1];
      var est=wpRev();  // WP_EXACT выставляется ВНУТРИ workProducts, читаем флаг после вызова
      push('Месяц+магазин помечен как оценка', WP_EXACT===false, WP_EXACT, false);
      push('Месяц+магазин: оценка в пределах 10% от BigQuery', off(est,T.store_month_rev)<10, Math.round(est), T.store_month_rev);
      var km=kpiNow();
      push('KPI месяц+магазин точный (store_month)', off(km.revenue,T.store_month_rev)<0.05&&km.exact===true, km.revenue, T.store_month_rev);
      CLEAR();
    } else if(has){
      push('Сверка срезов с BigQuery', 'skip', NOCUBE, '');
    }
    CLEAR();
    return out;
  })()`);
  rows.forEach(([n, ok, g, e]) => add(n, ok, g, e));
  if (!truth) skip('Сверка срезов с BigQuery', 'нет tests/truth.json — запустите python tests/truth.py');
}

// Проверки, добавленные ревизией вкладок (2026-08-21): пресет «Собственное производство»,
// фильтр магазина в отчёте по товарам, карточка среза на «Обзоре» и — главное —
// целостность разметки, от которой зависит НЕ ТРОГАЕМЫЙ блок TSD-экспорта.
function revisionSuite() {
  const rows = w.eval(`(function(){
    var out=[], push=function(n,ok,g,e){out.push([n,!!ok,g,e]);};
    var C=function(){${CLEAR}S.rpFrom='all';S.rpTo='all';S.rpMode='detail';S.rpSource='sales';S.rpMetric='rev';};
    var off=function(a,b){return b?Math.abs(a-b)/b*100:(a?100:0);};

    // ---- пресет «Собственное производство» = Кулинария + Выпечка + Хот-дог
    C();
    var have={}; D.by_category.forEach(function(c){have[c.category]=c.revenue;});
    var expected=0, n=0;
    ['Кулинария','Выпечка','Хот-дог'].forEach(function(c){if(have[c]!=null){expected+=have[c];n++;}});
    toggleOwnProd();
    var got=kpiNow().revenue;
    push('Пресет: выбраны все категории собственного производства', S.cat.length===n&&n>0, S.cat.length, n);
    push('Пресет: выручка == сумма by_category', off(got,expected)<0.05, Math.round(got), Math.round(expected));
    push('Пресет: кнопка подсвечена', ownProdOn()===true, ownProdOn(), true);
    toggleOwnProd();
    push('Пресет: повторный клик снимает фильтр', S.cat.length===0, S.cat.length, 0);

    // ---- фильтр магазина в отчёте по товарам (раньше игнорировался)
    var bs={}; D.by_store.forEach(function(r){bs[r.store]=r.revenue;});
    var s1=D.stores[0];
    C(); S.rpDim='products'; S.store=[s1];
    var rp=reportPivot('products',monthsInRange()).reduce(function(a,x){return a+x.total;},0);
    push('Отчёт «Товары»: фильтр магазина применяется', off(rp,bs[s1])<1.5, Math.round(rp), bs[s1]);
    push('Отчёт «Товары»+магазин помечен как оценка', RP_EXACT===false, RP_EXACT, false);
    C(); S.rpDim='products';
    var rpAll=reportPivot('products',monthsInRange()).reduce(function(a,x){return a+x.total;},0);
    push('Отчёт «Товары» без фильтра != одному магазину', Math.abs(rpAll-rp)>1000, Math.round(rpAll), Math.round(rp));

    // ---- маржа в отчёте совпадает с by_category
    C(); var c0=D.by_category[0];
    var rc=reportPivot('category',monthsInRange()).find(function(x){return x.name===c0.category;});
    push('Отчёт: колонка «Маржа %» == by_category', rc&&Math.abs(rc.mrg-c0.margin)<=0.2, rc&&rc.mrg, c0.margin);

    // ---- карточка среза на «Обзоре» вместо режима «Разрез»
    C(); S.tab='overview'; render();
    var empty=document.getElementById('ov_slice').innerHTML.length;
    S.cat=[c0.category]; render();
    var stats=document.querySelectorAll('#ov_slice .dstat').length;
    push('Обзор: без фильтра карточки среза нет', empty===0, empty, 0);
    push('Обзор: при одном фильтре карточка среза из 6 статов', stats===6, stats, 6);
    C();
    return out;
  })()`);
  rows.forEach(([n, ok, g, e]) => add(n, ok, g, e));

  // ---- разметка, от которой зависит блок TSD-экспорта (второй <script>, НЕ ТРОГАТЬ).
  // Он ищет карточку перебором DOM по тексту заголовка и читает <select> ПО ПОЗИЦИИ,
  // а чекбокс «скрыть технические» — поиском по всему документу.
  w.eval(`${CLEAR}S.tab='stock';render();`);
  const d = w.document;
  const card = d.getElementById('stale_card');
  const sels = card ? [...card.querySelectorAll('select')].map(s => s.id) : [];
  const techCbs = [...d.querySelectorAll('input[type=checkbox]')].filter(cb => {
    const p = cb.closest('label');
    return ((p ? p.textContent : '') + ' ' + (cb.parentNode ? cb.parentNode.textContent : '')).toLowerCase().includes('техн');
  }).length;
  add('TSD-экспорт: карточка «Товары без движения» на вкладке «Запасы»',
      !!(card && d.querySelector('#p_stock #stale_card') && /Товары без движения/.test(card.textContent)), !!card, true);
  add('TSD-экспорт: порядок select в карточке (дни/магазин/категория/поставщик)',
      sels.join(',') === 'stDays,stStore,stCat,stSup', sels.join(','), 'stDays,stStore,stCat,stSup');
  add('TSD-экспорт: ровно один чекбокс со словом «техн» на странице', techCbs === 1, techCbs, 1);
  add('TSD-экспорт: текстовый input в карточке есть',
      !!(card && card.querySelector('input[type=text],input[type=search],input:not([type])')), true, true);
  const days = d.getElementById('stDays');
  add('«Товары без движения»: окно по умолчанию 90 дней', days && days.value === '90', days && days.value, '90');
  // stale.json — это СНИМОК СКЛАДА НА ВЫБРАННУЮ ДАТУ (`as_of` = MAX(snapshot_date)
  // в stock_matrix), нужный при перемещениях. То, что снимок старый, — нормальное
  // состояние, а не поломка: владелец грузит остаток на нужный день тогда, когда он
  // нужен, и as_of сдвигается сам. Поэтому дата снимка здесь НЕ проверяется, только
  // печатается.
  // А вот имена точек обязаны совпадать с остальным дашбордом. До 2026-08-21
  // fetch_stale.py имел СВОЙ словарь нормализации на 7 ключей, и 12 из 38 магазинов
  // писались по-другому — «Товары без движения» нельзя было сопоставить ни с чем.
  // Снимок, собранный ДО этой даты, законно содержит старые имена — это история,
  // а не дефект, поэтому такой файл идёт в «пропущено», а не в FAIL. Как только
  // fetch_stale.py отработает заново (любой запуск Action), имена станут каноническими.
  // Служебный склад «Полевая-Склад» в full_data не входит намеренно (его прячет ползунок).
  const STALE = path.join(path.dirname(DATA), 'stale.json');
  if (fs.existsSync(STALE)) {
    const raw = fs.readFileSync(STALE, 'utf8');
    const meta = k => (raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')) || [, ''])[1];
    const asOf = meta('as_of'), built = meta('updated_at');
    const fdBuilt = String(w.eval('D.updated_at||""')).slice(0, 10);
    console.log('  Снимок остатков: на ' + (asOf || '?') + ' · файл собран ' + (built || '?'));
    // Свежесть САМОГО СНИМКА (as_of) не проверяем: остаток грузится под задачу (перемещения),
    // и снимок месячной давности — законное состояние. Проверяем другое: что файл stale.json
    // ПЕРЕСОБРАН вместе с full_data.json. Именно здесь была дыра — до 2026-09-03 в update.yml
    // стояло `git add docs/full_data.json` без stale.json, поэтому снимок от 28.08 пересобирался
    // в раннере и НИ РАЗУ не доезжал до прода: на сайте лежал файл от 11.08 со старыми именами.
    add('stale.json пересобран вместе с full_data.json',
        !!(built && fdBuilt && built >= fdBuilt), (built || '?') + ' против ' + (fdBuilt || '?'),
        'не старше даты сборки full_data.json');
    const names = new Set();
    for (const m of raw.matchAll(/"st"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) names.add(JSON.parse('"' + m[1] + '"'));
    const canon = new Set(w.eval('D.stores'));
    const SERVICE = new Set(['Полевая-Склад', 'Полевая-Просрок', 'Магазины-Просрок', 'Производство']);
    const norm = x => x.normalize('NFC').toLowerCase()
      .replace(/[іїi]/g, 'и').replace(/є/g, 'е').replace(/ґ/g, 'г')
      .replace(/[^a-zа-я0-9]+/g, ' ').trim();
    const canonNorm = new Map([...canon].map(n => [norm(n), n]));
    const alienAll = [...names].filter(n => !canon.has(n) && !SERVICE.has(n));
    const mismatch = alienAll.filter(n => canonNorm.has(norm(n)));
    const unknown = alienAll.filter(n => !canonNorm.has(norm(n)));
    add('stale.json: имена точек совпадают с full_data.stores',
        mismatch.length === 0, mismatch.slice(0, 6).join(', ') || '—', '—');
    if (unknown.length) skip('stale.json: точки снимка без продаж',
        unknown.slice(0, 6).join(', ') + ' — нет продаж за период, сверять не с чем');
    const missing = [...canon].filter(n => !names.has(n));
    add('stale.json: все точки сети присутствуют',
        names.size > 0 && missing.length === 0, missing.slice(0, 6).join(', ') || names.size + ' точек', '—');
  } else {
    skip('stale.json: имена точек совпадают с full_data.stores', 'нет docs/stale.json рядом с full_data.json');
  }
  // вкладок стало 8, старых имён в разметке быть не должно
  const navIds = [...d.querySelectorAll('.nav button')].map(b => b.dataset.p);
  add('Вкладок 8, старые frozen/moves/culinary убраны',
      navIds.length === 8 && !navIds.some(x => ['frozen','moves','culinary'].includes(x)), navIds.join(','), 8);
  // у каждой кнопки навигации есть своя страница
  const orphan = navIds.filter(p => !d.getElementById('p_' + p));
  add('Каждой кнопке навигации соответствует страница', orphan.length === 0, orphan.join(',') || '—', '—');
  // кнопки экспорта не указывают на исчезнувшие таблицы
  const badExp = [...d.querySelectorAll('.csvbtn[data-t]')].map(b => b.dataset.t).filter(t => !d.getElementById(t));
  add('Кнопки ⬇ Excel указывают на существующие таблицы', badExp.length === 0, badExp.join(',') || '—', '—');
}

// Регрессии, найденные после редизайна (2026-08-27). Все восемь ловятся только при
// ЗАГРУЖЕННОМ redesign.js — до этого харнесс вырезал внешние скрипты и слоя не видел.
function redesignSuite() {
  const d = w.document;
  const CL = `${CLEAR}msSyncAll();`;

  // 1) Тепловая карта. Её SVG-версия из redesign.js читала window.D/window.S, а D и S
  //    объявлены через let/const и свойствами window не становятся -> выходила сразу.
  w.eval(`${CL}S.tab='stores';render();`);
  const hm = d.getElementById('hm_chart');
  add('Тепловая карта: SVG отрисован', !!hm && hm.innerHTML.length > 1000, hm ? hm.innerHTML.length : 0, '>1000');
  add('Тепловая карта: подпись с пиком', /Пик/.test((d.getElementById('hm_note') || {}).textContent || ''),
      ((d.getElementById('hm_note') || {}).textContent || '').slice(0, 30), 'Пик …');

  // 2) Каскад категория->поставщик. setFilter/чипы/пресет звали msSync(один ключ),
  //    и счётчик на соседней кнопке застревал: «Все поставщиков (4)» при пустых фильтрах.
  const allSup = w.eval('D.by_supplier.length');
  w.eval(`${CL}setFilter('cat', D.by_category[0].category);`);
  const narrowed = w.eval("msOptions('sup').length");
  w.eval(`${CL}`);
  const restored = w.eval("msSummary('sup')");
  add('Каскад: список поставщиков сужается под категорию', narrowed < allSup, narrowed, '<' + allSup);
  add('Каскад: после сброса счётчик поставщиков возвращается', restored.includes(String(allSup)), restored, allSup);

  // 3) Аналитика считается под срез (раньше ABC/покрытие брались по всей сети).
  w.eval(`${CL}S.tab='analytics';render();`);
  const abc0 = d.getElementById('an_abc_k').textContent;
  const cov0 = d.querySelectorAll('#an_cov thead th').length;
  w.eval(`S.store=[D.stores[0]];msSyncAll();render();`);
  const abc1 = d.getElementById('an_abc_k').textContent;
  const cov1 = d.querySelectorAll('#an_cov thead th').length;
  add('Аналитика: ABC пересчитывается под фильтр', abc0 !== abc1, abc0 === abc1 ? 'та же сводка' : 'меняется', 'меняется');
  add('Аналитика: покрытие сужается до выбранных точек', cov1 < cov0, cov0 + ' -> ' + cov1, 'меньше');
  w.eval(`${CL}`);

  // 4) Оборачиваемость. avg_stock — СУММА месячных средних, значит turnover_rate это
  //    обороты в месяц; деление периода на него завышало срок в monthsCount() раз.
  const months = w.eval('monthsCount()');
  const worst = w.eval(`(function(){var m=0;(D.turnover_store||[]).forEach(function(t){var v=shelfDays(t.turnover_rate);if(v>m)m=v;});return m;})()`);
  add('Оборачиваемость: дни на полке пересчитаны на обороты за период',
      months > 1 && worst > 0 && worst < 200, worst + ' дн (макс по сети, ' + months + ' мес)', '<200');

  // 4-бис) Закупки должны включать централизованный склад. Сеть закупается через
  //   «Полевая-Склад» (66 млн ₴ из 246 млн за 2026); пока в fetch_incoming.py стоял фильтр
  //   `store IN keep`, дашборд показывал 181 млн, а по «Водке» — 284 тыс вместо 11,5 млн.
  const buyStores = new Set(w.eval('(D.in_store_month||[]).map(r=>r.store)'));
  const netStores = new Set(w.eval('D.stores'));
  const central = [...buyStores].filter(x => !netStores.has(x));
  if (central.length) {
    const cov = w.eval(`(function(){
      var buys=(D.in_cat_month||[]).reduce(function(a,r){return a+(r.revenue||0);},0);
      var cogs=(D.kpi.revenue||0)-(D.kpi.gp||0);
      return cogs? Math.round(buys/cogs*100):0; })()`);
    add('Закупки: централизованный склад учтён', true, central.join(', '), 'есть');
    add('Закупки: сходятся с себестоимостью продаж (60–130%)', cov >= 60 && cov <= 130, cov + '%', '60–130%');
  } else {
    skip('Закупки: централизованный склад учтён',
         'данные собраны прежним fetch_incoming.py — нажмите «Обновить данные»');
  }

  // 5) Отчёт по закупкам честно пишет покрытие: приходов по «Водке» 1,9% от продаж.
  w.eval(`${CL}S.tab='report';S.rpBuilt=true;S.rpDim='products';S.rpSource='incoming';S.cat=['Водка'];msSyncAll();render();`);
  const rps = (d.getElementById('rp_s') || {}).textContent || '';
  add('Отчёт «Закупки»: подписано покрытие относительно продаж', /закупки =/.test(rps),
      rps.slice(0, 60), 'есть подпись');
  w.eval(`${CL}S.rpSource='sales';S.rpBuilt=false;`);
}

// Фичи, добавленные 2026-08-28: GMROI, дефицит в гривнах, «продаётся у соседей».
// Все три считаются на фронте из уже имеющихся ключей, пайплайн не трогают.
function featuresSuite() {
  const d = w.document;
  const CL = `${CLEAR}msSyncAll();`;

  // ---- GMROI = прибыль / (avg_stock / число месяцев).
  // avg_stock в turnover_* — СУММА месячных средних, без деления GMROI занижен в monthsCount() раз.
  const g = w.eval(`(function(){
    var m=monthsCount(), gp={}, out={n:0,min:1e9,max:0,med:0,vals:[]};
    D.by_store.forEach(function(r){gp[r.store]=r.gp;});
    (D.turnover_store||[]).forEach(function(t){
      var v=gmroi(gp[t.store],t);
      if(v!=null){out.n++;out.vals.push(v);if(v<out.min)out.min=v;if(v>out.max)out.max=v;}
    });
    out.vals.sort(function(a,b){return a-b;});
    out.med=out.vals[Math.floor(out.vals.length/2)];
    out.months=m;
    return out;})()`);
  add('GMROI: посчитан для всех точек', g.n === w.eval('D.by_store.length'), g.n, w.eval('D.by_store.length'));
  add('GMROI: значения в разумном диапазоне (0,3–15)', g.min > 0.3 && g.max < 15,
      g.min.toFixed(2) + '…' + g.max.toFixed(2) + ' (медиана ' + g.med.toFixed(2) + ')', '0,3–15');
  w.eval(`${CL}S.tab='stores';render();`);
  const th = [...d.querySelectorAll('#stf_tab thead th')].map(x => x.textContent.replace(/[▼▲⇅\s]/g, ''));
  add('GMROI: колонка в таблице магазинов', th.includes('GMROI'), th.join(','), 'есть GMROI');
  w.eval(`${CL}S.tab='analytics';render();`);
  add('GMROI: график на «Аналитике» с подписью',
      !!d.getElementById('an_gmroi') && (d.getElementById('an_gmroi_note').textContent || '').length > 100,
      (d.getElementById('an_gmroi_note').textContent || '').length + ' симв.', '>100');

  // ---- Дефицит в гривнах: норма/мес × средняя цена позиции из products
  const o = w.eval(`(function(){
    var rev=0, gp=0, hit=0;
    (D.oos||[]).forEach(function(r){var m=oosMoney(r);rev+=m.rev;gp+=m.gp;if(m.rev>0)hit++;});
    return {rev:Math.round(rev), gp:Math.round(gp), hit:hit, n:(D.oos||[]).length,
            mrev:Math.round((D.kpi.revenue||0)/monthsCount())};})()`);
  add('Дефицит: цена известна почти для всех позиций', o.hit >= o.n * 0.9, o.hit + ' из ' + o.n, '≥90%');
  add('Дефицит: упущенная выручка меньше месячного оборота', o.rev > 0 && o.rev < o.mrev,
      o.rev.toLocaleString('ru-RU') + ' ₴/мес против оборота ' + o.mrev.toLocaleString('ru-RU'), '<оборота');
  add('Дефицит: прибыль меньше выручки', o.gp > 0 && o.gp < o.rev, o.gp.toLocaleString('ru-RU'), '<' + o.rev.toLocaleString('ru-RU'));
  w.eval(`${CL}S.tab='stock';render();`);
  const oth = [...d.querySelectorAll('#fr_oos thead th')].map(x => x.textContent.replace(/[▼▲⇅\s]/g, ''));
  add('Дефицит: колонка «Упущено ₴/мес» в таблице', oth.some(x => /Упущено/.test(x)), oth.join(','), 'есть');

  // ---- «Продаётся у соседей, но не у нас»
  w.eval(`${CL}S.tab='stock';render();`);
  add('Ассортимент: без выбранного магазина блок скрыт',
      d.getElementById('gap_card').style.display === 'none', d.getElementById('gap_card').style.display, 'none');
  const s1 = w.eval('D.stores[0]');
  w.eval(`${CL}S.store=['${s1.replace(/'/g, "\\'")}'];msSyncAll();S.tab='stock';render();`);
  const gapN = d.querySelectorAll('#gap_tab tbody tr').length;
  add('Ассортимент: при одном магазине блок показан и заполнен',
      d.getElementById('gap_card').style.display !== 'none' && gapN > 0, gapN + ' строк', '>0');
  // ни одна найденная позиция не должна продаваться в выбранной точке — иначе это не «дыра»
  const bad = w.eval(`(function(){
    var st='${s1.replace(/'/g, "\\'")}', si=D.stores.indexOf(st), rows=assortmentGaps(st,25);
    if(!rows)return -1;
    var idx={}; D.products.forEach(function(p,i){idx[p.p]=i;});
    var sold={}; D.prod_store.forEach(function(r){ if(r[1]===si&&r[2]>0) sold[r[0]]=1; });
    return rows.filter(function(x){return sold[idx[x.p]];}).length;})()`);
  add('Ассортимент: в списке нет позиций, которые в этой точке продаются', bad === 0, bad, 0);
  w.eval(`${CL}`);
}

function returnsSuite() {
  if (!w.eval('!!(D.returns_fact&&D.returns_dim)')) {
    skip('Возвраты: аддитивность куба и карточка на «Обзоре»',
         'нет returns_fact — пересоберите данные');
    return;
  }
  const rows = w.eval(`(function(){
    var out=[], dm=D.returns_dim, cube=D.returns_fact;
    var CLEAR=function(){${CLEAR}S.retScope='rp';};
    var near=function(a,b){return Math.abs(a-b)<1;};
    var total=0, byK={retail:0,prosrok:0,wh:0};
    cube.forEach(function(r){total+=r[5];byK[dm.k[r[4]]]+=r[5];});
    CLEAR();
    S.retScope='r';   var vr=returnsNow().pur;
    S.retScope='rp';  var vrp=returnsNow().pur;
    S.retScope='all'; var va=returnsNow().pur;
    out.push(['Возвраты: охват «розница» == класс retail', near(vr,byK.retail), Math.round(vr), Math.round(byK.retail)]);
    out.push(['Возвраты: охват «+просрочка» == retail+prosrok', near(vrp,byK.retail+byK.prosrok), Math.round(vrp), Math.round(byK.retail+byK.prosrok)]);
    out.push(['Возвраты: охват «всё» == весь куб', near(va,total), Math.round(va), Math.round(total)]);
    var bym=0; D.returns_meta.months.forEach(function(m){S.month=String(m);bym+=returnsNow().pur;});
    S.month='all';
    out.push(['Возвраты: сумма месяцев == итог', near(bym,va), Math.round(bym), Math.round(va)]);
    var f=function(dim,key){var s=0;dim.forEach(function(v){S[key]=[v];s+=returnsNow().pur;});S[key]=[];return s;};
    out.push(['Возвраты: сумма поставщиков == итог', near(f(dm.p,'sup'),va), 0, 0]);
    out.push(['Возвраты: сумма магазинов == итог', near(f(dm.s,'store'),va), 0, 0]);
    out.push(['Возвраты: сумма категорий == итог', near(f(dm.c,'cat'),va), 0, 0]);
    var p3=dm.p.slice(0,3), one=0;
    p3.forEach(function(p){S.sup=[p];one+=returnsNow().pur;});
    S.sup=p3; var many=returnsNow().pur; S.sup=[];
    out.push(['Возвраты: мультивыбор поставщиков аддитивен', near(one,many), Math.round(many), Math.round(one)]);
    var bc=D.returns_meta.by_class;
    out.push(['Возвраты: итог == returns_meta.by_class', near(va, bc.retail.pur+bc.prosrok.pur+bc.wh.pur), Math.round(va), Math.round(bc.retail.pur+bc.prosrok.pur+bc.wh.pur)]);
    CLEAR();
    return out;
  })()`);
  rows.forEach(([n, ok, g, e]) => add(n, ok, g, e));

  w.eval(`${CLEAR}S.tab='overview';render();`);
  const kpis = w.document.querySelectorAll('#ov_kpis .kpi').length;
  const ret = w.document.querySelectorAll('#ov_ret tbody tr').length;
  const seg = w.document.querySelectorAll('#retScope button.on').length;
  add('Обзор: 8 KPI-карточек (включая «Возвраты ₴»)', kpis === 8, kpis, 8);
  add('Обзор: таблица возвратов не пустая', ret > 0, ret, '>0');
  add('Обзор: ровно один активный сегмент ползунка', seg === 1, seg, 1);
}

function bootRedesign() {
  if (!REDESIGN) return;
  try {
    const el = w.document.createElement('script');
    el.textContent = REDESIGN;
    w.document.body.appendChild(el);
    // redesign.js подписывается на DOMContentLoaded; в jsdom оно уже прошло, шлём заново
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  } catch (e) { errors.push('redesign.js не выполнился: ' + (e.stack || e)); }
}

setTimeout(() => {
  if (!w.eval('typeof D!=="undefined" && !!D')) { console.error('ДАННЫЕ НЕ ЗАГРУЗИЛИСЬ'); process.exit(2); }
  bootRedesign();

  // Что вообще есть в этом full_data.json. Если данные собраны прежним скриптом,
  // часть проверок физически нечем выполнить — они идут как «пропущено», а не «провалено».
  const has = w.eval(`({cube:!!(D.prod_store&&D.products&&D.stores), ret:!!(D.returns_fact&&D.returns_dim),
    upd:(D.updated_at||'—')})`);
  const stale = !has.cube || !has.ret;
  console.log('  Данные от ' + has.upd + ' · куб позиций: ' + (has.cube ? 'есть' : 'НЕТ') +
    ' · возвраты: ' + (has.ret ? 'есть' : 'НЕТ'));
  if (stale) {
    console.log('  ВНИМАНИЕ: full_data.json собран прежним скриптом. Сначала `git push`,');
    console.log('  затем «Обновить данные» — иначе проверять нечего, а дашборд работает');
    console.log('  в приблизительном режиме (в интерфейсе это подписано «≈ оценка»).');
  }


// Тренды на KPI и сравнение месяцев (2026-09-03). Главный инвариант: помесячный ряд,
// по которому рисуется спарклайн, обязан совпадать с числом в карточке за тот же месяц.
// Именно это раньше расходилось: ряд строился по одному измерению, карточка — по срезу.
function trendSuite() {
  const CL = CLEAR;
  const rows = w.eval(`(function(){
    var out=[], CL=function(){${CLEAR}};
    var cases=[['без фильтров',''],
      ['магазин','S.store=[D.stores[3]];'],
      ['категория','S.cat=[D.by_category[1].category];'],
      ['магазин + категория','S.store=[D.stores[3]];S.cat=[D.by_category[1].category];'],
      ['магазин + поставщик','S.store=[D.stores[3]];S.sup=[D.by_supplier[1].supplier];']];
    for (var ci=0; ci<cases.length; ci++){
      var name=cases[ci][0], setup=cases[ci][1];
      CL(); eval(setup); var ser=sliceSeries(); var src=ser.src, bad=0, n=0;
      for (var i=0;i<ser.rows.length;i++){
        var r=ser.rows[i];
        CL(); eval(setup); S.month=String(r.mo); render();
        var k=kpiNow(); n++;
        var d=Math.abs((k.revenue||0)-(r.revenue||0));
        if (r.revenue && d/r.revenue>0.005) bad++;
      }
      out.push([name, src, n, bad]);
    }
    CL(); return out;
  })()`);
  rows.forEach(([name, src, n, bad]) =>
    add('Тренд == карточка помесячно: ' + name, bad === 0, bad ? bad + ' из ' + n + ' месяцев врут (' + src + ')' : n + ' мес · ' + src, '0 расхождений'));

  const pairs = w.eval(`(function(){
    ${CLEAR}render(); var a=window.KPI_TREND&&window.KPI_TREND.cmp;
    ${CLEAR}S.month='5';render(); var b=window.KPI_TREND&&window.KPI_TREND.cmp;
    ${CLEAR}S.month='8';S.cmp='3';render(); var c=window.KPI_TREND&&window.KPI_TREND.cmp;
    ${CLEAR}S.abc='A';render(); var d=window.KPI_TREND&&window.KPI_TREND.cmp;
    ${CLEAR}render();
    return [a,b,c,d];
  })()`);
  add('Сравнение: «весь период» берёт последний месяц против предыдущего',
      !!pairs[0] && pairs[0].a > pairs[0].b, pairs[0] ? pairs[0].a + ' vs ' + pairs[0].b : '—', 'a>b');
  add('Сравнение: выбран май -> база апрель', !!pairs[1] && pairs[1].a === 5 && pairs[1].b === 4,
      pairs[1] ? pairs[1].a + ' vs ' + pairs[1].b : '—', '5 vs 4');
  add('Сравнение: можно взять любой месяц (авг против марта)',
      !!pairs[2] && pairs[2].a === 8 && pairs[2].b === 3, pairs[2] ? pairs[2].a + ' vs ' + pairs[2].b : '—', '8 vs 3');
  add('Сравнение гасится там, где ряд не про карточку (ABC)', pairs[3] === null,
      pairs[3] ? 'стрелка рисуется' : 'погашено', 'погашено');

  // разметка карточек: без data-metric слой редизайна не знает, что рисовать
  w.eval(`${CLEAR}S.tab='overview';render();`);
  const metrics = [...w.document.querySelectorAll('#ov_kpis .kpi[data-metric]')].map(k => k.dataset.metric);
  add('KPI «Обзора» размечены метриками', metrics.length >= 7, metrics.join(',') || '—', '>=7');
  w.eval(`${CLEAR}S.tab='stores';render();`);
  add('KPI «Магазинов» размечены метриками',
      w.document.querySelectorAll('#st_kpis2 .kpi[data-metric]').length >= 2,
      w.document.querySelectorAll('#st_kpis2 .kpi[data-metric]').length, '>=2');
}


// Поставщики в двух измерениях (2026-09-04). Требование владельца дословно: «суммы не
// должны теряться и обрезаться». Поэтому здесь проверяется ровно это — что сумма по
// ЛЮБОМУ разрезу сходится с итогом, а не что «примерно похоже».
function supplierSuite() {
  const has = w.eval('!!(D.in_ts_month&&D.in_ts_month.length&&D.sales_ts_month&&D.sales_ts_month.length)');
  if (!has) {
    skip('Продажи по контрагентам == общая выручка', 'нет in_ts_month/sales_ts_month — данные собраны прежним скриптом');
    return;
  }
  const r = w.eval(`(function(){
    var sTs=0, sExact=0, noInc=0;
    (D.sales_ts_month||[]).forEach(function(x){ sTs+=+x.revenue||0; sExact+=+x.rev_exact||0;
      if(String(x.supplier_ts).indexOf('нет прихода')>=0) noInc+=+x.revenue||0; });
    var buyTs=0, buyMx=0;
    (D.in_ts_month||[]).forEach(function(x){ buyTs+=+x.revenue||0; });
    (D.in_supplier_month||[]).forEach(function(x){ buyMx+=+x.revenue||0; });
    var br=0, brBad=0;
    (D.sup_bridge||[]).forEach(function(x){ br+=+x.amt||0; if(!x.supplier_ts||!x.supplier)brBad++; });
    var neg=(D.sales_ts_month||[]).filter(function(x){return (+x.revenue||0)<0;}).length
           +(D.in_ts_month||[]).filter(function(x){return (+x.revenue||0)<0;}).length;
    return {sTs:sTs, sExact:sExact, noInc:noInc, buyTs:buyTs, buyMx:buyMx, br:br, brBad:brBad,
            neg:neg, rev:D.kpi.revenue, nTs:(new Set((D.in_ts_month||[]).map(function(x){return x.supplier_ts;}))).size};
  })()`);
  const off = (a, b) => b ? Math.abs(a - b) / b * 100 : (a ? 100 : 0);
  add('Продажи по контрагентам == общая выручка (разнесение ничего не теряет)',
      off(r.sTs, r.rev) < 0.01, Math.round(r.sTs) + ' против ' + r.rev, '<0,01%');
  add('Закупки: контрагенты == бренды (одна и та же сумма, два имени)',
      off(r.buyTs, r.buyMx) < 0.01, Math.round(r.buyTs) + ' против ' + Math.round(r.buyMx), '<0,01%');
  add('Мостик контрагент-бренд покрывает всю сумму закупок',
      off(r.br, r.buyTs) < 0.01 && r.brBad === 0, Math.round(r.br) + ' · пустых строк ' + r.brBad, '== закупкам');
  add('Разнесение не создаёт отрицательных строк', r.neg === 0, r.neg, 0);
  add('Доля точных (без разнесения) продаж по контрагентам',
      r.sExact > 0 && r.sExact < r.sTs, Math.round(r.sExact / r.sTs * 100) + '% точно', '0<x<100');
  add('Позиции без приходов не потеряны, а вынесены строкой', r.noInc > 0, Math.round(r.noInc) + ' ₴', '>0');

  // Юрлица: склейка подтверждённых переименований не должна менять итог — только уменьшать
  // число имён и увеличивать долю точных (позиция, которую «возили двое», после склейки
  // оказывается от одного юрлица). Автосклейки по имени нет: см. scripts/supplier_entity.py.
  if (w.eval('!!(D.sales_ent_month&&D.sales_ent_month.length)')) {
    const e = w.eval(`(function(){
      var se=0,sx=0,st=0,sxt=0,be=0,bt=0;
      (D.sales_ent_month||[]).forEach(function(x){se+=+x.revenue||0;sx+=+x.rev_exact||0;});
      (D.sales_ts_month||[]).forEach(function(x){st+=+x.revenue||0;sxt+=+x.rev_exact||0;});
      (D.in_ent_month||[]).forEach(function(x){be+=+x.revenue||0;});
      (D.in_ts_month||[]).forEach(function(x){bt+=+x.revenue||0;});
      return {se:se,sx:sx,st:st,sxt:sxt,be:be,bt:bt,
        nEnt:(new Set((D.in_ent_month||[]).map(function(x){return x.entity;}))).size,
        nTs:(new Set((D.in_ts_month||[]).map(function(x){return x.supplier_ts;}))).size};
    })()`);
    add('Юрлица: продажи == продажам по контрагентам (склейка не двигает суммы)',
        off(e.se, e.st) < 0.01, Math.round(e.se) + ' против ' + Math.round(e.st), '<0,01%');
    add('Юрлица: закупки == закупкам по контрагентам',
        off(e.be, e.bt) < 0.01, Math.round(e.be) + ' против ' + Math.round(e.bt), '<0,01%');
    add('Юрлица: имён стало меньше, чем контрагентов', e.nEnt < e.nTs, e.nEnt + ' из ' + e.nTs, '<');
    add('Юрлица: доля точных выросла', e.sx > e.sxt,
        Math.round(e.sx / e.se * 100) + '% против ' + Math.round(e.sxt / e.st * 100) + '%', '>');
  } else {
    skip('Юрлица: продажи == продажам по контрагентам', 'нет sales_ent_month — нужна пересборка данных');
  }

  // карточка «Поставщики»: все шесть комбинаций переключателей рендерятся и считают итог
  const combos = [['mx','sales'],['mx','buy'],['ts','sales'],['ts','buy'],['ent','sales'],['ent','buy']];
  let okCombo = 0, rowsTotal = [];
  for (const [dim, met] of combos) {
    try {
      w.eval(`${CLEAR}S.supDim='${dim}';S.supMet='${met}';S.tab='overview';render();`);
      const t = w.document.getElementById('ov_sup');
      const n = t ? t.querySelectorAll('tbody tr').length : 0;
      rowsTotal.push(dim + '/' + met + ':' + n);
      if (n > 0) okCombo++;
    } catch (e) { errors.push('карточка поставщиков [' + dim + '/' + met + ']: ' + (e.stack || e)); }
  }
  add('Карточка «Поставщики»: все 6 комбинаций переключателей заполнены',
      okCombo === 6, rowsTotal.join(' · '), '6 из 6');
  w.eval(`${CLEAR}S.supDim='mx';S.supMet='sales';S.tab='overview';render();`);
}


// Отчёты и кросс-фильтр (2026-09-17). До этой даты группировка «Магазины» не видела
// фильтра категории, а «Категории» — фильтра магазина: отчёт молча отдавал всю сеть.
// «Хот-дог» + разрез по магазинам показывал 304,7 млн ₴ вместо 619,6 тыс.
function reportSuite() {
  const cubes = w.eval('!!(D.store_cat_month&&D.store_cat_month.length)');
  if (!cubes) { skip('Отчёт: магазины под фильтром категории', 'нет store_cat_month — нужна пересборка данных'); return; }
  const r = w.eval(`(function(){
    var CL=function(){${CLEAR}S.rpFrom='all';S.rpTo='all';S.rpMetric='rev';S.rpSource='sales';S.rpMode='detail';};
    var cat=(D.by_category.find(function(c){return c.category==='Хот-дог';})||D.by_category[3]);
    CL(); S.cat=[cat.category]; S.rpDim='store';
    var a=reportPivot('store',monthsInRange());
    var aSum=a.reduce(function(s,o){return s+o.total;},0);
    var st=D.stores[3];
    CL(); S.store=[st]; S.rpDim='category';
    var b=reportPivot('category',monthsInRange());
    var bSum=b.reduce(function(s,o){return s+o.total;},0);
    CL(); S.store=[st]; var bRef=kpiNow().revenue;
    var sup=D.by_supplier[1].supplier;
    CL(); S.store=[st]; S.sup=[sup]; S.rpDim='supplier';
    var c=reportPivot('supplier',monthsInRange());
    var cSum=c.reduce(function(s,o){return s+o.total;},0);
    CL(); S.store=[st]; S.sup=[sup]; var cRef=kpiNow().revenue;
    CL();
    return {catName:cat.category, aSum:aSum, aRef:cat.revenue, aRows:a.length,
            bSum:bSum, bRef:bRef, cSum:cSum, cRef:cRef};
  })()`);
  const off = (x, y) => y ? Math.abs(x - y) / y * 100 : (x ? 100 : 0);
  add('Отчёт: магазины под фильтром категории == by_category',
      off(r.aSum, r.aRef) < 0.05, Math.round(r.aSum) + ' против ' + r.aRef + ' («' + r.catName + '», ' + r.aRows + ' точек)', '<0,05%');
  add('Отчёт: категории под фильтром магазина == KPI магазина',
      off(r.bSum, r.bRef) < 0.05, Math.round(r.bSum) + ' против ' + Math.round(r.bRef), '<0,05%');
  add('Отчёт: поставщики под фильтром магазина == KPI среза',
      off(r.cSum, r.cRef) < 0.05, Math.round(r.cSum) + ' против ' + Math.round(r.cRef), '<0,05%');

  // Перекрёстный режим: колонки — второе измерение. Сумма обязана совпасть с обычным
  // разрезом, иначе это уже не та же таблица, а другая цифра под тем же заголовком.
  const x = w.eval(`(function(){
    ${CLEAR}S.rpFrom='all';S.rpTo='all';S.rpMetric='rev';S.rpSource='sales';S.rpMode='cross';
    S.cat=ownProdCats(); S.rpDim='store';
    var c=rpCross('store',monthsInRange());
    if(!c)return null;
    var cs=c.rows.reduce(function(s,o){return s+o.total;},0);
    var ds=reportPivot('store',monthsInRange()).reduce(function(s,o){return s+o.total;},0);
    var byCol={}; c.cols.forEach(function(n,i){byCol[n]=c.rows.reduce(function(s,o){return s+(o['c'+i]||0);},0);});
    ${CLEAR}
    return {cols:c.cols, n:c.rows.length, cs:cs, ds:ds, byCol:byCol};
  })()`);
  if (!x) { skip('Отчёт перекрёстно: сумма == обычному разрезу', 'rpCross недоступен'); return; }
  add('Отчёт перекрёстно: сумма == обычному разрезу',
      off(x.cs, x.ds) < 0.01, Math.round(x.cs) + ' против ' + Math.round(x.ds), '<0,01%');
  add('Отчёт перекрёстно: колонки = выбранные категории пресета',
      x.cols.length === 3 && x.cols.indexOf('Кулинария') >= 0,
      x.cols.join(', '), 'Кулинария, Выпечка, Хот-дог');
  const byCat = w.eval('(function(){var m={};(D.by_category||[]).forEach(function(c){m[c.category]=c.revenue;});return m;})()');
  const bad = x.cols.filter(n => {
    const a = x.byCol[n], b = byCat[n];
    return b ? Math.abs(a - b) / b * 100 > 0.05 : false;
  });
  add('Отчёт перекрёстно: каждая колонка == by_category',
      bad.length === 0, bad.length ? bad.join(', ') : x.cols.map(n => n + ' ' + Math.round(x.byCol[n])).join(' · '), '0 расхождений');

  // ТОВАРЫ x МАГАЗИНЫ (2026-09-18). Куб prod_store годовой — месяца в нём нет. Поэтому
  // разрез обязан (а) на полном периоде совпасть с обычным отчётом по товарам и
  // (б) на неполном честно отказаться, а не отдать годовые цифры под видом месячных.
  const p = w.eval(`(function(){
    var CL=function(){${CLEAR}S.rpFrom='all';S.rpTo='all';S.rpMetric='rev';S.rpSource='sales';S.rpMode='cross';S.rpDim='products';};
    var cat=(D.by_category.find(function(c){return c.category==='Хот-дог';})||D.by_category[3]);
    CL(); S.cat=[cat.category];
    var c=rpCross('products',monthsInRange());
    if(!c||c.need)return {blocked:c&&c.need};
    var cs=c.rows.reduce(function(s,o){return s+o.total;},0);
    var ds=reportPivot('products',monthsInRange()).reduce(function(s,o){return s+o.total;},0);
    // сумма по колонкам одной строки == её итог: клетки не теряются и не двоятся
    var r0=c.rows[0]||{name:'',total:0}, cells=0;
    c.cols.forEach(function(n,i){cells+=(r0['c'+i]||0);});
    // неполный период: последний месяц отдельно
    var mos=(D.monthly||[]).map(function(m){return m.mo;});
    var last=mos[mos.length-1];
    CL(); S.cat=[cat.category]; S.rpFrom=last; S.rpTo=last;
    var part=rpCross('products',monthsInRange());
    ${CLEAR}
    return {catName:cat.category, n:c.rows.length, ncol:c.cols.length, cs:cs, ds:ds,
            r0:r0.name, r0t:r0.total, cells:cells,
            partNeed:!!(part&&part.need), partRows:(part&&part.rows)?part.rows.length:0};
  })()`);
  if (!p || p.blocked) {
    skip('Отчёт перекрёстно: товары x магазины', p && p.blocked ? p.blocked : 'нет куба prod_store');
  } else {
    add('Отчёт перекрёстно: товары x магазины == обычному разрезу по товарам',
        off(p.cs, p.ds) < 0.05,
        Math.round(p.cs) + ' против ' + Math.round(p.ds) + ' («' + p.catName + '», ' + p.n + ' позиций x ' + p.ncol + ' точек)', '<0,05%');
    add('Отчёт перекрёстно: клетки строки складываются в её итог',
        off(p.cells, p.r0t) < 0.05, '«' + p.r0 + '» ' + Math.round(p.cells) + ' против ' + Math.round(p.r0t), '<0,05%');
    add('Отчёт перекрёстно: на неполном периоде товары x магазины отказывают, а не врут',
        p.partNeed && p.partRows === 0, p.partNeed ? 'отказ с объяснением' : 'отдал ' + p.partRows + ' строк годовых цифр', 'отказ');

    // График «Динамика по месяцам» рисуется из o.by. У куба месяцев нет, поэтому ряд
    // достраивается из prod_month — и обязан сойтись с итогом строки, иначе под таблицей
    // будет чужая кривая. С выбранным магазином такого ряда нет — график должен гаснуть.
    const ch = w.eval(`(function(){
      var CL=function(){${CLEAR}S.rpFrom='all';S.rpTo='all';S.rpMetric='rev';S.rpSource='sales';S.rpMode='cross';S.rpDim='products';};
      var cat=(D.by_category.find(function(c){return c.category==='Хот-дог';})||D.by_category[3]);
      CL(); S.cat=[cat.category];
      var c=rpCross('products',monthsInRange()), mos=monthsInRange();
      var r0=c.rows[0], ser=mos.reduce(function(s,m){return s+(r0.by[m]||0);},0);
      CL(); S.cat=[cat.category]; S.store=[D.stores[3]];
      var c2=rpCross('products',monthsInRange());
      ${CLEAR}
      return {ser:ser, tot:r0.total, name:r0.name, noChart:!!(c2&&c2.noChart), cols2:(c2&&c2.cols)?c2.cols.length:0};
    })()`);
    add('Отчёт перекрёстно: помесячный ряд графика сходится с итогом строки',
        off(ch.ser, ch.tot) < 0.5, '«' + ch.name + '» ' + Math.round(ch.ser) + ' против ' + Math.round(ch.tot), '<0,5%');
    add('Отчёт перекрёстно: при выбранном магазине график гасится, а не рисует нули',
        ch.noChart && ch.cols2 === 1, ch.noChart ? 'график снят, колонок ' + ch.cols2 : 'рисует нулевую линию', 'снят');
  }
}


// Кросс-продажи (2026-09-19). Раньше пайплайн считал cross_variants и связки категорий,
// а фронт их не рисовал — проверок не было вовсе, и мёртвые ключи никто не замечал.
// Здесь сверяется ровно то, что заявлено подписями на экране.
function basketSuite() {
  const CI = w.eval('(D.cross_items||[])'), ST = w.eval('(D.cross_stats||null)');
  if (!CI.length || !ST) { skip('Кросс-продажи: типы связи', 'нет cross_items/cross_stats — нужна пересборка данных'); return; }
  const KINDS = ['cross', 'same', 'variant', 'nomatrix', 'subs'];
  const bad = CI.filter(r => KINDS.indexOf(r.kind) < 0);
  add('Кросс-продажи: у каждой пары известный тип связи', bad.length === 0,
      bad.length ? bad.length + ' без типа' : KINDS.map(k => k + ':' + CI.filter(r => r.kind === k).length).join(' '), '0 без типа');

  const NOCAT = 'Прочее (нет в матрице)';
  const tok = s => (s || '').toLowerCase().replace(/[^0-9a-zа-яёіїєґ ]/g, ' ').split(/\s+/).filter(Boolean);
  const pref = (a, b) => { const x = tok(a), y = tok(b); let n = 0; while (n < x.length && n < y.length && x[n] === y[n]) n++; return n; };
  const wrongCross = CI.filter(r => r.kind === 'cross' && (r.c1 === r.c2 || r.c1 === NOCAT || r.c2 === NOCAT));
  add('Кросс-продажи: «разные категории» — действительно разные и обе известны',
      wrongCross.length === 0, wrongCross.length ? wrongCross[0].c1 + ' / ' + wrongCross[0].c2 : 'расхождений нет', '0');
  const wrongSame = CI.filter(r => r.kind === 'same' && r.c1 !== r.c2);
  add('Кросс-продажи: «внутри категории» — категория одна', wrongSame.length === 0,
      wrongSame.length ? wrongSame[0].c1 + ' / ' + wrongSame[0].c2 : 'расхождений нет', '0');
  const wrongVar = CI.filter(r => r.kind === 'variant' && pref(r.a, r.b) < 2);
  add('Кросс-продажи: «одна линейка» — общий префикс не меньше двух слов', wrongVar.length === 0,
      wrongVar.length ? '«' + wrongVar[0].a + '» + «' + wrongVar[0].b + '»' : 'расхождений нет', '0');

  // Главное содержательное правило: всё, что показано как связка, встречается ЧАЩЕ
  // случайного (lift>1), а «взаимозамена» — наоборот, реже. Иначе подписи врут.
  const wrongLift = CI.filter(r => r.kind !== 'subs' && r.lift < ST.lift_min);
  const wrongSubs = CI.filter(r => r.kind === 'subs' && (r.lift >= ST.subs_max || r.c1 !== r.c2));
  add('Кросс-продажи: у связок сила связи не ниже порога', wrongLift.length === 0,
      wrongLift.length ? wrongLift.length + ' пар ниже ' + ST.lift_min : 'порог ' + ST.lift_min + ' выдержан', '0 нарушений');
  add('Кросс-продажи: «взаимозамена» — связь отрицательная (берут одно ИЛИ другое)',
      wrongSubs.length === 0 && CI.some(r => r.kind === 'subs'),
      wrongSubs.length ? wrongSubs.length + ' пар выше ' + ST.subs_max : CI.filter(r => r.kind === 'subs').length + ' пар с lift<=' + ST.subs_max, 'есть и все ниже порога');
  const thin = CI.filter(r => r.cnt < ST.cnt_min);
  add('Кросс-продажи: пара не тоньше порога по чекам', thin.length === 0,
      thin.length ? thin.length + ' пар тоньше ' + ST.cnt_min : 'минимум ' + Math.min.apply(null, CI.map(r => r.cnt)) + ' чеков', '0');

  // Таблица на «Аналитике» должна показывать РОВНО выбранный тип и переключаться.
  const seen = {};
  for (const k of KINDS) {
    try {
      w.eval(`${CLEAR}S.xKind='${k}';S.tab='analytics';render();`);
      const tb = w.document.getElementById('fr_cross');
      seen[k] = tb ? tb.querySelectorAll('tbody tr').length : 0;
    } catch (e) { errors.push('кросс-таблица [' + k + ']: ' + (e.stack || e)); }
  }
  const expect = {}; KINDS.forEach(k => expect[k] = CI.filter(r => r.kind === k).length);
  const mism = KINDS.filter(k => seen[k] !== expect[k]);
  add('Кросс-продажи: переключатель типа меняет таблицу и отдаёт ровно свой тип',
      mism.length === 0, mism.length ? mism.map(k => k + ': ' + seen[k] + ' вместо ' + expect[k]).join(', ')
        : KINDS.map(k => k + ' ' + seen[k]).join(' · '), 'совпадает с данными');
  w.eval(`${CLEAR}S.xKind='cross';S.tab='overview';render();`);

  // Связки категорий: тара и одноразовая посуда должны быть вычищены тем же фильтром,
  // что и везде, иначе топ — это «Пиво + Тара», а не поведение покупателя.
  const CX = w.eval('(D.cross||[])');
  const junk = CX.filter(r => /Тара|Одноразовая|на розлив|кофемашина/i.test(r.c1 + ' ' + r.c2));
  add('Связки категорий: тара и одноразовая посуда исключены', CX.length > 0 && junk.length === 0,
      junk.length ? junk[0].c1 + ' + ' + junk[0].c2 : CX.length + ' пар, мусора нет', '0');
  const noLift = CX.filter(r => typeof r.lift !== 'number');
  add('Связки категорий: сила связи посчитана для всех пар', noLift.length === 0,
      noLift.length ? noLift.length + ' без lift' : 'lift от ' + Math.min.apply(null, CX.map(r => r.lift)) + ' до ' + Math.max.apply(null, CX.map(r => r.lift)), '0');
}

  tabsSuite(); crossSuite(); returnsSuite(); revisionSuite(); trendSuite(); supplierSuite(); reportSuite(); basketSuite();
  if (REDESIGN) redesignSuite(); else skip('Регрессии слоя редизайна', 'нет docs/redesign.js');
  featuresSuite();

  const num = v => typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v);
  let bad = 0, skipped = 0;
  console.log('');
  for (const r of results) {
    if (r.ok === 'skip') { skipped++; console.log('  --    ' + r.name.padEnd(62) + 'пропущено: ' + r.got); continue; }
    if (!r.ok) bad++;
    console.log('  ' + (r.ok ? 'OK  ' : 'FAIL') + '  ' + r.name.padEnd(62) +
      num(r.got) + (r.ok ? '' : '   (ожидалось ' + num(r.exp) + ')'));
  }
  if (errors.length) {
    console.log('\n  Рантайм-ошибки:');
    errors.slice(0, 15).forEach(e => console.log('    ' + e));
  }
  console.log('\n  Проверок: ' + results.length + ' · провалено: ' + bad +
    ' · пропущено: ' + skipped + ' · рантайм-ошибок: ' + errors.length);
  // 1 — есть реальные провалы; 3 — провалов нет, но данные устарели и проверено не всё
  process.exit(bad || errors.length ? 1 : (stale ? 3 : 0));
}, 1200);
