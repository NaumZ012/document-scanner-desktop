## Release Checklist

Use this checklist before shipping a new build to users.

### 1. Environment and configuration

- **AZURE_OCR_KEY / AZURE_OCR_ENDPOINT** set correctly on the target machine.
- `.env` is **not** bundled in the installer; env vars or config file are documented for users.
- Custom analyzer IDs (Фактури, Даночен биланс, ДДВ, Плати) are up to date with Azure.

### 2. End‑to‑end flows per document type

For each sample file (Фактури, Даночен биланс, ДДВ, Плати):

- Drop PDF on **Home**.
- Verify **Review** shows:
  - Correct title for the schema.
  - Fields in the expected order with proper Macedonian labels.
  - Confidence badges and warning summary (празни / ниска доверба).
- Use **Преглед на скенирани документи** (Batch review) if applicable.
- Export to Excel and open the result:
  - Даночен биланс → `РД-Данок на добивка-2024-Example.xlsx` layout preserved, AOP column filled correctly.
  - ДДВ → all DDV boxes appear in a single summary row, headers match the example.
  - Плати → yearly totals row matches the example.
  - Фактури → rows match `Exaple-Invoices.xlsx` (columns and order).
- Reopen the same item from **History** and confirm data + document type are correct.

### 3. Error handling and UX

- Drop an unsupported file (wrong extension) → friendly error message, no crash.
- Simulate Azure failures (invalid key / endpoint, network off):
  - User sees a clear error toast.
  - App remains usable; new scans still work after fixing config.
- Try exporting when the template files are missing or renamed:
  - User sees a clear error; app does not crash or corrupt other files.
- Intentionally trigger a React error (dev only) and confirm the error boundary screen appears instead of a blank window.

### 4. Performance and responsiveness

- Batch scan **10+ documents** and:
  - Review cards render smoothly.
  - Preview modal opens quickly.
  - Export to Excel completes in a reasonable time.
- History view with **100+ entries**:
  - Search and pagination feel responsive.
  - Opening a history entry is fast.

### 5. Build and packaging

- `npm run build` succeeds with no TypeScript errors.
- `npm run tauri build` completes successfully.
- Installer installs and uninstalls cleanly on a fresh Windows VM.

