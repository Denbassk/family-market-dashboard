import io

path = "scripts/fetch_page3.py"
lines = io.open(path, encoding="utf-8").read().splitlines(True)

block = ("from nonstock import split_oos, sql_exclude, sql_only",
         "_EXCL = sql_exclude()",
         "_ONLY = sql_only()")

out, seen = [], set()
for l in lines:
    s = l.strip()
    if s in block:
        if s in seen:
            continue          # dubl — propuskaem
        seen.add(s)
    out.append(l)

io.open(path, "w", encoding="utf-8", newline="\n").write("".join(out))
print("OK: udaleno dublей:", len(lines) - len(out))

for n, l in enumerate(io.open(path, encoding="utf-8").read().splitlines(), 1):
    if any(k in l for k in ("_EXCL", "_ONLY", "oos = f", "split_oos", "unmatched")):
        print("  %4d: %s" % (n, l.strip()[:95]))