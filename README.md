# Document Scanner Desktop

Desktop app (Tauri + React + Rust) for scanning Macedonian business documents with Azure Content Understanding and exporting structured data into standard Excel templates.

- Drop a PDF → Azure analyzes it with your custom analyzers.
- Review the extracted fields (with confidence) per document type.
- Export into fixed Excel layouts for:
  - Фактури (`Exaple-Invoices.xlsx`)
  - Даночен биланс (`РД-Данок на добивка-2024-Example.xlsx`)
  - ДДВ (`РД-ДДВ-Example.xlsx`)
  - Плати (`РД-Трошоци за вработени-Example.xlsx`)

## Quickstart

```bash
npm install
npm run tauri dev
```

Set `AZURE_OCR_KEY` and `AZURE_OCR_ENDPOINT` in a `.env` (dev) or via OS/app‑data `.env` for production.  
See `docs/OVERVIEW.md` for more details about architecture and document flows.
