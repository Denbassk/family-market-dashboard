import io, sys
NA = "\u041f\u0440\u043e\u0447\u0435\u0435 (\u043d\u0435\u0442 \u0432 \u043c\u0430\u0442\u0440\u0438\u0446\u0435)"

# --- 11a: helper in nonstock.py ---
path = "scripts/nonstock.py"
src = io.open(path, encoding="utf-8").read()
if "def sql_exclude" not in src:
    src += '''

def _lst(items):
    return ",".join("'%s'" % x for x in sorted(items))


def sql_exclude(cat="m.cat", sup="m.sup"):
    """Uslovie WHERE: ostavit tolko poshtuchnye tovary (edinyy istochnik s python-filtrom)."""
    return ("(COALESCE(%s,'') NOT IN (%s) AND COALESCE(%s,'') NOT IN (%s))"
            % (cat, _lst(NONSTOCK_CATEGORIES), sup, _lst(NONSTOCK_SUPPLIERS)))


def sql_only(cat="m.cat", sup="m.sup"):
    return ("(COALESCE(%s,'') IN (%s) OR COALESCE(%s,'') IN (%s))"
            % (cat, _lst(NONSTOCK_CATEGORIES), sup, _lst(NONSTOCK_SUPPLIERS)))
'''
    io.open(path, "w", encoding="utf-8", newline="\n").write(src)
    print("OK: nonstock.sql_exclude/sql_only added")
else:
    print("SKIP: nonstock helpers exist")

path = "scripts/fetch_page3.py"
src = io.open(path, encoding="utf-8").read()
orig = src

# --- 9a: barcode into _dash_dead ---
a = "        SELECT s.nm p, COALESCE(m.cat,"
if a in src and "SELECT s.barcode, s.nm p" not in src:
    src = src.replace(a, "        SELECT s.barcode, s.nm p, COALESCE(m.cat,", 1)
    print("OK: barcode added to _dash_dead")

# --- 11b: nonstock filter inside SQL, before LIMIT ---
a = "WHERE s.qty90>=10 AND COALESCE(st.qty,0)<=0"
if a in src and "{_EXCL}" not in src:
    src = src.replace(a, a + " AND {_EXCL}", 1)
    src = src.replace("ORDER BY sold90 DESC LIMIT 1200", "ORDER BY sold90 DESC LIMIT 3000", 1)
    print("OK: oos SQL filters nonstock before LIMIT (3000)")

a = "from nonstock import split_oos"
if a in src:
    b = ("from nonstock import split_oos, sql_exclude, sql_only\n"
         "_EXCL = sql_exclude()\n"
         "_ONLY = sql_only()\n"
         "oos = oos.replace('{_EXCL}', _EXCL)")
    src = src.replace(a, b, 1)
    print("OK: _EXCL wired")

# --- 9b + 11c: nonstock kept in separate query; unmatched report ---
a = 'out["oos"], out["oos_nonstock"] = split_oos(_oos_raw)'
if a in src:
    b = ('out["oos"], _left = split_oos(_oos_raw)\n'
         'assert not _left, "SQL-filtr propustil neposhtuchnye: %d" % len(_left)\n'
         'out["oos_nonstock"] = rows(oos.replace(_EXCL, _ONLY).replace("LIMIT 3000", "LIMIT 400"))\n'
         'out["unmatched_items"] = rows(f"""SELECT barcode, ANY_VALUE(p) product,\n'
         '  COUNT(DISTINCT store) stores, ROUND(SUM(qty),0) qty, ROUND(SUM(value),0) value\n'
         '  FROM {DEAD} WHERE c=\'' + NA + '\'\n'
         '  GROUP BY barcode HAVING SUM(value)>=300 ORDER BY value DESC LIMIT 600""")\n'
         'out["unmatched_total"] = rows(f"SELECT ROUND(SUM(value),0) v, COUNT(DISTINCT barcode) n '
         'FROM {DEAD} WHERE c=\'' + NA + '\'")[0]\n'
         'print("unmatched:", out["unmatched_total"], "| v otchete:", len(out["unmatched_items"]))')
    src = src.replace(a, b, 1)
    print("OK: unmatched_items + nonstock query added")

if src != orig:
    io.open(path, "w", encoding="utf-8", newline="\n").write(src)

# --- merge list ---
path = "scripts/build_data.py"
src = io.open(path, encoding="utf-8").read()
if '"unmatched_items"' not in src:
    a = '"oos","oos_nonstock",'
    if a not in src:
        print("FAIL: merge list anchor not found"); sys.exit(1)
    io.open(path, "w", encoding="utf-8", newline="\n").write(
        src.replace(a, a + '"unmatched_items","unmatched_total",', 1))
    print("OK: build_data merge list updated")