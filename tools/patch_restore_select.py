import io, sys

NA = "\u041f\u0440\u043e\u0447\u0435\u0435 (\u043d\u0435\u0442 \u0432 \u043c\u0430\u0442\u0440\u0438\u0446\u0435)"
NS = "(\u043d\u0435\u0442 \u0432 \u043c\u0430\u0442\u0440\u0438\u0446\u0435)"

path = "scripts/fetch_page3.py"
src = io.open(path, encoding="utf-8").read()

i = src.find('oos = f"""')
j = src.find('"""', i + 10)
print("=== SQL DO pravki ===")
for n, l in enumerate(src[i:j].splitlines(), 1):
    print("  %2d| %s" % (n, l[:150]))

if "SELECT s.nm product" in src:
    print("\nSKIP: SELECT na meste")
    sys.exit(0)

sel = ("SELECT s.nm product, COALESCE(m.cat,'%s') category, COALESCE(m.sup,'%s') supplier,\n"
       "  s.store, CAST(ROUND(s.qty90,0) AS INT64) sold90, CAST(CEIL(s.qty90/3.0) AS INT64) need_month,\n"
       "  IFNULL(a.donor_stores,0)>0 elsewhere,\n"
       "  IFNULL(a.donor_stores,0) donor_stores, CAST(ROUND(IFNULL(a.tot,0),0) AS INT64) net_qty\n") % (NA, NS)

anchor = "FROM sales90 s LEFT JOIN stock st"
k = src.find(anchor, i)
if k < 0 or k > j:
    print("\nFAIL: ne nashel FROM sales90 vnutri zaprosa"); sys.exit(1)

src = src[:k] + sel + src[k:]
io.open(path, "w", encoding="utf-8", newline="\n").write(src)

i = src.find('oos = f"""'); j = src.find('"""', i + 10)
print("\n=== SQL POSLE pravki ===")
for n, l in enumerate(src[i:j].splitlines(), 1):
    print("  %2d| %s" % (n, l[:150]))
print("\nOK: SELECT vosstanovlen")