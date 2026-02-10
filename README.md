# Invoice Scanner Desktop

A desktop app for scanning invoices (PDF/images) with Azure Document Intelligence OCR and exporting extracted data to Excel. Built with **Tauri 2**, **React**, **TypeScript**, and **Vite**.

## Features

- **Home**: Drag & drop or browse for PDF, JPG, PNG, TIFF documents
- **OCR**: Azure Document Intelligence (prebuilt-invoice) for structured invoice data
- **Review**: Side-by-side view with editable extracted fields and confidence highlighting
- **Excel**: Append rows to existing workbooks; column mapping via profiles
- **Settings**: Create/edit Excel profiles (file, sheet, column → field mapping); light/dark theme
- **History**: List scanned documents with search and status filter; re-export to Excel

## Prerequisites

- **Node.js** 18+
- **Rust** (rustup) and **Cargo**
- **Tauri 2** prerequisites for your OS: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Setup

1. **Clone and install**

   ```bash
   cd document-scanner-desktop
   npm install
   ```

2. **Azure OCR**

   Create a [Document Intelligence](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/) resource in Azure, then add a `.env` file at the project root (copy from `.env.example`):

   ```env
   AZURE_OCR_KEY=your_key_here
   AZURE_OCR_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
   ```

   **Note:** `.env` is not bundled with the app. For distribution, document that users can set these env vars or a config file.

## Development

```bash
npm run tauri dev
```

This starts the **Vite** dev server (via `npm run dev`) and then the **Tauri** desktop window. Use **Home** to drop a file or click to browse; after OCR you’ll land on **Review** to edit fields and **Add to Excel** (create a profile in **Settings** first if needed).

- `npm run tauri dev` — full app (Vite + Tauri window)
- `npm run dev` — Vite only (browser at http://localhost:5173), for frontend-only testing

## Build

```bash
npm run tauri build
```

Produces the installer (e.g. Windows `.msi`/`.exe`) under `src-tauri/target/release/bundle/`.

## Project structure

| Area        | Location |
|------------|----------|
| React app  | `src/` (App, pages, components, services, shared) |
| Rust backend | `src-tauri/src/` (ocr, excel, db, commands, types) |
| SQLite DB  | Tauri app data dir (`invoice_scanner.db`) |
| Excel      | User-chosen path; app only reads and appends |

## Document types and fields

Supported document types: **Faktura**, **Plata**, **Smetka**, **Generic**. Field keys (e.g. `invoice_number`, `date`, `seller_name`, `total_amount`) are defined in `src/shared/constants.ts` and mirrored in extraction logic; profiles map Excel columns to these keys.

## License

MIT
