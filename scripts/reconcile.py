#!/usr/bin/env python3
"""СВЕРКА С ЭТАЛОНАМИ ТОРГСОФТА — три потока: продажи, приходы, возвраты.

Запускается руками (в CI не входит):
    set GOOGLE_APPLICATION_CREDENTIALS=credentials\\...json
    python scripts\\reconcile.py

Пишет docs/reconcile.json (машиночитаемо) и docs/RECONCILE.md (для чтения).

ЧТО С ЧЕМ СРАВНИВАЕТСЯ
  продажи  turnover_transactions            vs torgsoft_sales_ref
           ВАЖНО: сравнивать с amount_price_list, а НЕ с amount. price_retail в
           turnover_transactions — прейскурантная цена, скидок в ней нет; amount —
           уже после скидки. Эталон продаж загружен НЕ ПОЛНОСТЬЮ (только часть года),
           поэтому месяцы вне его периода помечаются как «нет эталона», а не как расхождение.
  приходы  incoming_transactions            vs torgsoft_incoming_ref_2026
  возвраты outgoing_to_supplier_transactions vs torgsoft_outgoing_ref

ПОРОГИ: |откл.| < 0.5% — ok, < 2% — warn, иначе — bad.
"""
import os, json, sys, datetime
from google.cloud import bigquery
from google.oauth2 import service_account

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from fetch_data import NORM, YEAR

P = "`family-market-analytics.family_market."
TT = P + "turnover_transactions`"
SREF = P + "torgsoft_sales_ref`"
IN = P + "incoming_transactions`"
IREF = P + "torgsoft_incoming_ref_2026`"
OUT = P + "outgoing_to_supplier_transactions`"
OREF = P + "torgsoft_outgoing_ref`"

OK, WARN = 0.5, 2.0
HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "docs")


def grade(pct):
    if pct is None:
        return "n/a"
    a = abs(pct)
    return "ok" if a < OK else ("warn" if a < WARN else "bad")


def pct(our, ref):
    return round((our - ref) / ref * 100, 2) if ref else None


def main():
    creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
    client = bigquery.Client(credentials=creds, project=creds.project_id)

    def run(sql):
        return [dict(r) for r in client.query(sql).result()]

    keep = "(" + ",".join(f"'{k}'" for k in NORM) + ")"
    rep = {"year": YEAR, "generated_at": datetime.datetime.now(datetime.timezone.utc)
           .strftime("%Y-%m-%d %H:%M UTC"), "thresholds": {"ok": OK, "warn": WARN}}

    # ---------- 1. ПРОДАЖИ ----------------------------------------------------
    scov = run(f"SELECT MIN(doc_date) a, MAX(doc_date) b FROM {SREF}")[0]
    sales = run(f"""
    WITH tt AS (SELECT EXTRACT(MONTH FROM transaction_datetime) mo,
        SUM(quantity*price_retail) rev, COUNT(DISTINCT transaction_id) tids
      FROM {TT} WHERE EXTRACT(YEAR FROM transaction_datetime)={YEAR} GROUP BY mo),
    rf AS (SELECT EXTRACT(MONTH FROM doc_date) mo, SUM(amount_price_list) apl,
        SUM(amount) amt, SUM(discount) disc, COUNT(DISTINCT doc_number) docs
      FROM {SREF} WHERE EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY mo)
    SELECT COALESCE(tt.mo, rf.mo) mo, ROUND(tt.rev,0) our, ROUND(rf.apl,0) ref_list,
      ROUND(rf.amt,0) ref_paid, ROUND(rf.disc,0) discount, tt.tids our_docs, rf.docs ref_docs
    FROM tt FULL OUTER JOIN rf USING(mo) ORDER BY mo""")
    for r in sales:
        r["diff_pct"] = pct(r["our"] or 0, r["ref_list"]) if r["ref_list"] else None
        r["status"] = grade(r["diff_pct"]) if r["ref_list"] else "нет эталона"

    sales_store = run(f"""
    WITH tt AS (SELECT store, EXTRACT(MONTH FROM transaction_datetime) mo,
        SUM(quantity*price_retail) rev FROM {TT}
      WHERE EXTRACT(YEAR FROM transaction_datetime)={YEAR} GROUP BY store, mo),
    rf AS (SELECT store, EXTRACT(MONTH FROM doc_date) mo, SUM(amount_price_list) apl
      FROM {SREF} WHERE EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY store, mo)
    SELECT COALESCE(tt.store,rf.store) store, COALESCE(tt.mo,rf.mo) mo,
      ROUND(tt.rev,0) our, ROUND(rf.apl,0) ref,
      ROUND(SAFE_DIVIDE(tt.rev-rf.apl, rf.apl)*100,2) diff_pct
    FROM tt FULL OUTER JOIN rf ON tt.store=rf.store AND tt.mo=rf.mo
    -- только месяцы, покрытые эталоном: иначе в «проблемные» попадёт вся вторая половина года
    WHERE COALESCE(tt.mo, rf.mo) IN (SELECT DISTINCT EXTRACT(MONTH FROM doc_date) FROM {SREF}
                                     WHERE EXTRACT(YEAR FROM doc_date)={YEAR})
      AND (tt.store IS NULL OR rf.store IS NULL OR ABS(SAFE_DIVIDE(tt.rev-rf.apl,rf.apl)) > {OK/100})
    ORDER BY ABS(COALESCE(tt.rev,0)-COALESCE(rf.apl,0)) DESC LIMIT 40""")
    rep["sales"] = {"ref_period": [str(scov["a"]), str(scov["b"])],
                    "by_month": sales, "problem_store_months": sales_store}

    # ---------- 2. ПРИХОДЫ ----------------------------------------------------
    inc = run(f"""
    WITH tx AS (SELECT EXTRACT(MONTH FROM incoming_datetime) mo, SUM(amount_purchase) a,
        COUNT(DISTINCT doc_number) docs FROM {IN}
      WHERE EXTRACT(YEAR FROM incoming_datetime)={YEAR} AND store IN {keep} GROUP BY mo),
    rf AS (SELECT EXTRACT(MONTH FROM doc_date) mo, SUM(amount) a, COUNT(DISTINCT doc_number) docs
      FROM {IREF} WHERE EXTRACT(YEAR FROM doc_date)={YEAR} AND store IN {keep} GROUP BY mo)
    SELECT COALESCE(tx.mo,rf.mo) mo, ROUND(tx.a,0) our, ROUND(rf.a,0) ref,
      tx.docs our_docs, rf.docs ref_docs FROM tx FULL OUTER JOIN rf USING(mo) ORDER BY mo""")
    for r in inc:
        r["diff_pct"] = pct(r["our"] or 0, r["ref"] or 0)
        r["status"] = grade(r["diff_pct"])

    inc_docs = run(f"""
    WITH tx AS (SELECT doc_number, SUM(amount_purchase) a FROM {IN}
      WHERE EXTRACT(YEAR FROM incoming_datetime)={YEAR} AND store IN {keep} GROUP BY doc_number),
    rf AS (SELECT doc_number, SUM(amount) a FROM {IREF}
      WHERE EXTRACT(YEAR FROM doc_date)={YEAR} AND store IN {keep} GROUP BY doc_number)
    SELECT COUNTIF(tx.doc_number IS NOT NULL AND rf.doc_number IS NOT NULL) matched,
      COUNTIF(rf.doc_number IS NULL) only_ours, COUNTIF(tx.doc_number IS NULL) only_ref,
      ROUND(SUM(IF(rf.doc_number IS NULL, tx.a, 0)),0) only_ours_amt,
      ROUND(SUM(IF(tx.doc_number IS NULL, rf.a, 0)),0) only_ref_amt
    FROM tx FULL OUTER JOIN rf USING(doc_number)""")[0]
    rep["incoming"] = {"by_month": inc, "by_doc": inc_docs}

    # ---------- 3. ВОЗВРАТЫ ---------------------------------------------------
    ret = run(f"""
    WITH tx AS (SELECT EXTRACT(MONTH FROM doc_date) mo, SUM(amount_purchase) a,
        COUNT(DISTINCT doc_number) docs FROM {OUT}
      WHERE EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY mo),
    rf AS (SELECT EXTRACT(MONTH FROM doc_date) mo, SUM(amount_purchase) a,
        COUNT(DISTINCT doc_number) docs FROM {OREF}
      WHERE EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY mo)
    SELECT COALESCE(tx.mo,rf.mo) mo, ROUND(tx.a,0) our, ROUND(rf.a,0) ref,
      tx.docs our_docs, rf.docs ref_docs FROM tx FULL OUTER JOIN rf USING(mo) ORDER BY mo""")
    for r in ret:
        r["diff_pct"] = pct(r["our"] or 0, r["ref"] or 0)
        r["status"] = grade(r["diff_pct"])

    ret_docs = run(f"""
    WITH tx AS (SELECT doc_number, SUM(amount_purchase) a FROM {OUT}
      WHERE EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY doc_number),
    rf AS (SELECT doc_number, SUM(amount_purchase) a FROM {OREF}
      WHERE EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY doc_number)
    SELECT COUNTIF(tx.doc_number IS NOT NULL AND rf.doc_number IS NOT NULL) matched,
      COUNTIF(rf.doc_number IS NULL) only_ours, COUNTIF(tx.doc_number IS NULL) only_ref,
      ROUND(SUM(IF(rf.doc_number IS NULL, tx.a, 0)),0) only_ours_amt,
      ROUND(SUM(IF(tx.doc_number IS NULL, rf.a, 0)),0) only_ref_amt,
      ROUND(SUM(IF(tx.doc_number IS NOT NULL AND rf.doc_number IS NOT NULL, tx.a-rf.a, 0)),0) delta_matched
    FROM tx FULL OUTER JOIN rf USING(doc_number)""")[0]
    rep["returns"] = {"by_month": ret, "by_doc": ret_docs}

    os.makedirs(DOCS, exist_ok=True)
    jpath = os.environ.get("OUT_PATH", os.path.join(DOCS, "reconcile.json"))
    json.dump(rep, open(jpath, "w"), ensure_ascii=False, separators=(",", ":"), default=str)

    # ---------- markdown ------------------------------------------------------
    ico = {"ok": "🟢", "warn": "🟡", "bad": "🔴", "n/a": "⚪", "нет эталона": "⚪"}
    RAW = {"mo", "our_docs", "ref_docs"}          # печатать как есть
    FLOAT2 = {"diff_pct"}                          # печатать с двумя знаками

    def num(v):
        return "—" if v is None else f"{v:,.0f}".replace(",", " ")
    L = [f"# Сверка с эталонами Торгсофта — {YEAR}", "",
         f"Сформировано: {rep['generated_at']}. Пороги: 🟢 <{OK}% · 🟡 <{WARN}% · 🔴 выше.", ""]

    def tbl(title, rows, cols, hdr):
        L.append("## " + title)
        L.append("")
        L.append("| " + " | ".join(hdr) + " |")
        L.append("|" + "---|" * len(hdr))
        for r in rows:
            cells = []
            for cnm in cols:
                v = r.get(cnm)
                if v is None:
                    cells.append("—")
                elif cnm in FLOAT2:
                    cells.append(f"{v:+.2f}")
                elif cnm in RAW or not isinstance(v, (int, float)):
                    cells.append(str(v))
                else:
                    cells.append(num(v))
            L.append("| " + " | ".join(cells) + " | " + ico.get(r.get("status"), "") + " " + str(r.get("status", "")) + " |")
        L.append("")

    L += [f"**Продажи.** Эталон покрывает {rep['sales']['ref_period'][0]} … {rep['sales']['ref_period'][1]} — "
          "остальные месяцы сверять не с чем. Сравнение идёт с `amount_price_list` "
          "(прейскурант), потому что `price_retail` в наших транзакциях — цена до скидки; "
          "колонка «скидка» показывает, на сколько дашборд завышает фактическую выручку.", ""]
    tbl("Продажи по месяцам", rep["sales"]["by_month"],
        ["mo", "our", "ref_list", "ref_paid", "discount", "diff_pct"],
        ["мес", "наши ₴", "эталон (прейскурант)", "эталон (оплачено)", "скидка ₴", "откл. %", "статус"])
    if rep["sales"]["problem_store_months"]:
        L += ["<details><summary>Магазины с отклонением выше порога</summary>", ""]
        L.append("| магазин | мес | наши ₴ | эталон ₴ | откл. % |")
        L.append("|---|---|---|---|---|")
        for r in rep["sales"]["problem_store_months"]:
            dp = "—" if r["diff_pct"] is None else f"{r['diff_pct']:+.2f}"
            L.append(f"| {r['store']} | {r['mo']} | {num(r['our'])} | {num(r['ref'])} | {dp} |")
        L += ["", "</details>", ""]

    tbl("Приходы по месяцам", rep["incoming"]["by_month"],
        ["mo", "our", "ref", "our_docs", "ref_docs", "diff_pct"],
        ["мес", "наши ₴", "эталон ₴", "наших накл.", "эталонных накл.", "откл. %", "статус"])
    d = rep["incoming"]["by_doc"]
    L += [f"Накладные: совпало {d['matched']}, только у нас {d['only_ours']} "
          f"({num(d['only_ours_amt'] or 0)} ₴), только в эталоне {d['only_ref']} "
          f"({num(d['only_ref_amt'] or 0)} ₴).", ""]

    tbl("Возвраты по месяцам", rep["returns"]["by_month"],
        ["mo", "our", "ref", "our_docs", "ref_docs", "diff_pct"],
        ["мес", "наши ₴", "эталон ₴", "наших док.", "эталонных док.", "откл. %", "статус"])
    d = rep["returns"]["by_doc"]
    L += [f"Документы: совпало {d['matched']} (расхождение по ним {num(d['delta_matched'] or 0)} ₴), "
          f"только у нас {d['only_ours']} ({num(d['only_ours_amt'] or 0)} ₴), "
          f"только в эталоне {d['only_ref']} ({num(d['only_ref_amt'] or 0)} ₴).", ""]

    mpath = os.path.join(DOCS, "RECONCILE.md")
    open(mpath, "w", encoding="utf-8").write("\n".join(L))
    print("сверка ->", jpath, "и", mpath)
    for k in ("sales", "incoming", "returns"):
        bad = [r for r in rep[k]["by_month"] if r.get("status") in ("warn", "bad")]
        print(f"  {k}: месяцев вне порога — {len(bad)}", [r["mo"] for r in bad] if bad else "")


if __name__ == "__main__":
    main()
