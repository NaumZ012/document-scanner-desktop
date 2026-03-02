# Excel template structures

This folder is how the AI (and the app) understand your Excel templates. **I can only read text/JSON, not binary .xlsx files.** So we store dumps and optional schema files here.

## 1. Dump raw content (required)

From the **project root** run:

```bash
npm run excel:dump
```

This finds every `.xlsx` under `example/` and writes one JSON per file into `excel-structures/`:

- **`<filename>.json`** – sheet names + first 50 rows of each sheet, cell-by-cell.  
  So I can see real layout, merged cells (one cell with text, rest empty), and where the data table is.

After you add or change a template, run `npm run excel:dump` again and commit the updated JSON so I see the new structure.

## 2. Optional: describe the data table (schema)

If you want export/import to be exact, add a **schema** file next to the dump. Then both you and I know:

- Which **sheet** to use  
- Which **row** is the header (1-based)  
- Which **row** is the first data row  
- Which **column (A, B, C, …)** maps to which field key  

Create a file like `excel-structures/Даночен биланс.schema.json` (or `DanocenBilans.schema.json`). Format:

```json
{
  "documentType": "Даночен биланс",
  "sheetName": "Даночен биланс 2024",
  "headerRow": 10,
  "dataStartRow": 11,
  "columns": [
    { "letter": "A", "fieldKey": "taxYear" },
    { "letter": "B", "fieldKey": "companyName" },
    { "letter": "C", "fieldKey": "companyTaxId" }
  ]
}
```

- **documentType** – label used in the app (e.g. Даночен биланс, Фактури, ДДВ, Плати).  
- **sheetName** – exact sheet name from the dump’s `sheet_names`.  
- **headerRow** – 1-based row index of the header (the row with column titles).  
- **dataStartRow** – 1-based row where data rows begin (usually `headerRow + 1`).  
- **columns** – order of columns; `letter` is Excel column (A, B, …), `fieldKey` is the app’s field (e.g. from `documentTypeSchemas.ts`).

You can add one schema per template. I’ll use the dumps to find the table and the schema to map columns.

## Summary

| Step | You do | I can do |
|------|--------|----------|
| 1 | Run `npm run excel:dump` after changing templates | Read `excel-structures/*.json` to see layout |
| 2 | (Optional) Add or edit `*.schema.json` with sheet, header row, columns | Use schema to fix export/import and mappings |

That’s how I “see” the structure of all your Excels.
