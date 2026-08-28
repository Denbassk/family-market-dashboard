#!/usr/bin/env python3
"""Контрольные числа для tests/check_dashboard.js — считаются прямо в BigQuery по staging,
чтобы сравнивать фронт не с самим же JSON, а с первоисточником.

Запуск из корня репозитория:
    python tests\\truth.py
Ключ сервис-аккаунта ищется сам: сначала переменная GOOGLE_APPLICATION_CREDENTIALS,
затем первый *.json в папке credentials\\ рядом с проектом — так же, как его берут
остальные скрипты пайплайна. Результат — tests\\truth.json (он в .gitignore).
"""
import glob
import json
import os
import sys

from google.cloud import bigquery
from google.oauth2 import service_account

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ST = os.environ.get("STAGING", "`family-market-analytics.family_market._dash_tx26`")
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "docs", "full_data.json")
OUT = os.path.join(HERE, "truth.json")


def client():
    """bigquery.Client() без аргументов требует Application Default Credentials, которых
    на машине нет — ключ берём явно, как это делают fetch_data.py и остальные скрипты."""
    key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not key or not os.path.exists(key):
        found = sorted(glob.glob(os.path.join(ROOT, "credentials", "*.json")))
        if not found:
            sys.exit("Не найден ключ сервис-аккаунта: ни GOOGLE_APPLICATION_CREDENTIALS,\n"
                     "ни файлов в " + os.path.join(ROOT, "credentials"))
        key = found[0]
    creds = service_account.Credentials.from_service_account_file(key)
    print("ключ:", os.path.basename(key), "| проект:", creds.project_id)
    return bigquery.Client(credentials=creds, project=creds.project_id)


def main():
    if not os.path.exists(DATA):
        sys.exit("Нет файла данных: " + DATA)
    c = client()
    full = json.load(open(DATA, encoding="utf-8"))
    one = lambda sql: [dict(r) for r in c.query(sql).result()][0]
    esc = lambda s: s.replace("'", "\\'")

    s1, s2 = full["stores"][0], full["stores"][1]
    mo = 3
    # ВЕРХНЯЯ ГРАНИЦА ПО ДАТЕ — обязательна.
    # `_dash_tx26` пересобирается при каждом прогоне fetch_data.py, а docs/full_data.json
    # на диске может быть от ПРЕДЫДУЩЕЙ сборки: GitHub Action обновляет данные по своему
    # расписанию, и между «сборка JSON» и «запуск truth.py» в staging успевают доехать
    # новые дни продаж. Тогда все итоги за ВЕСЬ период расходятся на доли процента,
    # и четыре проверки «== BigQuery» падают на ровном месте — при полностью исправном
    # дашборде (замер 2026-08-27: расхождение 1,3–1,9%, ровно на несколько дней продаж;
    # при этом помесячные проверки проходили, потому что март давно закрыт).
    # Ограничиваем выборку тем же периодом, что описан в самом JSON.
    end = (full.get("period") or {}).get("end")
    bound = f" AND d <= DATE('{end}')" if end else ""
    if end:
        print("период JSON:", (full["period"].get("start"), end), "- сверяем BigQuery по эту дату")
    else:
        print("ВНИМАНИЕ: в full_data.json нет period.end, сверка идёт по всему staging")
    # поставщик, который лежит в НЕСКОЛЬКИХ категориях — иначе тест «категория+поставщик»
    # вырождается: срез по одному поставщику совпадёт со срезом по паре просто потому,
    # что других категорий у него нет
    sup = one(f"""SELECT supplier FROM {ST} WHERE supplier!='(нет в матрице)'
      GROUP BY supplier HAVING COUNT(DISTINCT category)>=2 ORDER BY SUM(qty*pr) DESC LIMIT 1""")["supplier"]
    cat = one(f"""SELECT category FROM {ST} WHERE supplier='{esc(sup)}'
      GROUP BY category ORDER BY SUM(qty*pr) DESC LIMIT 1""")["category"]

    t = {"s1": s1, "s2": s2, "cat": cat, "sup": sup, "mo": mo, "period_end": end}
    q = lambda where: one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE {where}{bound}")["v"] or 0
    t["cat_sup_rev"]     = q(f"category='{esc(cat)}' AND supplier='{esc(sup)}'")
    t["sup_rev"]         = q(f"supplier='{esc(sup)}'")
    t["store_cat_rev"]   = q(f"store='{esc(s1)}' AND category='{esc(cat)}'")
    t["store_sup_rev"]   = q(f"store='{esc(s1)}' AND supplier='{esc(sup)}'")
    t["store_month_rev"] = q(f"store='{esc(s1)}' AND mo={mo}")
    t["store_rev"]       = q(f"store='{esc(s1)}'")
    t["net_rev"]         = one(f"SELECT ROUND(SUM(qty*pr),0) v FROM {ST} WHERE TRUE{bound}")["v"] or 0

    json.dump(t, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(json.dumps(t, ensure_ascii=False, indent=1))
    print("->", OUT)


if __name__ == "__main__":
    main()
