#!/usr/bin/env python3
"""Читает лист «Ассортиментная матрица (полная)» напрямую из Google Sheets (синхронизация с матрицей).
Оставляет только нужные колонки (ценовые зоны Посад/Кисет/Куркума отбрасываются)."""
import os, json, datetime
from google.oauth2 import service_account
from googleapiclient.discovery import build

SID = os.environ.get("MATRIX_SHEET_ID", "1sbITHxuTGt7yIRR2PmLvvzIxD-4n_O4eYUDzUNDtBBA")
SHEET = os.environ.get("MATRIX_SHEET_NAME", "Ассортиментная матрица (полная)")
OUT = os.environ.get("OUT_PATH", "matrix.json")
KEEP = ["Поставщик", "Товар", "Категория", "Решение", "Штрихкод",
        "Себестоимость", "Прибыль", "Покрытие", "Статус"]


def main():
    creds = service_account.Credentials.from_service_account_file(
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"],
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
    res = svc.spreadsheets().values().get(
        spreadsheetId=SID, range=SHEET, valueRenderOption="FORMATTED_VALUE").execute()
    vals = res.get("values", [])
    if not vals:
        json.dump({"matrix": {"cols": [], "rows": []}}, open(OUT, "w"), ensure_ascii=False)
        print("matrix empty"); return
    header = vals[0]
    idx = [header.index(c) for c in KEEP if c in header]
    cols = [header[i] for i in idx]
    rows = []
    for r in vals[1:]:
        r = r + [""] * len(header)          # добить недостающие ячейки
        row = [r[i] for i in idx]
        if any(str(x).strip() for x in row):  # пропустить полностью пустые строки
            rows.append(row)
    out = {"matrix": {
        "cols": cols, "rows": rows,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "sheet": SHEET}}
    json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
    print("matrix rows:", len(rows), "cols:", cols)


if __name__ == "__main__":
    main()
