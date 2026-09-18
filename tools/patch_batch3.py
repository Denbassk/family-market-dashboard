# -*- coding: utf-8 -*-
import io, sys
P = "scripts/fetch_page3.py"
src = io.open(P, encoding="utf-8").read()
orig = src
done = []

# --- 12: porog deficita 10 -> OOS_MIN (default 30), limit ne sjigaetsya na hvost
if 'OOS_MIN' not in src:
    src = src.replace(
        'ELSEWHERE_MIN = int(os.environ.get("ELSEWHERE_MIN", "3"))',
        'ELSEWHERE_MIN = int(os.environ.get("ELSEWHERE_MIN", "3"))\n'
        'OOS_MIN = int(os.environ.get("OOS_MIN", "30"))  # min prodazh za 90d, chtoby schitat deficitom', 1)
    src = src.replace('WHERE s.qty90>=10 AND', 'WHERE s.qty90>={OOS_MIN} AND', 1)
    done.append("12 oos threshold")

# --- 6: porog cennosti peremescheniya
if 'MIN_MOVE_VALUE", "0"' in src:
    src = src.replace('MIN_MOVE_VALUE", "0"', 'MIN_MOVE_VALUE", "150"', 1)
    done.append("6 min_move_value")

# --- 8: lift v cross_items
if 'lift' not in src:
    old_start = src.find('cross_items = f"""')
    old_end = src.find('out["cross_items"] = rows(cross_items)')
    assert old_start > 0 and old_end > old_start, "cross_items block not found"
    new = '''cross_items = f"""
WITH top AS (SELECT barcode FROM (SELECT a.barcode, SUM(a.qty) q FROM {AG} a
  LEFT JOIN (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode) m
  USING(barcode)
  WHERE {_XC} GROUP BY a.barcode ORDER BY q DESC LIMIT 500)),
tot AS (SELECT COUNT(DISTINCT tidn) n FROM {ST}),
b AS (SELECT tidn, barcode FROM {ST} JOIN top USING(barcode) GROUP BY tidn, barcode),
solo AS (SELECT barcode, COUNT(DISTINCT tidn) c FROM b GROUP BY barcode),
pairs AS (SELECT a.barcode x, b.barcode y, COUNT(DISTINCT a.tidn) cnt
  FROM b a JOIN b b ON a.tidn=b.tidn AND a.barcode<b.barcode GROUP BY x, y),
nm AS (SELECT barcode, ANY_VALUE(product_name) nm, ANY_VALUE(category) c
       FROM {AG} JOIN top USING(barcode) GROUP BY barcode)
SELECT n1.nm a, n2.nm b, n1.c c1, n2.c c2, p.cnt,
  ROUND(p.cnt * (SELECT n FROM tot) / (s1.c * s2.c), 2) lift,
  ROUND(p.cnt / s1.c * 100, 1) conf_ab,
  ROUND(p.cnt / s2.c * 100, 1) conf_ba
FROM pairs p
JOIN nm n1 ON n1.barcode=p.x JOIN nm n2 ON n2.barcode=p.y
JOIN solo s1 ON s1.barcode=p.x JOIN solo s2 ON s2.barcode=p.y
WHERE p.cnt >= {CROSS_MIN}
ORDER BY lift DESC LIMIT 80"""
'''
    src = src[:old_start] + new + src[old_end:]
    done.append("8 cross lift")

# --- 9: unmatched (barcode v _dash_dead uzhe est)
if 'unmatched_items' not in src:
    anchor = 'out["dead_total"] = rows('
    i = src.find(anchor)
    j = src.find("\n", i)
    add = ('\nout["unmatched_items"] = rows(f"SELECT barcode, p, c, store, ROUND(qty,0) qty, ROUND(value,0) value '
           'FROM {DEAD} WHERE c=\'Прочее (нет в матрице)\' ORDER BY value DESC LIMIT 500")\n'
           'out["unmatched_total"] = rows(f"SELECT ROUND(SUM(value),0) v, COUNT(*) n, '
           'COUNT(DISTINCT barcode) skus FROM {DEAD} WHERE c=\'Прочее (нет в матрице)\'")[0]\n')
    src = src[:j+1] + add + src[j+1:]
    done.append("9 unmatched")

# --- konstanty i diagnostika
if 'CROSS_MIN' not in src:
    src = src.replace('OOS_MIN = int(', 'CROSS_MIN = int(os.environ.get("CROSS_MIN", "50"))  # min chekov na paru dlya lift\nOOS_MIN = int(', 1)
if '_XC = ' not in src:
    src = src.replace('_ONLY = sql_only()', '_ONLY = sql_only()\n_XC = sql_exclude("m.cat", "m.sup")', 1)
# _XC nuzhen VYSHE cross_items, no nizhe importa nonstock — proverim poryadok
assert src.find('_XC = ') < src.find('cross_items = f'), "_XC deklarirovan posle ispolzovaniya"
if 'json.dump(out, open(OUT, "w")' in src:
    src = src.replace('json.dump(out, open(OUT, "w")', 'json.dump(out, open(OUT, "w", encoding="utf-8")', 1)
    done.append("utf-8 v fetch_page3")
if 'oos rows:' not in src:
    src = src.replace('print("кросс-пары товаров:"',
        'print("oos rows:", len(out["oos"]), "| nonstock:", len(out["oos_nonstock"]),\n'
        '      "| unmatched:", len(out.get("unmatched_items", [])), out.get("unmatched_total"))\n'
        'print("кросс-пары товаров:"', 1)

if src == orig:
    print("SKIP: vse patchi uzhe primeneny")
else:
    io.open(P, "w", encoding="utf-8", newline="\n").write(src)
    print("PATCHED:", ", ".join(done) or "cosmetics")