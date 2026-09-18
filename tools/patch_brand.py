# -*- coding: utf-8 -*-
import io
P = "scripts/fetch_page3.py"
src = io.open(P, encoding="utf-8").read(); o = src

# --- 8b: brend v nm CTE + flag same_brand vmesto vtorogo zaprosa
src = src.replace(
    "nm AS (SELECT barcode, ANY_VALUE(product_name) nm, ANY_VALUE(category) c\n"
    "       FROM {AG} JOIN top USING(barcode) GROUP BY barcode)",
    "nm AS (SELECT barcode, ANY_VALUE(product_name) nm, ANY_VALUE(category) c,\n"
    r"       REGEXP_EXTRACT(LOWER(ANY_VALUE(product_name)), r'^\W*(\w+\s+\w+)') brand" "\n"
    "       FROM {AG} JOIN top USING(barcode) GROUP BY barcode)", 1)
src = src.replace("  ROUND(p.cnt / s2.c * 100, 1) conf_ba\n",
                  "  ROUND(p.cnt / s2.c * 100, 1) conf_ba,\n"
                  "  COALESCE(n1.brand,'?1')=COALESCE(n2.brand,'?2') same_brand\n", 1)
src = src.replace("ORDER BY lift DESC LIMIT 80\"\"\"", "ORDER BY lift DESC LIMIT 400\"\"\"", 1)
src = src.replace(
    'out["cross_items"] = rows(cross_items)',
    '_cx = rows(cross_items)\n'
    '_diff = [r for r in _cx if not r["same_brand"]]\n'
    '_same = [r for r in _cx if r["same_brand"]]\n'
    'for r in _cx: r.pop("same_brand", None)\n'
    'out["cross_items"] = _diff[:80]      # raznye brendy = nastoyaschiy kross-sell\n'
    'out["cross_variants"] = _same[:40]   # odna lineyka = glubina assortimenta', 1)

# --- 9b: unmatched po shtrih-kodu, a ne po (tovar x magazin)
src = src.replace(
    "\"SELECT barcode, p, c, store, ROUND(qty,0) qty, ROUND(value,0) value FROM {DEAD} "
    "WHERE c='Прочее (нет в матрице)' ORDER BY value DESC LIMIT 500\"",
    "\"SELECT barcode, ANY_VALUE(p) p, COUNT(DISTINCT store) stores, ROUND(SUM(qty),0) qty, "
    "ROUND(SUM(value),0) value FROM {DEAD} WHERE c='Прочее (нет в матрице)' "
    "GROUP BY barcode ORDER BY value DESC LIMIT 800\"", 1)

src = src.replace('print("кросс-пары товаров:", len(out["cross_items"])',
                  'print("кросс-пары: разные бренды", len(out["cross_items"]),\n'
                  '      "| одна линейка", len(out["cross_variants"])', 1)

assert src != o, "nichego ne zamenilos - proveri ishodnik"
io.open(P, "w", encoding="utf-8", newline="\n").write(src)

# --- build_data.py: novyy klyuch inache molcha propadet
B = "scripts/build_data.py"
b = io.open(B, encoding="utf-8").read()
if '"cross_variants"' not in b:
    b = b.replace('"cross","cross_items"', '"cross","cross_items","cross_variants"', 1)
    io.open(B, "w", encoding="utf-8", newline="\n").write(b)
    print("build_data: cross_variants dobavlen v merge")
else:
    print("build_data: SKIP")

# --- workflow: staticheskaya proverka f-strok ryadom s proverkoy sintaksisa
W = ".github/workflows/update.yml"
w = io.open(W, encoding="utf-8").read()
if "check_fstrings" not in w:
    w = w.replace("      - name: Проверка синтаксиса\n        run: node tests/check_syntax.js\n",
                  "      - name: Проверка синтаксиса\n        run: node tests/check_syntax.js\n\n"
                  "      - name: Проверка f-строк в SQL\n        run: python tools/check_fstrings.py\n", 1)
    io.open(W, "w", encoding="utf-8", newline="\n").write(w)
    print("workflow: shag check_fstrings dobavlen")
else:
    print("workflow: SKIP")
print("PATCHED")