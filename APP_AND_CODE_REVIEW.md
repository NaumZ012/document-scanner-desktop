# Invoice Scanner Desktop — App & Code Review

**Date:** February 2025  
**Stack:** Tauri 2, React 18, TypeScript, Vite, Rust (OCR, Excel, SQLite), Azure Document Intelligence

---

## 1. What the app is about

**Invoice Scanner Desktop** is a local desktop app that:

1. **Ingests** invoices (PDF or images: JPG, PNG, TIFF) via drag‑and‑drop or file picker.
2. **Extracts** structured data using **Azure Document Intelligence (prebuilt-invoice)**:
   - Invoice number, dates, seller/buyer names and addresses, tax IDs  
   - Amounts (net, tax, total), currency, line item descriptions (combined)  
   - Document type inferred as "faktura" when using the invoice model
3. **Shows** a **Review** screen with editable fields and optional PDF preview.
4. **Exports** one row per scan to an existing Excel workbook using **profiles** (path + sheet + column → field mapping). Learning and auto-matching suggest mappings for new profiles.
5. **Keeps** a **History** of scans (SQLite) with status (pending / added_to_excel / error), search, and re-export from history.
6. **Supports** light/dark/system theme and a custom title bar (minimize/maximize/close).

**User flow (main path):** Home → drop PDF → OCR (Azure) → Review → edit if needed → Add to Excel (with a profile from Settings) → row appended; optional History for re-export or editing stored data.

---

## 2. Where we are now (current state)

### 2.1 Recent fixes (already in codebase)

| Area | Change | Purpose |
|------|--------|--------|
| **OCR amounts** | `valueCurrency.amount` extraction in `ocr.rs` | Prebuilt-invoice returns SubTotal/TotalTax/InvoiceTotal as currency; amounts were missing without this. |
| **Description** | Line items from `Items.valueArray` → `valueObject.Description.valueString` joined with `"; "` in `ocr.rs` | Populates the "Description" field from invoice line items. |
| **Tauri invoke** | `cache_excel_schema` called with camelCase args (`schemaJson`, `schemaHash`, `worksheetName`) in `api.ts` | Matches Tauri’s JS↔Rust naming; fixes "missing required key schemaJson". |
| **OOM on Add to Excel** | Schema analysis moved to backend: `analyze_excel_schema` (Rust/calamine), `get_excel_schema` no longer returns `file_bytes`; frontend uses backend for schema and sheet names | Avoids loading the full Excel file into the webview for schema, preventing Out of Memory on large workbooks. |
| **.gitignore** | Includes `.env`, `dist/`, `src-tauri/target/`, logs, OS cruft | Reduces risk of committing secrets and build artifacts. |

### 2.2 What’s working end‑to‑end

- **Home:** File validation (PDF header), drag‑drop and browse, loading hints.
- **OCR:** `run_ocr_invoice` (prebuilt-invoice), field mapping (Azure → internal keys), currency and line-item description extraction, optional debug logging.
- **Review:** Fields from `invoiceDataToFields`, grouped display, PDF preview (base64), Add to Excel with profile, history ID creation and status update.
- **Settings:** Excel profile CRUD, sheet/list from backend, schema from backend, header row, auto-match (keyword + learned + pattern), save/delete profile.
- **History:** List with search and status filter (SQL WHERE in Rust), open in Review (fromHistory), export/delete/save.
- **Excel write:** `writeAndVerify` (frontend: read → append row → verify → backup → write → cleanup) or backend `append_row_to_excel` (used by `writeFullRow`); schema is no longer loaded in frontend for analysis.

### 2.3 Known limitations / tech debt

- **Write path memory:** "Add to Excel" still uses `writeAndVerify`, which loads the full workbook in the frontend (ExcelJS) for append + verify. Very large workbooks could still cause high memory use or OOM; backend-only append would avoid that.
- **run_ocr (prebuilt-read):** Still exists and is synchronous; not used by the main invoice flow (which uses `run_ocr_invoice`). If ever used, it can block the UI; making the command async and using `spawn_blocking` would be consistent with other heavy commands.
- **Profile/history types:** Backend returns tuples (e.g. `(i64, String, String, String, String)` for profiles); frontend uses indices. Works but is brittle if column order changes; named structs would be clearer.
- **No automated tests:** No unit or integration tests in the repo.
- **extractFields.ts:** Referenced in an older assessment; **file does not exist**. The app uses Azure prebuilt-invoice + `invoiceDataToFields.ts`; no keyword-based extraction from raw text for invoices.

---

## 3. Code review

### 3.1 Architecture

- **Separation:** Clear split: React (UI, context, services, utils) vs. Tauri (commands, ocr, excel, db, types). Shared field keys and labels in `constants.ts`; types in `shared/types.ts`.
- **API boundary:** `api.ts` centralizes `invoke()`; camelCase for Tauri where required. Services (schema, mapping, excel, learning, orchestrator) sit above API.
- **State:** App context (screen, review, selectedProfileId, theme); Toast context; local state in pages. No global store; appropriate for this size.

### 3.2 Frontend

- **Strengths:** Lazy routes, `useCallback`/`useMemo` where it matters (Review), accessibility hints in DragDrop, theme with `data-theme` and media query.
- **Review.tsx:** `handleAddToExcel` and `handleExport` share profile resolution and `addToExcelWithProfile`; a small helper (e.g. `getProfileOrError`) could reduce duplication.
- **Settings.tsx:** `analyzeSchema` and `getSheetNamesFromPath` now use backend only; no worker/ExcelJS for schema. Dependency arrays (e.g. `sheetNames` in a callback) could be tidied for exhaustive-deps if desired.
- **History:** Search and status filter are applied in SQL in `db.rs` (WHERE + params); no in-memory filter of full table.
- **excelService.writeAndVerify:** Still uses `readExcelAsBuffer` + ExcelJS for full load; backup/write/restore logic is clear. For very large files, consider a backend-only append path or chunked strategies later.

### 3.3 Backend (Rust)

- **OCR (`ocr.rs`):** prebuilt-invoice only for invoice flow; `AZURE_TO_FIELD` mapping; `valueString`/`valueNumber`/`valueCurrency`/`valueDate`/`valueTime` and line items (Items → valueArray → valueObject.Description). Env via dotenvy; polling with timeout; blocking client (sync command). Optional debug logs under `#[cfg(debug_assertions)]`.
- **Excel (`excel.rs`):** Calamine for read (headers, column samples, schema analysis); edit_xlsx for append; drawing stripping to avoid "Repairs to document". `analyze_excel_schema` returns worksheet name, headers, samples, last data row, and schema hash (same algorithm as frontend for compatibility).
- **DB (`db.rs`):** Parameterized queries, schema with FKs, history filtered in SQL. Learned mappings with confidence and optional decay/usage.
- **Commands:** Heavy work (OCR invoice, Excel schema, headers, append) uses `spawn_blocking` and async commands where appropriate. Clone‑then‑move pattern in closures is correct.

### 3.4 Security and hygiene

- **Secrets:** Azure key/endpoint from env; not bundled. README notes env/config for distribution.
- **.gitignore:** Covers `.env`, `dist/`, `target/`, logs, OS files.
- **Inputs:** Paths and payloads from frontend used in OCR/Excel/DB. No path canonicalization or allowlist; acceptable for a local, same-origin Tauri app; consider validation if opening to untrusted inputs later.

### 3.5 Types and consistency

- **Backend vs frontend:** Profile/history as tuples works but is fragile; consider serde structs with camelCase for a single contract.
- **Errors:** Commands return `Result<T, String>`; frontend often uses `e instanceof Error ? e.message : String(e)`. Consistent and sufficient for current UX.

---

## 4. App review (product / UX)

### 4.1 Strengths

- **Single, clear job:** Scan invoice → review → export to Excel, with history and profiles.
- **No server:** Everything runs locally; Azure only for OCR; data stays on the machine.
- **Flexible mapping:** Profiles + learning + auto-match support different Excel layouts and languages (e.g. Macedonian keywords in constants).
- **Recoverability:** Backup before write and restore on failure; history allows re-export and edit.

### 4.2 Gaps / improvements

- **No onboarding:** First-time users must discover Settings → create profile before "Add to Excel" works. A short first-run hint or empty state could help.
- **Large Excel files:** Schema is now safe (backend); write path still loads full file in frontend. For 10MB+ workbooks, a backend-only append option would improve robustness.
- **OCR feedback:** Progress is implicit (loading state). If OCR is slow, a "Analyzing…" step or progress message could set expectations.
- **Errors:** Messages are technical (e.g. "Invalid profile mapping", API errors). User-facing copy could be refined for non-technical users.

---

## 5. Recommendations summary

| Priority | Item | Action |
|----------|------|--------|
| **High** | Write path memory | For "Add to Excel", consider using backend `append_row_to_excel` only (no full workbook load in frontend), or add a "simple append" mode for large files. |
| **Medium** | run_ocr (prebuilt-read) | If kept, make the command async and run `run_ocr` inside `spawn_blocking` to avoid blocking the UI. |
| **Medium** | Profile/history types | Replace tuple returns with serde structs (camelCase) for profiles and history rows; use same shape in TS. |
| **Low** | Review.tsx duplication | Extract profile resolution and mapping parse into a small helper used by handleAddToExcel and handleExport. |
| **Low** | Onboarding | Add first-run hint or empty state: "Create an Excel profile in Settings to export rows." |
| **Ongoing** | Tests | Add a few unit tests (e.g. schema hash, field mapping, invoiceDataToFields); optional E2E for scan → review → export. |
| **Ongoing** | Tooling | ESLint/Prettier and `cargo clippy`/`cargo fmt` in CI. |

---

## 6. Conclusion

The app is **coherent and feature-complete** for its goal: scan invoices with Azure, review structured data, and append rows to Excel with configurable mapping and history. Recent changes (amount/description extraction, Tauri camelCase, backend schema analysis, .gitignore) address the main correctness and stability issues. The next meaningful step is to reduce frontend memory use during **write** (backend-only append or optional "light" mode) and to tighten types and tests for long-term maintainability.
