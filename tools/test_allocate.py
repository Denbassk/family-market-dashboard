import json, sys, collections
sys.path.insert(0, "scripts")
from allocate import allocate_moves

d = json.load(open("docs/full_data.json", encoding="utf-8"))
raw = d.get("moves") or []
print("strok moves v prode:", len(raw))
print("summary v prode:", d.get("moves_summary"))
print("polya stroki:", sorted(raw[0].keys()) if raw else "net dannyh")

def overdraft(rows):
    cap, got = {}, collections.defaultdict(float)
    for r in rows:
        k = (r["donor"], r["product"])
        cap[k] = max(cap.get(k, 0), float(r["donor_stock"] or 0))
        got[k] += float(r["move_qty"] or 0)
    return {k: (v, cap[k]) for k, v in got.items() if v > cap[k] + 1e-6}

bad = overdraft(raw)
print("")
print("DO: donorov s pererashodom:", len(bad))
for k, (v, c) in sorted(bad.items(), key=lambda x: -x[1][0])[:5]:
    print("   %-22s %-42s otdano %d iz %d" % (k[0][:22], k[1][:42], v, c))

new, rep = allocate_moves(raw)
print("")
print("POSLE:", rep)
print("POSLE: donorov s pererashodom:", len(overdraft(new)))