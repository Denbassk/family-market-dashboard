# -*- coding: utf-8 -*-
import os, re, sys, glob
import pandas as pd
from datetime import datetime
from google.cloud import bigquery

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDER = os.path.join(ROOT, 'reports_stock')
os.makedirs(FOLDER, exist_ok=True)

CRED = r"D:\Family_Market_Analytics\credentials\family-market-analytics-23fbcbcee571c.json"
if os.path.exists(CRED):
    os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', CRED)
else:
    c = glob.glob(os.path.join(ROOT, 'credentials', '*.json'))
    if c: os.environ.setdefault('GOOGLE_APPLICATION_CREDENTIALS', c[0])

TABLE = 'family-market-analytics.family_market.stock_matrix'
SKIP = ['просрок', 'резерв', 'в пути', 'производство']

# ---- выбор файла ----
path = sys.argv[1] if len(sys.argv) > 1 else None
if not path:
    try:
        import tkinter as tk
        from tkinter import filedialog
        r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)
        path = filedialog.askopenfilename(title='Выберите отчёт "Состояние склада"',
                initialdir=FOLDER, filetypes=[('Excel', '*.xlsx *.xls'), ('Все файлы', '*.*')])
        r.destroy()
    except Exception as e:
        print('Проводник недоступен: %s' % e)
if not path:
    f = sorted(glob.glob(os.path.join(FOLDER, '*.xls*')), key=os.path.getmtime)
    if not f: print('Файл не выбран, в reports_stock пусто.'); sys.exit(1)
    path = f[-1]; print('Взят последний файл: ' + os.path.basename(path))

# ---- дата снимка ----
def ymd(name):
    m = re.search(r'(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{4})', name)
    if m: return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1))).date()
    m = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', name)
    if m: return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()
    return None

d = ymd(os.path.basename(path))
if not d:
    v = input('Дата в имени не найдена. Введите дату снимка ДД.ММ.ГГГГ: ').strip()
    d = ymd(v)
    if not d: print('Дата не распознана.'); sys.exit(1)

print('\nФайл: ' + os.path.basename(path))
print('Дата снимка: %s' % d)

# ---- чтение (2 строки шапки отчёта, заголовки в 3-й) ----
df = pd.read_excel(path, skiprows=2)
df.columns = [str(c).strip() for c in df.columns]
print('Колонки: ' + ', '.join(df.columns[:12]))

def col(*keys):
    for c in df.columns:
        lc = c.lower()
        if all(k in lc for k in keys): return c
    return None

cb, cn = col('штрих'), col('назв')
cs = col('склад')
cq = col('кільк') or col('количест') or col('кол-во') or col('кол - во')
cr_ = col('роздр') or col('розничн') or col('роздріб')
cc = col('собівар') or col('себестоим') or col('собіварт')
ca = col('артикул')
if not (cb and cs and cq):
    print('НЕ НАЙДЕНЫ обязательные колонки. штрих=%s склад=%s кол-во=%s' % (cb, cs, cq)); sys.exit(1)

o = pd.DataFrame()
o['barcode'] = df[cb].astype(str).str.replace(r'\.0$', '', regex=True).str.strip()
o['product_name'] = df[cn].astype(str).str.strip() if cn else ''
o['store'] = df[cs].astype(str).str.strip()
o['quantity'] = pd.to_numeric(df[cq], errors='coerce')
o['price_retail'] = pd.to_numeric(df[cr_], errors='coerce') if cr_ else None
o['cost_price'] = pd.to_numeric(df[cc], errors='coerce') if cc else None
o['article'] = df[ca].astype(str).str.strip() if ca else None

n0 = len(o)
o = o[o['barcode'].str.match(r'^\d{6,14}$', na=False)]
o = o[o['quantity'] > 0]
o = o[o['store'].str.len() > 1]
drop = o['store'].str.lower().str.contains('|'.join(SKIP), na=False)
print('Отсеяно служебных складов: %d (%s)' % (drop.sum(), ', '.join(sorted(o[drop].store.unique())) or '—'))
o = o[~drop]
print('Строк: %d из %d' % (len(o), n0))

o['snapshot_date'] = d
o['source_file'] = os.path.basename(path)
o['loaded_at'] = datetime.now()
o = o.groupby(['barcode', 'store', 'snapshot_date'], as_index=False).agg(
    product_name=('product_name', 'first'), quantity=('quantity', 'sum'),
    price_retail=('price_retail', 'max'), cost_price=('cost_price', 'max'),
    article=('article', 'first'), source_file=('source_file', 'first'),
    loaded_at=('loaded_at', 'first'))
o['record_id'] = (o.barcode + '_' + o.store.str.replace(r'[ ,\'"]', '_', regex=True)
                  + '_' + o.snapshot_date.astype(str).str.replace('-', ''))

frozen = (o.quantity * o.cost_price.fillna(0)).sum()
print('\nИТОГО: штрихкодов=%d  магазинов=%d  единиц=%.0f  себестоимость=%.0f грн'
      % (o.barcode.nunique(), o.store.nunique(), o.quantity.sum(), frozen))
print('Магазины (%d): %s' % (o.store.nunique(), ', '.join(sorted(o.store.unique()))))

if input('\nГрузить в stock_matrix? (y/n): ').strip().lower() != 'y':
    print('Отменено.'); sys.exit(0)

cl = bigquery.Client()
for c_, t_ in [('cost_price', 'FLOAT64'), ('article', 'STRING')]:
    try:
        cl.query('ALTER TABLE `%s` ADD COLUMN IF NOT EXISTS %s %s' % (TABLE, c_, t_)).result()
    except Exception as e:
        print('ALTER %s: %s' % (c_, str(e).split('\n')[0][:120]))

j = cl.query("DELETE FROM `%s` WHERE snapshot_date = DATE'%s'" % (TABLE, d)); j.result()
print('Удалено старых строк за эту дату: %s' % (j.num_dml_affected_rows or 0))

cl.load_table_from_dataframe(o, TABLE,
    job_config=bigquery.LoadJobConfig(write_disposition='WRITE_APPEND')).result()
print('ЗАГРУЖЕНО: %d строк' % len(o))
