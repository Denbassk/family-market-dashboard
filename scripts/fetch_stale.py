#!/usr/bin/env python3
"""«Не двигается N дней» — научно-корректная методика:
  ОСТАТОК   — реальный снимок склада (stock_current), qty_in_stock>0;
  ПРОДАЖА   — последняя дата продажи по чекам (turnover_transactions);
  ДНЕЙ      — (дата последних данных) − (последняя продажа); нет продаж → 999 («нет продаж»);
  ПРИХОД    — последняя дата прихода (incoming) как контекст (недавно завезённое ≠ неликвид).
Пишется в отдельный docs/stale.json (грузится по требованию). Клиент фильтрует по дней>=N + магазин/категория/товар."""
import os, json, datetime, sys
sys.path.append(os.path.dirname(__file__))
from fetch_page3 import NORM, keep, cs_sc, cs_tt, SC, TT, MX
from google.cloud import bigquery
from google.oauth2 import service_account

creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
client = bigquery.Client(credentials=creds, project=creds.project_id)
IN = "`family-market-analytics.family_market.incoming_transactions`"

# «Технические» товары — расходники собственного производства (не пробиваются на кассе поштучно,
# требуют комплектации: кофейный аппарат, хот-дог, упаковка). Узкий список без ложных срабатываний.
TECH_SUB = [
    # кофейный аппарат
    "кава зернова", "зернова кава", "кава в зернах",
    "сухе молоко (1кг)", "капучино (1кг)", "капучіно (1кг)", "лате (1кг)", "латте (1кг)",
    "какао (1кг)", "еспресо (1кг)", "айріш капучино",
    # стаканчики / крышки / размешиватели
    "стакан паперов", "стакан пластик", "стакан гофр", "паперовий стакан", "пластиковий стакан",
    "гофр.стакан", "гофр стакан", "кришка для", "кришка біла", "розмішувач", "мішалка для", "стірер",
    # булочки для хот-дога / упаковка
    "булка для хот", "булочка для хот", "пакет фасув",
]


def is_tech(name):
    n = (name or "").lower()
    if any(k in n for k in TECH_SUB):
        return 1
    # оптовые расходники хот-дога: сосиски/сардельки от мясокомбината или на вес (1кг)
    if ("сосиск" in n or "сардель" in n) and ("1кг" in n or "мк " in n):
        return 1
    return 0


def main():
    sql = f"""
    WITH maxd AS (SELECT MAX(transaction_datetime) md FROM {TT}),
    ls AS (SELECT barcode, CASE {cs_tt} END store, MAX(transaction_datetime) t FROM {TT} WHERE store IN {keep} GROUP BY barcode, store),
    inc AS (SELECT barcode, CASE {cs_tt} END store, MAX(incoming_datetime) t FROM {IN} WHERE store IN {keep} GROUP BY barcode, store),
    stock AS (SELECT barcode, ANY_VALUE(product_name) nm, CASE {cs_sc} END store, SUM(qty_in_stock) qty, ANY_VALUE(cost_price) cost
      FROM {SC} WHERE store_address IN {keep} AND qty_in_stock>0 GROUP BY barcode, store),
    m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode)
    SELECT CAST(st.barcode AS STRING) b, st.nm p, COALESCE(m.cat,'Прочее (нет в матрице)') c, COALESCE(m.sup,'(нет в матрице)') s, st.store st,
      CAST(ROUND(st.qty,0) AS INT64) q, CAST(ROUND(st.qty*st.cost,0) AS INT64) v,
      IFNULL(DATE_DIFF(DATE((SELECT md FROM maxd)), DATE(ls.t), DAY), 999) d,
      IFNULL(CAST(DATE(ls.t) AS STRING), '—') last,
      IFNULL(CAST(DATE(inc.t) AS STRING), '—') last_in
    FROM stock st
    LEFT JOIN ls  ON ls.barcode=st.barcode  AND ls.store=st.store
    LEFT JOIN inc ON inc.barcode=st.barcode AND inc.store=st.store
    LEFT JOIN m   ON m.barcode=st.barcode
    WHERE IFNULL(DATE_DIFF(DATE((SELECT md FROM maxd)), DATE(ls.t), DAY), 999) >= 3
    ORDER BY v DESC"""
    rows = [dict(r) for r in client.query(sql).result()]
    for r in rows:
        r["t"] = is_tech(r.get("p"))
    maxd = list(client.query(f"SELECT CAST(DATE(MAX(transaction_datetime)) AS STRING) d FROM {TT}").result())[0]["d"]
    out = {"rows": rows, "as_of": maxd,
           "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    OUT = os.environ.get("OUT_PATH", os.path.join(os.path.dirname(__file__), "..", "docs", "stale.json"))
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("stale rows:", len(rows), "| as_of:", maxd, "| KB:", round(os.path.getsize(OUT) / 1024, 1))


if __name__ == "__main__":
    main()
