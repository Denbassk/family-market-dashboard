#!/usr/bin/env node
/**
 * КАРТА КРОСС-ФИЛЬТРОВ: что на каждой вкладке реагирует на каждый фильтр, а что нет.
 *
 *   node tests/check_crossfilter.js
 *
 * Зачем. check_dashboard.js проверяет ЧИСЛА в тех местах, где мы уже знаем, что смотреть.
 * А тут вопрос другой: «я поставил фильтр магазина — какие блоки его вообще заметили?».
 * Скрипт рендерит каждую вкладку под семью срезами и сравнивает содержимое элементов
 * (для таблиц — хэш всего текста, для графиков — данные последнего setOption) с базой
 * без фильтров. На выходе таблица: «изм» — реагирует, «—» — нет.
 *
 * ЧИТАТЬ ТАК: «—» это не всегда баг. Часть разрезов физически отсутствует в данных
 * (оборачиваемость по точкам, кросс-продажи по чекам сети, матрица ассортимента без
 * магазинов, неликвиды по поставщикам без разреза по точкам). Такие места помечены
 * на самом дашборде жёлтым бейджем в заголовке карточки (setScope в index.html).
 * Баг — это когда разрез В ДАННЫХ ЕСТЬ, а блок его игнорирует. Так были найдены:
 *   - панель алертов на «Обзоре» читала D.* целиком (2026-09-03);
 *   - catAgg() терял фильтр ABC и «скрыть технические» на быстрых ветках;
 *   - «Замороженный капитал по магазинам» показывал сеть при выбранной точке.
 *
 * Требует: npm i jsdom. Прогон ~2-4 минуты (7 срезов x 8 вкладок x полный рендер).
 */
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{JSDOM,VirtualConsole}=require('jsdom');
const H=t=>t===null?'(нет элемента)':(t===''?'':crypto.createHash('md5').update(t).digest('hex').slice(0,10)+' /'+t.length);
const ROOT=__dirname, HTML=path.join(ROOT,'docs','index.html'), DATA=path.join(ROOT,'docs','full_data.json');
let html=fs.readFileSync(HTML,'utf8').replace(/<script[^>]+src=[^>]*><\/script>/g,'');
const RD=fs.readFileSync(path.join(ROOT,'docs','redesign.js'),'utf8');
const data=JSON.parse(fs.readFileSync(DATA,'utf8'));
const vc=new VirtualConsole(); vc.on('jsdomError',()=>{}); ['log','info','warn','error','debug','dir','table','trace','group','groupEnd','groupCollapsed','count','assert','time','timeEnd','timeLog'].forEach(k=>vc.on(k,()=>{}));
const OPT={};                       // id -> сериализованные данные последнего setOption
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  const mk=id=>({setOption(o){try{OPT[id]=JSON.stringify(o&&o.series||[]).slice(0,20000);}catch(e){OPT[id]='?';}},
    on(){},off(){},resize(){},dispose(){},clear(){OPT[id]='';},getZr:()=>({on(){}}),showLoading(){},hideLoading(){}});
  w.echarts={init:(el)=>mk(el&&el.id||'?'),getInstanceByDom:()=>null,graphic:{},color:{}};
  w.ExcelJS={Workbook:function(){const sh={columns:[],addRow:()=>({font:{},fill:{},eachCell(){}}),getRow:()=>({font:{},fill:{},eachCell(){}}),eachRow(){}};this.addWorksheet=()=>sh;this.xlsx={writeBuffer:async()=>new ArrayBuffer(8)};}};
  w.fetch=u=>String(u).includes('full_data')?Promise.resolve({ok:true,json:()=>Promise.resolve(data),headers:{get:()=>'x'}}):Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({}),text:()=>Promise.resolve(''),headers:{get:()=>null}});
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  w.requestAnimationFrame=cb=>setTimeout(cb,0);
  w.onerror=(m,s,l,c,e)=>console.error('ERR',(e&&e.stack)||m);
}});
const w=dom.window;
const CLEAR="S.month='all';S.store=[];S.cat=[];S.sup=[];S.q='';S.abc='all';S.noOff=false;";
// что смотрим: [вкладка, id элемента, тип]
const TARGETS=[
 ['overview','ov_kpis','dom'],['overview','ov_dyn','chart'],['overview','ov_cat','dom'],['overview','ov_store','dom'],
 ['overview','ov_tab','dom'],['overview','ov_alerts','dom'],['overview','ov_slice','dom'],['overview','ov_retbar','dom'],
 ['report','rp_tab','dom'],['report','rp_chart','chart'],['report','rp_kpis','dom'],['report','rp_s','dom'],
 ['analytics','an_abc','chart'],['analytics','an_abc_k','dom'],['analytics','an_turn','chart'],['analytics','an_turnsup','chart'],
 ['analytics','an_margin','chart'],['analytics','an_turnstore','chart'],['analytics','an_gmroi','chart'],['analytics','an_smatrix','chart'],
 ['analytics','an_gmroi_bad','dom'],['analytics','an_cov','dom'],['analytics','an_loss','dom'],['analytics','an_loss_k','dom'],['analytics','fr_cross','dom'],
 ['products','pr_tab','dom'],['products','pr_s','dom'],
 ['stock','fr_oos','dom'],['stock','fr_kpis','dom'],['stock','gap_tab','dom'],['stock','gap_s','dom'],['stock','fr_store','chart'],['stock','fr_sup','chart'],
 ['stores','stf_tab','dom'],['stores','st_kpis2','dom'],['stores','hm_chart','chart'],['stores','hm_note','dom'],
 ['matrix','mx_tab','dom'],['matrix','mx_kpis','dom'],
 ['suppliers','sup_kpis','dom'],
];
function snap(){
  const byTab={};
  for(const t of TARGETS){(byTab[t[0]]=byTab[t[0]]||[]).push(t);}
  const out={};
  for(const tab in byTab){
    let err=null;
    try{ w.eval("S.tab='"+tab+"';render();"); }catch(e){ err='RENDER-ERROR: '+(e.message||e); }
    for(const [,id,kind] of byTab[tab]){
      if(err){out[tab+'/'+id]=err;continue;}
      if(kind==='chart') out[tab+'/'+id]=OPT[id]||'(нет)';
      else { const el=w.document.getElementById(id); out[tab+'/'+id]=el?H((el.textContent||'').replace(/\s+/g,' ').trim()):'(нет элемента)'; }
    }
  }
  return out;
}
setTimeout(()=>{
  if(!w.eval('typeof D!=="undefined" && !!D')){console.error('ДАННЫЕ НЕ ЗАГРУЗИЛИСЬ');process.exit(2);}
  const el=w.document.createElement('script'); el.textContent=RD; w.document.body.appendChild(el);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded',{bubbles:true}));
  w.eval(CLEAR);
  const base=snap();
  const CASES=[
    ['магазин (1 шт)',   "S.store=[D.stores[3]];"],
    ['магазины (3 шт)',  "S.store=D.stores.slice(0,3);"],
    ['категория',        "S.cat=[D.by_category[1].category];"],
    ['поставщик',        "S.sup=[D.by_supplier[1].supplier];"],
    ['месяц',            "S.month='5';"],
    ['ABC=A',            "S.abc='A';"],
    ['магазин+категория',"S.store=[D.stores[3]];S.cat=[D.by_category[1].category];"],
  ];
  const res={};
  for(const [name,setup] of CASES){
    w.eval(CLEAR+setup);
    const s=snap();
    res[name]={};
    for(const k in base) res[name][k]= (s[k]===base[k]) ? '—' : (String(s[k]).startsWith('RENDER-ERROR')? 'ОШИБКА':'изм');
  }
  const keys=Object.keys(base);
  const head=['элемент'].concat(CASES.map(c=>c[0]));
  console.log('\n'+head[0].padEnd(26)+'база'.padStart(14)+head.slice(1).map(h=>h.slice(0,12).padStart(14)).join(''));
  for(const k of keys){
    const b=String(base[k]);
    const st=b==='(нет элемента)'?'НЕТ ЭЛЕМЕНТА':(b===''?'пусто':(b.indexOf(' /')>0?b.split(' /')[1]+' симв':b.length+' симв'));
    console.log(k.padEnd(26)+st.padStart(14)+CASES.map(c=>res[c[0]][k].padStart(14)).join(''));
  }
},1500);
