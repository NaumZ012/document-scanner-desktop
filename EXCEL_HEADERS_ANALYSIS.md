# Excel Files Header Analysis

This document provides a detailed analysis of the headers and data structure for each Excel file in the example folder. This is critical for understanding what fields need to be extracted from scanned documents.

---

## 1. INVOICES (Фактури)

**File:** `C:\BuildApps\document-scanner-desktop\example\Примери за автоматизирање на процеси\Invoices\Exaple-Invoices.xlsx`

**Excel Structure:**
- **Sheet Name:** Sheet1
- **Total Rows:** 1,048,526
- **Total Columns:** 36
- **Header Row:** Row 8

**Template Section (Rows 1-7):**
Rows 1-7 contain template metadata:
- Row 1: Company contact info (Тел. +389 2 6140 901, www.a-ba.mk, Address)
- Row 2: Клиент:, Подготвил:, Проверил:
- Row 3: Предмет:, Дата:, Дата:
- Row 4: Период:
- Rows 5-7: Empty

### Headers (Row 8) - 9 Columns:

| Column | Header (Macedonian) | Translation | Data Type |
|--------|---------------------|-------------|-----------|
| **A** | Тип на документ | Document Type | string |
| **B** | Број на документ | Document Number | string |
| **C** | Дата на документ | Document Date | date/datetime |
| **D** | Продавач | Seller/Vendor | string |
| **E** | Купувач | Buyer/Customer | string |
| **F** | Опис во документ | Description in Document | string (multi-line) |
| **G** | Нето износ | Net Amount | number |
| **H** | ДДВ 18% | VAT 18% | number |
| **I** | Бруто износ | Gross Amount | number |

### Sample Data Row (Row 9):
```
A (Тип на документ): "Фактура"
B (Број на документ): "1-81/99066"
C (Дата на документ): 2025-06-19
D (Продавач): "Естра Скопско"
E (Купувач): "Плажа потпеш ДОО"
F (Опис во документ): "Скопско Пиво 0.33 гајба 2016\nхајникен 0.25 х 24 НРГ АБП МК\nСол пиво 0.33 НРГ Х 24\nКока-кола ултра 0.25"
G (Нето износ): 27826.17
H (ДДВ 18%): 5008.71
I (Бруто износ): 32834.88
```

### Sample Data Row 2 (Row 10):
```
A: "Фактура"
B: "2585013358"
C: 2025-01-22
D: "ЕУРОТЕЛЕСАЈТС ДООЕЛ Скопје"
E: "А1 Македонија ДООЕЛ Скопје"
F: "Basic rent - 01.01.2025-31.01.2025-InterCompany Rent Debit Закуп за период: 01.01.2025 - 31.01.2025..."
G: 55620.39
H: 10011.39
I: 65631.78
```

### Key Observations:
- **Header row is NOT row 1** - it's row 8
- Column F (Description) can contain multi-line text with line breaks
- Dates are stored as datetime objects
- Numeric values are decimals (float)
- Document types include "Фактура" (Invoice)

---

## 2. ДАНОЧЕН БИЛАНС (Tax Balance)

**File:** `C:\BuildApps\document-scanner-desktop\example\Примери за автоматизирање на процеси\Даночен биланс\РД-Данок на добивка-2024-Example.xlsx`

**Excel Structure:**
- **Sheet Name:** Даночен биланс 2024
- **Total Rows:** 133
- **Total Columns:** 13
- **Header Row:** Row 4

**Template Section (Rows 1-3):**
Rows 1-3 appear to contain template/metadata information.

### Headers (Row 4) - 4 Visible Columns:

| Column | Header (Macedonian) | Translation | Data Type |
|--------|---------------------|-------------|-----------|
| **A** | Предмет: | Subject | string |
| **B** | Даночен биланс | Tax Balance | string |
| **D** | Дата: | Date | date/empty |
| **G** | Дата: | Date | date/empty |

### Sample Data Row (Row 5):
```
A (Предмет:): "Период:"
B (Даночен биланс): "01.01. -31.12.2024"
D (Дата:): None (empty)
G (Дата:): None (empty)
```

### Key Observations:
- **Header row is row 4**, not row 1
- This appears to be a more complex template with metadata rows
- Headers detected: Предмет:, Даночен биланс, and two Дата: columns
- The structure suggests this is a report template rather than a simple data table
- Row 5 contains period information (01.01. -31.12.2024)

**Note:** This Excel file has a different structure than the Invoices file. It appears to be more of a form/report template with metadata in the first few rows, then actual tabular data below. The true data structure likely starts further down in the spreadsheet.

---

## 3. ПЛАТИ (Salaries / Employee Costs)

**File:** `C:\BuildApps\document-scanner-desktop\example\Примери за автоматизирање на процеси\Плати\РД-Трошоци за вработени-Example.xlsx`

**Excel Structure:**
- **Sheet Name:** МПИН
- **Total Rows:** 58
- **Total Columns:** 16,369 (very wide!)
- **Header Row:** Row 11

**Template Section (Rows 1-10):**
Rows 1-10 contain template/report header information.

### Headers (Row 11) - 13 Visible Columns:

| Column | Header (Macedonian) | Translation | Data Type |
|--------|---------------------|-------------|-----------|
| **C** | % | Percentage | empty/number |
| **D** | Јануари | January | integer |
| **E** | Фебруари | February | integer |
| **F** | Март | March | integer |
| **G** | Април | April | integer/empty |
| **H** | Мај | May | integer/empty |
| **I** | Јуни | June | integer/empty |
| **J** | Јули | July | integer/empty |
| **K** | Август | August | integer/empty |
| **L** | Септември | September | integer/empty |
| **M** | Октомври | October | integer/empty |
| **N** | Ноември | November | integer/empty |
| **O** | Декември | December | integer/empty |

### Sample Data Row (Row 12):
```
C (%): None (empty)
D (Јануари): 408393
E (Фебруари): 408542
F (Март): 449067
G (Април): None (empty)
H (Мај): None (empty)
I (Јуни): None (empty)
J (Јули): None (empty)
K (Август): None (empty)
L (Септември): None (empty)
M (Октомври): None (empty)
N (Ноември): None (empty)
O (Декември): None (empty)
```

### Key Observations:
- **Header row is row 11**, not row 1
- **Extremely wide spreadsheet** (16,369 columns) - likely contains extensive formatting or merged cells
- Headers show monthly data (all 12 months of the year)
- Column C appears to be for percentages but is empty in sample data
- First three months (Jan, Feb, March) have data in the sample row
- Values are large integers (employee costs/salaries)
- Remaining months are empty in this sample (likely incomplete data or partial year)

**Note:** The extremely large column count (16,369) suggests this file may have extensive formatting, merged cells, or hidden columns. The actual usable data appears to be in columns C through O (13 columns).

---

## Summary and Recommendations

### Common Patterns Across All Files:

1. **Headers are NOT in Row 1**
   - Invoices: Row 8
   - Tax Balance: Row 4
   - Salaries: Row 11
   - All files have template/metadata sections above the actual data

2. **Template Sections**
   - All files have metadata/template information in the first several rows
   - This typically includes: Client name, dates, prepared by, checked by, period info

3. **Data Types**
   - Dates: datetime objects (format: YYYY-MM-DD)
   - Numbers: float for amounts with decimals, integer for whole numbers
   - Strings: can be multi-line (contain \\n)

### Critical Considerations for OCR Extraction:

1. **Header Detection Logic Needed**
   - Cannot assume row 1 is headers
   - Need to detect which row contains actual column headers
   - Look for rows with multiple non-empty string values

2. **Field Mapping Requirements**

   **For Invoices:**
   - Document Type → Column A
   - Document Number → Column B
   - Date → Column C (datetime)
   - Seller → Column D
   - Buyer → Column E
   - Description → Column F (multi-line support needed)
   - Net Amount → Column G (decimal)
   - VAT 18% → Column H (decimal)
   - Gross Amount → Column I (decimal)

   **For Tax Balance:**
   - Period information in early rows
   - Need to identify actual data table structure (may vary)

   **For Salaries:**
   - Monthly columns (January through December)
   - Percentage column
   - Need to handle wide spreadsheets with many columns

3. **Data Validation**
   - Dates should be valid datetime objects
   - Numeric fields should be properly formatted (decimals for amounts)
   - Multi-line text should preserve line breaks

4. **Excel Template Awareness**
   - When inserting extracted data into Excel, respect the template structure
   - Don't overwrite metadata rows
   - Insert data starting at the correct row (after headers)

---

## Next Steps

1. **Define OCR Field Mappings**
   - Create mapping between OCR extracted fields and Excel columns
   - Example: `ocr_field_invoice_number` → Excel Column B

2. **Implement Header Detection**
   - Create algorithm to find the header row dynamically
   - Don't hardcode row numbers

3. **Handle Multi-line Text**
   - Ensure OCR extraction preserves line breaks for description fields
   - Test with multi-line descriptions

4. **Create Insertion Logic**
   - Write data to correct row (first empty row after headers)
   - Maintain proper data types (dates as datetime, numbers as float/int)

5. **Validation Rules**
   - Validate extracted data before insertion
   - Check required fields are present
   - Verify data types match Excel expectations
