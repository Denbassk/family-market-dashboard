#!/usr/bin/env python3
"""Сбор данных для дашборда Family Market.
ВАЖНО: категория и поставщик берутся ТОЛЬКО из assortment_matrix_full (актуальная матрица) по штрих-коду.
Товары вне матрицы -> категория «Прочее (нет в матрице)», поставщик «(нет в матрице)».
Для скорости/цены создаётся промежуточная таблица _dash_tx26 (один скан), по ней считаются агрегаты."""
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
    if not os.environ.get("SKIP_STAGING"):
      client.query(f"""
    CREATE OR REPLACE TABLE {ST} AS
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
    raw AS (
      SELECT CASE {cases} END AS store, t.barcode, t.product_name,
        t.quantity qty, t.price_retail pr, t.price_purchase pp,
        EXTRACT(MONTH FROM t.transaction_datetime) mo, t.transaction_id tid,
        DATE(t.transaction_datetime) d,
        CASE
          WHEN STARTS_WITH(TRIM(t.product_name),'Кулінарія') THEN 'Кулинария'
          WHEN STARTS_WITH(TRIM(t.product_name),'Випічка') THEN 'Выпечка'
          WHEN STARTS_WITH(TRIM(t.product_name),'Хот-Дог') THEN 'Хот-дог'
          ELSE COALESCE(m.cat,'Прочее (нет в матрице)')
        END category,
        COALESCE(m.sup,'(нет в матрице)') supplier,
        (m.barcode IS NOT NULL) in_matrix
      FROM {TT} t LEFT JOIN m USING(barcode)
      WHERE EXTRACT(YEAR FROM t.transaction_datetime)={YEAR} AND store IN {keep}
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
    SELECT raw.store, raw.barcode, raw.product_name, raw.qty, raw.pr, raw.pp, raw.mo, raw.tid, raw.d,
      IF(fix.in_matrix_fix, fix.category_fix, raw.category) category,
      IF(fix.in_matrix_fix, fix.supplier_fix, raw.supplier) supplier,
      fix.in_matrix_fix in_matrix
    FROM raw JOIN fix USING(product_name)
    """).result()

    def run(sql): return [dict(r) for r in client.query(sql).result()]
    out = {"year": YEAR, "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    per = run(f"SELECT CAST(MIN(d) AS STRING) a, CAST(MAX(d) AS STRING) b, COUNT(DISTINCT d) nd FROM {ST}")[0]
    out["period"] = {"start": per["a"], "end": per["b"], "days": per["nd"]}

    out["kpi"] = run(f"""SELECT ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, COUNT(DISTINCT tid) receipts,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT category) cats, COUNT(DISTINCT supplier) suppliers,
      COUNT(DISTINCT store) stores, ROUND(SUM(qty),0) units,
      ROUND(SUM(IF(NOT in_matrix, qty*pr, 0)),0) offmatrix_rev FROM {ST}""")[0]

    out["monthly"] = run(f"""SELECT mo, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SUM(qty),0) qty, COUNT(DISTINCT tid) receipts, COUNT(DISTINCT barcode) skus FROM {ST} GROUP BY mo ORDER BY mo""")

    out["by_category"] = run(f"""SELECT category, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, ROUND(SUM(qty),0) qty, COUNT(DISTINCT tid) receipts,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT store) stores
      FROM {ST} GROUP BY category ORDER BY revenue DESC""")

    out["by_store"] = run(f"""SELECT store, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, COUNT(DISTINCT tid) receipts,
      COUNT(DISTINCT category) cats, COUNT(DISTINCT barcode) skus, ROUND(SUM(qty),0) qty
      FROM {ST} GROUP BY store ORDER BY revenue DESC""")

    out["by_supplier"] = run(f"""SELECT supplier, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, ROUND(SUM(qty),0) qty, COUNT(DISTINCT tid) receipts,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT category) cats, COUNT(DISTINCT store) stores
      FROM {ST} GROUP BY supplier ORDER BY revenue DESC""")

    # покрытие: категория x магазин (выручка)
    out["cat_store"] = run(f"""SELECT category, store, ROUND(SUM(qty*pr),0) revenue
      FROM {ST} GROUP BY category, store""")
    # поставщик x магазин (для фильтра «Обзора» по поставщику)
    out["sup_store"] = run(f"""SELECT supplier, store, ROUND(SUM(qty*pr),0) revenue
      FROM {ST} GROUP BY supplier, store""")

    # тепловая карта: день недели × час (по чекам, локальное время торгсофта). dow: 1=Вс..7=Сб
    out["heatmap"] = run(f"""SELECT CASE {cases} END store,
      EXTRACT(DAYOFWEEK FROM transaction_datetime) dow, EXTRACT(HOUR FROM transaction_datetime) hr,
      ROUND(SUM(quantity*price_retail),0) revenue, COUNT(DISTINCT transaction_id) receipts
      FROM {TT} WHERE EXTRACT(YEAR FROM transaction_datetime)={YEAR} AND store IN {keep} GROUP BY 1,2,3""")

    # динамика по категориям и магазинам (для фильтра по времени)
    out["cat_month"] = run(f"""SELECT category, mo, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT tid) receipts, COUNT(DISTINCT barcode) skus
      FROM {ST} GROUP BY category, mo""")
    out["store_month"] = run(f"""SELECT store, mo, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT tid) receipts, COUNT(DISTINCT barcode) skus
      FROM {ST} GROUP BY store, mo""")
    # помесячно по поставщикам и по ВСЕМ позициям (для конструктора отчётов и динамики)
    out["supplier_month"] = run(f"""SELECT supplier, mo, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT tid) receipts, COUNT(DISTINCT barcode) skus
      FROM {ST} GROUP BY supplier, mo""")
    out["prod_month"] = run(f"""
      WITH topp AS (SELECT product_name FROM (SELECT product_name, SUM(qty*pr) rev FROM {ST} GROUP BY product_name ORDER BY rev DESC LIMIT 3500))
      SELECT product_name p, mo, ROUND(SUM(qty*pr),0) rev, ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty
      FROM {ST} JOIN topp USING(product_name) GROUP BY p, mo""")

    out["stores"] = [r["store"] for r in run(f"SELECT store FROM {ST} GROUP BY store ORDER BY store")]
    out["wholesale_stores"] = [s for s in WHOLESALE if s in out["stores"]]

    # ПОЗИЦИИ (главный факт для drill-down) + ABC-класс, посчитанный по ВСЕМ товарам
    out["products"] = run(f"""
      WITH p AS (SELECT product_name, ANY_VALUE(category) c, ANY_VALUE(supplier) s,
          SUM(qty*pr) rev, SUM((pr-pp)*qty) gp, SUM(qty) qty, COUNT(DISTINCT store) st
        FROM {ST} GROUP BY product_name),
      r AS (SELECT *, SUM(rev) OVER (ORDER BY rev DESC) / NULLIF(SUM(rev) OVER (),0) cum FROM p)
      SELECT product_name p, c, s, ROUND(rev,0) rev, ROUND(gp,0) gp, ROUND(qty,0) qty, st,
        ROUND(SAFE_DIVIDE(gp,rev)*100,1) mrg,
        CASE WHEN cum<=0.8 THEN 'A' WHEN cum<=0.95 THEN 'B' ELSE 'C' END abc
      FROM r ORDER BY rev DESC LIMIT 4500""")

    # XYZ: стабильность спроса по месяцам (коэффициент вариации выручки). X — ровный спрос, Z — рваный/сезонный.
    # Текущий (неполный) месяц исключаем, чтобы не занижать стабильность.
    mx = run(f"SELECT MAX(mo) m FROM {ST}")[0]["m"] or 1
    ncomplete = max(1, mx - 1)
    xyz = run(f"""
      WITH pm AS (SELECT product_name, mo, SUM(qty*pr) rev FROM {ST} WHERE mo < {mx} GROUP BY product_name, mo),
      a AS (SELECT product_name, AVG(rev) mean, STDDEV_POP(rev) sd, COUNT(*) nmon FROM pm GROUP BY product_name)
      SELECT product_name p, CASE
        WHEN nmon < 0.6*{ncomplete} THEN 'Z'
        WHEN SAFE_DIVIDE(sd,mean)<=0.4 THEN 'X'
        WHEN SAFE_DIVIDE(sd,mean)<=0.8 THEN 'Y' ELSE 'Z' END xyz FROM a""")
    xm = {r["p"]: r["xyz"] for r in xyz}
    for p in out["products"]:
        p["xyz"] = xm.get(p["p"], "—")

    # ПОЛНЫЙ КУБ ПОЗИЦИЯ × МАГАЗИН (для точного среза «Позиций» по выбранным магазинам).
    # store_top_products ниже — это ТОП-30 на точку, он покрывает всего ~26% выручки магазина,
    # а при выборе двух и более магазинов фронт вообще терял фильтр и показывал всю сеть.
    # Формат компактный: строка = [индекс в out["products"], индекс в out["stores"], выручка, прибыль, кол-во].
    # Имена не дублируются — индексы ссылаются на уже существующие массивы.
    pidx = {p["p"]: i for i, p in enumerate(out["products"])}
    sidx = {s: i for i, s in enumerate(out["stores"])}
    raw_ps = run(f"""SELECT store, product_name p, ROUND(SUM(qty*pr),0) rev,
        ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty
      FROM {ST} GROUP BY store, p""")
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
          SUM(qty*pr) rev, SUM((pr-pp)*qty) gp, SUM(qty) qty,
          ROW_NUMBER() OVER (PARTITION BY store ORDER BY SUM(qty*pr) DESC) rn
        FROM {ST} GROUP BY store, product_name)
      SELECT store, product_name p, c, sup s, ROUND(rev,0) rev, ROUND(gp,0) gp, ROUND(qty,0) qty
      FROM s WHERE rn<=30 ORDER BY store, rev DESC""")

    # ABC — сводка по всем товарам
    out["abc"] = {
      "classes": run(f"""
        WITH p AS (SELECT product_name, SUM(qty*pr) rev, SUM((pr-pp)*qty) gp FROM {ST} GROUP BY product_name),
        r AS (SELECT rev, gp, SUM(rev) OVER (ORDER BY rev DESC)/NULLIF(SUM(rev) OVER (),0) cum FROM p)
        SELECT CASE WHEN cum<=0.8 THEN 'A' WHEN cum<=0.95 THEN 'B' ELSE 'C' END abc,
          COUNT(*) skus, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp
        FROM r GROUP BY abc ORDER BY abc"""),
      "curve": [[c["rn"], c["cum_pct"]] for c in run(f"""
        WITH p AS (SELECT product_name, SUM(qty*pr) rev FROM {ST} GROUP BY product_name),
        r AS (SELECT ROW_NUMBER() OVER (ORDER BY rev DESC) rn,
          SUM(rev) OVER (ORDER BY rev DESC)/NULLIF(SUM(rev) OVER (),0) cum, COUNT(*) OVER () n FROM p)
        SELECT rn, ROUND(cum*100,2) cum_pct FROM r
        WHERE MOD(rn, GREATEST(1, CAST(CEIL(n/200) AS INT64)))=0 OR rn=1 ORDER BY rn""")],
      "total_sku": run(f"SELECT COUNT(DISTINCT product_name) n FROM {ST}")[0]["n"],
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

    # КУЛИНАРИЯ И ВЫПЕЧКА (собственное производство, вне матрицы — по префиксам названий)
    CUL = "(STARTS_WITH(TRIM(product_name),'Випічка') OR STARTS_WITH(TRIM(product_name),'Кулінарія')) AND store!='Полевая магазин'"
    SUB = "CASE WHEN STARTS_WITH(TRIM(product_name),'Випічка') THEN 'Випічка' ELSE 'Кулінарія' END"
    cul = {}
    cul["kpi"] = run(f"""SELECT ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, ROUND(SUM(qty),0) units,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT store) stores, COUNT(DISTINCT tid) receipts
      FROM {ST} WHERE {CUL}""")[0]
    cul["by_sub"] = run(f"""SELECT {SUB} sub, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, ROUND(SUM(qty),0) qty, COUNT(DISTINCT barcode) skus
      FROM {ST} WHERE {CUL} GROUP BY sub ORDER BY revenue DESC""")
    cul["by_month"] = run(f"""SELECT mo, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp
      FROM {ST} WHERE {CUL} GROUP BY mo ORDER BY mo""")
    cul["store_month"] = run(f"""SELECT store, mo, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp
      FROM {ST} WHERE {CUL} GROUP BY store, mo""")
    cul["by_store"] = run(f"""SELECT store, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, ROUND(SUM(qty),0) qty, COUNT(DISTINCT tid) receipts
      FROM {ST} WHERE {CUL} GROUP BY store ORDER BY revenue DESC""")
    cul["products"] = run(f"""
      WITH p AS (SELECT product_name, {SUB} sub, SUM(qty*pr) rev, SUM((pr-pp)*qty) gp, SUM(qty) qty, COUNT(DISTINCT store) st
                 FROM {ST} WHERE {CUL} GROUP BY product_name, sub),
      r AS (SELECT *, SUM(rev) OVER (ORDER BY rev DESC)/NULLIF(SUM(rev) OVER (),0) cum FROM p)
      SELECT product_name p, sub, ROUND(rev,0) rev, ROUND(gp,0) gp, ROUND(qty,0) qty, st,
        ROUND(SAFE_DIVIDE(gp,rev)*100,1) mrg,
        CASE WHEN cum<=0.8 THEN 'A' WHEN cum<=0.95 THEN 'B' ELSE 'C' END abc
      FROM r ORDER BY rev DESC""")
    cul["prod_store"] = run(f"""SELECT product_name p, store, ROUND(SUM(qty*pr),0) rev, ROUND(SUM(qty),0) qty
      FROM {ST} WHERE {CUL} GROUP BY p, store""")
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
