#!/usr/bin/env python3
"""CI entrypoint: собирает основные данные (fetch_data) + страницу 3 (fetch_page3) и мержит в docs/full_data.json."""
import os, json, subprocess, sys
HERE=os.path.dirname(__file__)
DOCS=os.path.join(HERE,"..","docs","full_data.json")

env=dict(os.environ)
# 0) СИНХРОНИЗАЦИЯ матрицы: Google-лист -> BigQuery assortment_matrix_full (единый источник категорий/поставщиков).
#    Если упадёт (нет доступа к Sheets и т.п.) — не рушим всю сборку, используем прежнюю таблицу.
try:
    subprocess.run([sys.executable, os.path.join(HERE,"sync_matrix.py")], check=True, env=env)
except Exception as e:
    print("sync_matrix пропущен (используется прежняя assortment_matrix_full):", e)
# 1) основной сбор -> docs/full_data.json
env["OUT_PATH"]=DOCS
subprocess.run([sys.executable, os.path.join(HERE,"fetch_data.py")], check=True, env=env)
# 2) страница 3 -> /tmp/page3.json
p3="/tmp/page3.json"; env["OUT_PATH"]=p3
subprocess.run([sys.executable, os.path.join(HERE,"fetch_page3.py")], check=True, env=env)
# 2b) матрица напрямую из Google Sheets -> /tmp/matrix.json
mx="/tmp/matrix.json"; env["OUT_PATH"]=mx
subprocess.run([sys.executable, os.path.join(HERE,"fetch_matrix.py")], check=True, env=env)
# 2c) приходы/закупки -> /tmp/incoming.json
inc="/tmp/incoming.json"; env["OUT_PATH"]=inc
subprocess.run([sys.executable, os.path.join(HERE,"fetch_incoming.py")], check=True, env=env)
# 2c-bis) возвраты поставщикам -> /tmp/returns.json
ret="/tmp/returns.json"; env["OUT_PATH"]=ret
subprocess.run([sys.executable, os.path.join(HERE,"fetch_returns.py")], check=True, env=env)
# 2d) «не двигается N дней» -> docs/stale.json (отдельный файл, грузится по требованию)
env2=dict(os.environ); env2["OUT_PATH"]=os.path.join(HERE,"..","docs","stale.json")
subprocess.run([sys.executable, os.path.join(HERE,"fetch_stale.py")], check=True, env=env2)
# 3) merge
full=json.load(open(DOCS, encoding="utf-8")); p=json.load(open(p3, encoding="utf-8"))
try:
    full["matrix"]=json.load(open(mx, encoding="utf-8"))["matrix"]
except Exception as e:
    print("matrix merge skipped:", e)
try:
    for k,v in json.load(open(inc, encoding="utf-8")).items(): full[k]=v
except Exception as e:
    print("incoming merge skipped:", e)
try:
    for k,v in json.load(open(ret, encoding="utf-8")).items(): full[k]=v
except Exception as e:
    print("returns merge skipped:", e)
for k in ["moves","moves_summary","oos","oos_nonstock","unmatched_items","unmatched_total","dead_items","dead_by_store","dead_by_cat","dead_by_supplier","dead_total","stock_as_of",
          "cross","cross_items","cross_stats","writeoffs_by_store","writeoffs_top","writeoffs_by_cat","writeoffs_by_supplier","culinary_writeoffs"]:
    if k in p: full[k]=p[k]
json.dump(full, open(DOCS,"w", encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
print("merged -> docs/full_data.json  (moves:", len(full.get("moves",[])), ")")
