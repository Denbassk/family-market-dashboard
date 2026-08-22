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
const html = fs.readFileSync(HTML, 'utf8').replace(/<script[^>]+src=[^>]*><\/script>/g, '');
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

setTimeout(() => {
  if (!w.eval('typeof D!=="undefined" && !!D')) { console.error('ДАННЫЕ НЕ ЗАГРУЗИЛИСЬ'); process.exit(2); }

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
