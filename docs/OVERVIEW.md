## Document Scanner Desktop – Overview

**What it does**

- Scans local documents (Фактури, Даночен биланс, ДДВ, Плати) using Azure Content Understanding.
- Shows a review screen with extracted fields and confidence.
- Exports data into fixed Excel templates (one standard layout per document type).
- Keeps a SQLite history so you can reopen, edit and re‑export past scans.

**Main flow**

1. Open the app and choose the document type on the Home screen.
2. Drop a PDF (or click to browse) — the app calls your configured Azure analyzer.
3. Review page opens:
   - Left: PDF preview (for new scans).
   - Right: structured fields for that document type, in the same order/headings as your Excel example.
4. Edit any fields if needed.
5. Export:
   - Даночен биланс: copies `РД-Данок на добивка-2024-Example.xlsx` and fills the AOP column.
   - ДДВ: writes one summary row with all DDV boxes (01–19, 21–31) as columns.
   - Плати: writes a row with yearly totals (бруто, придонеси, персонален данок, нето).
   - Фактури: writes rows that match `Exaple-Invoices.xlsx` (Тип, Број, Дата, Продавач, Купувач, Опис, Нето, ДДВ, Бруто).
6. The scan is stored in History, with status and timestamp.

**Key files**

- Frontend: `src/` (React + TypeScript pages, components, shared constants/schemas).
- Backend: `src-tauri/src/` (Rust Tauri commands, Azure OCR integration, Excel I/O, SQLite).
- Templates:
  - `example/…/Invoices/Exaple-Invoices.xlsx`
  - `example/…/Даночен биланс/РД-Данок на добивка-2024-Example.xlsx`
  - `example/…/ДДВ/РД-ДДВ-Example.xlsx`
  - `example/…/Плати/РД-Трошоци за вработени-Example.xlsx`

**Environment**

- `AZURE_OCR_KEY` and `AZURE_OCR_ENDPOINT` must be set (via `.env` during dev, or OS / app‑data `.env` in production).
- Optional custom analyzer IDs:
  - `AZURE_CU_ANALYZER_FAKTURA`
  - `AZURE_CU_ANALYZER_SMETKA`
  - `AZURE_CU_ANALYZER_GENERIC`
  - `AZURE_CU_ANALYZER_PLATA`

**Build / run**

- Dev: `npm install` then `npm run tauri dev`
- Frontend build: `npm run build`
- Production bundle: `npm run tauri build` (installer under `src-tauri/target/release/bundle/`)

