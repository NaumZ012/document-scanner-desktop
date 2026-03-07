# Pre-release checklist (completed in code)

This document records what was verified or implemented for the final pre-release pass.

## 1. Console statements
- **Done.** All `console.log` / `console.error` / `console.warn` / `console.debug` removed or gated.
- `src/utils/logger.ts`: Logging runs only when `import.meta.env.DEV` is true; production builds do not log to console.

## 2. No hardcoded secrets
- **Done.** Supabase URL and anon key come from `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `src/services/supabaseClient.ts`.
- Azure endpoint and key in Rust (`src-tauri/src/ocr.rs`) use `AZURE_OCR_*` env at runtime and `AZURE_OCR_*_BUILD` at compile time; no hardcoded keys or URLs.

## 3. Supabase queries and owner_id
- **Done.** Every table query filters by the authenticated user:
  - `profiles`: `.eq("id", user.id)` (profiles.id = auth.uid()).
  - `employees`: `.eq("owner_id", user.id)`.
  - `api_calls` / `audit_log`: `.eq("owner_id", user.id)` for non-admins; admins see all by design (RLS can allow role = 'admin').

## 4. Supabase client and JWT
- **Done.** Single client in `supabaseClient.ts` with `persistSession: true` and `autoRefreshToken: true`. The Supabase JS client attaches the session JWT to every request when the user is signed in.
- `audit.ts`: When calling the audit_event edge function, the current session token is sent (fetched via `getSession()` if not passed), so backend can set `owner_id = auth.uid()`.

## 5. Azure endpoint and key
- **Done.** Rust `ocr.rs` uses `azure_env()`: runtime `AZURE_OCR_ENDPOINT` / `AZURE_OCR_KEY`, then build-time `AZURE_OCR_ENDPOINT_BUILD` / `AZURE_OCR_KEY_BUILD`. No hardcoded values.

## 6. Tauri updater
- **Done.** In `App.tsx`, on launch a background check runs (non-blocking). If an update is available, a toast appears: “Update X available. Restart to install.” with a “Download and restart” button. No blocking of app startup.

## 7. Employee PIN verification
- **Done.** PIN verification is server-side only. The `start_session` edge function calls RPCs `verify_employee_pin` and `create_employee`; no client-side PIN verification or hashing.

## 8. Rate limiting before Azure scan
- **Done.** Before starting a scan batch, `Home.tsx` calls `checkRateLimitBeforeScan()` which invokes the `check_rate_limit` edge function (which calls the DB RPC `check_rate_limit`). If rate limited, the user sees a friendly message and the scan does not run.

## 9. Auth and scan events in audit_log
- **Done.** Audit events logged:
  - **Login success/failed:** `Auth.tsx` calls `logAuditEvent({ eventType: "login_success" | "login_failed", ... })`.
  - **Logout:** `AuthContext.tsx` `signOut` calls `logAuditEvent({ eventType: "logout", accessToken })` before clearing session.
  - **PIN attempt:** `start_session` edge function inserts `employee_pin_success` or `employee_pin_failed` into `audit_log`.
  - **Scan complete:** `Home.tsx` calls `logAuditEvent({ eventType: "scan_completed", metadata: { file_name, document_type } })` after each successful OCR.
  - **Rate limit hit:** `check_rate_limit` and `ocr_invoice` edge functions insert `rate_limit_hit` when the RPC denies the request.

## 10. TODO / FIXME
- **Done.** No TODO or FIXME comments left in the codebase (verified by search).

## 11. Friendly error messages
- **Done.** User-facing errors use plain language:
  - Auth: `toFriendlyAuthError()` in `AuthContext.tsx` maps Supabase auth errors to friendly messages.
  - Scan: `toFriendlyScanError()` in `src/utils/friendlyErrors.ts` used in `Home.tsx` and `DragDrop.tsx`.
  - Admin: Generic “Could not load…” messages instead of raw Supabase errors.
  - Employee: “Could not start session. Please check your PIN and try again.” and “Something went wrong. Please try again.”
  - ErrorBoundary: Only shows a generic “Нешто тргна наопаку…” message; raw error message and stack traces are no longer shown in the UI.

## 12. Manual test flow (for you to run)
1. **Sign up** → New account created; audit_log has `login_success` (or sign-up flow event).
2. **Employee screen** → Choose “Skip” (or select/create employee with PIN); `start_session` creates `app_sessions` row; audit has PIN events if applicable.
3. **Scan a document** → Home → select type → add PDF → Scan. Rate limit is checked first; then OCR runs; on success `scan_completed` is logged.
4. **Supabase** → In Dashboard, check `audit_log` and (if used) `api_calls` / `app_sessions` for the current user; confirm rows have correct `owner_id` and events.

## New / updated files (this pass)
- `supabase/functions/check_rate_limit/index.ts` – Edge function for rate limit check before scan.
- `src/utils/friendlyErrors.ts` – Shared friendly scan error messages.
- `src/services/audit.ts` – Added `logout` event type and `checkRateLimitBeforeScan()`.
- `src/context/AuthContext.tsx` – Logout audit, friendly auth errors.
- `src/pages/Home.tsx` – Rate limit check before scan, `scan_completed` audit, friendly scan errors.
- `src/pages/Admin.tsx` – Friendly load error messages.
- `src/pages/Employee.tsx` – Friendly error messages.
- `src/components/DragDrop.tsx` – Friendly scan errors via `toFriendlyScanError`.
- `src/components/ErrorBoundary.tsx` – Removed raw error message from UI.
- `src/utils/logger.ts` – No console output in production.
