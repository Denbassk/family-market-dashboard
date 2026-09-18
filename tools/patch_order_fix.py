import io, re, sys

path = "scripts/fetch_page3.py"
src = io.open(path, encoding="utf-8").read()

decl = ("from nonstock import split_oos, sql_exclude, sql_only\n"
        "_EXCL = sql_exclude()\n"
        "_ONLY = sql_only()\n")

# 1. ubiraem deklaracii iz mesta posle f-stroki
src = src.replace(decl, "", 1)
src = src.replace("from nonstock import split_oos, sql_exclude, sql_only\n", "", 1)
src = src.replace("_EXCL = sql_exclude()\n", "", 1)
src = src.replace("_ONLY = sql_only()\n", "", 1)
src = src.replace("oos = oos.replace('{_EXCL}', _EXCL)\n", "", 1)
src = src.replace("from nonstock import split_oos\n", "", 1)

# 2. stavim ih PERED f-strokoy oos
i = src.find("oos = f\"\"\"")
if i < 0:
    print("FAIL: oos f-string not found"); sys.exit(1)
src = src[:i] + decl + src[i:]

io.open(path, "w", encoding="utf-8", newline="\n").write(src)
print("OK: declarations moved before oos f-string")

for n, l in enumerate(io.open(path, encoding="utf-8").read().splitlines(), 1):
    if any(k in l for k in ("_EXCL", "_ONLY", "oos = f", "split_oos", "unmatched")):
        print("  %4d: %s" % (n, l.strip()[:100]))