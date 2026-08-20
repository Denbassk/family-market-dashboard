#!/usr/bin/env python3
"""ВОЗВРАТЫ ПОСТАВЩИКАМ -> docs/full_data.json (ключи returns_*).

Источник позиций: family_market.outgoing_to_supplier_transactions (есть barcode/qty/суммы).
Эталон-контроль:  family_market.torgsoft_outgoing_ref (уровень документа, поставщик+сумма).
Сверка по doc_number за 2026 показала расхождение 0.14% — позиционная таблица пригодна
и для карточки на «Обзоре», и для детализации.

ПОСТАВЩИК. В возвратах/приходах Торгсофт пишет КОНТРАГЕНТА («Союз (Оболонь)»), а матрица —
БРЕНД («Оболонь»). Пересечение имён почти нулевое (48 из 52 имён возвратов нет в матрице),
поэтому имя приводится к матричному. Приоритет: сначала поставщик товара по BARCODE из
матрицы (мультибрендовый контрагент иначе схлопывает разные бренды в одно имя), затем —
перевод имени контрагента через family_market.supplier_mapping (покрытие 98.6% суммы).
Два способа согласованы: 14 535 совпадений против 11 расхождений.
Без этого фильтр «Поставщик» на дашборде по возвратам не работал бы вообще.

КЛАССЫ ТОЧЕК (ползунок охвата на «Обзоре»):
  retail  — 38 торговых точек сети (то же множество, что и во всех остальных вкладках)
  prosrok — «Магазины-Просрок» / «Полевая-Просрок» (списание просрочки поставщику)
  wh      — «Полевая-Склад», «Производство», закрытая «Професорська 12»

ОБМЕН. Физобмен (товар за товар) в данных не отличим от денежного возврата — признака нет.
Список обменных поставщиков ведётся руками в scripts/returns_config.py, флаг едет в куб
полем "x", фронт показывает его строкой «в т.ч. обмен».

ВЫХОД: компактный факт-куб returns_fact (~4.3 тыс строк), по которому фронт считает любой
срез точно — включая кросс-фильтры месяц × магазин × категория × поставщик.
"""
import os, json, datetime, sys
from google.cloud import bigquery
from google.oauth2 import service_account

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from fetch_data import NORM, YEAR
import returns_config as RC

P = "`family-market-analytics.family_market."
OUT_TX = P + "outgoing_to_supplier_transactions`"
OUT_REF = P + "torgsoft_outgoing_ref`"
MX = P + "assortment_matrix_full`"
SM = P + "supplier_mapping`"
SC = P + "supplier_conditions`"
SMM = P + "supplier_mapping_matrix`"

NO_SUP = "(нет в матрице)"
NO_CAT = "Прочее (нет в матрице)"


def main():
    creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
    client = bigquery.Client(credentials=creds, project=creds.project_id)

    def run(sql):
        return [dict(r) for r in client.query(sql).result()]

    cases = " ".join(f"WHEN o.store='{k}' THEN '{v}'" for k, v in NORM.items())
    keep = "(" + ",".join(f"'{k}'" for k in NORM) + ")"

    # ---- факт-куб: месяц × магазин × категория × поставщик -------------------
    fact = run(f"""
    WITH sm AS (SELECT incoming_supplier, ANY_VALUE(matrix_supplier) ms FROM {SM}
                WHERE matrix_supplier IS NOT NULL GROUP BY incoming_supplier),
         m  AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode)
    SELECT
      EXTRACT(MONTH FROM o.doc_date) mo,
      o.store store_raw,
      CASE WHEN o.store IN {keep} THEN CASE {cases} END ELSE o.store END store,
      (o.store IN {keep}) in_keep,
      CASE
        WHEN STARTS_WITH(TRIM(o.product_name),'Кулінарія') THEN 'Кулинария'
        WHEN STARTS_WITH(TRIM(o.product_name),'Випічка')  THEN 'Выпечка'
        WHEN STARTS_WITH(TRIM(o.product_name),'Хот-Дог')  THEN 'Хот-дог'
        ELSE COALESCE(m.cat,'{NO_CAT}') END category,
      COALESCE(m.sup, sm.ms, '{NO_SUP}') supplier,
      o.supplier supplier_ts,
      ROUND(SUM(o.amount_purchase),2) pur,
      ROUND(SUM(o.amount_retail),2)   ret,
      ROUND(SUM(o.quantity),3)        qty,
      COUNT(*)                        lines
    FROM {OUT_TX} o
    LEFT JOIN sm ON o.supplier = sm.incoming_supplier
    LEFT JOIN m  ON o.barcode  = m.barcode
    WHERE EXTRACT(YEAR FROM o.doc_date) = {YEAR}
    GROUP BY mo, store_raw, store, in_keep, category, supplier, supplier_ts
    """)

    # ---- документы (нельзя суммировать по кубу — один док = много строк) -----
    docs = run(f"""
    SELECT EXTRACT(MONTH FROM o.doc_date) mo,
      CASE WHEN o.store IN {keep} THEN CASE {cases} END ELSE o.store END store,
      COUNT(DISTINCT o.doc_number) docs
    FROM {OUT_TX} o WHERE EXTRACT(YEAR FROM o.doc_date) = {YEAR} GROUP BY mo, store
    """)

    # ---- условия по возвратам (для подсказки и ручного поиска обмена) --------
    terms = run(f"""
    WITH mm AS (SELECT matrix_supplier, ANY_VALUE(conditions_supplier) cs FROM {SMM} GROUP BY matrix_supplier)
    SELECT mm.matrix_supplier supplier, ANY_VALUE(sc.returns_allowed) allowed,
           ANY_VALUE(sc.returns_percent) pct, ANY_VALUE(TRIM(sc.returns_text)) txt
    FROM mm JOIN {SC} sc ON sc.supplier_name = mm.cs GROUP BY mm.matrix_supplier
    """)

    # ---- эталон: контрольные суммы по месяцам --------------------------------
    ref = run(f"""
    SELECT EXTRACT(MONTH FROM doc_date) mo, COUNT(DISTINCT doc_number) docs,
      ROUND(SUM(amount_purchase),2) pur, ROUND(SUM(amount_retail_fixed),2) ret
    FROM {OUT_REF} WHERE EXTRACT(YEAR FROM doc_date) = {YEAR} GROUP BY mo ORDER BY mo
    """)

    # ---- сборка --------------------------------------------------------------
    # компактный куб: словари измерений + массивы-строки
    # [mo, store_i, cat_i, sup_i, class_i, pur, ret, qty, lines, (exchange)]
    KCLS = ["retail", "prosrok", "wh"]
    dim_s, dim_c, dim_p = {}, {}, {}

    def idx(d, v):
        if v not in d:
            d[v] = len(d)
        return d[v]

    cube, unmapped, ts_names = [], 0.0, {}
    tot = {}
    for r in fact:
        cls = RC.store_class(r["store_raw"], r["in_keep"])
        sup, store = r["supplier"], r["store"]
        pu, rt = round(r["pur"] or 0, 2), round(r["ret"] or 0, 2)
        qty, ln = round(r["qty"] or 0, 3), r["lines"]
        row = [int(r["mo"]), idx(dim_s, store), idx(dim_c, r["category"]), idx(dim_p, sup),
               KCLS.index(cls), pu, rt, qty, ln]
        if RC.is_exchange(sup, store):
            row.append(1)
        cube.append(row)
        if sup == NO_SUP:
            unmapped += pu
        ts_names.setdefault(sup, set()).add(r["supplier_ts"])
        a = tot.setdefault(cls, {"pur": 0.0, "ret": 0.0, "qty": 0.0, "lines": 0})
        a["pur"] += pu; a["ret"] += rt; a["qty"] += qty; a["lines"] += ln
    for a in tot.values():
        a["pur"] = round(a["pur"], 2); a["ret"] = round(a["ret"], 2); a["qty"] = round(a["qty"], 3)

    ref_pur = round(sum((x["pur"] or 0) for x in ref), 2)
    our_pur = round(sum(r[5] for r in cube), 2)

    inv = lambda d: [k for k, _ in sorted(d.items(), key=lambda kv: kv[1])]
    out = {
        "returns_fact": cube,
        "returns_dim": {"s": inv(dim_s), "c": inv(dim_c), "p": inv(dim_p), "k": KCLS},
        "returns_docs": [{"m": int(d["mo"]), "s": d["store"], "d": d["docs"]} for d in docs],
        "returns_ref": [{"m": int(x["mo"]), "docs": x["docs"], "pur": x["pur"], "ret": x["ret"]} for x in ref],
        "returns_terms": {t["supplier"]: {
            "a": (None if t["allowed"] is None else bool(t["allowed"])),
            "p": t["pct"], "t": t["txt"] or None} for t in terms if t["supplier"]},
        "returns_meta": {
            "year": YEAR,
            "months": sorted({r[0] for r in cube}),
            "by_class": tot,
            "ref_pur": ref_pur,
            "our_pur": our_pur,
            "diff_pct": (round((our_pur - ref_pur) / ref_pur * 100, 2) if ref_pur else None),
            "unmapped_pur": round(unmapped, 2),
            "exchange_suppliers": sorted(RC.EXCHANGE_SUPPLIERS),
            "amount_basis": "purchase",
            "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        },
    }

    path = os.environ.get("OUT_PATH", "returns.json")
    json.dump(out, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
    print("возвраты: строк куба", len(cube), "| документов-строк", len(docs),
          "| классы", {k: round(v["pur"]) for k, v in tot.items()})
    print("  наши", our_pur, "| эталон", ref_pur, "| расхождение",
          out["returns_meta"]["diff_pct"], "% | без маппинга поставщика", round(unmapped))
    multi = {k: sorted(v) for k, v in ts_names.items() if len(v) > 1}
    if multi:
        print("  контрагентов на одного поставщика матрицы:", len(multi))
    print("  размер", round(os.path.getsize(path) / 1024, 1), "KB")


if __name__ == "__main__":
    main()
