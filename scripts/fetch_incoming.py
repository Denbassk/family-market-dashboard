#!/usr/bin/env python3
"""Приходы/закупки (incoming_transactions) помесячно — для отчётов «Закупки».
revenue = сумма закупки (amount_purchase), gp = потенц. наценка (retail-purchase), qty = кол-во."""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account
import sys
sys.path.append(os.path.dirname(__file__))
from fetch_data import NORM, YEAR

creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
client = bigquery.Client(credentials=creds, project=creds.project_id)
IN = "`family-market-analytics.family_market.incoming_transactions`"
REF = "`family-market-analytics.family_market.torgsoft_incoming_ref_2026`"
MX = "`family-market-analytics.family_market.assortment_matrix_full`"
IS = "`family-market-analytics.family_market._dash_in26`"
cases = " ".join(f"WHEN store='{k}' THEN '{v}'" for k, v in NORM.items())
keep = "(" + ",".join(f"'{k}'" for k in NORM) + ")"


def run(sql): return [dict(r) for r in client.query(sql).result()]


def main():
    # staging приходов (для срезов по товарам/категориям — в эталоне нет штрихкодов)
    client.query(f"""
    CREATE OR REPLACE TABLE {IS} AS
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat FROM {MX} GROUP BY barcode)
    SELECT CASE {cases} END store, i.barcode, i.product_name, i.supplier,
      i.quantity qty, i.amount_purchase amt, i.amount_retail amt_ret,
      EXTRACT(MONTH FROM i.incoming_datetime) mo,
      CASE WHEN STARTS_WITH(TRIM(i.product_name),'Кулінарія') THEN 'Кулинария'
           WHEN STARTS_WITH(TRIM(i.product_name),'Випічка') THEN 'Выпечка'
           WHEN STARTS_WITH(TRIM(i.product_name),'Хот-Дог') THEN 'Хот-дог'
           ELSE COALESCE(m.cat,'Прочее (нет в матрице)') END category
    FROM {IN} i LEFT JOIN m USING(barcode)
    WHERE EXTRACT(YEAR FROM i.incoming_datetime)={YEAR} AND store IN {keep}
    """).result()

    out = {}
    # Магазины и Поставщики — из ЭТАЛОНА (torgsoft_incoming_ref_2026), уровень накладных, без задвоений.
    out["in_store_month"] = run(f"""SELECT CASE {cases} END store, EXTRACT(MONTH FROM doc_date) mo,
      ROUND(SUM(amount),0) revenue, ROUND(SUM(amount_retail-amount),0) gp, 0 qty
      FROM {REF} WHERE store IN {keep} AND EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY store, mo""")
    out["in_supplier_month"] = run(f"""SELECT supplier, EXTRACT(MONTH FROM doc_date) mo,
      ROUND(SUM(amount),0) revenue, ROUND(SUM(amount_retail-amount),0) gp, 0 qty
      FROM {REF} WHERE store IN {keep} AND EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY supplier, mo""")
    out["in_cat_month"] = run(f"""SELECT category, mo, ROUND(SUM(amt),0) revenue, ROUND(SUM(amt_ret-amt),0) gp, ROUND(SUM(qty),0) qty
      FROM {IS} GROUP BY category, mo""")
    out["in_prod_month"] = run(f"""
      WITH topp AS (SELECT product_name FROM (SELECT product_name, SUM(amt) a FROM {IS} GROUP BY product_name ORDER BY a DESC LIMIT 3500))
      SELECT product_name p, mo, ROUND(SUM(amt),0) rev, ROUND(SUM(amt_ret-amt),0) gp, ROUND(SUM(qty),0) qty
      FROM {IS} JOIN topp USING(product_name) GROUP BY p, mo""")
    out["incoming_meta"] = {"updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}

    OUT = os.environ.get("OUT_PATH", "incoming.json")
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print("приходы: store_month", len(out["in_store_month"]), "| supplier_month", len(out["in_supplier_month"]),
          "| cat_month", len(out["in_cat_month"]), "| prod_month", len(out["in_prod_month"]))


if __name__ == "__main__":
    main()
