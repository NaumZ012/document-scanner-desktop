# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Desktop application for scanning invoices (PDF/images) using Azure Document Intelligence OCR and exporting extracted data to Excel. Built with **Tauri 2** (Rust backend) + **React 18** + **TypeScript** + **Vite**.

## Development Commands

```bash
# Install dependencies
npm install

# Development (starts Vite dev server + Tauri window)
npm run tauri dev

# Frontend only (browser at http://localhost:5173)
npm run dev

# Build production installer
npm run tauri build
# Output: src-tauri/target/release/bundle/

# TypeScript compilation check
npm run build
```

## Azure OCR Setup

Requires `.env` file at project root (copy from `.env.example`):
```
AZURE_OCR_KEY=your_key_here
AZURE_OCR_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
```

## Architecture

### Frontend (`src/`)
- **React SPA** with client-side routing (no react-router, manual screen state in AppContext)
- **Pages**: Home (file drop/browse) → Review (edit OCR fields) → History (scanned docs) → Settings (Excel profiles)
- **Services layer**:
  - `api.ts`: Tauri command invocations (OCR, file validation, Excel operations)
  - `invoiceProcessingOrchestrator.ts`: Coordinates full pipeline (validate → OCR → schema → mapping → write → learning)
  - `excelService.ts`, `mappingService.ts`, `learningService.ts`, `schemaService.ts`
- **Multi-strategy header matching** (`src/utils/matching/`): keyword, learned mapping, pattern library, aggregation, and optimization
- **Web Workers**: `excelParse.worker.ts` for Excel parsing to avoid blocking main thread
- **Context**: `AppContext` (global state: screen, current document, fields), `ToastContext` (notifications)

### Backend (`src-tauri/src/`)
- **Rust modules**:
  - `main.rs` / `lib.rs`: Tauri app setup, plugin init (dialog)
  - `commands.rs`: All Tauri commands exposed to frontend (OCR, Excel I/O, DB, file ops)
  - `ocr.rs`: Azure Document Intelligence API integration (prebuilt-invoice model)
  - `excel.rs`: Read/write Excel via `calamine`, `rust_xlsxwriter`, `edit-xlsx`
  - `db.rs`: SQLite (profiles, history, learned mappings) via `rusqlite`
  - `types.rs`: Shared Rust types/structs
- **SQLite database**: `invoice_scanner.db` in Tauri app data dir
  - Tables: `profiles`, `history`, `learned_mappings`

### Type System
- **Shared types** (`src/shared/types.ts`): TypeScript definitions mirrored in Rust commands
- **Constants** (`src/shared/constants.ts`): Document types (faktura, plata, smetka, generic), field keys, keywords (Macedonian/English/German), header matching keywords
- Field keys are the canonical data model: `invoice_number`, `date`, `seller_name`, `total_amount`, etc.

### Data Flow
1. User drops file on Home → validate → invoke `run_ocr_invoice` (Rust backend calls Azure)
2. Azure returns structured invoice data → convert to frontend fields → navigate to Review
3. User edits fields, selects Excel profile → invoke pipeline orchestrator
4. Pipeline: schema analysis → multi-strategy header matching → user review if low confidence → write row to Excel → record learned mapping
5. History stored in SQLite; re-export available from History page

## Key Patterns

- **Tauri commands**: All backend operations are async Tauri commands invoked from `src/services/api.ts` using `invoke<T>()`
- **Multi-strategy matching**: Header-to-field mapping uses keyword strategy (HEADER_KEYWORDS), learned mappings (SQLite cache), and pattern library (regex/format detection on column samples), then aggregates and optimizes
- **Schema hashing**: Excel schema (headers array) is hashed to cache learned mappings per workbook structure
- **Excel-schema-driven forms**: Review page dynamically generates form fields from Excel schema (not hardcoded document types). All columns in Excel become editable fields.
- **Full-row writes**: ALWAYS write complete rows (all columns from schema), not just mapped fields. Uses Rust `edit_xlsx` crate for memory efficiency.
- **Confidence tracking**: OCR results include confidence scores; mapping strategies return confidence; UI highlights low-confidence fields

## Important Notes

- **Document types**: Faktura, Plata, Smetka, Generic (Macedonian invoices)
- **Keywords**: Heavily Macedonian-centric (Cyrillic + Latin), with English/German fallback
- **Excel operations**: Backend uses multiple crates (`calamine` for read, `rust_xlsxwriter` for new files, `edit-xlsx` for appending to existing)
- **No environment at runtime**: `.env` is dev-only; distributed app requires users to set env vars or config file
- **SQLite migrations**: None implemented; schema is created in `db.rs::Db::new()` if missing

## Common Gotchas

- **Excel writing**: NEVER use ExcelJS for writing (causes memory crashes with 26MB+ files). ALWAYS use Rust `append_row_to_excel` via `writeFullRow()` in excelService.ts. The `writeAndVerify()` function using ExcelJS is deprecated.
- **Form fields come from Excel schema**: Review page generates fields dynamically from `schema.columns`, NOT from hardcoded FIELD_KEYS. Each Excel column becomes a form field.
- **Column index vs letter**: Form state uses column index (0-based), but Rust backend uses column letter ("A", "B", "C"). Convert with `indexToLetter()` in schemaService.
- **Naming inconsistency**: Repo is `document-scanner-desktop`, package.json is `invoice-scanner`, README says "Invoice Scanner Desktop"
- **TypeScript path alias**: `@/` maps to `src/` (configured in tsconfig.json and vite.config.ts)
- **Tauri 2**: Uses `@tauri-apps/api` v2, `tauri-plugin-dialog` for file pickers
- **Windows-specific paths**: Development primarily on Windows (backslashes in paths)

## Testing

No test suite currently implemented. Manual testing workflow:
1. `npm run tauri dev`
2. Drop a PDF invoice on Home
3. Verify OCR extraction on Review
4. Create Excel profile in Settings
5. Add to Excel, check row appended
6. Verify history record created
