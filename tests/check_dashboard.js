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
    const chart = () => ({ setOption(){}, on(){}, off(){}, resize(){}, dispose(){},
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
    const alien = [...names].filter(n => !canon.has(n) && !SERVICE.has(n));
    add('stale.json: имена точек совпадают с full_data.stores',
        alien.length === 0, alien.slice(0, 6).join(', ') || '—', '—');
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

  tabsSuite(); crossSuite(); returnsSuite(); revisionSuite();
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
