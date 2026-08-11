# -*- coding: utf-8 -*-
"""Товары без движения.
Остаток        : family_market.turnover_monthly (end_qty / end_cost)
Последняя продажа: family_market.turnover_transactions (реальные даты чеков)
Поставщик      : family_market.incoming_transactions (юрлицо последнего прихода)
"""
import os, json, calendar, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.path.join(
    ROOT, "credentials", "family-market-analytics-23fbcbcee571c.json")
if not os.path.exists(KEY):
    raise SystemExit("Не найден ключ сервисного аккаунта: " + KEY)

OUT      = os.environ.get("OUT_PATH") or os.path.join(ROOT, "docs", "stale.json")
LOOKBACK = int(os.environ.get("STALE_LOOKBACK", "12"))   # окно поиска продаж, мес.
MIN_D    = int(os.environ.get("STALE_MIN_DAYS", "3"))    # минимум дней без продаж
STOCK_YM = os.environ.get("STOCK_YM", "").strip()

creds = service_account.Credentials.from_service_account_file(KEY)
bq = bigquery.Client(credentials=creds, project=creds.project_id, location="EU")

PROJ = "family-market-analytics"
DS   = "family_market"
TM   = "`%s.%s.turnover_monthly`" % (PROJ, DS)
INC  = "`%s.%s.incoming_transactions`" % (PROJ, DS)
TT   = "`%s.%s.turnover_transactions`" % (PROJ, DS)

K = {"barcode": "b", "name": "p", "cat": "c", "sup": "s", "shop": "st",
     "qty": "q", "val": "v", "days": "d", "last": "last", "last_in": "last_in"}

# --- период остатков ----------------------------------------------------
if STOCK_YM:
    Y, M = int(STOCK_YM[:4]), int(STOCK_YM[5:7])
else:
    r = list(bq.query("SELECT year y, month m FROM %s WHERE end_qty>0 "
                      "GROUP BY y,m ORDER BY y DESC,m DESC LIMIT 1" % TM).result())[0]
    Y, M = int(r.y), int(r.m)
print("Период остатков: %04d-%02d | окно продаж %d мес. | порог %d дн." % (Y, M, LOOKBACK, MIN_D))

# --- автоопределение колонок в turnover_transactions --------------------
tt = bq.get_table("%s.%s.turnover_transactions" % (PROJ, DS))
COLS = dict((f.name.lower(), f.field_type) for f in tt.schema)


def pick(names, types=None):
    for n in names:
        if n in COLS and (types is None or COLS[n] in types):
            return n
    if types:
        for n, t in COLS.items():
            if t in types:
                return n
    return None


T_BC  = pick(["barcode", "bar_code", "ean"])
T_ST  = pick(["store", "shop", "store_name", "shop_name"])
T_DT  = pick(["sale_date", "doc_date", "date", "receipt_date", "check_date",
              "sale_datetime", "transaction_date", "datetime"],
             ("DATE", "DATETIME", "TIMESTAMP"))
T_QTY = pick(["quantity", "qty", "sales_qty", "kolvo"])
print("turnover_transactions: штрихкод=%s | магазин=%s | дата=%s | кол-во=%s" % (T_BC, T_ST, T_DT, T_QTY))
if not (T_BC and T_ST and T_DT):
    raise SystemExit("Не найдены нужные колонки в turnover_transactions: " + ", ".join(sorted(COLS)))

# --- нормализация названий магазинов ------------------------------------
NORM = {
    "Полевая 83": "Полевая-Опт", "Полевая, 83": "Полевая-Опт",
    "Полевая,83": "Полевая-Опт", "Полевая-83": "Полевая-Опт",
    "Полевая-Магазин": "Полевая-Опт", "Полевая-Склад": "Полевая-Опт",
    "Героїв Сталінграду 163А": "Байрона 163", "Героїв Сталінграда 163А": "Байрона 163",
    "Героїв Сталінграду 156": "Байрона 156", "Героїв Сталінграда 156": "Байрона 156",
    "Героїв Сталінграду 138/1": "Байрона 138/1", "Героїв Сталінграда 138/1": "Байрона 138/1",
}
EXCLUDE_L = ["Магазины-Просрок", "Полевая-Просрок", "Производство",
             "Склад резерва Кулинария Семенка"]


def _q(s):
    return "'" + s.replace("'", "\\'") + "'"


EXCLUDE = ",".join(_q(x) for x in EXCLUDE_L)


def nstore(col="store"):
    p = ["CASE TRIM(CAST(%s AS STRING))" % col]
    for k, v in NORM.items():
        p.append("WHEN %s THEN %s" % (_q(k), _q(v)))
    p.append("ELSE TRIM(CAST(%s AS STRING)) END" % col)
    return " ".join(p)


QFLT = ("AND %s > 0" % T_QTY) if T_QTY else ""

SQL = """
WITH stock AS (
  SELECT {nst} AS store,
         TRIM(CAST(barcode AS STRING)) AS bc,
         product_name AS nm,
         ANY_VALUE(category) AS cat,
         SUM(end_qty)  AS q,
         SUM(end_cost) AS v
  FROM {tm}
  WHERE year=@y AND month=@m AND end_qty>0
    AND TRIM(CAST(store AS STRING)) NOT IN ({ex})
    AND NOT REGEXP_CONTAINS(TRIM(CAST(store AS STRING)), r'^-?[0-9]')
  GROUP BY 1,2,3
  HAVING SUM(end_qty) > 0
),
inc AS (
  SELECT {ninc} AS st,
         TRIM(CAST(barcode AS STRING))  AS bc,
         TRIM(CAST(supplier AS STRING)) AS sup,
         doc_date AS dt
  FROM {inc}
  WHERE supplier IS NOT NULL AND TRIM(CAST(supplier AS STRING)) != ''
    AND barcode  IS NOT NULL AND TRIM(CAST(barcode  AS STRING)) != ''
),
sup_store AS (
  SELECT st, bc, ARRAY_AGG(sup ORDER BY dt DESC LIMIT 1)[OFFSET(0)] AS sup
  FROM inc GROUP BY 1,2
),
sup_any AS (
  SELECT bc, ARRAY_AGG(sup ORDER BY dt DESC LIMIT 1)[OFFSET(0)] AS sup
  FROM inc GROUP BY 1
),
inc_last AS (
  SELECT st, bc, MAX(dt) AS last_in FROM inc GROUP BY 1,2
),
mv AS (
  SELECT {ntt} AS store,
         TRIM(CAST({tbc} AS STRING)) AS bc,
         MAX(DATE({tdt})) AS last_sale
  FROM {tt}
  WHERE DATE({tdt}) BETWEEN DATE_SUB(@asof, INTERVAL @lb MONTH) AND @asof
    {qflt}
  GROUP BY 1,2
)
SELECT s.store, s.bc, s.nm, s.cat, s.q, s.v,
       COALESCE(ss.sup, sa.sup, '(нет в приходах)') AS sup,
       m.last_sale, il.last_in,
       IF(m.last_sale IS NULL, 999, DATE_DIFF(@asof, m.last_sale, DAY)) AS idle
FROM stock s
LEFT JOIN sup_store ss ON ss.st = s.store AND ss.bc = s.bc
LEFT JOIN sup_any   sa ON sa.bc = s.bc
LEFT JOIN mv        m  ON m.store = s.store AND m.bc = s.bc
LEFT JOIN inc_last  il ON il.st = s.store AND il.bc = s.bc
WHERE IF(m.last_sale IS NULL, 999, DATE_DIFF(@asof, m.last_sale, DAY)) >= @mind
ORDER BY s.v DESC
""".format(tm=TM, inc=INC, tt=TT, ex=EXCLUDE, qflt=QFLT,
           nst=nstore(), ninc=nstore(), ntt=nstore(T_ST),
           tbc=T_BC, tdt=T_DT)

today = datetime.date.today()
as_of = today if (today.year == Y and today.month == M) \
        else datetime.date(Y, M, calendar.monthrange(Y, M)[1])

job = bq.query(SQL, job_config=bigquery.QueryJobConfig(query_parameters=[
    bigquery.ScalarQueryParameter("y", "INT64", Y),
    bigquery.ScalarQueryParameter("m", "INT64", M),
    bigquery.ScalarQueryParameter("asof", "DATE", as_of),
    bigquery.ScalarQueryParameter("lb", "INT64", LOOKBACK),
    bigquery.ScalarQueryParameter("mind", "INT64", MIN_D),
]))

# --- технические товары (зеркало TECH_SUB в docs/index.html) ------------
TECH_SUB = ["кава зернова", "зернова кава", "кава в зернах", "сухе молоко (1кг)",
            "капучино (1кг)", "капучіно (1кг)", "лате (1кг)", "латте (1кг)",
            "какао (1кг)", "еспресо (1кг)", "айріш капучино", "стакан паперов",
            "стакан пластик", "стакан гофр", "паперовий стакан", "пластиковий стакан",
            "гофр.стакан", "гофр стакан", "кришка для", "кришка біла", "розмішувач",
            "мішалка для", "стірер", "булка для хот", "булочка для хот", "пакет фасув"]


def is_tech(name):
    n = (name or "").lower()
    if any(k in n for k in TECH_SUB):
        return 1
    if ("сосиск" in n or "сардель" in n) and ("1кг" in n or "мк " in n):
        return 1
    return 0


def clean_bc(s):
    s = (s or "").strip()
    return s[:-2] if s.endswith(".0") else s


rows = []
for r in job.result():
    nm = (r.nm or "").strip()
    rows.append({
        K["barcode"]: clean_bc(r.bc),
        K["name"]:    nm,
        K["cat"]:     (r.cat or "").strip() or "(нет в матрице)",
        K["sup"]:     (r.sup or "").strip() or "(нет в приходах)",
        K["shop"]:    (r.store or "").strip(),
        K["qty"]:     round(float(r.q or 0), 3),
        K["val"]:     round(float(r.v or 0), 2),
        K["days"]:    int(r.idle or 0),
        K["last"]:    r.last_sale.isoformat() if r.last_sale else "—",
        K["last_in"]: r.last_in.isoformat() if r.last_in else "—",
        "t":          is_tech(nm),
    })

print("Строк: %d | сумма: %.0f | поставщиков: %d | технических: %d | нет продаж: %d" % (
    len(rows), sum(x[K["val"]] for x in rows), len(set(x[K["sup"]] for x in rows)),
    sum(x["t"] for x in rows), sum(1 for x in rows if x[K["days"]] >= 999)))
print("Магазины:", ", ".join(sorted(set(x[K["shop"]] for x in rows))))

payload = {"as_of": as_of.isoformat(), "rows": rows}
if os.path.exists(OUT):
    try:
        with open(OUT, "r", encoding="utf-8") as f:
            old = json.load(f)
        if isinstance(old, dict):
            payload = dict(old)
            rk = next((k for k, v in old.items() if isinstance(v, list)), "rows")
            payload[rk] = rows
            for k in ("as_of", "asOf", "date", "generated_at"):
                if k in payload:
                    payload[k] = as_of.isoformat()
    except Exception as e:
        print("Старый файл не разобран:", str(e)[:120])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
print("Записано:", OUT, "| as_of:", as_of.isoformat())
