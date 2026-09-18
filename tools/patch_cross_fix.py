# -*- coding: utf-8 -*-
import io
P = "scripts/fetch_page3.py"
src = io.open(P, encoding="utf-8").read()
o = src

if "CROSS_MIN = " not in src:
    src = src.replace("OOS_MIN = int(",
        'CROSS_MIN = int(os.environ.get("CROSS_MIN", "50"))  # min chekov na paru dlya lift\nOOS_MIN = int(', 1)

src = src.replace('chtoby schitat deficitom  # min stock to call a store a real donor',
                  'chtoby schitat deficitom', 1)

# _XC: kategoriya/postavschik uzhe lezhat v _dash_a26, join s MX ne nuzhen
src = src.replace('_XC = sql_exclude("m.cat", "m.sup")', '_XC = sql_exclude("a.category", "a.supplier")', 1)
src = src.replace(
    """WITH top AS (SELECT barcode FROM (SELECT a.barcode, SUM(a.qty) q FROM {AG} a
  LEFT JOIN (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode) m
  USING(barcode)
  WHERE {_XC} GROUP BY a.barcode ORDER BY q DESC LIMIT 500)),""",
    """WITH top AS (SELECT barcode FROM (SELECT a.barcode, SUM(a.qty) q FROM {AG} a
  WHERE {_XC} GROUP BY a.barcode ORDER BY q DESC LIMIT 500)),""", 1)

if src == o:
    print("SKIP: nechego menyat")
else:
    io.open(P, "w", encoding="utf-8", newline="\n").write(src)
    print("PATCHED")