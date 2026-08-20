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
 *   3) ВОЗВРАТЫ: аддитивность куба returns_fact по всем измерениям и охватам.
 *
 * Код возврата 1, если хоть одна проверка провалилась или был рантайм-эксепшен.
 * Зависимость одна: npm i jsdom
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

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
const add = (name, ok, got, exp) => { results.push({ name, ok: !!ok, got, exp }); };

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
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
  const tabs = ['overview','report','analytics','products','frozen','stores','moves','culinary','matrix'];
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
    var CLEAR=function(){${CLEAR}};
    var off=function(a,b){return b?Math.abs(a-b)/b*100:(a?100:0);};
    var wpRev=function(){return workProducts().reduce(function(s,p){return s+(+p.rev||0);},0);};
    var byStore={}; D.by_store.forEach(function(r){byStore[r.store]=r.revenue;});
    var s1=(T.s1||D.stores[0]), s2=(T.s2||D.stores[1]);
    var push=function(n,ok,g,e){out.push([n,!!ok,g,e]);};

    CLEAR(); S.store=[s1];
    push('Позиции: один магазин == by_store', off(wpRev(),byStore[s1])<0.05, Math.round(wpRev()), byStore[s1]);

    CLEAR(); S.store=[s1,s2];
    var two=wpRev(), ref2=byStore[s1]+byStore[s2];
    push('Позиции: два магазина == сумма by_store', off(two,ref2)<0.05, Math.round(two), ref2);
    push('Позиции: два магазина НЕ равны всей сети', Math.abs(two-D.kpi.revenue)>1000, Math.round(two), D.kpi.revenue);
    var k=kpiNow();
    push('KPI: два магазина == сумма by_store', off(k.revenue,ref2)<0.05, k.revenue, ref2);
    push('KPI: два магазина помечен как точный срез', k.exact===true, k.exact, true);
    var rec=D.by_store.filter(function(r){return r.store===s1||r.store===s2;})
                      .reduce(function(a,r){return a+(r.receipts||0);},0);
    push('KPI: чеки по магазинам складываются', k.receipts===rec, k.receipts, rec);

    CLEAR(); var all=0; D.stores.forEach(function(s){S.store=[s];all+=wpRev();});
    CLEAR();
    push('Позиции: сумма по всем точкам == выручка сети', off(all,D.kpi.revenue)<0.05, Math.round(all), D.kpi.revenue);

    CLEAR(); S.store=[s1];
    var ca=catAgg().reduce(function(a,r){return a+r.revenue;},0);
    push('Категории: при выбранном магазине == by_store', off(ca,byStore[s1])<0.05, Math.round(ca), byStore[s1]);

    CLEAR(); var c2=[D.by_category[0].category,D.by_category[1].category];
    var one=0; c2.forEach(function(c){S.cat=[c];one+=kpiNow().revenue;});
    S.cat=c2; var many=kpiNow().revenue;
    push('KPI: мультивыбор категорий аддитивен', off(one,many)<0.05, Math.round(many), Math.round(one));
    push('KPI: чеки по двум категориям скрыты (не складываются)', kpiNow().receipts===undefined, kpiNow().receipts, undefined);
    CLEAR();

    if(D.prod_store&&D.stores){
      var acc={}; D.prod_store.forEach(function(r){var s=D.stores[r[1]];acc[s]=(acc[s]||0)+r[2];});
      var worst=0,wn='';
      Object.keys(byStore).forEach(function(s){var d=off(acc[s]||0,byStore[s]);if(d>worst){worst=d;wn=s;}});
      push('Куб prod_store == by_store по всем точкам (макс. '+worst.toFixed(3)+'% · '+wn+')', worst<0.05, +worst.toFixed(3), 0);
    }

    if(has){
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
    }
    CLEAR();
    return out;
  })()`);
  rows.forEach(([n, ok, g, e]) => add(n, ok, g, e));
  if (!truth) add('Сверка с BigQuery пропущена (нет tests/truth.json)', true, 'skip', 'skip');
}

function returnsSuite() {
  if (!w.eval('!!(D.returns_fact&&D.returns_dim)')) {
    add('Возвраты: данных нет — пересоберите full_data.json', false, 'нет returns_fact', 'есть');
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
  tabsSuite(); crossSuite(); returnsSuite();

  const num = v => typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v);
  let bad = 0;
  console.log('');
  for (const r of results) {
    if (!r.ok) bad++;
    console.log('  ' + (r.ok ? 'OK  ' : 'FAIL') + '  ' + r.name.padEnd(62) +
      num(r.got) + (r.ok ? '' : '   (ожидалось ' + num(r.exp) + ')'));
  }
  if (errors.length) {
    console.log('\n  Рантайм-ошибки:');
    errors.slice(0, 15).forEach(e => console.log('    ' + e));
  }
  console.log('\n  Проверок: ' + results.length + ' · провалено: ' + bad +
    ' · рантайм-ошибок: ' + errors.length);
  process.exit(bad || errors.length ? 1 : 0);
}, 1200);
