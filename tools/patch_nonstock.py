import io, sys

# --- 1. scripts/nonstock.py (ASCII-safe: Cyrillic via \u escapes) ---
mod = '''# -*- coding: utf-8 -*-
"""Tovary bez poshtuchnogo ucheta: prodayutsya, no ostatka po shtrih-kodu ne byvaet.
Kategorii vzyaty iz assortment_matrix_full (proverено na oos 2026-09-18)."""

NONSTOCK_CATEGORIES = {
    "\\u0413\\u043e\\u0442\\u043e\\u0432\\u044b\\u0439 \\u043d\\u0430\\u043f\\u0438\\u0442\\u043e\\u043a (\\u043a\\u043e\\u0444\\u0435\\u043c\\u0430\\u0448\\u0438\\u043d\\u0430/\\u0430\\u0432\\u0442\\u043e\\u043c\\u0430\\u0442)",
    "\\u0413\\u043e\\u0442\\u043e\\u0432\\u0430\\u044f \\u0435\\u0434\\u0430",
    "\\u041f\\u0438\\u0432\\u043e \\u043d\\u0430 \\u0440\\u0430\\u0437\\u043b\\u0438\\u0432",
    "\\u0422\\u0430\\u0440\\u0430 \\u0438 \\u0443\\u043f\\u0430\\u043a\\u043e\\u0432\\u043a\\u0430",
    "\\u041e\\u0434\\u043d\\u043e\\u0440\\u0430\\u0437\\u043e\\u0432\\u0430\\u044f \\u043f\\u043e\\u0441\\u0443\\u0434\\u0430",
}

# Razliv vnutri kategorii "Voda": Morshin — butilirovannaya (uchet est),
# Imperatorska — razliv (ostatka net).
NONSTOCK_SUPPLIERS = {
    "\\u0406\\u043c\\u043f\\u0435\\u0440\\u0430\\u0442\\u043e\\u0440\\u0441\\u044c\\u043a\\u0430",
}

# Nulevoy ostatok k kontsu dnya — norma, no nedozakaz realen: tolko pometka.
DAILY_ZERO_OK = {
    "\\u0425\\u043b\\u0435\\u0431\\u043e\\u0431\\u0443\\u043b\\u043e\\u0447\\u043d\\u044b\\u0435 \\u0438\\u0437\\u0434\\u0435\\u043b\\u0438\\u044f",
}


def is_nonstock(row):
    return (row.get("category") in NONSTOCK_CATEGORIES
            or row.get("supplier") in NONSTOCK_SUPPLIERS)


def split_oos(rows):
    real, nonstock = [], []
    for r in rows:
        if is_nonstock(r):
            nonstock.append(r)
        else:
            if r.get("category") in DAILY_ZERO_OK:
                r = dict(r)
                r["daily_zero_ok"] = True
            real.append(r)
    assert len(real) + len(nonstock) == len(rows), "split_oos lost rows"
    return real, nonstock
'''
io.open("scripts/nonstock.py", "w", encoding="utf-8", newline="\n").write(mod)
print("OK: scripts/nonstock.py written")

# --- 2. fetch_page3.py: raise LIMIT, split rows ---
path = "scripts/fetch_page3.py"
src = io.open(path, encoding="utf-8").read()
if "split_oos" in src:
    print("SKIP: fetch_page3 already patched")
else:
    a = "ORDER BY sold90 DESC LIMIT 500"
    b = "ORDER BY sold90 DESC LIMIT 1200"
    if a not in src:
        print("FAIL: oos LIMIT anchor not found"); sys.exit(1)
    src = src.replace(a, b, 1)

    a = 'out["oos"] = rows(oos)'
    b = ('from nonstock import split_oos\n'
         '_oos_raw = rows(oos)\n'
         'out["oos"], out["oos_nonstock"] = split_oos(_oos_raw)\n'
         'print("oos split: vsego", len(_oos_raw), "| realnyh", len(out["oos"]),\n'
         '      "| bez ucheta", len(out["oos_nonstock"]))')
    if a not in src:
        print("FAIL: out[oos] anchor not found"); sys.exit(1)
    src = src.replace(a, b, 1)
    io.open(path, "w", encoding="utf-8", newline="\n").write(src)
    print("OK: fetch_page3.py patched (LIMIT 1200 + split)")

# --- 3. build_data.py: new key must be in merge list ---
path = "scripts/build_data.py"
src = io.open(path, encoding="utf-8").read()
if '"oos_nonstock"' in src:
    print("SKIP: build_data already has oos_nonstock")
else:
    a = 'for k in ["moves","moves_summary","oos",'
    b = 'for k in ["moves","moves_summary","oos","oos_nonstock",'
    if a not in src:
        print("FAIL: merge list anchor not found"); sys.exit(1)
    io.open(path, "w", encoding="utf-8", newline="\n").write(src.replace(a, b, 1))
    print("OK: build_data.py merge list updated")