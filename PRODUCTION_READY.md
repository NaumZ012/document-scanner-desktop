# Production-Ready Process — Invoice Scanner Desktop

Use this checklist to prepare and present the app in a **production-quality** way (e.g. for a demo tomorrow).

---

## 1. Pre-build checklist

### 1.1 Code & config

- [ ] **TypeScript compiles**: Run `npm run build`. Fix any type errors.
- [ ] **No stray debug code**: Search for `console.log` / `debugger` in `src/` and remove or guard for production.
- [ ] **Version**: In `package.json` and `src-tauri/tauri.conf.json`, set a clear version (e.g. `1.0.0` for first release).
- [ ] **Tauri bundle**: In `src-tauri/tauri.conf.json`, `bundle.icon` should list your icons (e.g. `icons/icon.ico`, `icons/icon.icns`, etc.). `bundle.copyright` can be set for the installer.

### 1.2 Azure OCR (critical for demo)

The app reads **AZURE_OCR_KEY** and **AZURE_OCR_ENDPOINT** from the environment. In production there is no project `.env`; use one of these:

**Option A — System environment variables (recommended for a single demo machine)**  
Set before launching the app:

- **Windows (PowerShell, current user):**
  ```powershell
  [System.Environment]::SetEnvironmentVariable("AZURE_OCR_KEY", "your_key", "User")
  [System.Environment]::SetEnvironmentVariable("AZURE_OCR_ENDPOINT", "https://your-resource.cognitiveservices.azure.com/", "User")
  ```
  Then **restart the app** (or log off/on) so it sees the new variables.

- **Windows (cmd, current session only):**
  ```cmd
  set AZURE_OCR_KEY=your_key
  set AZURE_OCR_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
  ```
  Then start the app from that same command window.

**Option B — .env in app data folder**  
The app loads a `.env` file from its **app data directory** at startup (if present):

1. Build and run the app once.
2. In the app: **Settings → “Open app data folder”**.
3. In that folder, create a file named `.env` with:
   ```env
   AZURE_OCR_KEY=your_key_here
   AZURE_OCR_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
   ```
4. Restart the app.

After either option, **Settings** should show Azure status as **configured**.

### 1.3 Test run (dev)

- [ ] Run `npm run tauri dev`, drop a PDF on Home, confirm OCR runs and Review opens.
- [ ] Add to Excel (with a profile), then check History and Settings (Azure, version, theme).

---

## 2. Build for production

### 2.1 Installer build

```bash
npm run build
npm run tauri build
```

- First command builds the frontend (Vite + TypeScript).
- Second produces the installer and portable binaries.

### 2.2 Output location

- **Windows**: `src-tauri\target\release\bundle\`
  - **MSI**: `msi\Invoice Scanner_1.0.0_x64_en-US.msi` (or similar)
  - **NSIS**: `nsis\Invoice Scanner_1.0.0_x64-setup.exe` (or similar)
  - **Portable**: sometimes under the same folder (e.g. `.exe` without installer)

Use the **MSI** or **NSIS** installer for a clean “production” install, or the portable `.exe` for a no-install demo.

---

## 3. Pre-presentation setup (on demo machine)

1. **Install** the app from the MSI/NSIS or run the portable executable.
2. **Configure Azure** using Option A or B above. Verify in **Settings** that Azure shows as configured.
3. **Create an Excel profile** (Settings): pick a target workbook and sheet so “Add to Excel” works during the demo.
4. **Prepare 1–2 sample PDFs** (invoices) in a known folder for drag-and-drop.
5. **Optional**: Set **Settings → Theme** (e.g. dark) and **Language** so the UI looks consistent.
6. **Close and reopen** the app once to ensure env/config are loaded and the window state is clean.

---

## 4. Presentation flow (suggested)

1. **Home**: Show drag-and-drop (or file picker), drop a sample invoice.
2. **Review**: Show extracted fields, confidence, and side-by-side preview; briefly edit a field.
3. **Add to Excel**: Choose the profile, add the row, confirm success message.
4. **History**: Show the new record, optional re-export or search.
5. **Settings**: Show Azure status, version, theme, and Excel profiles (no need to expose keys).

---

## 5. Quick reference commands

| Task              | Command              |
|-------------------|----------------------|
| Dev (Vite + Tauri)| `npm run tauri dev`   |
| Build frontend    | `npm run build`       |
| Build installer   | `npm run tauri build` |
| Installer output  | `src-tauri\target\release\bundle\` |

---

## 6. If something goes wrong

- **“AZURE_OCR_KEY not set”**: Configure Azure via Option A or B above and restart the app.
- **Build fails**: Run `npm run build` and fix TypeScript errors; ensure Rust toolchain is up to date (`rustup update`).
- **Window blank after install**: Ensure the machine has WebView2 (Windows 10/11 usually do). If not, install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
- **Excel “access denied”**: Close the workbook in Excel before adding rows from the app.

Following this process should make the app look and behave in a **production-ready** way for your presentation.
