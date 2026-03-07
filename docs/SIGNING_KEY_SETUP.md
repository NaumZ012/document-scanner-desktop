# Tauri updater signing key (Windows)

On Windows, **password-protected keys do not work** with the build script (Tauri bug). Use an **unencrypted** key so the build can sign the MSI without prompting.

## One-time setup: create a key with no password

1. **Back up your current keys** (optional, if you had releases signed with the old key):
   ```powershell
   copy update.key update.key.bak
   copy update.key.pub update.key.pub.bak
   ```

2. **Generate a new key with no password:**
   ```powershell
   npx tauri signer generate -w update.key
   ```
   When prompted:
   - **"Please enter a password to protect the secret key"** → press **Enter** (leave empty).
   - **"Password (one more time)"** → press **Enter** again.

3. **Update the public key in the app config:**
   - Open `update.key.pub` and copy its **entire content** (one line of base64).
   - Open `src-tauri/tauri.conf.json` and find `plugins` → `updater` → `pubkey`.
   - Replace the existing `pubkey` value with the new value from `update.key.pub` (keep the quotes).

   Example in `tauri.conf.json`:
   ```json
   "plugins": {
     "updater": {
       "pubkey": "PASTE_THE_FULL_CONTENT_OF_update.key.pub_HERE",
       "endpoints": ["https://github.com/NaumZ012/document-scanner-desktop/releases/latest/download/latest.json"],
       "windows": { "installMode": "passive" }
     }
   }
   ```

4. **Do not set a password in `.env`:**
   - Remove or comment out `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if present.
   - You can set `TAURI_SIGNING_PRIVATE_KEY_PATH=update.key` or leave it unset (script uses `update.key` in the repo root by default).

5. **Build:**
   ```powershell
   npm run tauri:build:production
   ```
   You should see "Using signing key file: ... (no password)" and the build will produce the MSI and `.sig` file.

## Summary

| Key type              | Build result on Windows      |
|-----------------------|-----------------------------|
| Unencrypted (no pass) | Signs successfully          |
| Password-protected    | Prompts or fails; skip signing |

Keep `update.key` and `update.key.pub` out of Git (e.g. `update.key` in `.gitignore`; `.pub` can be committed if you want, but the private key must never be committed).
