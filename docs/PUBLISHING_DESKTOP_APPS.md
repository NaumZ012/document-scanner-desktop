# How desktop apps are published (auth, security, product)

This doc aligns this project with how many teams ship desktop apps: **auth** (main + employees), **security**, and the **product** (scanning), with a practical approach to distribution and updates.

---

## 1. What you have (and what others do)

| Area | This app | Common practice |
|------|----------|------------------|
| **Auth** | Supabase Auth (main users) + employee PIN / Edge Function | Same: main auth (OAuth/email) + role or PIN for kiosk/employee flows |
| **Security** | RLS, owner_id, JWT on requests, no secrets in frontend, Azure from env | Same: backend/DB authz, env for API keys, no hardcoded secrets |
| **Product** | Invoice/document scanning → Excel | Core value; auth and security protect it |
| **Distribution** | Tauri MSI (Windows) | Same: ship installer (MSI/EXE/DMG), optionally with auto-updates |

---

## 2. Auth: main + employees

- **Main auth**  
  Supabase Auth (email/OAuth) for “who is this user?” and session. Your app already uses this for login/logout and protected UI.

- **Employees**  
  Many desktop apps use a second path for kiosk or employee use: PIN or short code, validated server-side (e.g. Edge Function) so it can’t be bypassed in the client. Your employee PIN flow fits this pattern.

- **What to keep doing**  
  - Enforce all sensitive actions (scan, export, admin) behind auth.  
  - Validate employee PIN only in Supabase (Edge Function / DB), never trust client-only checks.

---

## 3. Security

- **Secrets**  
  Azure keys and any other secrets only in env (or secure config), never in repo or frontend. The production build script bakes Azure config into the binary; `.env` stays local and is not shipped.

- **Backend / DB**  
  Supabase RLS and `owner_id` (or similar) so rows are scoped to the signed-in user. All API calls use the Supabase client with the user’s JWT.

- **Desktop-specific**  
  Tauri keeps the app in a sandbox; CSP and asset protocol are set in `tauri.conf.json`. No need to relax them unless you add new endpoints.

- **Audit**  
  Logging login, logout, failed attempts, PIN use, and scan completion (as you do) is standard for audit and support.

---

## 4. Product (scanning)

The “product” is: **scan documents → extract data → export to Excel**. Auth and security are there to protect that flow and the data.

- **Rate limiting**  
  Calling your backend (or Edge Function) before hitting Azure avoids abuse and keeps costs under control.

- **Friendly errors**  
  User-facing messages for auth, rate limit, and scan failures (no raw stack traces) match how other desktop apps present errors.

---

## 5. Distribution and updates (practical approach)

Many teams do this:

1. **Ship the installer first**  
   Build the MSI, put it on GitHub Releases (or your download page). Users install manually. No signed updater required to ship.

2. **Add signed auto-updates later**  
   When you want in-app updates, use Tauri’s updater with a **key that has no password** (avoids the Windows password-env bug):
   - `npx tauri signer generate -w update.key` → press Enter twice (empty password).
   - Put the public key in `tauri.conf.json`, use `update.key` and **do not** set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   - Build with the script; signing will work without env issues.

3. **Skip signing until you need it**  
   In `.env` set:
   ```env
   TAURI_SKIP_SIGNING=1
   ```
   Then run:
   ```powershell
   npm run tauri:build:production
   ```
   You get a valid MSI every time. The app still runs; only the *signed* auto-update verification is skipped until you enable signing (e.g. with an unencrypted key).

---

## 6. Checklist for “ready to publish”

- [ ] Auth: main (Supabase) + employee (PIN via Edge Function) in place.  
- [ ] Security: no secrets in repo; RLS/owner_id; JWT on requests; Azure from env.  
- [ ] Product: scanning and export work; rate limit and friendly errors in place.  
- [ ] Build: `.env` has Azure and (if you want signing) key path; use `TAURI_SKIP_SIGNING=1` to build without signing.  
- [ ] Distribute: upload MSI to GitHub Releases (or your site); document download/install for users.  
- [ ] (Optional) Later: switch to an unencrypted signing key and remove `TAURI_SKIP_SIGNING` to enable signed auto-updates.

This keeps the focus on **auth**, **security**, and the **scanning product**, and matches how many developers publish desktop apps: installer first, signed updates when needed.
