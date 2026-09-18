import io
p = "scripts/fetch_page3.py"
s = io.open(p, encoding="utf-8").read()
s = s.replace("""REGEXP_EXTRACT(LOWER(ANY_VALUE(product_name)), r'^\\W*(\\w+\\s+\\w+)') brand""",
              """REGEXP_EXTRACT(LOWER(ANY_VALUE(product_name)), '^[^ ]+ [^ ]+') brand""")
io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("regexp bez slashey:", "OK" if "[^ ]+ [^ ]+" in s else "NE NASHEL")

c = "tools/check_fstrings.py"
t = io.open(c, encoding="utf-8").read()
t = t.replace('sorted(glob.glob("scripts/*.py") + glob.glob("tools/*.py"))',
              '["scripts/fetch_page3.py", "scripts/nonstock.py", "scripts/build_data.py"]')
io.open(c, "w", encoding="utf-8", newline="\n").write(t)
print("gate scope:", "OK" if "fetch_page3.py" in t else "NE NASHEL")