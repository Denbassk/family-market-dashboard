# -*- coding: utf-8 -*-
"""Товары без движения.
Остатки  : family_market.turnover_monthly (end_qty / end_cost)
Поставщик: family_market.incoming_transactions (юрлицо из последнего прихода)
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
LOOKBACK = int(os.environ.get("STALE_LOOKBACK", "12"))
MIN_M    = int(os.environ.get("STALE_MIN_MONTHS", "2"))
STOCK_YM = os.environ.get("STOCK_YM", "").strip()

creds = service_account.Credentials.from_service_account_file(KEY)
bq = bigquery.Client(credentials=creds, project=creds.project_id, location="EU")

TM  = "`family-market-analytics.family_market.turnover_monthly`"
INC = "`family-market-analytics.family_market.incoming_transactions`"

K = {"barcode": "b", "name": "p", "cat": "c", "sup": "s", "shop": "st",
     "qty": "q", "val": "v", "days": "d", "last": "last", "last_in": "last_in"}

if STOCK_YM:
    Y, M = int(STOCK_YM[:4]), int(STOCK_YM[5:7])
else:
    r = list(bq.query("SELECT year y, month m FROM %s WHERE end_qty>0 "
                      "GROUP BY y,m ORDER BY y DESC,m DESC LIMIT 1" % TM).result())[0]
    Y, M = int(r.y), int(r.m)
CUR = Y * 12 + M
print("Период остатков: %04d-%02d | окно продаж %d мес. | порог %d мес." % (Y, M, LOOKBACK, MIN_M))

# --- нормализация названий магазинов -------------------------------------
NORM = {
    "Полевая 83": "Полевая-Опт",
    "Полевая, 83": "Полевая-Опт",
    "Полевая,83": "Полевая-Опт",
    "Полевая-83": "Полевая-Опт",
    "Полевая-Магазин": "Полевая-Опт",
    "Полевая-Склад": "Полевая-Опт",
    "Героїв Сталінграду 163А": "Байрона 163",
    "Героїв Сталінграда 163А": "Байрона 163",
    "Героїв Сталінграду 156": "Байрона 156",
    "Героїв Сталінграда 156": "Байрона 156",
    "Героїв Сталінграду 138/1": "Байрона 138/1",
    "Героїв Сталінграда 138/1": "Байрона 138/1",
}
EXCLUDE_L = ["Магазины-Просрок", "Полевая-Просрок", "Производство",
             "Склад резерва Кулинария Семенка"]


def _q(s):
    return "'" + s.replace("'", "\\'") + "'"


EXCLUDE = ",".join(_q(x) for x in EXCLUDE_L)


def nstore():
    parts = ["CASE TRIM(CAST(store AS STRING))"]
    for k, v in NORM.items():
        parts.append("WHEN %s THEN %s" % (_q(k), _q(v)))
    parts.append("ELSE TRIM(CAST(store AS STRING)) END")
    return " ".join(parts)


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
mv AS (
  SELECT {nmv} AS store,
         TRIM(CAST(barcode AS STRING)) AS bc,
         product_name AS nm,
         MAX(IF(sales_qty>0, year*12+month, NULL))       AS last_sale,
         MAX(IF(transfer_in_qty>0, year*12+month, NULL)) AS last_in
  FROM {tm}
  WHERE year*12+month BETWEEN @cur-@lb AND @cur
  GROUP BY 1,2,3
)
SELECT s.store, s.bc, s.nm, s.cat, s.q, s.v,
       COALESCE(ss.sup, sa.sup, '(нет в приходах)') AS sup,
       m.last_sale, m.last_in,
       @cur - IFNULL(m.last_sale, @cur-@lb-1) AS idle
FROM stock s
LEFT JOIN sup_store ss ON ss.st = s.store AND ss.bc = s.bc
LEFT JOIN sup_any   sa ON sa.bc = s.bc
LEFT JOIN mv        m  ON m.store = s.store AND m.bc = s.bc AND m.nm = s.nm
WHERE @cur - IFNULL(m.last_sale, @cur-@lb-1) >= @minm
ORDER BY s.v DESC
""".format(tm=TM, inc=INC, ex=EXCLUDE, nst=nstore(), nmv=nstore(), ninc=nstore())

job = bq.query(SQL, job_config=bigquery.QueryJobConfig(query_parameters=[
    bigquery.ScalarQueryParameter("y", "INT64", Y),
    bigquery.ScalarQueryParameter("m", "INT64", M),
    bigquery.ScalarQueryParameter("cur", "INT64", CUR),
    bigquery.ScalarQueryParameter("lb", "INT64", LOOKBACK),
    bigquery.ScalarQueryParameter("minm", "INT64", MIN_M),
]))

today = datetime.date.today()
as_of = today.isoformat() if (today.year == Y and today.month == M) \
        else "%04d-%02d-%02d" % (Y, M, calendar.monthrange(Y, M)[1])


def ym2date(v):
    if not v:
        return ""
    y, m = int(v) // 12, int(v) % 12
    if m == 0:
        y, m = y - 1, 12
    return "%04d-%02d-%02d" % (y, m, calendar.monthrange(y, m)[1])


def clean_bc(s):
    s = (s or "").strip()
    return s[:-2] if s.endswith(".0") else s


rows = []
for r in job.result():
    idle = int(r.idle or 0)
    has_sale = bool(r.last_sale)
    rows.append({
        K["barcode"]: clean_bc(r.bc),
        K["name"]:    (r.nm or "").strip(),
        K["cat"]:     (r.cat or "").strip() or "(нет в матрице)",
        K["sup"]:     (r.sup or "").strip() or "(нет в приходах)",
        K["shop"]:    (r.store or "").strip(),
        K["qty"]:     round(float(r.q or 0), 3),
        K["val"]:     round(float(r.v or 0), 2),
        K["days"]:    (idle * 30) if has_sale else 999,
        K["last"]:    ym2date(r.last_sale) if has_sale else "—",
        K["last_in"]: ym2date(r.last_in) if r.last_in else "—",
        "t":          1,
    })

no_sup = sum(1 for x in rows if x[K["sup"]] == "(нет в приходах)")
print("Строк: %d | сумма: %.0f | поставщиков: %d | без поставщика: %d" % (
    len(rows), sum(x[K["val"]] for x in rows),
    len(set(x[K["sup"]] for x in rows)), no_sup))
print("Магазины:", ", ".join(sorted(set(x[K["shop"]] for x in rows))))

payload = rows
if os.path.exists(OUT):
    try:
        with open(OUT, "r", encoding="utf-8") as f:
            old = json.load(f)
        if isinstance(old, dict):
            rk = next((k for k, v in old.items() if isinstance(v, list)), None)
            if rk:
                payload = dict(old)
                payload[rk] = rows
                for k in ("as_of", "asOf", "date", "generated_at"):
                    if k in payload:
                        payload[k] = as_of
    except Exception as e:
        print("Старый файл не разобран:", str(e)[:120])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
print("Записано:", OUT, "| as_of:", as_of)
