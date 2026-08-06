#!/usr/bin/env python3
"""Данные для перемещений, неликвидов (по позициям + поставщик), кросс-продаж (по позициям), списаний.
Категория/поставщик — из assortment_matrix_full. Использует промежуточную таблицу _dash_tx26 (создаёт fetch_data.py)."""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

YEAR = int(os.environ.get("REPORT_YEAR", 2026))
creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
client = bigquery.Client(credentials=creds, project=creds.project_id)

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
 "Переяславська 23":"Переяславська 23","Петра Григоренка 37":"Петра Григоренка 37",
 "Полевая 83":"Полевая магазин","Полевая-Магазин":"Полевая магазин",  # склад/опт — помечен, но исключён из перемещений
 "Пр-т Героїв Харкова 160":"Героїв Харкова 160","Пр-т Тракторобудiвникiв 95":"Тракторобудівників 95",
 "Пр-т Ювілейний 67":"Ювілейний 67","Роганська 130/4":"Роганська 130/4","Роганська 148":"Роганська 148",
 "Салтівське шосе 264В":"Салтівське шосе 264В","Танкопія 16":"Танкопія 16","Шевченко 341":"Шевченко 341",
}
keep = "(" + ",".join(f"'{k}'" for k in NORM) + ")"
cs_sc = " ".join(f"WHEN store_address='{k}' THEN '{v}'" for k, v in NORM.items())
cs_tt = " ".join(f"WHEN store='{k}' THEN '{v}'" for k, v in NORM.items())
cs_wo = " ".join(f"WHEN sender_store='{k}' THEN '{v}'" for k, v in NORM.items())
SC = "`family-market-analytics.returns_system.stock_current`"
TT = "`family-market-analytics.family_market.turnover_transactions`"
MX = "`family-market-analytics.family_market.assortment_matrix_full`"
WO = "`family-market-analytics.writeoffs.writeoffs_report`"
CW = "`family-market-analytics.family_market.culinary_writeoffs`"
ST = "`family-market-analytics.family_market._dash_tx26`"

def rows(sql): return [dict(r) for r in client.query(sql).result()]
out = {"year": YEAR, "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}

# ---------- ПЕРЕМЕЩЕНИЯ (донор без продаж 90д -> получатель со спросом) ----------
# Только между розничными магазинами (Полевая-склад/опт уже исключена из keep).
# Донор — 0 продаж за 90д (остаток можно освободить). Получатель — есть спрос, мало остатка.
# recv_month = месячная скорость продаж получателя (qty90/3) = минимально необходимый остаток на месяц.
# move_qty = сколько переместить = нужное получателю до месячного остатка, но не больше остатка донора.
move_core = f"""
WITH sales90 AS (
  SELECT barcode, CASE {cs_tt} END store, SUM(quantity) qty90
  FROM {TT} WHERE transaction_datetime>=TIMESTAMP_SUB((SELECT MAX(transaction_datetime) FROM {TT}),INTERVAL 90 DAY)
    AND store IN {keep} GROUP BY barcode, store),
stock AS (SELECT barcode, ANY_VALUE(product_name) nm, CASE {cs_sc} END store, SUM(qty_in_stock) qty, ANY_VALUE(cost_price) cost
  FROM {SC} WHERE store_address IN {keep} AND qty_in_stock>0 GROUP BY barcode, store),
m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
donors AS (SELECT s.barcode, s.nm, s.store, s.qty, s.cost FROM stock s
  LEFT JOIN sales90 sl USING(barcode,store) WHERE COALESCE(sl.qty90,0)=0 AND s.qty>=3),
recv AS (SELECT sl.barcode, sl.store, sl.qty90, COALESCE(s.qty,0) stock_now FROM sales90 sl
  LEFT JOIN stock s USING(barcode,store) WHERE sl.qty90>=5 AND COALESCE(s.qty,0)<=2)
SELECT product, category, supplier, donor, donor_stock, receiver, recv_sells, recv_stock, recv_month, move_qty,
  ROUND(move_qty*cost,0) value
FROM (
  SELECT d.nm product, COALESCE(m.cat,'Прочее (нет в матрице)') category, COALESCE(m.sup,'(нет в матрице)') supplier,
    d.store donor, CAST(ROUND(d.qty,0) AS INT64) donor_stock, d.cost cost,
    r.store receiver, CAST(ROUND(r.qty90,0) AS INT64) recv_sells, CAST(ROUND(r.stock_now,0) AS INT64) recv_stock,
    CAST(CEIL(r.qty90/3.0) AS INT64) recv_month,
    LEAST(CAST(ROUND(d.qty,0) AS INT64),
          GREATEST(0, CAST(CEIL(r.qty90/3.0) AS INT64) - CAST(ROUND(r.stock_now,0) AS INT64))) move_qty
  FROM donors d JOIN recv r ON d.barcode=r.barcode AND d.store!=r.store
  LEFT JOIN m ON m.barcode=d.barcode)
WHERE move_qty>0 AND donor!='Полевая магазин' AND receiver!='Полевая магазин'"""
move = move_core + " ORDER BY recv_sells DESC, value DESC LIMIT 300"
out["moves"] = rows(move)
out["moves_summary"] = rows(f"SELECT COUNT(*) pairs, COUNT(DISTINCT product) skus, ROUND(SUM(value),0) value FROM ({move_core})")[0]

# ---------- ДЕФИЦИТ / УПУЩЕННЫЕ ПРОДАЖИ (товар продаётся, но остаток 0) ----------
oos = f"""
WITH sales90 AS (SELECT barcode, ANY_VALUE(product_name) nm, CASE {cs_tt} END store, SUM(quantity) qty90
  FROM {TT} WHERE transaction_datetime>=TIMESTAMP_SUB((SELECT MAX(transaction_datetime) FROM {TT}),INTERVAL 90 DAY)
    AND store IN {keep} GROUP BY barcode, store),
stock AS (SELECT barcode, CASE {cs_sc} END store, SUM(qty_in_stock) qty FROM {SC}
  WHERE store_address IN {keep} GROUP BY barcode, store),
anystk AS (SELECT barcode, SUM(qty_in_stock) tot FROM {SC} WHERE store_address IN {keep} GROUP BY barcode),
m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode)
SELECT s.nm product, COALESCE(m.cat,'Прочее (нет в матрице)') category, COALESCE(m.sup,'(нет в матрице)') supplier,
  s.store, CAST(ROUND(s.qty90,0) AS INT64) sold90, CAST(CEIL(s.qty90/3.0) AS INT64) need_month,
  IFNULL(a.tot,0)>0 elsewhere
FROM sales90 s LEFT JOIN stock st USING(barcode,store) LEFT JOIN anystk a USING(barcode) LEFT JOIN m ON m.barcode=s.barcode
WHERE s.qty90>=10 AND COALESCE(st.qty,0)<=0 AND s.store!='Полевая магазин'
ORDER BY sold90 DESC LIMIT 500"""
out["oos"] = rows(oos)

# ---------- НЕЛИКВИДЫ: по позициям с поставщиком (остаток есть, продаж 90д нет) ----------
dead = f"""
WITH sales90 AS (SELECT barcode, CASE {cs_tt} END store, SUM(quantity) q90 FROM {TT}
  WHERE transaction_datetime>=TIMESTAMP_SUB((SELECT MAX(transaction_datetime) FROM {TT}),INTERVAL 90 DAY)
    AND store IN {keep} GROUP BY barcode,store),
stock AS (SELECT barcode, ANY_VALUE(product_name) nm, CASE {cs_sc} END store, SUM(qty_in_stock) qty, ANY_VALUE(cost_price) cost
  FROM {SC} WHERE store_address IN {keep} AND qty_in_stock>0 GROUP BY barcode,store),
m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
dead0 AS (
  SELECT s.nm p, COALESCE(m.cat,'Прочее (нет в матрице)') c, COALESCE(m.sup,'(нет в матрице)') s,
    s.store, s.qty, s.qty*s.cost value
  FROM stock s LEFT JOIN sales90 sl USING(barcode,store) LEFT JOIN m ON m.barcode=s.barcode
  WHERE COALESCE(sl.q90,0)=0)
SELECT * FROM dead0"""
out["dead_items"] = rows(f"SELECT p, c, s, store, ROUND(qty,0) qty, ROUND(value,0) value FROM ({dead}) ORDER BY value DESC LIMIT 1200")
out["dead_by_store"] = rows(f"SELECT store, ROUND(SUM(value),0) dead_value, COUNT(*) dead_skus FROM ({dead}) GROUP BY store ORDER BY dead_value DESC")
out["dead_by_cat"] = rows(f"SELECT c category, ROUND(SUM(value),0) dead_value, COUNT(*) dead_skus FROM ({dead}) GROUP BY c ORDER BY dead_value DESC")
out["dead_by_supplier"] = rows(f"SELECT s supplier, ROUND(SUM(value),0) dead_value, COUNT(*) dead_skus FROM ({dead}) GROUP BY s ORDER BY dead_value DESC LIMIT 40")
out["dead_total"] = rows(f"SELECT ROUND(SUM(value),0) v, COUNT(*) n FROM ({dead})")[0]

# ---------- КРОСС-ПРОДАЖИ: по позициям (пары товаров в одном чеке) ----------
cross_items = f"""
WITH top AS (SELECT barcode FROM (SELECT barcode, SUM(qty) q FROM {ST} GROUP BY barcode ORDER BY q DESC LIMIT 500)),
b AS (SELECT tid, barcode, ANY_VALUE(product_name) nm, ANY_VALUE(category) c FROM {ST} JOIN top USING(barcode) GROUP BY tid, barcode),
pairs AS (SELECT a.barcode x, b.barcode y, ANY_VALUE(a.nm) n1, ANY_VALUE(b.nm) n2, ANY_VALUE(a.c) c1, ANY_VALUE(b.c) c2,
    COUNT(DISTINCT a.tid) cnt FROM b a JOIN b b ON a.tid=b.tid AND a.barcode<b.barcode GROUP BY x,y)
SELECT n1 a, n2 b, c1, c2, cnt FROM pairs ORDER BY cnt DESC LIMIT 80"""
out["cross_items"] = rows(cross_items)
# кросс по категориям (для верхнеуровневого взгляда)
out["cross"] = rows(f"""
WITH tx AS (SELECT tid, category FROM {ST} WHERE in_matrix GROUP BY tid, category),
pairs AS (SELECT a.category c1, b.category c2, COUNT(DISTINCT a.tid) cnt
  FROM tx a JOIN tx b ON a.tid=b.tid AND a.category<b.category GROUP BY c1,c2)
SELECT c1, c2, cnt FROM pairs ORDER BY cnt DESC LIMIT 25""")

# ---------- СПИСАНИЯ ----------
out["writeoffs_by_store"] = rows(f"""SELECT CASE {cs_wo} END store, ROUND(SUM(amount_cost),0) amount, COUNT(*) cnt
  FROM {WO} WHERE EXTRACT(YEAR FROM writeoff_date)={YEAR} GROUP BY store HAVING store IS NOT NULL ORDER BY amount DESC LIMIT 20""")
out["writeoffs_top"] = rows(f"""SELECT w.product_name, COALESCE(m.sup,'(нет в матрице)') supplier,
  ROUND(SUM(w.amount_cost),0) amount, ROUND(SUM(w.quantity),0) qty
  FROM {WO} w LEFT JOIN (SELECT barcode, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode) m USING(barcode)
  WHERE EXTRACT(YEAR FROM w.writeoff_date)={YEAR} GROUP BY w.product_name, supplier ORDER BY amount DESC LIMIT 25""")
out["writeoffs_by_cat"] = rows(f"""SELECT COALESCE(m.cat,'Прочее (нет в матрице)') category,
  ROUND(SUM(w.amount_cost),0) amount, COUNT(*) cnt
  FROM {WO} w LEFT JOIN (SELECT barcode, ANY_VALUE(category) cat FROM {MX} GROUP BY barcode) m USING(barcode)
  WHERE EXTRACT(YEAR FROM w.writeoff_date)={YEAR} GROUP BY category ORDER BY amount DESC""")
out["writeoffs_by_supplier"] = rows(f"""SELECT COALESCE(m.sup,'(нет в матрице)') supplier,
  ROUND(SUM(w.amount_cost),0) amount, COUNT(*) cnt
  FROM {WO} w LEFT JOIN (SELECT barcode, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode) m USING(barcode)
  WHERE EXTRACT(YEAR FROM w.writeoff_date)={YEAR} GROUP BY supplier ORDER BY amount DESC LIMIT 20""")
out["culinary_writeoffs"] = rows(f"""SELECT reason, ROUND(SUM(cost),0) cost, COUNT(*) cnt
  FROM {CW} GROUP BY reason ORDER BY cost DESC""")

OUT = os.environ.get("OUT_PATH", "page3_data.json")
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
import os as _o
print("OK", round(_o.path.getsize(OUT) / 1024, 1), "KB")
print("перемещения:", out["moves_summary"], "| строк:", len(out["moves"]))
print("неликвиды: позиций", len(out["dead_items"]), "| всего", out["dead_total"],
      "| поставщиков", len(out["dead_by_supplier"]))
print("кросс-пары товаров:", len(out["cross_items"]), "| списания магазинов:", len(out["writeoffs_by_store"]))
