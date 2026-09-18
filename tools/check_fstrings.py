# -*- coding: utf-8 -*-
"""Staticheskaya proverka f-strok: objavleny li imena i objavleny li RANSHE ispolzovaniya.
Lovit NameError v SQL-zaprosah za 2 sekundy, do skana BigQuery. Nichego ne pravit."""
import io, ast, sys, builtins, glob

def declared(node):
    """Vse imena, svyazannye v etom uzle (bez vhoda vo vlozhennye funkcii)."""
    out = {}
    def add(t, ln):
        if isinstance(t, ast.Name):
            out.setdefault(t.id, ln)
        elif isinstance(t, (ast.Tuple, ast.List)):
            for e in t.elts: add(e, ln)
        elif isinstance(t, ast.Starred):
            add(t.value, ln)
    body = node.body if isinstance(node, ast.Module) else node.body
    for n in ast.walk(node):
        ln = getattr(n, "lineno", 0)
        if isinstance(n, ast.Assign):
            for t in n.targets: add(t, ln)
        elif isinstance(n, (ast.AnnAssign, ast.AugAssign)):
            add(n.target, ln)
        elif isinstance(n, ast.NamedExpr):
            add(n.target, ln)
        elif isinstance(n, (ast.For, ast.AsyncFor, ast.comprehension)):
            add(n.target, ln)
        elif isinstance(n, (ast.With, ast.AsyncWith)):
            for it in n.items:
                if it.optional_vars is not None: add(it.optional_vars, ln)
        elif isinstance(n, ast.ExceptHandler) and n.name:
            out.setdefault(n.name, ln)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.setdefault(n.name, ln)
            a = getattr(n, "args", None)
            if a:
                for arg in a.posonlyargs + a.args + a.kwonlyargs + [a.vararg, a.kwarg]:
                    if arg: out.setdefault(arg.arg, arg.lineno)
        elif isinstance(n, (ast.Import, ast.ImportFrom)):
            for al in n.names: out.setdefault((al.asname or al.name).split(".")[0], ln)
        elif isinstance(n, (ast.Global, ast.Nonlocal)):
            for nm in n.names: out.setdefault(nm, 0)
    return out

bad = 0
for path in ["scripts/fetch_page3.py", "scripts/nonstock.py", "scripts/build_data.py"]:
    src = io.open(path, encoding="utf-8").read()
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        print("SYNTAX %s:%s %s" % (path, e.lineno, e.msg)); bad += 1; continue
    known = set(dir(builtins))
    scopes = [tree] + [n for n in ast.walk(tree)
                       if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    allnames = declared(tree)          # vse imena fayla, dlya proverki "sushestvuet li voobshe"
    for sc in scopes:
        names = declared(sc)
        toplevel = isinstance(sc, ast.Module)
        for n in ast.walk(sc):
            if not isinstance(n, ast.JoinedStr):
                continue
            for v in n.values:
                if not isinstance(v, ast.FormattedValue):
                    continue
                for x in ast.walk(v):
                    if not isinstance(x, ast.Name) or x.id in known:
                        continue
                    if x.id not in allnames:
                        print("NE OBJAVLENO %s:%s  {%s}" % (path, n.lineno, x.id)); bad += 1
                    elif toplevel and x.id in names and names[x.id] > n.lineno:
                        # tolko modulnyy uroven: tam poryadok strok = poryadok vypolneniya
                        print("POZDNO %s:%s  {%s} objavleno na %s"
                              % (path, n.lineno, x.id, names[x.id])); bad += 1
print("f-stroki: nahodok", bad)
sys.exit(1 if bad else 0)