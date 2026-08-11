# -*- coding: utf-8 -*-
import os, re, json, glob
from datetime import date
from google.cloud import bigquery

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRED = r"D:\Family_Market_Analytics\credentials\family-market-analytics-23fbcbcee571c.json"
if os.path.exists(CRED): os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', CRED)
else:
    c = glob.glob(os.path.join(ROOT, 'credentials', '*.json'))
    if c: os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', c[0])

DS   = 'family-market-analytics.family_market'
OUT  = os.path.join(ROOT, 'docs', 'stale.json')
MON  = int(os.environ.get('STALE_MONTHS', '12'))     # окно поиска продаж
MIN_D= int(os.environ.get('STALE_MIN_DAYS', '3'))    # минимум дней без продаж

NORM = {
    'Полевая 83': 'Полевая-Магазин', 'Полевая, 83': 'Полевая-Магазин',
    'Героїв Сталінграда 138/1': 'Байрона 138/1',
    'Героїв Сталінграду 138/1': 'Байрона 138/1',
    'Героїв Сталінграду 156': 'Байрона 156',
    'Героїв Сталінграду 163А': 'Байрона 163',
    'Героїв Сталінграда 163А': 'Байрона 163',
}
TECH = ['пакет', 'плівка', 'пленка', 'стрейч', 'етикет', 'этикет', 'ценник', 'цінник',
        'скотч', 'лоток', 'контейнер', 'рукав', 'мішк', 'мешк', 'перчатк', 'рукавич',
        'серветк', 'салфетк', 'форма для', 'підклад', 'подлож']

cl = bigquery.Client()

def cols(t):
    return [f.name for f in cl.get_table(f'{DS}.{t}').schema]

def pick(names, *cands):
    low = {n.lower(): n for n in names}
    for c in cands:
        if c in low: return low[c]
    for c in cands:
        for n in names:
            if c in n.lower(): return n
    return None

tt, ic = cols('turnover_transactions'), cols('incoming_transactions')
T_BC = pick(tt, 'barcode'); T_ST = pick(tt, 'store', 'shop')
T_DT = pick(tt, 'date', 'transaction_date', 'sale_date', 'doc_date', 'operation_date', 'dt')
I_BC = pick(ic, 'barcode'); I_SUP = pick(ic, 'supplier', 'постач')
I_DT = pick(ic, 'date', 'incoming_date', 'doc_date', 'transaction_date', 'dt')
print(f'продажи: {T_BC}/{T_ST}/{T_DT}   приходы: {I_BC}/{I_SUP}/{I_DT}')

def sql_norm(col):
    s = col
    for k, v in NORM.items():
        s = f"IF(TRIM({s})='{k}','{v}',{s})"
    return f'TRIM({s})'

SNAP = os.environ.get('STOCK_DATE')
snap = SNAP or list(cl.query(
    f'SELECT CAST(MAX(snapshot_date) AS STRING) d FROM `{DS}.stock_matrix`'))[0].d
print('снимок остатков: ' + snap)

q = f"""
WITH st AS (
  SELECT CAST(barcode AS STRING) bc, {sql_norm('store')} store,
         ANY_VALUE(product_name) nm, SUM(quantity) qty,
         SUM(quantity * COALESCE(cost_price, 0)) val
  FROM `{DS}.stock_matrix`
  WHERE snapshot_date = DATE'{snap}' AND quantity > 0
  GROUP BY bc, store
),
sl AS (
  SELECT CAST({T_BC} AS STRING) bc, {sql_norm(T_ST)} store,
         MAX(DATE({T_DT})) last_sale
  FROM `{DS}.turnover_transactions`
  WHERE DATE({T_DT}) BETWEEN DATE_SUB(DATE'{snap}', INTERVAL {MON} MONTH) AND DATE'{snap}'
  GROUP BY bc, store
),
inc AS (
  SELECT bc, sup, last_in FROM (
    SELECT CAST({I_BC} AS STRING) bc, {I_SUP} sup, DATE({I_DT}) last_in,
           ROW_NUMBER() OVER (PARTITION BY CAST({I_BC} AS STRING)
                              ORDER BY DATE({I_DT}) DESC) rn
    FROM `{DS}.incoming_transactions`
    WHERE {I_SUP} IS NOT NULL AND TRIM({I_SUP}) != ''
  ) WHERE rn = 1
)
SELECT st.bc, st.nm, st.store, ROUND(st.qty,2) qty, ROUND(st.val,2) val,
       CAST(sl.last_sale AS STRING) last_sale,
       COALESCE(inc.sup,'(нет поставщика)') sup,
       CAST(inc.last_in AS STRING) last_in,
       IFNULL(DATE_DIFF(DATE'{snap}', sl.last_sale, DAY), 999) d
FROM st
LEFT JOIN sl  ON sl.bc = st.bc AND sl.store = st.store
LEFT JOIN inc ON inc.bc = st.bc
WHERE IFNULL(DATE_DIFF(DATE'{snap}', sl.last_sale, DAY), 999) >= {MIN_D}
"""

rows = []
for r in cl.query(q):
    nm = r.nm or ''
    rows.append({'b': r.bc, 'p': nm, 'c': '(нет в матрице)', 's': r.sup, 'st': r.store,
                 'q': float(r.qty), 'v': float(r.val),
                 'd': int(r.d), 'last': r.last_sale or '—', 'last_in': r.last_in or '—',
                 't': 1 if any(w in nm.lower() for w in TECH) else 0})
rows.sort(key=lambda x: -x['v'])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({'rows': rows, 'as_of': snap, 'updated_at': str(date.today())},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)

sup = len({r['s'] for r in rows}); nosup = sum(1 for r in rows if r['s'] == '(нет поставщика)')
print('строк=%d  сумма=%.0f  поставщиков=%d  без поставщика=%d  магазинов=%d  тех=%d'
      % (len(rows), sum(r['v'] for r in rows), sup, nosup,
         len({r['st'] for r in rows}), sum(r['t'] for r in rows)))
print('магазины: ' + ', '.join(sorted({r['st'] for r in rows})))
