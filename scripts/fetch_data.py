#!/usr/bin/env python3
"""Сбор данных для дашборда Family Market.
ВАЖНО: категория и поставщик берутся ТОЛЬКО из assortment_matrix_full (актуальная матрица) по штрих-коду.
Товары вне матрицы -> категория «Прочее (нет в матрице)», поставщик «(нет в матрице)».

ЦЕНА ЗАПРОСОВ (переделано 2026-09-03). Раньше каждый из ~28 агрегатов заново читал всю
промежуточную таблицу _dash_tx26 — 4,24 млн строк, 943 МБ, из которых 777 МБ (82%) это
повторяющиеся СТРОКИ: product_name 231 МБ, tid 175 МБ, category 123 МБ, store 111 МБ.
Одна сборка стоила 19-21 ГБ при бесплатном лимите BigQuery 1 ТБ в месяц.

Теперь после промежуточной таблицы делается ДВА прохода, и дальше всё считается по
маленьким витринам:
  _dash_a26 - агрегат (месяц x магазин x штрих-код), ~0,5 млн строк вместо 4,24 млн.
              Отсюда берутся все суммы: выручка, прибыль, количество, COUNT(DISTINCT
              barcode/store/category). Один запрос читает десятки мегабайт вместо 400-600.
  _dash_r26 - чеки. COUNT(DISTINCT tid) не складывается, поэтому все нужные разрезы
              считаются ОДНИМ запросом через GROUPING SETS: итог, месяц, категория,
              магазин, поставщик, их помесячные пары, тепловая карта (магазин x день x
              час) и кулинария. Раньше на это уходило 8 полных сканов таблицы.
Тепловая карта тоже переехала сюда: раньше она отдельно читала turnover_transactions
(ещё ~0,9 ГБ), хотя те же чеки уже лежат в промежуточной таблице.

Отключить пересборку витрин: SKIP_STAGING=1 (тогда используются вчерашние _dash_*).
"""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from domain import NORM, WHOLESALE, sql_case, sql_keep  # единый источник имён точек, см. scripts/domain.py

YEAR = int(os.environ.get("REPORT_YEAR", 2026))
OUT  = os.environ.get("OUT_PATH", os.path.join(os.path.dirname(__file__), "..", "docs", "full_data.json"))



TT = "`family-market-analytics.family_market.turnover_transactions`"
MX = "`family-market-analytics.family_market.assortment_matrix_full`"
TM = "`family-market-analytics.family_market.turnover_monthly`"
ST = "`family-market-analytics.family_market._dash_tx26`"
AG = "`family-market-analytics.family_market._dash_a26`"
RC = "`family-market-analytics.family_market._dash_r26`"

# Условие «собственное производство» (кулинария + выпечка, без опта). Раньше повторялось
# текстом в шести запросах и каждый раз заставляло читать product_name (231 МБ).
# Теперь считается один раз при сборке промежуточной таблицы и лежит колонкой cul.
CUL_SQL = ("(STARTS_WITH(TRIM(product_name),'Випічка') OR STARTS_WITH(TRIM(product_name),'Кулінарія'))"
           " AND store!='Полевая магазин'")


def _reorder(d, order):
    """Порядок ключей в JSON должен остаться прежним: конструктор отчётов на фронте
    строит колонки по порядку полей объекта."""
    vals = {k: d.pop(k) for k in order if k in d}
    rest = dict(d)
    d.clear(); d.update(vals); d.update(rest)


def main():
    creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
    client = bigquery.Client(credentials=creds, project=creds.project_id)
    cases = sql_case()
    keep = sql_keep()

    # 1) промежуточная таблица: продажи YEAR в 38 точках + категория/поставщик из матрицы
    #
    # ЕДИНАЯ категория/поставщик НА НАЗВАНИЕ ТОВАРА. У одного товара часто два штрих-кода
    # (штучный и упаковка/перекодировка), и в матрице лежит только один из них. Тогда часть
    # выручки одной и той же позиции уезжала в «(нет в матрице)», а срезы переставали биться:
    # `products` берёт категорию через ANY_VALUE по названию, а `by_category` считает по строкам.
    # Замер: 50 названий из 4 364 имели больше одной категории/поставщика — 6,67 млн ₴ (2,3% выручки).
    # Решение: вес = выручка ТОЛЬКО матричных штрих-кодов, поэтому вариант, найденный в матрице,
    # всегда побеждает; если товара нет в матрице ни под одним кодом — остаётся «нет в матрице».
    #
    # rev/gp считаются здесь, а не в каждом запросе: pr и pp дальше не нужны никому,
    # а две колонки читаются дешевле трёх. dow/hr — для тепловой карты (см. шапку файла).
    if not os.environ.get("SKIP_STAGING"):
      client.query(f"""
    CREATE OR REPLACE TABLE {ST}
    PARTITION BY d
    CLUSTER BY store, category, barcode
    AS
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
    raw AS (
      SELECT CASE {cases} END AS store, t.barcode, t.product_name,
        t.quantity qty, t.price_retail pr, t.price_purchase pp,
        EXTRACT(MONTH FROM t.transaction_datetime) mo, t.transaction_id tid,
        DATE(t.transaction_datetime) d,
        EXTRACT(DAYOFWEEK FROM t.transaction_datetime) dow,
        EXTRACT(HOUR FROM t.transaction_datetime) hr,
        CASE
          WHEN STARTS_WITH(TRIM(t.product_name),'Кулінарія') THEN 'Кулинария'
          WHEN STARTS_WITH(TRIM(t.product_name),'Випічка') THEN 'Выпечка'
          WHEN STARTS_WITH(TRIM(t.product_name),'Хот-Дог') THEN 'Хот-дог'
          ELSE COALESCE(m.cat,'Прочее (нет в матрице)')
        END category,
        COALESCE(m.sup,'(нет в матрице)') supplier,
        (m.barcode IS NOT NULL) in_matrix
      FROM {TT} t LEFT JOIN m USING(barcode)
      WHERE t.transaction_datetime >= DATETIME({YEAR}, 1, 1, 0, 0, 0)
        AND t.transaction_datetime <  DATETIME({YEAR} + 1, 1, 1, 0, 0, 0)
        AND store IN {keep}
    ),
    variants AS (
      SELECT product_name, category, supplier, in_matrix,
             SUM(IF(in_matrix, qty*pr, 0)) w
      FROM raw GROUP BY product_name, category, supplier, in_matrix
    ),
    fix AS (
      SELECT product_name,
             ANY_VALUE(category HAVING MAX w) category_fix,
             ANY_VALUE(supplier HAVING MAX w) supplier_fix,
             LOGICAL_OR(in_matrix) in_matrix_fix
      FROM variants GROUP BY product_name
    )
    SELECT raw.store, raw.barcode, raw.product_name, raw.qty,
      raw.qty*raw.pr rev, (raw.pr-raw.pp)*raw.qty gp,
      raw.mo, raw.tid, FARM_FINGERPRINT(CAST(raw.tid AS STRING)) tidn, raw.d, raw.dow, raw.hr,
      IF(fix.in_matrix_fix, fix.category_fix, raw.category) category,
      IF(fix.in_matrix_fix, fix.supplier_fix, raw.supplier) supplier,
      fix.in_matrix_fix in_matrix,
      ({CUL_SQL}) cul
    FROM raw JOIN fix USING(product_name)
    """).result()

      # 2) ВИТРИНА СУММ. Всё, где не нужны чеки и дата, считается по ней.
      client.query(f"""
    CREATE OR REPLACE TABLE {AG}
    CLUSTER BY store, category, product_name
    AS SELECT mo, store, barcode, product_name, category, supplier, in_matrix, cul,
      SUM(qty) qty, SUM(rev) rev, SUM(gp) gp
    FROM {ST} GROUP BY mo, store, barcode, product_name, category, supplier, in_matrix, cul
    """).result()

      # 3) ВИТРИНА ЧЕКОВ. COUNT(DISTINCT tid) не складывается, поэтому все разрезы —
      # одним проходом через GROUPING SETS. Разрез узнаётся по тому, какие колонки не NULL
      # (NULL-ов в этих полях в данных нет).
      client.query(f"""
    CREATE OR REPLACE TABLE {RC} AS
    SELECT mo, store, category, supplier, dow, hr, cul,
      COUNT(DISTINCT tid) receipts, ROUND(SUM(rev),0) revenue
    FROM {ST}
    GROUP BY GROUPING SETS (
      (), (mo), (category), (store), (supplier),
      (category, mo), (store, mo), (supplier, mo),
      (store, dow, hr), (cul), (cul, store))
    """).result()

    def run(sql): return [dict(r) for r in client.query(sql).result()]
    out = {"year": YEAR, "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}

    # ---- чеки из витрины: раскладываем разрезы по словарям
    rc = run(f"SELECT * FROM {RC}")
    ALLC = ("mo", "store", "category", "supplier", "dow", "hr", "cul")
    def _grain(r, *cols):
        """строка витрины относится к разрезу cols, если ровно эти поля не NULL"""
        return all(r[c] is not None for c in cols) and all(r[c] is None for c in ALLC if c not in cols)
    rc_total = next(r for r in rc if _grain(r))
    rc_mo    = {r["mo"]: r for r in rc if _grain(r, "mo")}
    rc_cat   = {r["category"]: r for r in rc if _grain(r, "category")}
    rc_st    = {r["store"]: r for r in rc if _grain(r, "store")}
    rc_sup   = {r["supplier"]: r for r in rc if _grain(r, "supplier")}
    rc_catm  = {(r["category"], r["mo"]): r for r in rc if _grain(r, "category", "mo")}
    rc_stm   = {(r["store"], r["mo"]): r for r in rc if _grain(r, "store", "mo")}
    rc_supm  = {(r["supplier"], r["mo"]): r for r in rc if _grain(r, "supplier", "mo")}
    rc_heat  = [r for r in rc if _grain(r, "store", "dow", "hr")]
    rc_cul   = {r["cul"]: r for r in rc if _grain(r, "cul")}
    rc_culst = {(r["cul"], r["store"]): r for r in rc if _grain(r, "cul", "store")}
    def rec(d, k):
        r = d.get(k)
        return int(r["receipts"]) if r else 0

    per = run(f"SELECT CAST(MIN(d) AS STRING) a, CAST(MAX(d) AS STRING) b, COUNT(DISTINCT d) nd FROM {ST}")[0]
    out["period"] = {"start": per["a"], "end": per["b"], "days": per["nd"]}

    kpi = run(f"""SELECT ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SAFE_DIVIDE(SUM(gp),SUM(rev))*100,1) margin,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT category) cats, COUNT(DISTINCT supplier) suppliers,
      COUNT(DISTINCT store) stores, ROUND(SUM(qty),0) units,
      ROUND(SUM(IF(NOT in_matrix, rev, 0)),0) offmatrix_rev FROM {AG}""")[0]
    kpi["receipts"] = int(rc_total["receipts"])
    _reorder(kpi, ["revenue","gp","margin","receipts","skus","cats","suppliers","stores","units","offmatrix_rev"])
    out["kpi"] = kpi

    out["monthly"] = run(f"""SELECT mo, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SUM(qty),0) qty, COUNT(DISTINCT barcode) skus FROM {AG} GROUP BY mo ORDER BY mo""")
    for r in out["monthly"]:
        r["receipts"] = rec(rc_mo, r["mo"])
        _reorder(r, ["mo","revenue","gp","qty","receipts","skus"])

    out["by_category"] = run(f"""SELECT category, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SAFE_DIVIDE(SUM(gp),SUM(rev))*100,1) margin, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT store) stores
      FROM {AG} GROUP BY category ORDER BY revenue DESC""")
    for r in out["by_category"]:
        r["receipts"] = rec(rc_cat, r["category"])
        _reorder(r, ["category","revenue","gp","margin","qty","receipts","skus","stores"])

    out["by_store"] = run(f"""SELECT store, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SAFE_DIVIDE(SUM(gp),SUM(rev))*100,1) margin,
      COUNT(DISTINCT category) cats, COUNT(DISTINCT barcode) skus, ROUND(SUM(qty),0) qty
      FROM {AG} GROUP BY store ORDER BY revenue DESC""")
    for r in out["by_store"]:
        r["receipts"] = rec(rc_st, r["store"])
        _reorder(r, ["store","revenue","gp","margin","receipts","cats","skus","qty"])

    out["by_supplier"] = run(f"""SELECT supplier, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SAFE_DIVIDE(SUM(gp),SUM(rev))*100,1) margin, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT category) cats, COUNT(DISTINCT store) stores
      FROM {AG} GROUP BY supplier ORDER BY revenue DESC""")
    for r in out["by_supplier"]:
        r["receipts"] = rec(rc_sup, r["supplier"])
        _reorder(r, ["supplier","revenue","gp","margin","qty","receipts","skus","cats","stores"])

    # покрытие: категория x магазин (выручка)
    out["cat_store"] = run(f"""SELECT category, store, ROUND(SUM(rev),0) revenue
      FROM {AG} GROUP BY category, store""")
    # поставщик x магазин (для фильтра «Обзора» по поставщику)
    out["sup_store"] = run(f"""SELECT supplier, store, ROUND(SUM(rev),0) revenue
      FROM {AG} GROUP BY supplier, store""")

    # тепловая карта: день недели x час (по чекам, локальное время торгсофта). dow: 1=Вс..7=Сб
    # Берётся из витрины чеков — тот же tid, что и раньше, но без отдельного скана
    # turnover_transactions (это было ~0,9 ГБ на каждую сборку).
    out["heatmap"] = [{"store": r["store"], "dow": r["dow"], "hr": r["hr"],
                       "revenue": r["revenue"], "receipts": int(r["receipts"])} for r in rc_heat]

    # динамика по категориям и магазинам (для фильтра по времени)
    out["cat_month"] = run(f"""SELECT category, mo, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT barcode) skus FROM {AG} GROUP BY category, mo""")
    for r in out["cat_month"]:
        r["receipts"] = rec(rc_catm, (r["category"], r["mo"]))
        _reorder(r, ["category","mo","revenue","gp","qty","receipts","skus"])
    out["store_month"] = run(f"""SELECT store, mo, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT barcode) skus FROM {AG} GROUP BY store, mo""")
    for r in out["store_month"]:
        r["receipts"] = rec(rc_stm, (r["store"], r["mo"]))
        _reorder(r, ["store","mo","revenue","gp","qty","receipts","skus"])
    # помесячно по поставщикам и по ВСЕМ позициям (для конструктора отчётов и динамики)
    out["supplier_month"] = run(f"""SELECT supplier, mo, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT barcode) skus FROM {AG} GROUP BY supplier, mo""")
    for r in out["supplier_month"]:
        r["receipts"] = rec(rc_supm, (r["supplier"], r["mo"]))
        _reorder(r, ["supplier","mo","revenue","gp","qty","receipts","skus"])
    out["prod_month"] = run(f"""
      WITH topp AS (SELECT product_name FROM (SELECT product_name, SUM(rev) rev FROM {AG} GROUP BY product_name ORDER BY rev DESC LIMIT 3500))
      SELECT product_name p, mo, ROUND(SUM(rev),0) rev, ROUND(SUM(gp),0) gp, ROUND(SUM(qty),0) qty
      FROM {AG} JOIN topp USING(product_name) GROUP BY p, mo""")

    out["stores"] = [r["store"] for r in run(f"SELECT store FROM {AG} GROUP BY store ORDER BY store")]
    out["wholesale_stores"] = [s for s in WHOLESALE if s in out["stores"]]

    # ПОЗИЦИИ (главный факт для drill-down) + ABC-класс, посчитанный по ВСЕМ товарам
    out["products"] = run(f"""
      WITH p AS (SELECT product_name, ANY_VALUE(category) c, ANY_VALUE(supplier) s,
          SUM(rev) rev, SUM(gp) gp, SUM(qty) qty, COUNT(DISTINCT store) st
        FROM {AG} GROUP BY product_name),
      r AS (SELECT *, SUM(rev) OVER (ORDER BY rev DESC) / NULLIF(SUM(rev) OVER (),0) cum FROM p)
      SELECT product_name p, c, s, ROUND(rev,0) rev, ROUND(gp,0) gp, ROUND(qty,0) qty, st,
        ROUND(SAFE_DIVIDE(gp,rev)*100,1) mrg,
        CASE WHEN cum<=0.8 THEN 'A' WHEN cum<=0.95 THEN 'B' ELSE 'C' END abc
      FROM r ORDER BY rev DESC LIMIT 4500""")

    # XYZ: стабильность спроса по месяцам (коэффициент вариации выручки). X — ровный спрос, Z — рваный/сезонный.
    # Текущий (неполный) месяц исключаем, чтобы не занижать стабильность.
    mx = run(f"SELECT MAX(mo) m FROM {AG}")[0]["m"] or 1
    ncomplete = max(1, mx - 1)
    xyz = run(f"""
      WITH pm AS (SELECT product_name, mo, SUM(rev) rev FROM {AG} WHERE mo < {mx} GROUP BY product_name, mo),
      a AS (SELECT product_name, AVG(rev) mean, STDDEV_POP(rev) sd, COUNT(*) nmon FROM pm GROUP BY product_name)
      SELECT product_name p, CASE
        WHEN nmon < 0.6*{ncomplete} THEN 'Z'
        WHEN SAFE_DIVIDE(sd,mean)<=0.4 THEN 'X'
        WHEN SAFE_DIVIDE(sd,mean)<=0.8 THEN 'Y' ELSE 'Z' END xyz FROM a""")
    xm = {r["p"]: r["xyz"] for r in xyz}
    for p in out["products"]:
        p["xyz"] = xm.get(p["p"], "—")

    # ПОЛНЫЙ КУБ ПОЗИЦИЯ x МАГАЗИН (для точного среза «Позиций» по выбранным магазинам).
    # store_top_products ниже — это ТОП-30 на точку, он покрывает всего ~26% выручки магазина,
    # а при выборе двух и более магазинов фронт вообще терял фильтр и показывал всю сеть.
    # Формат компактный: строка = [индекс в out["products"], индекс в out["stores"], выручка, прибыль, кол-во].
    # Имена не дублируются — индексы ссылаются на уже существующие массивы.
    pidx = {p["p"]: i for i, p in enumerate(out["products"])}
    sidx = {s: i for i, s in enumerate(out["stores"])}
    raw_ps = run(f"""SELECT store, product_name p, ROUND(SUM(rev),0) rev,
        ROUND(SUM(gp),0) gp, ROUND(SUM(qty),0) qty
      FROM {AG} GROUP BY store, p""")
    ps, lost_rev, lost_rows = [], 0.0, 0
    for r in raw_ps:
        i, j = pidx.get(r["p"]), sidx.get(r["store"])
        if i is None or j is None:          # товар не попал в срез products (LIMIT) — считаем потерю
            lost_rev += r["rev"] or 0; lost_rows += 1; continue
        ps.append([i, j, int(r["rev"] or 0), int(r["gp"] or 0), int(r["qty"] or 0)])
    ps.sort(key=lambda x: (x[0], x[1]))
    out["prod_store"] = ps
    out["prod_store_meta"] = {"rows": len(ps), "lost_rows": lost_rows, "lost_revenue": round(lost_rev, 0),
                              "covered_pct": (round((1 - lost_rev / (out["kpi"]["revenue"] or 1)) * 100, 3))}

    # топ товаров по каждому магазину (drill магазин -> позиции)
    out["store_top_products"] = run(f"""
      WITH s AS (SELECT store, product_name, ANY_VALUE(category) c, ANY_VALUE(supplier) sup,
          SUM(rev) rev, SUM(gp) gp, SUM(qty) qty,
          ROW_NUMBER() OVER (PARTITION BY store ORDER BY SUM(rev) DESC) rn
        FROM {AG} GROUP BY store, product_name)
      SELECT store, product_name p, c, sup s, ROUND(rev,0) rev, ROUND(gp,0) gp, ROUND(qty,0) qty
      FROM s WHERE rn<=30 ORDER BY store, rev DESC""")

    # ABC — сводка по всем товарам
    out["abc"] = {
      "classes": run(f"""
        WITH p AS (SELECT product_name, SUM(rev) rev, SUM(gp) gp FROM {AG} GROUP BY product_name),
        r AS (SELECT rev, gp, SUM(rev) OVER (ORDER BY rev DESC)/NULLIF(SUM(rev) OVER (),0) cum FROM p)
        SELECT CASE WHEN cum<=0.8 THEN 'A' WHEN cum<=0.95 THEN 'B' ELSE 'C' END abc,
          COUNT(*) skus, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp
        FROM r GROUP BY abc ORDER BY abc"""),
      "curve": [[c["rn"], c["cum_pct"]] for c in run(f"""
        WITH p AS (SELECT product_name, SUM(rev) rev FROM {AG} GROUP BY product_name),
        r AS (SELECT ROW_NUMBER() OVER (ORDER BY rev DESC) rn,
          SUM(rev) OVER (ORDER BY rev DESC)/NULLIF(SUM(rev) OVER (),0) cum, COUNT(*) OVER () n FROM p)
        SELECT rn, ROUND(cum*100,2) cum_pct FROM r
        WHERE MOD(rn, GREATEST(1, CAST(CEIL(n/200) AS INT64)))=0 OR rn=1 ORDER BY rn""")],
      "total_sku": run(f"SELECT COUNT(DISTINCT product_name) n FROM {AG}")[0]["n"],
    }

    # ОБОРАЧИВАЕМОСТЬ (turnover_monthly + категория/поставщик из матрицы)
    tmcases = sql_case()
    turn_base = f"""
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
    tm AS (SELECT barcode, CASE {tmcases} END store, SUM(sales_cost) sales, SUM((start_cost+end_cost)/2) avg_stock
           FROM {TM} WHERE year={YEAR} AND store IN {keep} GROUP BY barcode, store)"""
    out["turnover"] = run(turn_base + f"""
      SELECT COALESCE(m.cat,'Прочее (нет в матрице)') category,
        ROUND(SUM(tm.sales),0) sales_cost, ROUND(SUM(tm.avg_stock),0) avg_stock,
        ROUND(SAFE_DIVIDE(SUM(tm.sales),SUM(tm.avg_stock)),2) turnover_rate
      FROM tm LEFT JOIN m USING(barcode) GROUP BY category HAVING avg_stock>0 ORDER BY sales_cost DESC""")
    out["turnover_store"] = run(turn_base + """
      SELECT store, ROUND(SUM(sales),0) sales_cost, ROUND(SUM(avg_stock),0) avg_stock,
        ROUND(SAFE_DIVIDE(SUM(sales),SUM(avg_stock)),2) turnover_rate
      FROM tm GROUP BY store HAVING avg_stock>0 ORDER BY turnover_rate DESC""")
    out["turnover_supplier"] = run(turn_base + f"""
      SELECT COALESCE(m.sup,'(нет в матрице)') supplier,
        ROUND(SUM(tm.sales),0) sales_cost, ROUND(SUM(tm.avg_stock),0) avg_stock,
        ROUND(SAFE_DIVIDE(SUM(tm.sales),SUM(tm.avg_stock)),2) turnover_rate
      FROM tm LEFT JOIN m USING(barcode) GROUP BY supplier HAVING avg_stock>0 ORDER BY sales_cost DESC""")

    # КУЛИНАРИЯ И ВЫПЕЧКА (собственное производство, вне матрицы — по префиксам названий).
    # Признак cul посчитан при сборке промежуточной таблицы, здесь только фильтр по флагу.
    SUB = "CASE WHEN STARTS_WITH(TRIM(product_name),'Випічка') THEN 'Випічка' ELSE 'Кулінарія' END"
    cul = {}
    ck = run(f"""SELECT ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SAFE_DIVIDE(SUM(gp),SUM(rev))*100,1) margin, ROUND(SUM(qty),0) units,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT store) stores
      FROM {AG} WHERE cul""")[0]
    ck["receipts"] = rec(rc_cul, True)
    _reorder(ck, ["revenue","gp","margin","units","skus","stores","receipts"])
    cul["kpi"] = ck
    cul["by_sub"] = run(f"""SELECT {SUB} sub, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SAFE_DIVIDE(SUM(gp),SUM(rev))*100,1) margin, ROUND(SUM(qty),0) qty, COUNT(DISTINCT barcode) skus
      FROM {AG} WHERE cul GROUP BY sub ORDER BY revenue DESC""")
    cul["by_month"] = run(f"""SELECT mo, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp
      FROM {AG} WHERE cul GROUP BY mo ORDER BY mo""")
    cul["store_month"] = run(f"""SELECT store, mo, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp
      FROM {AG} WHERE cul GROUP BY store, mo""")
    cul["by_store"] = run(f"""SELECT store, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp,
      ROUND(SAFE_DIVIDE(SUM(gp),SUM(rev))*100,1) margin, ROUND(SUM(qty),0) qty
      FROM {AG} WHERE cul GROUP BY store ORDER BY revenue DESC""")
    for r in cul["by_store"]:
        r["receipts"] = rec(rc_culst, (True, r["store"]))
    cul["products"] = run(f"""
      WITH p AS (SELECT product_name, {SUB} sub, SUM(rev) rev, SUM(gp) gp, SUM(qty) qty, COUNT(DISTINCT store) st
                 FROM {AG} WHERE cul GROUP BY product_name, sub),
      r AS (SELECT *, SUM(rev) OVER (ORDER BY rev DESC)/NULLIF(SUM(rev) OVER (),0) cum FROM p)
      SELECT product_name p, sub, ROUND(rev,0) rev, ROUND(gp,0) gp, ROUND(qty,0) qty, st,
        ROUND(SAFE_DIVIDE(gp,rev)*100,1) mrg,
        CASE WHEN cum<=0.8 THEN 'A' WHEN cum<=0.95 THEN 'B' ELSE 'C' END abc
      FROM r ORDER BY rev DESC""")
    cul["prod_store"] = run(f"""SELECT product_name p, store, ROUND(SUM(rev),0) rev, ROUND(SUM(qty),0) qty
      FROM {AG} WHERE cul GROUP BY p, store""")
    out["culinary"] = cul

    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    import os as _os
    print("OK size:", round(_os.path.getsize(OUT) / 1024, 1), "KB")
    print("KPI:", out["kpi"])
    print("категорий:", len(out["by_category"]), "| магазинов:", len(out["stores"]),
          "| поставщиков:", len(out["by_supplier"]), "| товаров:", len(out["products"]),
          "| оборач.кат:", len(out["turnover"]), "| оборач.пост:", len(out["turnover_supplier"]))


if __name__ == "__main__":
    main()
