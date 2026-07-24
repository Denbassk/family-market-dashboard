#!/usr/bin/env python3
"""CI entrypoint: собирает основные данные (fetch_data) + страницу 3 (fetch_page3) и мержит в docs/full_data.json."""
import os, json, subprocess, sys
HERE=os.path.dirname(__file__)
DOCS=os.path.join(HERE,"..","docs","full_data.json")

env=dict(os.environ)
# 1) основной сбор -> docs/full_data.json
env["OUT_PATH"]=DOCS
subprocess.run([sys.executable, os.path.join(HERE,"fetch_data.py")], check=True, env=env)
# 2) страница 3 -> /tmp/page3.json
p3="/tmp/page3.json"; env["OUT_PATH"]=p3
subprocess.run([sys.executable, os.path.join(HERE,"fetch_page3.py")], check=True, env=env)
# 3) merge
full=json.load(open(DOCS)); p=json.load(open(p3))
for k in ["moves","moves_summary","dead_items","dead_by_store","dead_by_cat","dead_by_supplier","dead_total",
          "cross","cross_items","writeoffs_by_store","writeoffs_top","writeoffs_by_supplier","culinary_writeoffs"]:
    if k in p: full[k]=p[k]
json.dump(full, open(DOCS,"w"), ensure_ascii=False, separators=(",",":"))
print("merged -> docs/full_data.json  (moves:", len(full.get("moves",[])), ")")
