#!/usr/bin/env python3
"""Синхронизация: Google-лист «Ассортиментная матрица (полная)» -> BigQuery assortment_matrix_full.
Делает матрицу единым источником: правки в Google-таблице (новые/удалённые позиции и поставщики)
попадают в категории/поставщики/фильтры всего дашборда. Запускать ПЕРВЫМ шагом сборки (до fetch_data).
Безопасность: перезапись только если в листе >= MIN_ROWS штрихкодов (иначе не трогаем боевую таблицу)."""
import os, datetime
from google.oauth2 import service_account
from googleapiclient.discovery import build
from google.cloud import bigquery

SID = os.environ.get("MATRIX_SHEET_ID", "1sbITHxuTGt7yIRR2PmLvvzIxD-4n_O4eYUDzUNDtBBA")
SHEET = os.environ.get("MATRIX_SHEET_NAME", "Ассортиментная матрица (полная)")
DS = "family-market-analytics.family_market"
TARGET = os.environ.get("MATRIX_TABLE", "assortment_matrix_full")   # для теста можно указать временную
MIN_ROWS = int(os.environ.get("MATRIX_MIN_ROWS", "1500"))

# Google-заголовок -> поле BQ
MAP = {"Штрихкод": "barcode", "Поставщик": "supplier", "Товар": "product_name",
       "Категория": "category", "Решение": "decision", "Себестоимость": "cost",
       "Прибыль": "profit", "Покрытие": "coverage", "Статус": "status"}
NUM = {"cost", "profit", "coverage"}
SCHEMA = [bigquery.SchemaField(n, "FLOAT" if n in NUM else "STRING")
          for n in ["barcode", "supplier", "product_name", "category", "decision",
                    "cost", "profit", "coverage", "status"]]


def num(v):
    s = str(v or "").replace("\xa0", "").replace(" ", "").replace("%", "").replace(",", ".").strip()
    try:
        return float(s) if s not in ("", "-", "—") else None
    except ValueError:
        return None


def main():
    creds = service_account.Credentials.from_service_account_file(
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"],
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly",
                "https://www.googleapis.com/auth/bigquery"])
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
    vals = svc.spreadsheets().values().get(
        spreadsheetId=SID, range=SHEET, valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    if not vals:
        print("ПУСТОЙ лист — синхронизация отменена, боевая таблица не тронута"); return
    hdr = vals[0]
    idx = {field: hdr.index(gcol) for gcol, field in MAP.items() if gcol in hdr}
    if "barcode" not in idx:
        print("нет колонки «Штрихкод» — отмена"); return
    rows, seen = [], set()
    for r in vals[1:]:
        r = r + [""] * len(hdr)
        bc = str(r[idx["barcode"]]).strip()
        if not bc or bc in seen:
            continue
        seen.add(bc)
        rec = {"barcode": bc}
        for field, i in idx.items():
            if field == "barcode":
                continue
            rec[field] = num(r[i]) if field in NUM else (str(r[i]).strip() or None)
        rows.append(rec)
    if len(rows) < MIN_ROWS:
        print(f"в листе только {len(rows)} штрихкодов (< {MIN_ROWS}) — похоже на сбой чтения, "
              f"боевая таблица НЕ перезаписана"); return

    client = bigquery.Client(credentials=creds, project=creds.project_id)
    table_id = f"{DS}.{TARGET}"
    job = client.load_table_from_json(
        rows, table_id,
        job_config=bigquery.LoadJobConfig(schema=SCHEMA, write_disposition="WRITE_TRUNCATE"))
    job.result()
    n = client.get_table(table_id).num_rows
    sup = len({r["supplier"] for r in rows if r.get("supplier")})
    cat = len({r["category"] for r in rows if r.get("category")})
    print(f"матрица синхронизирована -> {TARGET}: {n} позиций, поставщиков {sup}, категорий {cat}, "
          f"лист от {datetime.datetime.now(datetime.timezone.utc):%Y-%m-%d %H:%M UTC}")


if __name__ == "__main__":
    main()
