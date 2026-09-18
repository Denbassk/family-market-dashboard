import io, sys

path = "scripts/fetch_page3.py"
src = io.open(path, encoding="utf-8").read()
orig = src
done = []

# --- 2b: LIMIT 20 in writeoffs_by_store (38 stores max, limit truncated the list) ---
a = "GROUP BY store HAVING store IS NOT NULL ORDER BY amount DESC LIMIT 20"
b = "GROUP BY store HAVING store IS NOT NULL ORDER BY amount DESC"
if a in src:
    src = src.replace(a, b, 1)
    done.append("2b writeoffs LIMIT 20 removed")

# --- 2c: elsewhere flag ---
a = "anystk AS (SELECT barcode, SUM(qty) tot FROM {STK} GROUP BY barcode),"
b = ("anystk AS (SELECT barcode, SUM(GREATEST(qty,0)) tot,\n"
     "           COUNTIF(qty>={ELSEWHERE_MIN}) donor_stores\n"
     "           FROM {STK} WHERE store IS NOT NULL AND store!='Polevaya' GROUP BY barcode),")
b = b.replace("'Polevaya'", "'\u041f\u043e\u043b\u0435\u0432\u0430\u044f \u043c\u0430\u0433\u0430\u0437\u0438\u043d'")
if a in src:
    src = src.replace(a, b, 1)
    done.append("2c anystk rebuilt (negatives dropped, service stores excluded)")

a = "  IFNULL(a.tot,0)>0 elsewhere"
b = ("  IFNULL(a.donor_stores,0)>0 elsewhere,\n"
     "  IFNULL(a.donor_stores,0) donor_stores, CAST(ROUND(IFNULL(a.tot,0),0) AS INT64) net_qty")
if a in src:
    src = src.replace(a, b, 1)
    done.append("2c elsewhere = has real donor store")

# constant for the threshold
if "ELSEWHERE_MIN" in src and "ELSEWHERE_MIN =" not in src:
    a = 'def rows(sql): return [dict(r) for r in client.query(sql).result()]'
    b = ('ELSEWHERE_MIN = int(os.environ.get("ELSEWHERE_MIN", "3"))  # min stock to call a store a real donor\n\n'
         + a)
    src = src.replace(a, b, 1)
    done.append("ELSEWHERE_MIN constant added")

if src == orig:
    print("SKIP: nothing matched (already patched?)")
    sys.exit(0)

io.open(path, "w", encoding="utf-8", newline="\n").write(src)
for d in done:
    print("OK:", d)