#!/usr/bin/env python3
"""Контрольные числа для харнесса кросс-фильтров — считаются прямо в BigQuery по staging,
чтобы сравнивать фронт не с самим же JSON, а с первоисточником."""
import json, os, sys
from google.cloud import bigquery

ST = os.environ.get("STAGING", "`family-market-analytics.family_market._dash_tx26`")
c = bigquery.Client()
full = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fm/docs/full_data.json"))
one = lambda sql: [dict(r) for r in c.query(sql).result()][0]
esc = lambda s: s.replace("'", "\\'")

s1, s2 = full["stores"][0], full["stores"][1]
mo = 3
# поставщик, который лежит в НЕСКОЛЬКИХ категориях — иначе тест «категория+поставщик»
# вырождается: срез по одному поставщику совпадёт со срезом по паре просто потому,
# что других категорий у него нет
sup = one(f"""SELECT supplier FROM {ST} WHERE supplier!='(нет в матрице)'
  GROUP BY supplier HAVING COUNT(DISTINCT category)>=2 ORDER BY SUM(qty*pr) DESC LIMIT 1""")["supplier"]
cat = one(f"""SELECT category FROM {ST} WHERE supplier='{esc(sup)}'
  GROUP BY category ORDER BY SUM(qty*pr) DESC LIMIT 1""")["category"]

t = {"s1": s1, "s2": s2, "cat": cat, "sup": sup, "mo": mo}
t["cat_sup_rev"]     = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE category='{esc(cat)}' AND supplier='{esc(sup)}'")["v"] or 0
t["sup_rev"]         = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE supplier='{esc(sup)}'")["v"] or 0
t["store_cat_rev"]   = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE store='{esc(s1)}' AND category='{esc(cat)}'")["v"] or 0
t["store_sup_rev"]   = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE store='{esc(s1)}' AND supplier='{esc(sup)}'")["v"] or 0
t["store_month_rev"] = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE store='{esc(s1)}' AND mo={mo}")["v"] or 0
t["store_rev"]       = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE store='{esc(s1)}'")["v"] or 0
t["net_rev"]         = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST}")["v"] or 0

json.dump(t, open("/tmp/fm/truth.json", "w"), ensure_ascii=False)
print(json.dumps(t, ensure_ascii=False, indent=1))
