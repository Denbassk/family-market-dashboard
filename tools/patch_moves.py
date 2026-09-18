import io, os, re, sys

p = os.path.join("scripts", "fetch_page3.py")
src = io.open(p, encoding="utf-8").read()

if "allocate_moves" in src:
    print("SKIP: already patched")
    sys.exit(0)

pat = re.compile(
    r'move\s*=\s*move_core\s*\+\s*"\s*ORDER BY recv_sells DESC, value DESC LIMIT 300"\s*\r?\n'
    r'out\["moves"\]\s*=\s*rows\(move\)\s*\r?\n'
    r'out\["moves_summary"\]\s*=\s*rows\(f"[^"]*"\)\[0\]\s*\r?\n'
)

new = (
    '# LIMIT snyat: itog schitaem po toy zhe vyborke, chto uhodit v tablicu.\n'
    'move = move_core + " ORDER BY recv_sells DESC, value DESC"\n'
    '_raw_moves = rows(move)\n'
    'from allocate import allocate_moves\n'
    'MIN_MOVE_VALUE = float(os.environ.get("MIN_MOVE_VALUE", "0"))\n'
    'out["moves"], _mv_rep = allocate_moves(_raw_moves, min_value=MIN_MOVE_VALUE)\n'
    'print("moves allocation:", _mv_rep)\n'
    'out["moves_summary"] = {\n'
    '    "pairs": len(out["moves"]),\n'
    '    "skus": len({r["product"] for r in out["moves"]}),\n'
    '    "value": int(sum(float(r["value"] or 0) for r in out["moves"])),\n'
    '    "allocated": True,\n'
    '}\n'
)

out, n = pat.subn(new, src, count=1)
if n != 1:
    print("FAIL: anchor not found, file untouched")
    for i, line in enumerate(src.splitlines(), 1):
        if "moves_summary" in line or "LIMIT 300" in line:
            print("  line %d: %s" % (i, line[:120]))
    sys.exit(1)

io.open(p, "w", encoding="utf-8", newline="\n").write(out)
print("OK: patched %s" % p)