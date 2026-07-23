#!/usr/bin/env python3
"""Данные для страницы 3 (Перемещения) + неликвиды, кросс-продажи, списания/возвраты."""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

YEAR=2026
creds=service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
client=bigquery.Client(credentials=creds, project=creds.project_id)

NORM = {
 "Іскрінський 19":"Іскринський 19В","Амосова 5А":"Амосова 5А","Астрономічна 44Г":"Астрономічна 44Г",
 "Байрона 138/1":"Байрона 138/1","Героїв Сталінграда 138/1":"Байрона 138/1","Байрона 156":"Байрона 156",
 "Героїв Сталінграду 156":"Байрона 156","Байрона 163":"Байрона 163А","Героїв Сталінграду 163А":"Байрона 163А",
 "Богдана Хмельницького 8":"Богдана Хмельницького 8","Бучми 32":"Бучми 32","Бучми 52":"Бучми 52",
 "Бучми Джерело":"Бучми 32Б1","Валентинівська 24":"Валентинівська 24Б","Валентинівська 50А":"Валентинівська 50А",
 "Гарібальді 1":"Гарібальді 1","Гвардійців Широнінців 54":"Гвардійців Широнінців 54","Грозненська 38":"Грозненська 38",
 "Зернова 6/5":"Зернова 6/5","Зубенко 23":"Зубенка 23","Зубенко 31В/5":"Зубенка 31В5","Качанівська 19":"Качанівська 19",
 "Краснодарська 171з":"Краснодарська 171/З","Михайля Семенка 17":"Михайля Семенка 17",
 "Небесної Сотні 14/1":"Героїв Небесної Сотні 14/1","Нескорених 33":"Нескорених 33","Нескорених 4Д":"Нескорених 4Д",
 "Ньютона 102":"Ньютона 102","Ньютона 111":"Ньютона 111","Олімпійська 9А":"Олімпійська 9А",
 "Переяславська 23":"Переяславська 23","Петра Григоренка 37":"Петра Григоренка 37","Полевая 83":"Полевая 83",
 "Полевая-Магазин":"Полевая 83","Пр-т Героїв Харкова 160":"Героїв Харкова 160","Пр-т Тракторобудiвникiв 95":"Тракторобудівників 95",
 "Пр-т Ювілейний 67":"Ювілейний 67","Роганська 130/4":"Роганська 130/4","Роганська 148":"Роганська 148",
 "Салтівське шосе 264В":"Салтівське шосе 264В","Танкопія 16":"Танкопія 16","Шевченко 341":"Шевченко 341",
}
keep="("+",".join(f"'{k}'" for k in NORM)+")"
cs_sc=" ".join(f"WHEN store_address='{k}' THEN '{v}'" for k,v in NORM.items())
cs_tt=" ".join(f"WHEN store='{k}' THEN '{v}'" for k,v in NORM.items())
SC="`family-market-analytics.returns_system.stock_current`"
TT="`family-market-analytics.family_market.turnover_transactions`"
MX="`family-market-analytics.family_market.assortment_matrix_full`"
WO="`family-market-analytics.writeoffs.writeoffs_report`"
CW="`family-market-analytics.family_market.culinary_writeoffs`"
def rows(sql): return [dict(r) for r in client.query(sql).result()]
out={"year":YEAR,"updated_at":datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d %H:%M UTC")}

# ---------- СТРАНИЦА 3: ПЕРЕМЕЩЕНИЯ ----------
move=f"""
WITH sales90 AS (
  SELECT barcode, CASE {cs_tt} END store, SUM(quantity) qty90
  FROM {TT} WHERE transaction_datetime>=TIMESTAMP_SUB((SELECT MAX(transaction_datetime) FROM {TT}),INTERVAL 90 DAY)
    AND store IN {keep} GROUP BY barcode, store),
stock AS (SELECT barcode, ANY_VALUE(product_name) nm, CASE {cs_sc} END store, SUM(qty_in_stock) qty, ANY_VALUE(cost_price) cost
  FROM {SC} WHERE store_address IN {keep} AND qty_in_stock>0 GROUP BY barcode, store),
donors AS (SELECT s.barcode, s.nm, s.store, s.qty, s.cost FROM stock s
  LEFT JOIN sales90 sl USING(barcode,store) WHERE COALESCE(sl.qty90,0)=0 AND s.qty>=3),
recv AS (SELECT sl.barcode, sl.store, sl.qty90, COALESCE(s.qty,0) stock_now FROM sales90 sl
  LEFT JOIN stock s USING(barcode,store) WHERE sl.qty90>=5 AND COALESCE(s.qty,0)<=2)
SELECT d.nm product, d.store donor, ROUND(d.qty,0) donor_stock, ROUND(d.qty*d.cost,0) value,
  r.store receiver, ROUND(r.qty90,0) recv_sells, ROUND(r.stock_now,0) recv_stock
FROM donors d JOIN recv r ON d.barcode=r.barcode AND d.store!=r.store
ORDER BY r.qty90 DESC LIMIT 200"""
out["moves"]=rows(move)
# summary перемещений (по уже отобранным парам)
out["moves_summary"]=rows(f"SELECT COUNT(*) pairs, COUNT(DISTINCT product) skus, ROUND(SUM(value),0) value FROM ({move.replace(' ORDER BY r.qty90 DESC LIMIT 200','')})")[0]

# ---------- НЕЛИКВИДЫ / ЗАМОРОЖЕННЫЙ КАПИТАЛ ----------
dead=f"""
WITH sales90 AS (SELECT barcode, CASE {cs_tt} END store, SUM(quantity) q90 FROM {TT}
  WHERE transaction_datetime>=TIMESTAMP_SUB((SELECT MAX(transaction_datetime) FROM {TT}),INTERVAL 90 DAY)
    AND store IN {keep} GROUP BY barcode,store),
stock AS (SELECT barcode, CASE {cs_sc} END store, SUM(qty_in_stock) qty, ANY_VALUE(cost_price) cost
  FROM {SC} WHERE store_address IN {keep} AND qty_in_stock>0 GROUP BY barcode,store),
m AS (SELECT barcode, ANY_VALUE(category) cat FROM {MX} GROUP BY barcode)
SELECT COALESCE(m.cat,'Прочее (нет в матрице)') category, s.store,
  ROUND(SUM(IF(COALESCE(sl.q90,0)=0, s.qty*s.cost, 0)),0) dead_value,
  COUNTIF(COALESCE(sl.q90,0)=0) dead_skus
FROM stock s LEFT JOIN sales90 sl USING(barcode,store) LEFT JOIN m USING(barcode)
GROUP BY category, store"""
out["dead_by_store"]=rows(f"SELECT store, ROUND(SUM(dead_value),0) dead_value, SUM(dead_skus) dead_skus FROM ({dead}) GROUP BY store ORDER BY dead_value DESC")
out["dead_by_cat"]=rows(f"SELECT category, ROUND(SUM(dead_value),0) dead_value, SUM(dead_skus) dead_skus FROM ({dead}) GROUP BY category ORDER BY dead_value DESC LIMIT 15")

# ---------- КРОСС-ПРОДАЖИ (пары категорий в чеке) ----------
cross=f"""
WITH tx AS (SELECT t.transaction_id, m.cat FROM {TT} t
  JOIN (SELECT barcode, ANY_VALUE(category) cat FROM {MX} GROUP BY barcode) m USING(barcode)
  WHERE EXTRACT(YEAR FROM t.transaction_datetime)={YEAR} AND CASE {cs_tt} END IS NOT NULL AND m.cat IS NOT NULL),
pairs AS (SELECT a.cat c1, b.cat c2, COUNT(DISTINCT a.transaction_id) cnt
  FROM tx a JOIN tx b ON a.transaction_id=b.transaction_id AND a.cat<b.cat GROUP BY c1,c2)
SELECT c1, c2, cnt FROM pairs ORDER BY cnt DESC LIMIT 25"""
out["cross"]=rows(cross)

# ---------- СПИСАНИЯ ----------
out["writeoffs_by_store"]=rows(f"""SELECT CASE {cs_tt.replace('store','sender_store')} END store,
  ROUND(SUM(amount_cost),0) amount, COUNT(*) cnt FROM {WO}
  WHERE EXTRACT(YEAR FROM writeoff_date)={YEAR} GROUP BY store HAVING store IS NOT NULL ORDER BY amount DESC LIMIT 20""")
out["writeoffs_top"]=rows(f"""SELECT product_name, ROUND(SUM(amount_cost),0) amount, ROUND(SUM(quantity),0) qty
  FROM {WO} WHERE EXTRACT(YEAR FROM writeoff_date)={YEAR} GROUP BY product_name ORDER BY amount DESC LIMIT 15""")
out["culinary_writeoffs"]=rows(f"""SELECT reason, ROUND(SUM(cost),0) cost, COUNT(*) cnt
  FROM {CW} GROUP BY reason ORDER BY cost DESC""")

OUT=os.environ.get("OUT_PATH","page3_data.json")
json.dump(out, open(OUT,"w"), ensure_ascii=False, separators=(",",":"))
import os as _o
print("OK", round(_o.path.getsize(OUT)/1024,1),"KB")
print("перемещения:", out["moves_summary"], "| строк рекоменд.:", len(out["moves"]))
print("неликвиды складов:", len(out["dead_by_store"]), "| кросс-пары:", len(out["cross"]),
      "| списания магазинов:", len(out["writeoffs_by_store"]))
