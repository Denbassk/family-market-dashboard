#!/usr/bin/env python3
"""Фокус-группы для собственника: динамика по месяцам + разрезы.
Читает промежуточную таблицу _dash_tx26 (создаёт fetch_data.py). Новую группу добавить = одна строка в GROUPS."""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
client = bigquery.Client(credentials=creds, project=creds.project_id)
ST = "`family-market-analytics.family_market._dash_tx26`"
OPT = "Полевая 83 (опт)"

# (имя группы, SQL-условие). Розничные группы исключают опт; «Полевая» — это сам опт-магазин.
GROUPS = [
    ("Кулинария и выпечка",
     f"(STARTS_WITH(TRIM(product_name),'Кулінарія') OR STARTS_WITH(TRIM(product_name),'Випічка')) AND store!='{OPT}'"),
    ("Кофе аппарат",
     f"category='Готовый напиток (кофемашина/автомат)' AND store!='{OPT}'"),
    ("Хот-дог",
     f"LOWER(product_name) LIKE '%хот%дог%' AND store!='{OPT}'"),
    ("Полевая (опт/база)",
     f"store='{OPT}'"),
]


def rows(sql): return [dict(r) for r in client.query(sql).result()]


def main():
    focus = []
    for name, cond in GROUPS:
        monthly = rows(f"""SELECT mo, ROUND(SUM(qty*pr),0) rev, ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty
          FROM {ST} WHERE {cond} GROUP BY mo ORDER BY mo""")
        total = rows(f"""SELECT ROUND(SUM(qty*pr),0) rev, ROUND(SUM((pr-pp)*qty),0) gp,
          ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) margin, ROUND(SUM(qty),0) qty,
          COUNT(DISTINCT barcode) skus, COUNT(DISTINCT tid) receipts, COUNT(DISTINCT store) stores
          FROM {ST} WHERE {cond}""")[0]
        products = rows(f"""SELECT product_name p, ROUND(SUM(qty*pr),0) rev, ROUND(SUM((pr-pp)*qty),0) gp,
          ROUND(SAFE_DIVIDE(SUM((pr-pp)*qty),SUM(qty*pr))*100,1) mrg, ROUND(SUM(qty),0) qty, COUNT(DISTINCT store) st
          FROM {ST} WHERE {cond} GROUP BY p ORDER BY rev DESC LIMIT 60""")
        by_store = rows(f"""SELECT store, ROUND(SUM(qty*pr),0) rev, ROUND(SUM((pr-pp)*qty),0) gp, ROUND(SUM(qty),0) qty
          FROM {ST} WHERE {cond} GROUP BY store ORDER BY rev DESC""")
        prod_month = rows(f"""SELECT product_name p, mo, ROUND(SUM(qty*pr),0) rev, ROUND(SUM(qty),0) qty
          FROM {ST} WHERE {cond} GROUP BY p, mo""")
        focus.append({"name": name, "monthly": monthly, "total": total,
                      "products": products, "by_store": by_store, "prod_month": prod_month})
    out = {"focus": focus, "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    OUT = os.environ.get("OUT_PATH", "focus.json")
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    for g in focus:
        print(f"{g['name']}: {g['total']['rev']:,.0f} ₴, месяцев {len(g['monthly'])}, позиций {len(g['products'])}")


if __name__ == "__main__":
    main()
