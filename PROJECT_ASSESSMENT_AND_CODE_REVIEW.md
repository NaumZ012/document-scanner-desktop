# Project Assessment & Code Review

**Project:** Invoice Scanner Desktop (document-scanner-desktop)  
**Stack:** Tauri 2, React 18, TypeScript, Vite, Rust backend, SQLite, Azure Document Intelligence  
**Date:** Feb 4, 2025  

---

## 1. Executive Summary

The project is a **desktop invoice/document scanner** that uses Azure Document Intelligence for OCR, extracts structured fields (invoice number, dates, amounts, seller/buyer, etc.), and exports data to Excel with configurable column mapping and history. The architecture is clear: React frontend, Tauri backend (Rust) for OCR, Excel I/O, and SQLite.

**Overall:** Solid structure and feature set. Several **bugs**, **security/hygiene**, and **scalability** issues should be addressed before production or heavy use.

---

## 2. Project Structure Assessment

| Area | Assessment |
|------|------------|
| **Separation of concerns** | Good: `src/` (React), `src-tauri/src/` (Rust), shared types, services, utils. |
| **Naming** | Inconsistent: repo/folder is `document-scanner-desktop`, `package.json` name is `invoice-scanner`, README says "Invoice Scanner Desktop". Consider aligning. |
| **Config** | `.env` for Azure keys; `.env.example` present. `.gitignore` is **incomplete** (see Issues). |
| **Build** | Vite + Tauri; `npm run tauri dev` / `tauri build`; TypeScript strict enough. |

---

## 3. Code Review – Critical Issues

### 3.1 Bug: Global regex with `exec()` in loop (extractFields.ts)

**File:** `src/utils/extractFields.ts` (currency extraction)

**Issue:** A **stateful** regex with the `g` flag is reused in a loop. `RegExp.prototype.exec()` updates `lastIndex`; when the next iteration runs on a **different** string (`line.text`), the regex may not match correctly or may skip lines.

```ts
// Lines 197–201 – BUG
const currStandalone = /(?:^|[\s,:])(RSD|MKD|EUR|USD)(?:[\s,\d]|$)/gi;
for (const line of lines) {
  const m = currStandalone.exec(line.text);  // lastIndex is shared across iterations
  if (m) return { value: m[1].toUpperCase(), confidence: line.confidence };
}
```

**Fix:** Use a non-global regex and `String.prototype.match()`, or create a new regex per iteration, or reset `lastIndex` before each `exec()`:

```ts
const currStandalone = /(?:^|[\s,:])(RSD|MKD|EUR|USD)(?:[\s,\d]|$)/i;
for (const line of lines) {
  const m = line.text.match(currStandalone);
  if (m) return { value: m[1].toUpperCase(), confidence: line.confidence };
}
```

(Note: `match()` with a non-global regex returns the first match with groups, which is what you need here.)

---

### 3.2 Bug: `setInterval` vs `setTimeout` (DragDrop.tsx)

**File:** `src/components/DragDrop.tsx` (lines 86–88)

**Issue:** The code uses `window.setInterval()` but clears it with `window.clearInterval()`. The variable is named and used correctly; the only oddity is that the **loading hint** rotates on an interval, which is correct. No functional bug here after re-check—just ensure the interval is cleared on unmount (it is in the effect cleanup). **No change required** unless you prefer a single timeout for a one-shot hint change.

---

### 3.3 Inefficiency: History filtered in memory (db.rs)

**File:** `src-tauri/src/db.rs` – `get_history()`

**Issue:** All history rows are selected and then filtered in Rust by `search` and `status_filter`. For large tables this wastes memory and CPU.

```rust
// Current: loads ALL rows, then filters
let rows = stmt.query_map([], |row| { ... });
let all: Vec<_> = rows.filter_map(|r| r.ok()).collect();
let out = all.into_iter().filter(|(_, _, _, fp, data, st, _, _)| { ... }).collect();
```

**Recommendation:** Move filtering into SQL with `WHERE` and parameterized queries (e.g. `LIKE '%' || ?1 || '%'` for search, `status = ?2` for status). Use `LIMIT` if you add pagination later.

---

### 3.4 Redundant clones in async commands (commands.rs)

**File:** `src-tauri/src/commands.rs`

**Issue:** In async commands, `path` and `sheet` (and in `append_row_to_excel`, payload fields) are cloned before `spawn_blocking(move || ...)`. This is correct for moving into the closure, but in places you clone then use references in the closure:

```rust
// e.g. read_excel_headers – cloning is needed for move, but the pattern is repeated
let path = path.clone();
let sheet = sheet.clone();
tauri::async_runtime::spawn_blocking(move || excel::read_excel_headers(&path, &sheet, header_row))
```

No bug, but you could pass a single struct or tuple by value to reduce boilerplate. **Low priority.**

---

## 4. Security & Hygiene

### 4.1 `.gitignore` is incomplete

**Current:** Only `node_modules` is listed.

**Risk:** `.env` (Azure keys), `dist/`, Rust `target/`, IDE/OS files, and lockfiles (if you ever want to ignore them) can be committed by mistake. `.env` is especially sensitive.

**Recommendation:** Add at least:

- `.env`
- `dist/`
- `src-tauri/target/`
- `*.log`
- `.DS_Store` / `Thumbs.db`
- Optional: `*.tsbuildinfo` if you don’t want to track them

---

### 4.2 Secrets and environment

- **Azure key:** Read from env at runtime (good); not hardcoded.
- **Distribution:** README correctly states that `.env` is not bundled and users must set env or config.
- **Suggestion:** For packaged builds, consider a secure store (e.g. OS keychain) or a config file in app data dir, and document it.

---

### 4.3 Input validation

- **Rust:** File paths and payloads from the frontend are used in `ocr::run_ocr`, `excel::*`, and DB. Paths are not validated for path traversal (e.g. `../`). In Tauri the frontend is same-origin, but validating path canonicalization or allowed bases is still recommended.
- **Frontend:** History “Add record” allows free-form JSON in `extracted_data`; DB stores it as JSON. No sanitization beyond JSON parse. Acceptable for a local app; for any future server/export, validate structure and size.

---

## 5. Type & API Consistency

### 5.1 Backend vs frontend types

- **Profiles:** Rust returns `(i64, String, String, String, String)`; frontend uses tuple indices `row[0]`, `row[1]`, etc. This is fragile if the backend ever reorders columns. Consider a shared type or at least named fields (e.g. serde struct) and a single source of truth.
- **Learned mapping:** Rust returns `(String, f64)` (column_letter, confidence). Frontend types it as `[string, number] | null`, which is correct.

### 5.2 Error handling

- **Rust:** Commands return `Result<T, String>`. Errors are strings; no error codes. Fine for this app; for richer UX you could use an enum or code.
- **Frontend:** `api.ts` passes through Tauri errors. Pages often do `e instanceof Error ? e.message : String(e)`. Consistent and acceptable.

---

## 6. Frontend-Specific Notes

### 6.1 Strengths

- Clear use of context (App, Toast), hooks, and `useCallback`/`useMemo` where it matters (e.g. Review page).
- Accessibility: `aria-label`, `aria-hidden`, `aria-live` in DragDrop; could be extended elsewhere.
- Theme (light/dark/system) with `data-theme` and media query listener is implemented correctly.

### 6.2 Minor issues

- **Review.tsx:** Duplicated logic between `handleAddToExcel` and `handleExport` (profile resolution, mapping parse, row build). Could be extracted to a shared helper.
- **History.tsx:** “Add record” modal allows arbitrary JSON; a single typo can make the record unusable. Consider a simple key/value form or a validator.
- **Settings.tsx:** `handleSaveProfile` dependency array includes `sheetNames`; it’s not used in the callback. Harmless but noisy for exhaustive-deps.

---

## 7. Backend (Rust) Notes

### 7.1 Strengths

- OCR: Polling with timeout, clear error messages, env loading via dotenvy.
- Excel: Uses `edit_xlsx` to preserve formatting; strip-drawings logic avoids “Repairs to document” in Excel.
- DB: Parameterized queries (rusqlite `params!`), schema with foreign key for `excel_profile_id`.
- Async: Heavy work (Excel, OCR) offloaded with `spawn_blocking` where appropriate so the UI stays responsive.

### 7.2 OCR (ocr.rs)

- **Blocking client:** `reqwest::blocking::Client` is used in `run_ocr`, which is invoked from a Tauri command. The command is synchronous, so the UI can freeze during the 2s × up to 60 polls. Consider making `run_ocr` run inside `spawn_blocking` (and the Tauri command async) so the UI doesn’t block.
- **Timeout:** 120s for the initial request is reasonable; total wait can be ~2 minutes for polling. Document this for users.

### 7.3 Database (db.rs)

- **Double mutex:** `AppState` has `Mutex<Option<Db>>`, and `Db` has `Mutex<Connection>`. This is intentional (optional DB + single connection) and correct.
- **Learned mappings:** Confidence decay and usage boost in `get_learned_mapping` are clear and reasonable.

---

## 8. Testing & Quality

- **Tests:** No tests (unit/integration) found in the repo. For OCR parsing, Excel round-trip, and field extraction, even a few tests would reduce regressions.
- **Linting:** No ESLint/Prettier config in the listed files; consider adding them and running in CI.
- **Rust:** `cargo clippy` and `cargo fmt` are recommended; no config seen.

---

## 9. Recommendations Summary

| Priority | Item | Action |
|----------|------|--------|
| **High** | Regex bug in currency extraction | Use non-global regex + `match()` (or new regex / reset `lastIndex`) in `extractFields.ts`. |
| **High** | `.gitignore` | Add `.env`, `dist/`, `src-tauri/target/`, and common noise files. |
| **Medium** | History query | Filter `get_history` in SQL (WHERE + params) instead of in Rust. |
| **Medium** | OCR blocking UI | Run `run_ocr` in `spawn_blocking` and make the command async so the UI doesn’t freeze. |
| **Low** | Naming | Align repo name, `package.json` name, and README title. |
| **Low** | Shared types | Consider shared profile/history types (e.g. serde structs) between Rust and TS. |
| **Low** | Duplicate logic | Extract “build row from profile + fields” in Review.tsx into a helper. |
| **Ongoing** | Tests & tooling | Add a few unit tests (extraction, mapping); add ESLint/Prettier and Clippy. |

---

## 10. Conclusion

The project is well-structured and feature-complete for a desktop invoice scanner with OCR and Excel export. The **critical fix** is the global-regex bug in `extractFields.ts`. Improving **.gitignore**, **history query performance**, and **OCR non-blocking behavior** will make the app safer and more scalable. The rest of the items are incremental improvements and maintainability.

If you want, I can suggest concrete patches for the regex fix and `.gitignore` next.
