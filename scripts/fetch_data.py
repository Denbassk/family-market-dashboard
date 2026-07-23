#!/usr/bin/env python3
"""Полный сбор данных для многостраничного дашборда по всему ассортименту."""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

YEAR = int(os.environ.get("REPORT_YEAR", 2026))
OUT  = os.environ.get("OUT_PATH", os.path.join(os.path.dirname(__file__),"..","docs","full_data.json"))

NORM = {
 "Іскрінський 19":"Іскринський 19В","Амосова 5А":"Амосова 5А","Астрономічна 44Г":"Астрономічна 44Г",
 "Байрона 138/1":"Байрона 138/1","Героїв Сталінграда 138/1":"Байрона 138/1",
 "Байрона 156":"Байрона 156","Героїв Сталінграду 156":"Байрона 156",
 "Байрона 163":"Байрона 163А","Героїв Сталінграду 163А":"Байрона 163А",
 "Богдана Хмельницького 8":"Богдана Хмельницького 8","Бучми 32":"Бучми 32","Бучми 52":"Бучми 52",
 "Бучми Джерело":"Бучми 32Б1","Валентинівська 24":"Валентинівська 24Б","Валентинівська 50А":"Валентинівська 50А",
 "Гарібальді 1":"Гарібальді 1","Гвардійців Широнінців 54":"Гвардійців Широнінців 54","Грозненська 38":"Грозненська 38",
 "Зернова 6/5":"Зернова 6/5","Зубенко 23":"Зубенка 23","Зубенко 31В/5":"Зубенка 31В5","Качанівська 19":"Качанівська 19",
 "Краснодарська 171з":"Краснодарська 171/З","Михайля Семенка 17":"Михайля Семенка 17",
 "Небесної Сотні 14/1":"Героїв Небесної Сотні 14/1","Нескорених 33":"Нескорених 33","Нескорених 4Д":"Нескорених 4Д",
 "Ньютона 102":"Ньютона 102","Ньютона 111":"Ньютона 111","Олімпійська 9А":"Олімпійська 9А",
 "Переяславська 23":"Переяславська 23","Петра Григоренка 37":"Петра Григоренка 37",
 "Полевая 83":"Полевая 83","Полевая-Магазин":"Полевая 83","Пр-т Героїв Харкова 160":"Героїв Харкова 160",
 "Пр-т Тракторобудiвникiв 95":"Тракторобудівників 95","Пр-т Ювілейний 67":"Ювілейний 67",
 "Роганська 130/4":"Роганська 130/4","Роганська 148":"Роганська 148","Салтівське шосе 264В":"Салтівське шосе 264В",
 "Танкопія 16":"Танкопія 16","Шевченко 341":"Шевченко 341",
}

def main():
    creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
    client = bigquery.Client(credentials=creds, project=creds.project_id)
    TT="`family-market-analytics.family_market.turnover_transactions`"
    MX="`family-market-analytics.family_market.assortment_matrix_full`"
    TM="`family-market-analytics.family_market.turnover_monthly`"
    cases=" ".join(f"WHEN store='{k}' THEN '{v}'" for k,v in NORM.items())
    keep="("+",".join(f"'{k}'" for k in NORM)+")"

    # база: продажи 2026 в 38 точках + категория/поставщик из матрицы (непокрытое -> Прочее)
    base=f"""
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
    tx AS (
      SELECT CASE {cases} END store, t.barcode, t.product_name,
        t.quantity qty, t.price_retail pr, t.price_purchase pp,
        EXTRACT(MONTH FROM t.transaction_datetime) mo, t.transaction_id tid,
        COALESCE(m.cat,'Прочее (нет в матрице)') category,
        COALESCE(m.sup,'(нет в матрице)') supplier,
        (m.barcode IS NOT NULL) in_matrix
      FROM {TT} t LEFT JOIN m USING(barcode)
      WHERE EXTRACT(YEAR FROM t.transaction_datetime)={YEAR} AND store IN {keep}
    )"""
    def run(sql): return [dict(r) for r in client.query(base+sql).result()]

    out={"year":YEAR,"updated_at":datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M UTC")}

    out["kpi"]=run("""SELECT ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, COUNT(DISTINCT tid) receipts,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT category) cats, COUNT(DISTINCT supplier) suppliers,
      COUNT(DISTINCT store) stores FROM tx""")[0]

    out["monthly"]=run("""SELECT mo, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      COUNT(DISTINCT tid) receipts FROM tx GROUP BY mo ORDER BY mo""")

    out["by_category"]=run("""SELECT category, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, ROUND(SUM(qty),0) qty,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT store) stores
      FROM tx GROUP BY category ORDER BY revenue DESC""")

    out["by_store"]=run("""SELECT store, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, COUNT(DISTINCT tid) receipts,
      COUNT(DISTINCT category) cats, COUNT(DISTINCT barcode) skus
      FROM tx GROUP BY store ORDER BY revenue DESC""")

    out["by_supplier"]=run("""SELECT supplier, ROUND(SUM(qty*pr),0) revenue, ROUND(SUM((pr-pp)*qty),0) gp,
      ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin,
      COUNT(DISTINCT barcode) skus, COUNT(DISTINCT category) cats
      FROM tx GROUP BY supplier ORDER BY revenue DESC LIMIT 40""")

    # category x store (покрытие) — выручка
    out["cat_store"]=run("""SELECT category, store, ROUND(SUM(qty*pr),0) revenue
      FROM tx GROUP BY category, store""")

    # ABC: товары по выручке (для кумуляты). Топ-300 + агрегат хвоста.
    out["sku_abc"]=run("""SELECT product_name, category, ROUND(SUM(qty*pr),0) revenue,
      ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty
      FROM tx GROUP BY product_name, category ORDER BY revenue DESC LIMIT 300""")
    out["sku_total"]=run("""SELECT COUNT(*) n, ROUND(SUM(revenue),0) rev FROM (
      SELECT product_name, SUM(qty*pr) revenue FROM tx GROUP BY product_name)""")[0]

    out["stores"]=[r["store"] for r in run("SELECT store FROM tx GROUP BY store ORDER BY store")]

    # оборачиваемость (turnover_monthly + матрица), только 38 реальных точек
    tmcases=" ".join(f"WHEN store='{k}' THEN '{v}'" for k,v in NORM.items())
    # по КАТЕГОРИЯМ
    turn_cat=f"""
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat FROM {MX} GROUP BY barcode),
    tm AS (SELECT barcode, SUM(sales_cost) sales, SUM((start_cost+end_cost)/2) avg_stock
           FROM {TM} WHERE year={YEAR} AND store IN {keep} GROUP BY barcode)
    SELECT COALESCE(m.cat,'Прочее (нет в матрице)') category,
      ROUND(SUM(tm.sales),0) sales_cost, ROUND(SUM(tm.avg_stock),0) avg_stock,
      ROUND(SAFE_DIVIDE(SUM(tm.sales),SUM(tm.avg_stock)),2) turnover_rate
    FROM tm LEFT JOIN m USING(barcode)
    GROUP BY category HAVING avg_stock>0 ORDER BY sales_cost DESC"""
    out["turnover"]=[dict(r) for r in client.query(turn_cat).result()]

    # по МАГАЗИНАМ (агрегация по адресам с нормализацией)
    turn_store=f"""
    WITH tm AS (
      SELECT CASE {tmcases} END store, SUM(sales_cost) sales, SUM((start_cost+end_cost)/2) avg_stock
      FROM {TM} WHERE year={YEAR} AND store IN {keep} GROUP BY store)
    SELECT store, ROUND(SUM(sales),0) sales_cost, ROUND(SUM(avg_stock),0) avg_stock,
      ROUND(SAFE_DIVIDE(SUM(sales),SUM(avg_stock)),2) turnover_rate
    FROM tm GROUP BY store HAVING avg_stock>0 ORDER BY turnover_rate DESC"""
    out["turnover_store"]=[dict(r) for r in client.query(turn_store).result()]

    # ABC по всем товарам
    out["abc"]={
      "classes": run("""
        , abc_sku AS (SELECT product_name, SUM(qty*pr) rev, SUM((pr-pp)*qty) gp FROM tx GROUP BY product_name),
        abc_ranked AS (SELECT rev, gp, SUM(rev) OVER (ORDER BY rev DESC)/SUM(rev) OVER () cum FROM abc_sku)
        SELECT CASE WHEN cum<=0.8 THEN 'A' WHEN cum<=0.95 THEN 'B' ELSE 'C' END abc,
          COUNT(*) skus, ROUND(SUM(rev),0) revenue, ROUND(SUM(gp),0) gp
        FROM abc_ranked GROUP BY abc ORDER BY abc"""),
      "curve": [[c["rn"],c["cum_pct"]] for c in run("""
        , abc_sku AS (SELECT product_name, SUM(qty*pr) rev FROM tx GROUP BY product_name),
        abc_ranked AS (SELECT ROW_NUMBER() OVER (ORDER BY rev DESC) rn,
          SUM(rev) OVER (ORDER BY rev DESC)/SUM(rev) OVER () cum, COUNT(*) OVER () n FROM abc_sku)
        SELECT rn, ROUND(cum*100,2) cum_pct FROM abc_ranked
        WHERE MOD(rn,GREATEST(1,CAST(CEIL(n/150) AS INT64)))=0 OR rn=1 ORDER BY rn""")],
      "total_sku": run("SELECT COUNT(DISTINCT product_name) n FROM tx")[0]["n"],
    }

    json.dump(out, open(OUT,"w"), ensure_ascii=False, separators=(",",":"))
    import os as _os
    print("OK size:", round(_os.path.getsize(OUT)/1024,1),"KB")
    print("KPI:", out["kpi"])
    print("категорий:",len(out["by_category"]),"| магазинов:",len(out["stores"]),
          "| поставщиков:",len(out["by_supplier"]),"| SKU ABC:",len(out["sku_abc"]),
          "| оборач.категорий:",len(out["turnover"]),"| оборач.магазинов:",len(out["turnover_store"]))

if __name__=="__main__":
    main()
