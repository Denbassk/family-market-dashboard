import io, re, sys

path = "scripts/build_data.py"
src = io.open(path, encoding="utf-8").read()
orig = src

def fix(m):
    inner = m.group(1)
    if "encoding" in inner:
        return m.group(0)
    return 'open(%s, encoding="utf-8")' % inner

src = re.sub(r'open\(([^()]*?)\)', fix, src)

if src == orig:
    print("SKIP: nothing to change (already has encoding?)")
else:
    io.open(path, "w", encoding="utf-8", newline="\n").write(src)
    print("OK: patched", path)

for i, line in enumerate(io.open(path, encoding="utf-8").read().splitlines(), 1):
    if "open(" in line:
        print("  %4d: %s" % (i, line.strip()[:110]))