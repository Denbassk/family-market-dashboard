#!/usr/bin/env python3
"""Приходы/закупки (incoming_transactions) помесячно — для отчётов «Закупки».
revenue = сумма закупки (amount_purchase), gp = потенц. наценка (retail-purchase), qty = кол-во.

ВАЖНО (исправлено 2026-08-27): здесь НЕЛЬЗЯ фильтровать по `store IN keep`.
Сеть закупается централизованно: 66 млн ₴ из 246 млн (26,5% всех закупок 2026) приходят
не в магазины, а на «Полевая-Склад», и оттуда расходятся по точкам. Пока стоял фильтр
по 38 торговым точкам, дашборд показывал 181 млн вместо 246 млн, а по акцизным категориям
терял почти всё: «Водка» 284 тыс ₴ вместо 11,5 млн (2,5%), «Бренди/Коньяк» — 0 из 5,87 млн.
Владелец видел продажи водки на 14,8 млн при закупках 284 тыс и справедливо не верил глазам.

Задвоения при этом нет — проверено: внутренних перемещений в incoming_transactions
практически не бывает (поставщик «Магазин» — 7,7 тыс ₴ за год), а сумма закупок по всем
объектам (246,0 млн) сходится с себестоимостью продаж за 2026 (243,5 млн) — 101,0%.
Все крупные поставщики водки («Баядера», «Трейдінг Продакт Компані», «Глобал-Сервіс»)
везут 100% объёма на склад.
"""
import os, json, datetime
from google.cloud import bigquery
from google.oauth2 import service_account
import sys
sys.path.append(os.path.dirname(__file__))
from fetch_data import YEAR
from domain import NORM, sql_case, sql_case_full, sql_keep
import supplier_entity  # подтверждённые владельцем склейки контрагентов

creds = service_account.Credentials.from_service_account_file(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
client = bigquery.Client(credentials=creds, project=creds.project_id)
IN = "`family-market-analytics.family_market.incoming_transactions`"
REF = "`family-market-analytics.family_market.torgsoft_incoming_ref_2026`"
MX = "`family-market-analytics.family_market.assortment_matrix_full`"
IS = "`family-market-analytics.family_market._dash_in26`"
SM = "`family-market-analytics.family_market.supplier_mapping`"
cases = sql_case()
keep = sql_keep()
ENT = supplier_entity.sql_case('i.supplier')


def run(sql): return [dict(r) for r in client.query(sql).result()]


def main():
    # staging приходов (для срезов по товарам/категориям — в эталоне нет штрихкодов)
    client.query(f"""
    CREATE OR REPLACE TABLE {IS} AS
    WITH m AS (SELECT barcode, ANY_VALUE(category) cat, ANY_VALUE(supplier) sup FROM {MX} GROUP BY barcode),
         sm AS (SELECT incoming_supplier, ANY_VALUE(matrix_supplier) ms FROM {SM}
                WHERE matrix_supplier IS NOT NULL GROUP BY incoming_supplier)
    SELECT {sql_case_full('i.store')} store, i.barcode, i.product_name,
      i.supplier supplier_ts,
      -- юрлицо: то же, что контрагент, но склеенное по ПОДТВЕРЖДЁННОМУ владельцем списку
      -- переименований (scripts/supplier_entity.py). Автоматики по имени тут нет и не будет.
      {ENT} entity,
      -- поставщик в терминах МАТРИЦЫ: сначала по штрих-коду (иначе мультибрендовый
      -- дистрибьютор вроде «ДЛ Солюшн» схлопывает 67 млн ₴ сигарет в одно имя),
      -- затем — перевод имени контрагента через supplier_mapping.
      COALESCE(m.sup, sm.ms, '(нет в матрице)') supplier,
      i.quantity qty, i.amount_purchase amt, i.amount_retail amt_ret,
      EXTRACT(MONTH FROM i.incoming_datetime) mo,
      CASE WHEN STARTS_WITH(TRIM(i.product_name),'Кулінарія') THEN 'Кулинария'
           WHEN STARTS_WITH(TRIM(i.product_name),'Випічка') THEN 'Выпечка'
           WHEN STARTS_WITH(TRIM(i.product_name),'Хот-Дог') THEN 'Хот-дог'
           ELSE COALESCE(m.cat,'Прочее (нет в матрице)') END category
    FROM {IN} i LEFT JOIN m USING(barcode) LEFT JOIN sm ON i.supplier = sm.incoming_supplier
    WHERE EXTRACT(YEAR FROM i.incoming_datetime)={YEAR}
    """).result()

    out = {}
    # Магазины и Поставщики — из ЭТАЛОНА (torgsoft_incoming_ref_2026), уровень накладных, без задвоений.
    out["in_store_month"] = run(f"""SELECT {sql_case_full('store')} store, EXTRACT(MONTH FROM doc_date) mo,
      ROUND(SUM(amount),0) revenue, ROUND(SUM(amount_retail-amount),0) gp, 0 qty
      FROM {REF} WHERE EXTRACT(YEAR FROM doc_date)={YEAR} GROUP BY store, mo""")
    # ПОСТАВЩИКИ — из staging (позиции), а НЕ из эталона.
    # В эталоне поставщик = контрагент Торгсофта («ДЛ Солюшн», «Союз (Оболонь)»), а фильтр
    # «Поставщик» на дашборде построен на именах МАТРИЦЫ («Сигарети_PM», «Оболонь»):
    # 112 из 128 имён эталона в матрице отсутствуют — 94% суммы, фильтр давал пустоту.
    # Плюс мультибрендовый дистрибьютор на уровне накладной неразделим: «ДЛ Солюшн» — это
    # 67 млн ₴, которые по штрих-кодам раскладываются на Сигарети_PM/BAT/JTI/IT.
    # Плата за точность — уровень позиций вместо накладных (сумма ниже эталона на ~1%).
    out["in_supplier_month"] = run(f"""SELECT supplier, mo,
      ROUND(SUM(amt),0) revenue, ROUND(SUM(amt_ret-amt),0) gp, ROUND(SUM(qty),0) qty
      FROM {IS} GROUP BY supplier, mo""")
    # диагностика покрытия (в лог, не в JSON)
    cov = run(f"""
      WITH mx AS (SELECT DISTINCT supplier FROM {MX} WHERE supplier IS NOT NULL)
      SELECT ROUND(SUM(s.amt),0) total,
             ROUND(SUM(IF(s.supplier IN (SELECT supplier FROM mx), s.amt, 0)),0) matched
      FROM {IS} s""")[0]
    # эталон берём по ТЕМ ЖЕ границам, что и staging (все объекты), иначе диагностика врёт
    ref_total = run(f"""SELECT ROUND(SUM(amount),0) a FROM {REF}
      WHERE EXTRACT(YEAR FROM doc_date)={YEAR}""")[0]["a"]
    out["in_cat_month"] = run(f"""SELECT category, mo, ROUND(SUM(amt),0) revenue, ROUND(SUM(amt_ret-amt),0) gp, ROUND(SUM(qty),0) qty
      FROM {IS} GROUP BY category, mo""")
    out["in_prod_month"] = run(f"""
      WITH topp AS (SELECT product_name FROM (SELECT product_name, SUM(amt) a FROM {IS} GROUP BY product_name ORDER BY a DESC LIMIT 3500))
      SELECT product_name p, mo, ROUND(SUM(amt),0) rev, ROUND(SUM(amt_ret-amt),0) gp, ROUND(SUM(qty),0) qty
      FROM {IS} JOIN topp USING(product_name) GROUP BY p, mo""")
    # ---------- ДВА ИЗМЕРЕНИЯ ПОСТАВЩИКА (2026-09-04) ----------
    # Дашборд всегда показывал поставщика в терминах МАТРИЦЫ (бренд: «Сигарети_PM»),
    # и контрагента по документам («ДЛ Солюшн», 83,3 млн ₴ шести брендов) в нём просто
    # не существовало. Это не опечатка в названиях: связь бренд<->контрагент — многие
    # ко многим («Оболонь» едет от трёх контрагентов, «Корона» от пяти), и сшивается
    # она по ШТРИХ-КОДУ, а не по имени.
    # in_ts_month — закупки по контрагенту. Точны на 100%: в накладной контрагент один.
    out["in_ts_month"] = run(f"""SELECT supplier_ts, mo,
      ROUND(SUM(amt),0) revenue, ROUND(SUM(amt_ret-amt),0) gp, ROUND(SUM(qty),0) qty
      FROM {IS} GROUP BY supplier_ts, mo""")

    # sales_ts_month — ПРОДАЖИ по контрагенту. В чеке накладной нет, связь только через
    # штрих-код, поэтому 19,9% выручки (60,5 млн ₴, 552 штрих-кода) приходится на позиции,
    # которые везут двое и больше. Просто приписать их каждому — задвоение на 20%.
    # Разносим ПРОПОРЦИОНАЛЬНО доле закупок контрагента по этому же штрих-коду: тогда
    # сумма по разрезу сходится с итогом продаж до копейки. rev_exact показывает, какая
    # часть строки посчитана без разнесения (у позиции один контрагент) — чтобы на экране
    # было видно, где цифра точная, а где доля. Позиции без приходов не теряются:
    # они уходят отдельной честной строкой «(нет прихода в 2026)».
    out["sales_ts_month"] = run(f"""
      WITH inc AS (SELECT CAST(barcode AS STRING) bc, supplier_ts, SUM(amt) amt
                   FROM {IS} WHERE amt>0 GROUP BY bc, supplier_ts),
      tot AS (SELECT bc, SUM(amt) amt FROM inc GROUP BY bc),
      share AS (SELECT i.bc, i.supplier_ts, SAFE_DIVIDE(i.amt,t.amt) w,
                       COUNT(*) OVER (PARTITION BY i.bc) n
                FROM inc i JOIN tot t USING(bc)),
      s AS (SELECT CAST(barcode AS STRING) bc, mo, SUM(rev) rev, SUM(gp) gp, SUM(qty) qty
            FROM `family-market-analytics.family_market._dash_a26` GROUP BY bc, mo)
      SELECT COALESCE(sh.supplier_ts,'(нет прихода в {YEAR})') supplier_ts, s.mo,
        ROUND(SUM(s.rev*IFNULL(sh.w,1)),0) revenue,
        ROUND(SUM(s.gp *IFNULL(sh.w,1)),0) gp,
        ROUND(SUM(s.qty*IFNULL(sh.w,1)),0) qty,
        ROUND(SUM(IF(IFNULL(sh.n,1)=1, s.rev, 0)),0) rev_exact
      FROM s LEFT JOIN share sh ON sh.bc=s.bc
      GROUP BY supplier_ts, s.mo""")

    # То же самое, но по ЮРЛИЦУ: имена, которые владелец подтвердил как одну компанию,
    # склеены. Смысл не косметический: позиция, которую «возили двое», после склейки
    # оказывается от одного юрлица, и её продажи считаются точно, без разнесения.
    # Замер на подтверждённом списке: доля точных 79,1% -> 85,2% (+17,5 млн ₴).
    out["in_ent_month"] = run(f"""SELECT entity, mo,
      ROUND(SUM(amt),0) revenue, ROUND(SUM(amt_ret-amt),0) gp, ROUND(SUM(qty),0) qty
      FROM {IS} GROUP BY entity, mo""")
    out["sales_ent_month"] = run(f"""
      WITH inc AS (SELECT CAST(barcode AS STRING) bc, entity, SUM(amt) amt
                   FROM {IS} WHERE amt>0 GROUP BY bc, entity),
      tot AS (SELECT bc, SUM(amt) amt FROM inc GROUP BY bc),
      share AS (SELECT i.bc, i.entity, SAFE_DIVIDE(i.amt,t.amt) w,
                       COUNT(*) OVER (PARTITION BY i.bc) n
                FROM inc i JOIN tot t USING(bc)),
      s AS (SELECT CAST(barcode AS STRING) bc, mo, SUM(rev) rev, SUM(gp) gp, SUM(qty) qty
            FROM `family-market-analytics.family_market._dash_a26` GROUP BY bc, mo)
      SELECT COALESCE(sh.entity,'(нет прихода в {YEAR})') entity, s.mo,
        ROUND(SUM(s.rev*IFNULL(sh.w,1)),0) revenue,
        ROUND(SUM(s.gp *IFNULL(sh.w,1)),0) gp,
        ROUND(SUM(s.qty*IFNULL(sh.w,1)),0) qty,
        ROUND(SUM(IF(IFNULL(sh.n,1)=1, s.rev, 0)),0) rev_exact
      FROM s LEFT JOIN share sh ON sh.bc=s.bc
      GROUP BY entity, s.mo""")

    # sup_bridge — мостик «контрагент <-> бренд» по штрих-кодам. Он же рабочий список
    # на дозаполнение supplier_mapping: строки с брендом «(нет в матрице)» — это то,
    # что мы покупаем, но не знаем, чей это бренд.
    out["sup_bridge"] = run(f"""SELECT supplier_ts, entity, supplier,
      ROUND(SUM(amt),0) amt, COUNT(DISTINCT barcode) skus
      FROM {IS} GROUP BY supplier_ts, entity, supplier ORDER BY amt DESC""")

    out["incoming_meta"] = {"updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}

    OUT = os.environ.get("OUT_PATH", "incoming.json")
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    _sts=sum(r["revenue"] or 0 for r in out["sales_ts_month"])
    print("  два измерения поставщика: контрагентов", len({r["supplier_ts"] for r in out["in_ts_month"]}),
          "| продажи, разнесённые по контрагентам:", round(_sts),
          "| из них точных:", round(sum(r["rev_exact"] or 0 for r in out["sales_ts_month"])),
          "| строк мостика:", len(out["sup_bridge"]))
    print("приходы: store_month", len(out["in_store_month"]), "| supplier_month", len(out["in_supplier_month"]),
          "| cat_month", len(out["in_cat_month"]), "| prod_month", len(out["in_prod_month"]))
    print("  поставщики -> имена матрицы:", cov["matched"], "из", cov["total"],
          "(", (round(cov["matched"] / cov["total"] * 100, 1) if cov["total"] else 0), "% суммы )")
    print("  позиции", cov["total"], "vs эталон накладных", ref_total,
          "| расхождение", (round((cov["total"] - ref_total) / ref_total * 100, 2) if ref_total else None), "%")


if __name__ == "__main__":
    main()
