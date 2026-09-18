#!/usr/bin/env python3
"""Данные для перемещений, неликвидов (по позициям + поставщик), кросс-продаж (по позициям), списаний.
Категория/поставщик — из assortment_matrix_full. Использует промежуточную таблицу _dash_tx26 (создаёт fetch_data.py).

ЦЕНА ЗАПРОСОВ (переделано 2026-09-03). Раньше блок «продажи за 90 дней» (sales90) был
подставлен ТЕКСТОМ в семь запросов подряд — перемещения, их итог, дефицит и пять срезов
неликвидов, — и каждый раз заново читал turnover_transactions (2,69 ГБ, без партиций).
Замер на сборке 2026-09-03 07:30: 1125 + 573 + 573 + 569 x 4 = 5,5 ГБ из 21 ГБ всей сборки.
Теперь sales90, снимок остатков и сами неликвиды считаются ОДИН раз в маленькие витрины
_dash_s90 / _dash_stk / _dash_dead, а семь запросов читают уже их (десятки мегабайт).

Кросс-продажи считают COUNT(DISTINCT tid) по парам. Строковый tid — 175 МБ на скан,
поэтому в промежуточной таблице лежит tidn = FARM_FINGERPRINT(tid) (32 МБ). Для пар это
равнозначно: вероятность коллизии на 1,8 млн чеков ~1e-7, а сумма выручки через tidn
не считается нигде — только счёт пар.
"""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from domain import NORM, WHOLESALE, sql_case, sql_keep  # единый источник имён точек, см. scripts/domain.py

YEAR = int(os.environ.get("REPORT_YEAR", 2026))
creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
client = bigquery.Client(credentials=creds, project=creds.project_id)

keep = sql_keep()
cs_tt = sql_case("store")
cs_wo = sql_case("sender_store")
SM = "`family-market-analytics.family_market.stock_matrix`"   # свежий снимок Торгсофта (заменил удалённую stock_current)
TT = "`family-market-analytics.family_market.turnover_transactions`"
MX = "`family-market-analytics.family_market.assortment_matrix_full`"
WO = "`family-market-analytics.writeoffs.writeoffs_report`"
CW = "`family-market-analytics.family_market.culinary_writeoffs`"
ST = "`family-market-analytics.family_market._dash_tx26`"
AG = "`family-market-analytics.family_market._dash_a26`"
S90 = "`family-market-analytics.family_market._dash_s90`"
STK = "`family-market-analytics.family_market._dash_stk`"
DEAD = "`family-market-analytics.family_market._dash_dead`"

ELSEWHERE_MIN = int(os.environ.get("ELSEWHERE_MIN", "3"))
CROSS_MIN = int(os.environ.get("CROSS_MIN", "50"))  # min chekov na paru dlya lift
OOS_MIN = int(os.environ.get("OOS_MIN", "30"))  # min prodazh za 90d, chtoby schitat deficitom

def rows(sql): return [dict(r) for r in client.query(sql).result()]
# актуальный снимок остатков (не хардкод)
snap = list(client.query(f"SELECT CAST(MAX(snapshot_date) AS STRING) d FROM {SM}").result())[0]["d"]
print("снимок остатков stock_matrix:", snap)

# ---------- ВИТРИНЫ (один проход вместо семи) ----------
# _dash_s90 — продажи за последние 90 дней по (штрих-код, магазин). Раньше этот блок
# читал turnover_transactions в каждом из семи запросов.
# _dash_stk — снимок остатков на выбранную дату: количество, себестоимость, название.
#             ANY_VALUE тут был и раньше; посчитанный один раз, он ещё и стабильнее —
#             все семь отчётов теперь видят одно и то же название и одну себестоимость.
# _dash_dead — «неликвиды»: есть остаток, за 90 дней ни одной продажи. Пять срезов ниже
#             (по позициям, магазинам, категориям, поставщикам, итог) читают эту витрину.
if not os.environ.get("SKIP_STAGING"):
    client.query(f"""
    CREATE OR REPLACE TABLE {S90} AS
    SELECT barcode, CASE {cs_tt} END store, ANY_VALUE(product_name) nm, SUM(quantity) qty90
    FROM {TT}
    WHERE transaction_datetime >= TIMESTAMP_SUB((SELECT MAX(transaction_datetime) FROM {TT}), INTERVAL 90 DAY)
      AND store IN {keep}
    GROUP BY barcode, store""").result()
    # qty — по всем строкам снимка (так считал stock_cte(False) для дефицита),
    # qty_pos/nm_pos/cost_pos — только по строкам quantity>=0.001 (так считал stock_cte(True)
    # для перемещений и неликвидов). Обе версии нужны, чтобы цифры не поехали.
    client.query(f"""
    CREATE OR REPLACE TABLE {STK} AS
    SELECT barcode, CASE {cs_tt} END store,
           SUM(quantity) qty,
           SUM(IF(quantity>=0.001, quantity, 0)) qty_pos,
           COUNTIF(quantity>=0.001) n_pos,
           ANY_VALUE(IF(quantity>=0.001, product_name, NULL)) nm,
           ANY_VALUE(IF(quantity>=0.001, COALESCE(cost_price,0), NULL)) cost
    FROM {SM} WHERE snapshot_date=DATE'{snap}' AND store IN {keep}
    GROUP BY barcode, store""").result()
    client.query(f"""
    CREATE OR REPLACE TABLE {DEAD} AS
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
    stock AS (SELECT barcode, store, nm, qty_pos qty, cost FROM {STK} WHERE n_pos>0)
    SELECT s.barcode, s.nm p, COALESCE(m.cat,'Прочее (нет в матрице)') c, COALESCE(m.sup,'(нет в матрице)') s,
      s.store, s.qty, s.qty*s.cost value
    FROM stock s LEFT JOIN {S90} sl USING(barcode,store) LEFT JOIN m ON m.barcode=s.barcode
    WHERE COALESCE(sl.qty90,0)=0""").result()

out = {"year": YEAR, "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "stock_as_of": snap}

# ---------- ПЕРЕМЕЩЕНИЯ (донор без продаж 90д -> получатель со спросом) ----------
# Только между розничными магазинами (Полевая-склад/опт уже исключена из keep).
# Донор — 0 продаж за 90д (остаток можно освободить). Получатель — есть спрос, мало остатка.
# recv_month = месячная скорость продаж получателя (qty90/3) = минимально необходимый остаток на месяц.
# move_qty = сколько переместить = нужное получателю до месячного остатка, но не больше остатка донора.
move_core = f"""
WITH sales90 AS (SELECT barcode, store, qty90 FROM {S90}),
stock AS (SELECT barcode, store, nm, qty_pos qty, cost FROM {STK} WHERE n_pos>0),
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
# LIMIT snyat: itog schitaem po toy zhe vyborke, chto uhodit v tablicu.
move = move_core + " ORDER BY recv_sells DESC, value DESC"
_raw_moves = rows(move)
from allocate import allocate_moves
MIN_MOVE_VALUE = float(os.environ.get("MIN_MOVE_VALUE", "150"))
out["moves"], _mv_rep = allocate_moves(_raw_moves, min_value=MIN_MOVE_VALUE)
print("moves allocation:", _mv_rep)
out["moves_summary"] = {
    "pairs": len(out["moves"]),
    "skus": len({r["product"] for r in out["moves"]}),
    "value": int(sum(float(r["value"] or 0) for r in out["moves"])),
    "allocated": True,
}
# ---------- ДЕФИЦИТ / УПУЩЕННЫЕ ПРОДАЖИ (товар продаётся, но остаток 0) ----------
from nonstock import split_oos, sql_exclude, sql_only
_EXCL = sql_exclude()
_ONLY = sql_only()
_XC = sql_exclude("a.category", "a.supplier")

oos = f"""
WITH sales90 AS (SELECT barcode, nm, store, qty90 FROM {S90}),
stock AS (SELECT barcode, store, qty FROM {STK}),
anystk AS (SELECT barcode, SUM(GREATEST(qty,0)) tot,
           COUNTIF(qty>={ELSEWHERE_MIN}) donor_stores
           FROM {STK} WHERE store IS NOT NULL AND store!='Полевая магазин' GROUP BY barcode),
m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode)
SELECT s.nm product, COALESCE(m.cat,'Прочее (нет в матрице)') category, COALESCE(m.sup,'(нет в матрице)') supplier,
  s.store, CAST(ROUND(s.qty90,0) AS INT64) sold90, CAST(CEIL(s.qty90/3.0) AS INT64) need_month,
  IFNULL(a.donor_stores,0)>0 elsewhere,
  IFNULL(a.donor_stores,0) donor_stores, CAST(ROUND(IFNULL(a.tot,0),0) AS INT64) net_qty
FROM sales90 s LEFT JOIN stock st USING(barcode,store) LEFT JOIN anystk a USING(barcode) LEFT JOIN m ON m.barcode=s.barcode
WHERE s.qty90>={OOS_MIN} AND COALESCE(st.qty,0)<=0 AND {_EXCL} AND s.store!='Полевая магазин'
ORDER BY sold90 DESC LIMIT 3000"""
_oos_raw = rows(oos)
out["oos"], _left = split_oos(_oos_raw)
assert not _left, "SQL-filtr propustil neposhtuchnye: %d" % len(_left)
out["oos_nonstock"] = rows(oos.replace(_EXCL, _ONLY).replace("LIMIT 3000", "LIMIT 400"))

# ---------- НЕЛИКВИДЫ: по позициям с поставщиком (остаток есть, продаж 90д нет) ----------
out["dead_items"] = rows(f"SELECT p, c, s, store, ROUND(qty,0) qty, ROUND(value,0) value FROM {DEAD} ORDER BY value DESC LIMIT 1200")
out["dead_by_store"] = rows(f"SELECT store, ROUND(SUM(value),0) dead_value, COUNT(*) dead_skus FROM {DEAD} GROUP BY store ORDER BY dead_value DESC")
out["dead_by_cat"] = rows(f"SELECT c category, ROUND(SUM(value),0) dead_value, COUNT(*) dead_skus FROM {DEAD} GROUP BY c ORDER BY dead_value DESC")
out["dead_by_supplier"] = rows(f"SELECT s supplier, ROUND(SUM(value),0) dead_value, COUNT(*) dead_skus FROM {DEAD} GROUP BY s ORDER BY dead_value DESC LIMIT 40")
out["dead_total"] = rows(f"SELECT ROUND(SUM(value),0) v, COUNT(*) n FROM {DEAD}")[0]

out["unmatched_items"] = rows(f"SELECT barcode, ANY_VALUE(p) p, COUNT(DISTINCT store) stores, ROUND(SUM(qty),0) qty, ROUND(SUM(value),0) value FROM {DEAD} WHERE c='Прочее (нет в матрице)' GROUP BY barcode ORDER BY value DESC LIMIT 800")
out["unmatched_total"] = rows(f"SELECT ROUND(SUM(value),0) v, COUNT(*) n, COUNT(DISTINCT barcode) skus FROM {DEAD} WHERE c='Прочее (нет в матрице)'")[0]

# ---------- КРОСС-ПРОДАЖИ: по позициям (пары товаров в одном чеке) ----------
# tidn вместо tid — см. шапку файла.
cross_items = f"""
WITH top AS (SELECT barcode FROM (SELECT a.barcode, SUM(a.qty) q FROM {AG} a
  WHERE {_XC} GROUP BY a.barcode ORDER BY q DESC LIMIT 500)),
tot AS (SELECT COUNT(DISTINCT tidn) n FROM {ST}),
b AS (SELECT tidn, barcode FROM {ST} JOIN top USING(barcode) GROUP BY tidn, barcode),
solo AS (SELECT barcode, COUNT(DISTINCT tidn) c FROM b GROUP BY barcode),
pairs AS (SELECT a.barcode x, b.barcode y, COUNT(DISTINCT a.tidn) cnt
  FROM b a JOIN b b ON a.tidn=b.tidn AND a.barcode<b.barcode GROUP BY x, y),
nm AS (SELECT barcode, ANY_VALUE(product_name) nm, ANY_VALUE(category) c,
       REGEXP_EXTRACT(LOWER(ANY_VALUE(product_name)), '^[^ ]+') brand
       FROM {AG} JOIN top USING(barcode) GROUP BY barcode)
SELECT n1.nm a, n2.nm b, n1.c c1, n2.c c2, p.cnt,
  ROUND(p.cnt * (SELECT n FROM tot) / (s1.c * s2.c), 2) lift,
  ROUND(p.cnt / s1.c * 100, 1) conf_ab,
  ROUND(p.cnt / s2.c * 100, 1) conf_ba,
  COALESCE(n1.brand,'?1')=COALESCE(n2.brand,'?2') same_brand
FROM pairs p
JOIN nm n1 ON n1.barcode=p.x JOIN nm n2 ON n2.barcode=p.y
JOIN solo s1 ON s1.barcode=p.x JOIN solo s2 ON s2.barcode=p.y
WHERE p.cnt >= {CROSS_MIN}
ORDER BY lift DESC LIMIT 400"""
_cx = rows(cross_items)
_diff = [r for r in _cx if not r["same_brand"]]
_same = [r for r in _cx if r["same_brand"]]
for r in _cx: r.pop("same_brand", None)
out["cross_items"] = _diff[:80]      # raznye brendy = nastoyaschiy kross-sell
out["cross_variants"] = _same[:40]   # odna lineyka = glubina assortimenta
# кросс по категориям (для верхнеуровневого взгляда)
out["cross"] = rows(f"""
WITH tx AS (SELECT tidn, category FROM {ST} WHERE in_matrix GROUP BY tidn, category),
pairs AS (SELECT a.category c1, b.category c2, COUNT(DISTINCT a.tidn) cnt
  FROM tx a JOIN tx b ON a.tidn=b.tidn AND a.category<b.category GROUP BY c1,c2)
SELECT c1, c2, cnt FROM pairs ORDER BY cnt DESC LIMIT 25""")

# ---------- СПИСАНИЯ ----------
out["writeoffs_by_store"] = rows(f"""SELECT CASE {cs_wo} END store, ROUND(SUM(amount_cost),0) amount, COUNT(*) cnt
  FROM {WO} WHERE EXTRACT(YEAR FROM writeoff_date)={YEAR} GROUP BY store HAVING store IS NOT NULL ORDER BY amount DESC""")
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
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
import os as _o
print("OK", round(_o.path.getsize(OUT) / 1024, 1), "KB")
print("перемещения:", out["moves_summary"], "| строк:", len(out["moves"]))
print("неликвиды: позиций", len(out["dead_items"]), "| всего", out["dead_total"],
      "| поставщиков", len(out["dead_by_supplier"]))
print("oos rows:", len(out["oos"]), "| nonstock:", len(out["oos_nonstock"]),
      "| unmatched:", len(out.get("unmatched_items", [])), out.get("unmatched_total"))
print("кросс-пары: разные бренды", len(out["cross_items"]),
      "| одна линейка", len(out["cross_variants"]), "| списания магазинов:", len(out["writeoffs_by_store"]))
