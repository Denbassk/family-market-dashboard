# -*- coding: utf-8 -*-
import io, ast, builtins
P = "scripts/fetch_page3.py"
src = io.open(P, encoding="utf-8").read()
if "CROSS_MIN = " not in src:
    src = src.replace("OOS_MIN = int(",
        'CROSS_MIN = int(os.environ.get("CROSS_MIN", "50"))  # min chekov na paru dlya lift\nOOS_MIN = int(', 1)
    io.open(P, "w", encoding="utf-8", newline="\n").write(src)
    print("PATCHED: CROSS_MIN objavlen")
else:
    print("SKIP: CROSS_MIN uzhe est")

# statika: vse li imena v f-strokah objavleny i objavleny li RANSHE ispolzovaniya
tree = ast.parse(src)
pos = {}
for n in ast.walk(tree):
    t = None
    if isinstance(n, ast.Assign):
        t = [x.id for x in n.targets if isinstance(x, ast.Name)]
    elif isinstance(n, ast.FunctionDef):
        t = [n.name]
    elif isinstance(n, (ast.Import, ast.ImportFrom)):
        t = [(a.asname or a.name).split(".")[0] for a in n.names]
    elif isinstance(n, (ast.For, ast.comprehension)) and isinstance(n.target, ast.Name):
        t = [n.target.id]
    for name in (t or []):
        pos.setdefault(name, n.lineno if hasattr(n, "lineno") else 0)
known = set(dir(builtins))
bad, late = [], []
for n in ast.walk(tree):
    if isinstance(n, ast.JoinedStr):
        for v in n.values:
            if not isinstance(v, ast.FormattedValue):
                continue
            for x in ast.walk(v):
                if isinstance(x, ast.Name) and x.id not in known:
                    if x.id not in pos:
                        bad.append((n.lineno, x.id))
                    elif pos[x.id] > n.lineno:
                        late.append((n.lineno, x.id, pos[x.id]))
print("NE OBJAVLENY:", sorted(set(bad)) or "net")
print("OBJAVLENY POZZHE ISPOLZOVANIYA:", sorted(set(late)) or "net")