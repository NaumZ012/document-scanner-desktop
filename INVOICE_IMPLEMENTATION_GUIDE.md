# Invoice Scanner - Implementation Guide

## 📊 Your Invoice Excel Structure (CONFIRMED)

**File:** `example/Примери за автоматизирање на процеси/Invoices/Exaple-Invoices.xlsx`

### Excel Layout
```
Rows 1-7:  ┌──────────────────────────────────────────┐
TEMPLATE   │ Company: Плажа потпеш ДОО                │
(DON'T     │ Тел: +389 2 6140 901                     │
TOUCH)     │ Клиент: [name]    Подготвил: [name]      │
           │ Предмет: [subject]  Дата: [date]         │
           │ Период: [period]                          │
           │ [empty rows]                              │
           └──────────────────────────────────────────┘

Row 8:     ┌──────────┬──────────┬──────────┬──────────┬─────────┬──────┬──────┬──────┬────────┐
HEADERS    │ Тип на   │ Број на  │ Дата на  │ Продавач │ Купувач │ Опис │ Нето │ ДДВ  │ Бруто  │
           │ документ │ документ │ документ │          │         │      │износ│ 18%  │ износ  │
           ├──────────┼──────────┼──────────┼──────────┼─────────┼──────┼──────┼──────┼────────┤
Row 9:     │ Фактура  │1-81/99066│19.06.2025│Естра...  │Плажа... │Скоп..│27826 │5008  │32834   │
DATA       │          │          │          │          │         │      │  .17 │  .71 │  .88   │
ROWS       ├──────────┼──────────┼──────────┼──────────┼─────────┼──────┼──────┼──────┼────────┤
           │ Фактура  │2585013358│22.01.2025│ЕУРОТЕЛ...│А1 Мак...│Basic │55620 │10011 │65631   │
Row 10:    │          │          │          │          │         │rent..│  .39 │  .39 │  .78   │
           ├──────────┼──────────┼──────────┼──────────┼─────────┼──────┼──────┼──────┼────────┤
Row 11:    │ Фактура  │12504911  │07.10.2025│ДСВ Роад..│Friform..│Paten │151565│  0   │151565  │
           │          │          │          │          │         │trans │      │      │        │
           └──────────┴──────────┴──────────┴──────────┴─────────┴──────┴──────┴──────┴────────┘

Row 12: ← NEXT INVOICE GOES HERE (automatic detection by app)
```

### Column Definitions

| Col | Header | Type | Example | OCR Field Mapping |
|-----|--------|------|---------|-------------------|
| A | Тип на документ | string | "Фактура" | `document_type` |
| B | Број на документ | string | "2585013358" | `invoice_number` |
| C | Дата на документ | date | "2025-01-22" | `date` |
| D | Продавач | string | "ЕУРОТЕЛЕСАЈТС" | `seller_name` |
| E | Купувач | string | "А1 Македонија" | `buyer_name` |
| F | Опис во документ | string (multi-line) | "Basic rent\nIC lease..." | `description` |
| G | Нето износ | number (decimal) | 55620.39 | `net_amount` |
| H | ДДВ 18% | number (decimal) | 10011.39 | `tax_amount` |
| I | Бруто износ | number (decimal) | 65631.78 | `total_amount` |

---

## 🔄 Complete Workflow

### **Step 1: User Creates Profile**

**Settings Page → Create Profile:**
```
┌────────────────────────────────────────┐
│ Create Excel Profile                   │
├────────────────────────────────────────┤
│ Profile Name:                          │
│ ┌────────────────────────────────────┐ │
│ │ Invoice 2025                       │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Excel File:                            │
│ ┌────────────────────────────────────┐ │
│ │ C:\...\Exaple-Invoices.xlsx  [📁] │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Sheet Name:                            │
│ ┌────────────────────────────────────┐ │
│ │ Sheet1                        [▼] │ │
│ └────────────────────────────────────┘ │
│                                        │
│ Header Row:                            │
│ ┌────────────────────────────────────┐ │
│ │ 8                             [▼] │ │
│ └────────────────────────────────────┘ │
│ ℹ️ Detected: Row 8 has headers         │
│                                        │
│ [Cancel]                     [Save ✓] │
└────────────────────────────────────────┘
```

**Backend Call:**
```javascript
await analyzeExcelSchema(
  "C:\\...\\Exaple-Invoices.xlsx",
  "Sheet1",
  8  // ← header_row
);
```

**Auto-Mapping (happens automatically):**
```javascript
// App matches Excel headers to OCR fields using HEADER_KEYWORDS
{
  "A": "document_type",    // "Тип на документ" → keyword match
  "B": "invoice_number",   // "Број на документ" → keyword match
  "C": "date",             // "Дата на документ" → keyword match
  "D": "seller_name",      // "Продавач" → keyword match
  "E": "buyer_name",       // "Купувач" → keyword match
  "F": "description",      // "Опис во документ" → keyword match
  "G": "net_amount",       // "Нето износ" → keyword match
  "H": "tax_amount",       // "ДДВ 18%" → keyword match
  "I": "total_amount"      // "Бруто износ" → keyword match
}
```

Profile saved to SQLite:
```sql
INSERT INTO profiles (name, excel_path, sheet_name, column_mapping) VALUES (
  'Invoice 2025',
  'C:\...\Exaple-Invoices.xlsx',
  'Sheet1',
  '{"A":"document_type","B":"invoice_number",...,"_headerRow":8}'
);
```

---

### **Step 2: User Uploads Invoice PDF**

**Home Page:**
```
┌────────────────────────────────────────┐
│ 📄 Drop invoice PDF here or click     │
│                                        │
│   [Click to browse]                    │
│                                        │
│ Supported: PDF, JPG, PNG, TIFF         │
└────────────────────────────────────────┘
```

User drops: `Invoice-Plaza Potpes DOO.pdf`

**Backend OCR Call:**
```javascript
const ocrResult = await runOcrInvoice("Invoice-Plaza Potpes DOO.pdf");

// Azure Document Intelligence returns:
{
  fields: {
    document_type: { value: "Фактура", confidence: 0.99 },
    invoice_number: { value: "2585013358", confidence: 0.95 },
    date: { value: "2025-01-22", confidence: 0.98 },
    seller_name: { value: "ЕУРОТЕЛЕСАЈТС ДООЕЛ Скопје", confidence: 0.92 },
    buyer_name: { value: "А1 Македонија ДООЕЛ Скопје", confidence: 0.94 },
    description: { value: "Basic rent - 01.01.2025-31.01.2025...", confidence: 0.88 },
    net_amount: { value: "55620.39", confidence: 0.96 },
    tax_amount: { value: "10011.39", confidence: 0.95 },
    total_amount: { value: "65631.78", confidence: 0.97 }
  }
}
```

App navigates to **Review** page with OCR data.

---

### **Step 3: Review Page (Excel-Driven Form)**

**Backend loads schema:**
```javascript
// When user selects profile "Invoice 2025"
const profile = await getProfile(profileId);
const schema = await getSchemaForProfile(
  profile.excel_path,    // "Exaple-Invoices.xlsx"
  profile.sheet_name,    // "Sheet1"
  8                      // header_row from mapping
);

// schema.columns:
[
  { index: 0, letter: "A", header: "Тип на документ", dataType: "string" },
  { index: 1, letter: "B", header: "Број на документ", dataType: "string" },
  { index: 2, letter: "C", header: "Дата на документ", dataType: "date" },
  { index: 3, letter: "D", header: "Продавач", dataType: "string" },
  { index: 4, letter: "E", header: "Купувач", dataType: "string" },
  { index: 5, letter: "F", header: "Опис во документ", dataType: "string" },
  { index: 6, letter: "G", header: "Нето износ", dataType: "number" },
  { index: 7, letter: "H", header: "ДДВ 18%", dataType: "number" },
  { index: 8, letter: "I", header: "Бруто износ", dataType: "number" }
]
```

**Prefill form from OCR:**
```javascript
// For each column, check if there's a mapping to OCR field
const formData = {};

schema.columns.forEach(col => {
  const ocrField = profile.column_mapping[col.letter];  // e.g., mapping["A"] = "document_type"
  if (ocrField && ocrResult.fields[ocrField]) {
    formData[col.index] = ocrResult.fields[ocrField].value;
  }
});

// Result:
{
  0: "Фактура",                      // Column A ← document_type
  1: "2585013358",                   // Column B ← invoice_number
  2: "2025-01-22",                   // Column C ← date
  3: "ЕУРОТЕЛЕСАЈТС ДООЕЛ Скопје",  // Column D ← seller_name
  4: "А1 Македонија ДООЕЛ Скопје",  // Column E ← buyer_name
  5: "Basic rent - 01.01.2025...",  // Column F ← description
  6: "55620.39",                     // Column G ← net_amount
  7: "10011.39",                     // Column H ← tax_amount
  8: "65631.78"                      // Column I ← total_amount
}
```

**UI renders form (dynamically generated from schema.columns):**
```
┌────────────────────────────────────────────────────┐
│ Review Extracted Data                              │
├────────────────────────────────────────────────────┤
│ Profile: Invoice 2025                              │
│                                                    │
│ [A] Тип на документ                                │
│ ┌────────────────────────────────────────────────┐ │
│ │ Фактура                                   ✓0.99│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [B] Број на документ                               │
│ ┌────────────────────────────────────────────────┐ │
│ │ 2585013358                                ✓0.95│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [C] Дата на документ (date)                       │
│ ┌────────────────────────────────────────────────┐ │
│ │ 2025-01-22                                ✓0.98│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [D] Продавач                                       │
│ ┌────────────────────────────────────────────────┐ │
│ │ ЕУРОТЕЛЕСАЈТС ДООЕЛ Скопје                ✓0.92│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [E] Купувач                                        │
│ ┌────────────────────────────────────────────────┐ │
│ │ А1 Македонија ДООЕЛ Скопје                ✓0.94│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [F] Опис во документ (multi-line)                 │
│ ┌────────────────────────────────────────────────┐ │
│ │ Basic rent - 01.01.2025-31.01.2025            │ │
│ │ InterCompany Rent Debit                       │ │
│ │ Закуп за период: 01.01.2025 - 31.01.2025     │ │
│ │ IC lease out add.upgrade                  ⚠0.88│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [G] Нето износ (number)                           │
│ ┌────────────────────────────────────────────────┐ │
│ │ 55620.39                                  ✓0.96│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [H] ДДВ 18% (number)                              │
│ ┌────────────────────────────────────────────────┐ │
│ │ 10011.39                                  ✓0.95│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [I] Бруто износ (number)                          │
│ ┌────────────────────────────────────────────────┐ │
│ │ 65631.78                                  ✓0.97│ │
│ └────────────────────────────────────────────────┘ │
│                                                    │
│ [Cancel]                        [Add to Excel ✓] │
└────────────────────────────────────────────────────┘
```

User can **edit** any field before saving.

---

### **Step 4: User Clicks "Add to Excel"**

**Frontend builds row data:**
```javascript
const row = schema.columns.map(col => ({
  column: col.letter,
  value: String(formData[col.index] || "")
}));

// row:
[
  { column: "A", value: "Фактура" },
  { column: "B", value: "2585013358" },
  { column: "C", value: "2025-01-22" },
  { column: "D", value: "ЕУРОТЕЛЕСАЈТС ДООЕЛ Скопје" },
  { column: "E", value: "А1 Македонија ДООЕЛ Скопје" },
  { column: "F", value: "Basic rent - 01.01.2025-31.01.2025..." },
  { column: "G", value: "55620.39" },
  { column: "H", value: "10011.39" },
  { column: "I", value: "65631.78" }
]
```

**Backend (Rust) writes to Excel:**
```rust
// src-tauri/src/commands.rs:351
pub async fn append_row_to_excel(payload: AppendRowPayload) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        excel::append_row_to_excel(&path, &sheet, row)
    }).await
}

// src-tauri/src/excel.rs:217
pub fn append_row_to_excel(
    path: &str,              // "Exaple-Invoices.xlsx"
    sheet_name: &str,        // "Sheet1"
    column_values: Vec<(String, String)>  // row data
) -> Result<(), String> {
    // Load Excel with edit_xlsx (preserves formatting)
    let mut workbook = edit_xlsx::Workbook::from_path(path)?;
    let worksheet = workbook.get_worksheet_mut_by_name(sheet_name)?;

    // Find next row: max_row() returns 11 (last data row)
    let new_row = worksheet.max_row() + 1;  // = 12

    // Write each column
    for (col_letter, value) in column_values {
        let cell_ref = format!("{}{}", col_letter, new_row);  // "A12", "B12", etc.
        worksheet.write_string(&cell_ref, value)?;
    }

    // Save (preserves rows 1-7 template)
    workbook.save_as(path)?;

    // Strip drawings to prevent Excel warnings
    strip_drawings_from_xlsx(path)?;

    Ok(())
}
```

**Excel After Save:**
```
Row 8:  [HEADERS - unchanged]
Row 9:  [Existing invoice - unchanged]
Row 10: [Existing invoice - unchanged]
Row 11: [Existing invoice - unchanged]
Row 12: │Фактура│2585013358│22.01.2025│ЕУРОТЕЛЕСАЈТС...│А1 Македонија...│Basic rent...│55620.39│10011.39│65631.78│ ← NEW!
```

**History Record Created:**
```sql
INSERT INTO history (
  created_at,
  document_type,
  file_path_or_name,
  extracted_data,
  status,
  excel_profile_id
) VALUES (
  '2025-02-07T10:30:00Z',
  'faktura',
  'Invoice-Plaza Potpes DOO.pdf',
  '{"Тип на документ":"Фактура","Број на документ":"2585013358",...}',
  'added_to_excel',
  1
);
```

---

## ✅ What's Ready

### Backend (100% Complete)
- ✅ `analyze_excel_schema(path, sheet, header_row)` - Analyzes Excel structure
- ✅ `append_row_to_excel(path, sheet, row)` - Writes full row
- ✅ Preserves template formatting (rows 1-7 untouched)
- ✅ Finds actual last row (not 1,048,576)
- ✅ Uses `edit_xlsx` (memory-efficient, handles 26MB+)
- ✅ Auto-mapping via `HEADER_KEYWORDS`
- ✅ SQLite storage for profiles, history, learned mappings

### Frontend Services (95% Complete)
- ✅ `getSchemaForProfile()` - NEW: Enhanced schema with column metadata
- ✅ `writeFullRow()` - NEW: Writes all columns via Rust backend
- ✅ `enhanceSchema()` - NEW: Adds column index, letter, dataType
- ⏳ `Review.tsx` - Needs refactoring to use schema-driven form

---

## 🔧 Next: Refactor Review.tsx

Replace the current fixed-field approach with the Excel-driven form. I've already provided the complete code in previous responses.

**Key changes:**
1. Load schema when profile selected
2. Generate form fields from `schema.columns`
3. Prefill using mappings + OCR data
4. Save using `writeFullRow()`

Once this is done, the app will work with **any Excel structure** - not just invoices!
