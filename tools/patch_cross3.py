# -*- coding: utf-8 -*-
"""Kross-prodazhi: odin spisok s tipom svyazi, rang po chekam, lift kak filtr.

Idempotenten: povtornyy zapusk pechataet SKIP i nichego ne menyaet.
Pravki delayutsya poiskom po tekstu, ne po nomeram strok.
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P3 = os.path.join(ROOT, "scripts", "fetch_page3.py")
BD = os.path.join(ROOT, "scripts", "build_data.py")
IDX = os.path.join(ROOT, "docs", "index.html")


def rd(p):
    return io.open(p, encoding="utf-8").read()


def wr(p, s):
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)


def need(txt, anchor, what):
    if anchor not in txt:
        print("ОШИБКА: не найден якорь в %s: %r" % (what, anchor[:70]))
        sys.exit(1)


NEW_BLOCK = '''# ---------- КРОСС-ПРОДАЖИ: по позициям (пары товаров в одном чеке) ----------
# tidn вместо tid — см. шапку файла.
#
# ТРИ РЕШЕНИЯ, ВЗЯТЫЕ ИЗ ФАКТИЧЕСКОГО РАСПРЕДЕЛЕНИЯ (замер 2026-09-19, 10 467 пар с cnt>=30).
#
# 1. РАНЖИРУЕМ ПО ЧЕКАМ, а lift — это ФИЛЬТР, не сортировка. Сортировка по lift DESC
#    поднимала наверх редкое: «Монжар Джелопі Акули + Морська Зірка» — lift 489 на 125
#    чеках. Для полки ценнее «Кулінарія Олів'є + Випічка Сосиска в тісті» — 1006 чеков
#    при lift 16,7. Медиана lift у межкатегорийных пар 1,94, поэтому LIFT_MIN=2 срезает
#    ровно ту половину, где связи нет и оба товара просто популярны.
#
# 2. ТИП СВЯЗИ — ПО КАТЕГОРИИ И ОБЩЕМУ ПРЕФИКСУ НАЗВАНИЯ, а не по «бренду». Бренд первым
#    словом ломался на «Корм Пан Кот» и «Кава Петрівська Слобода» (первое слово — тип
#    товара, а не бренд), а REGEXP_EXTRACT отдавал NULL на «Бойчак  Соломка» (два пробела
#    подряд), и пара уезжала в «разные бренды». Общий префикс в два слова и длиннее ловит
#    линейку без словарей: «Волошкове Поле Сирок …», «Корм Пан Кот …», «Рома Пиріжок …».
#
# 3. НИЗКИЙ lift — ТОЖЕ СИГНАЛ, и раньше он терялся весь. lift<=SUBS_MAX означает «берут
#    одно ИЛИ другое»: Пепсі-Кола/Кока-Кола 0,42, Оболонська/Моршинська 0,40,
#    Зіберт/Львівське 0,48. Это единственная настоящая взаимозамена в данных, и нужна она
#    для ротации ассортимента, а не для выкладки. Сортировка по lift DESC выбрасывала
#    такие пары в самый хвост.
#
# ОСТОРОЖНО СО СЛОВОМ «ВЗАИМОЗАМЕНА». Пары одной категории с высоким lift (Фанта+Спрайт
# 38,1; Монстр+Бьорн 30,1; Окрошка+Олів'є 20,6) — НЕ взаимозамена, их берут ВМЕСТЕ.
# Поэтому такой тип называется same («вместе внутри категории»), а не subs.
_NOCAT = "Прочее (нет в матрице)"
_XT = sql_exclude("category", "supplier")


def _xtok(s):
    # класс символов записан перечислением: обратный слэш внутри f-строки — SyntaxError на 3.13
    return re.sub("[^0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ ]", " ", (s or "").lower()).split()


def _xpref(a, b):
    """Сколько первых слов совпадает. Токенизация заодно чинит двойные пробелы."""
    n = 0
    for x, y in zip(_xtok(a), _xtok(b)):
        if x != y:
            break
        n += 1
    return n


def _xkind(r):
    # взаимозамена только ВНУТРИ категории: батон и кока-кола тоже дают lift<1, но это
    # не замена друг друга, а разные походы в магазин — большая закупка против «забежал»
    if r["lift"] < SUBS_MAX and r["c1"] == r["c2"] and r["c1"] != _NOCAT:
        return "subs"
    if _xpref(r["a"], r["b"]) >= 2:
        return "variant"
    if r["c1"] == _NOCAT or r["c2"] == _NOCAT:
        return "nomatrix"
    return "cross" if r["c1"] != r["c2"] else "same"


cross_items = f"""
WITH top AS (SELECT barcode FROM (SELECT a.barcode, SUM(a.qty) q FROM {AG} a
  WHERE {_XC} GROUP BY a.barcode ORDER BY q DESC LIMIT {CROSS_TOP})),
tot AS (SELECT COUNT(DISTINCT tidn) n FROM {ST}),
b AS (SELECT tidn, barcode FROM {ST} JOIN top USING(barcode) GROUP BY tidn, barcode),
solo AS (SELECT barcode, COUNT(DISTINCT tidn) c FROM b GROUP BY barcode),
pairs AS (SELECT a.barcode x, b.barcode y, COUNT(DISTINCT a.tidn) cnt
  FROM b a JOIN b b ON a.tidn=b.tidn AND a.barcode<b.barcode GROUP BY x, y),
nm AS (SELECT barcode, ANY_VALUE(product_name) nm, ANY_VALUE(category) c
       FROM {AG} JOIN top USING(barcode) GROUP BY barcode),
j AS (SELECT n1.nm a, n2.nm b, n1.c c1, n2.c c2, p.cnt,
   ROUND(p.cnt * (SELECT n FROM tot) / (s1.c * s2.c), 2) lift,
   ROUND(p.cnt / s1.c * 100, 1) conf_ab, ROUND(p.cnt / s2.c * 100, 1) conf_ba
 FROM pairs p JOIN nm n1 ON n1.barcode=p.x JOIN nm n2 ON n2.barcode=p.y
 JOIN solo s1 ON s1.barcode=p.x JOIN solo s2 ON s2.barcode=p.y
 WHERE p.cnt >= {CROSS_MIN})
SELECT * FROM j WHERE lift >= {LIFT_MIN}
   OR (lift < {SUBS_MAX} AND c1 = c2 AND c1 != '{_NOCAT}')
ORDER BY cnt DESC LIMIT 4000"""
_cx = rows(cross_items)
for _r in _cx:
    _r["kind"] = _xkind(_r)
_found, _shown, _keep = {}, {}, []
for _r in _cx:
    _found[_r["kind"]] = _found.get(_r["kind"], 0) + 1
for _k, _cap in CROSS_CAP:
    _part = sorted([_r for _r in _cx if _r["kind"] == _k], key=lambda x: -x["cnt"])[:_cap]
    _shown[_k] = len(_part)
    _keep += _part
_keep.sort(key=lambda x: -x["cnt"])
out["cross_items"] = _keep
out["cross_stats"] = {"found": _found, "shown": _shown, "cnt_min": CROSS_MIN,
                      "lift_min": LIFT_MIN, "subs_max": SUBS_MAX, "top": CROSS_TOP}

# Связки КАТЕГОРИЙ — верхнеуровневый ответ на «что с чем вообще берут». Тара и одноразовая
# посуда отсюда убраны тем же фильтром, что и везде: без него топ был «Пиво + Тара 85 722».
# lift показывает, что частота обманчива: «Пиво + Табачные» встречаются в 58 902 чеках,
# но lift 0,85 — то есть связи нет, это просто две самые ходовые категории сети.
out["cross"] = rows(f"""
WITH tx AS (SELECT tidn, category FROM {ST} WHERE in_matrix AND {_XT} GROUP BY tidn, category),
tot AS (SELECT COUNT(DISTINCT tidn) n FROM tx),
solo AS (SELECT category, COUNT(DISTINCT tidn) c FROM tx GROUP BY category),
pairs AS (SELECT a.category c1, b.category c2, COUNT(DISTINCT a.tidn) cnt
  FROM tx a JOIN tx b ON a.tidn=b.tidn AND a.category<b.category GROUP BY c1,c2)
SELECT p.c1, p.c2, p.cnt, ROUND(p.cnt*(SELECT n FROM tot)/(s1.c*s2.c),2) lift
FROM pairs p JOIN solo s1 ON s1.category=p.c1 JOIN solo s2 ON s2.category=p.c2
WHERE p.cnt >= {CAT_MIN} ORDER BY cnt DESC LIMIT 40""")'''

NEW_CONST = '''CROSS_MIN = int(os.environ.get("CROSS_MIN", "30"))  # min chekov na paru, chtoby lift ne shumel
CROSS_TOP = int(os.environ.get("CROSS_TOP", "800"))  # skolko hodovyh pozitsiy beryom v kandidaty
LIFT_MIN = float(os.environ.get("LIFT_MIN", "2"))    # nizhe - svyazi net, oba tovara prosto populyarny
SUBS_MAX = float(os.environ.get("SUBS_MAX", "1"))    # nizhe - berut odno ILI drugoe (tolko vnutri odnoy kategorii)
CAT_MIN = int(os.environ.get("CAT_MIN", "300"))      # min chekov na paru kategoriy
CROSS_CAP = [("cross", 400), ("same", 150), ("variant", 100), ("nomatrix", 60), ("subs", 120)]'''

OLD_CONST = 'CROSS_MIN = int(os.environ.get("CROSS_MIN", "50"))  # min chekov na paru dlya lift'

OLD_START = '# ---------- КРОСС-ПРОДАЖИ: по позициям (пары товаров в одном чеке) ----------'
OLD_END = 'SELECT c1, c2, cnt FROM pairs ORDER BY cnt DESC LIMIT 25""")'

OLD_PRINT = '''print("кросс-пары: разные бренды", len(out["cross_items"]),
      "| одна линейка", len(out["cross_variants"]), "| списания магазинов:", len(out["writeoffs_by_store"]))'''
NEW_PRINT = '''print("кросс-пары:", len(out["cross_items"]), "строк из", len(_cx), "|",
      " ".join("%s %d/%d" % (k, _shown.get(k, 0), _found.get(k, 0)) for k, _ in CROSS_CAP),
      "| связки категорий:", len(out["cross"]), "| списания магазинов:", len(out["writeoffs_by_store"]))'''


def patch_p3():
    t = rd(P3)
    if "_xkind" in t:
        print("SKIP fetch_page3.py — уже пропатчен")
        return False
    need(t, OLD_CONST, "fetch_page3.py (константы)")
    need(t, OLD_START, "fetch_page3.py (начало блока)")
    need(t, OLD_END, "fetch_page3.py (конец блока)")
    need(t, OLD_PRINT, "fetch_page3.py (итоговый print)")
    need(t, "import os, json, datetime", "fetch_page3.py (импорты)")
    t = t.replace("import os, json, datetime", "import os, re, json, datetime", 1)
    t = t.replace(OLD_CONST, NEW_CONST, 1)
    i, j = t.index(OLD_START), t.index(OLD_END) + len(OLD_END)
    t = t[:i] + NEW_BLOCK + t[j:]
    t = t.replace(OLD_PRINT, NEW_PRINT, 1)
    wr(P3, t)
    print("OK fetch_page3.py")
    return True


def patch_bd():
    t = rd(BD)
    old = '"cross","cross_items","cross_variants",'
    if '"cross_stats"' in t:
        print("SKIP build_data.py — уже пропатчен")
        return False
    need(t, old, "build_data.py (список мержа)")
    wr(BD, t.replace(old, '"cross","cross_items","cross_stats",', 1))
    print("OK build_data.py — cross_stats добавлен в мерж, cross_variants убран")
    return True


if __name__ == "__main__":
    a, b = patch_p3(), patch_bd()
    print("изменено файлов:", sum([a, b]))
