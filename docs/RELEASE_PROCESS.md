# Release process — what to do before you release and build

Follow these steps every time you cut a new release.

---

## 1. Bump the version (do this first)

Use the **same version** in all three places (e.g. `1.0.14`):

| File | What to change |
|------|----------------|
| `package.json` | `"version": "1.0.14"` |
| `src-tauri/tauri.conf.json` | `"version": "1.0.14"` |
| `src-tauri/Cargo.toml` | `version = "1.0.14"` |

Commit the version bump, e.g. `git add -A && git commit -m "Bump version to 1.0.14"`.

---

## 2. Check your `.env` (no secrets in repo)

Your **local** `.env` at the project root must have everything the production build needs. The build script reads it and injects values into the build; the file itself is not shipped.

Required for the **production build**:

- `AZURE_OCR_KEY` — Azure Document Intelligence / Content Understanding key  
- `AZURE_OCR_ENDPOINT` — e.g. `https://your-resource.cognitiveservices.azure.com/`  
- `AZURE_CU_ANALYZER_FAKTURA` — e.g. `projectAnalyzer_1772627858781_391`  
- `AZURE_CU_ANALYZER_SMETKA` — e.g. `TaxBalance03`  
- `AZURE_CU_ANALYZER_GENERIC` — your generic analyzer ID  
- `AZURE_CU_ANALYZER_PLATA` — your plata analyzer ID  

**Updater signing:** The production build script **does not sign** the MSI (so the build always succeeds on Windows). You get a valid MSI; the app runs. For in-app auto-updates you would need to sign in a separate step (e.g. `npx tauri build` with signing env set, or sign the MSI manually). See [Publishing desktop apps](PUBLISHING_DESKTOP_APPS.md).

Optional for **dev only** (not baked into the installer):

- `VITE_SUPABASE_URL` — Supabase project URL  
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key  

Never commit `.env`. It’s in `.gitignore`.

---

## 3. Close the app and build

1. Close **Invoice Scanner** / Document Scanner if it’s running (so the build can overwrite files).
2. From the **repo root** run:

   ```powershell
   npm run tauri:build:production
   ```

   This script:

   - Reads your `.env`
   - Sets `AZURE_*_BUILD` and `AZURE_CU_ANALYZER_*_BUILD` (and Tauri signing vars) for the build
   - Runs `npm run build` (frontend) then `tauri build` (Rust + MSI)

3. Wait for the build to finish. The MSI will be under:

   `src-tauri\target\release\bundle\msi\`

   You should see: `Invoice Scanner_1.0.14_x64_en-US.msi` (no .sig — signing is not done by this script).

---

## 4. Create the GitHub release and updater files

The Tauri updater expects a **GitHub Release** with the MSI and a **`latest.json`** that points to it. Tauri does **not** generate `latest.json` for you; you create/update it yourself.

1. **Create a new release on GitHub**
   - Repo: `NaumZ012/document-scanner-desktop`
   - “Draft a new release”
   - Tag: `v1.0.14` (must match the version you set in step 1; create the tag if needed)
   - Title: e.g. `Release 1.0.14`
   - Description: optional (e.g. changelog)

2. **Upload these assets to the release**
   - `Invoice Scanner_1.0.14_x64_en-US.msi`
   - `Invoice Scanner_1.0.14_x64_en-US.msi.sig`

3. **Create or update `latest.json`**  
   The updater checks:

   `https://github.com/NaumZ012/document-scanner-desktop/releases/latest/download/latest.json`

   So you must add **`latest.json`** as an asset to the **latest** release (or the release you want the app to update to). Content format:

   ```json
   {
     "version": "1.0.14",
     "notes": "Optional release notes",
     "pub_date": "2026-03-07T00:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<contents of Invoice Scanner_1.0.14_x64_en-US.msi.sig>",
         "url": "https://github.com/NaumZ012/document-scanner-desktop/releases/download/v1.0.14/Invoice.Scanner_1.0.14_x64_en-US.msi"
       }
     }
   }
   ```

   - `version` — same as in step 1 (e.g. `1.0.14`).  
   - `signature` — paste the **entire** contents of the `.msi.sig` file (one line).  
   - `url` — the **actual** download URL of the MSI asset.  
     - Tag in the URL must match the release tag (e.g. `v1.0.14`).  
     - File name in the URL must match the asset name. GitHub may show the asset as `Invoice Scanner_1.0.14_x64_en-US.msi`; the URL will have spaces encoded as `%20` or similar. Use the URL you get after uploading.

   Save this as a file named **`latest.json`** and upload it as an asset to **the same release** (or to the release that you want to be “latest”).

4. **Publish the release** (if it was a draft).

After this, the in-app updater will see the new version and show “Update X available. Restart to install.” when users open the app.

---

## 5. Optional: Supabase Edge Functions

If you added or changed Edge Functions (e.g. `check_rate_limit`, `audit_event`, `start_session`), deploy them so production uses the latest code:

```bash
supabase functions deploy check_rate_limit
supabase functions deploy audit_event
supabase functions deploy start_session
```

(Or your usual Supabase deploy flow.)

---

## Quick checklist (copy before each release)

- [ ] Bump version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
- [ ] Commit version bump
- [ ] `.env` has Azure keys, analyzer IDs, and Tauri signing vars (no commit)
- [ ] Close the app, run `npm run tauri:build:production`
- [ ] Create GitHub release with tag `vX.Y.Z`, upload `.msi` and `.msi.sig`
- [ ] Create/upload `latest.json` with correct `version`, `signature`, and `url`
- [ ] Publish the release
- [ ] (Optional) Deploy Supabase functions

---

## Troubleshooting

- **“No private key” / signing errors**  
  Ensure `.env` has `TAURI_SIGNING_PRIVATE_KEY` (or `TAURI_SIGNING_PRIVATE_KEY_PATH`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The production build script passes these through; it does not load `.env` by default for `tauri build`, so the script is required.

- **Installer works but “no update” in app**  
  Check that `latest.json` is uploaded to the **latest** release and that its `version` is **newer** than the version the user has installed. The app compares versions; if `latest.json` is missing or points to an older version, no update is offered.

- **OCR fails in the installed app**  
  The built app uses the Azure and analyzer values that were in `.env` at **build time** (via the production build script). Rebuild with `npm run tauri:build:production` and a correct `.env` so the new MSI has the right config.
