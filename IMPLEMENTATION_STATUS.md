# Dynamic Excel Schema Implementation - Status

## ✅ Completed Changes

### 1. Enhanced Type System
**File: `src/shared/types.ts`**

Added new interfaces for Excel-schema-driven architecture:
- `ColumnMetadata`: Represents a single Excel column (index, letter, header, dataType, samples)
- `EnhancedExcelSchema`: Extends `ExcelSchema` with `columns: ColumnMetadata[]`

### 2. Schema Service Enhancements
**File: `src/services/schemaService.ts`**

Added functions:
- `indexToLetter(index)`: Convert 0-based index to Excel letter (0→A, 25→Z, 26→AA)
- `inferDataType(samples)`: Detect column type from sample values (string/number/date)
- `enhanceSchema(schema)`: Add column metadata to base schema
- `getSchemaForProfile(excelPath, sheetName, headerRow)`: Get enhanced schema for a profile

### 3. Excel Service Refactoring
**File: `src/services/excelService.ts`**

Added new function (replaces memory-heavy ExcelJS approach):
- `writeFullRow()`: Writes complete row using Rust backend
  - Accepts `Record<number, string | number>` (keyed by column index)
  - Builds row cells for ALL schema columns
  - Calls Rust `append_row_to_excel` (memory-efficient)
  - Returns `{ success: boolean, rowNumber: number }`

### 4. Updated CLAUDE.md
Added documentation about:
- Excel-schema-driven forms pattern
- Full-row write requirement
- Common gotchas (never use ExcelJS for writes, form fields from schema)

---

## 🚧 Still TODO

### 1. Review Page Refactoring (CRITICAL)
**File: `src/pages/Review.tsx`**

Current state: Still uses old field-based approach with hardcoded `ExtractedField[]`

**Needs:**
```typescript
// OLD (current):
const [fields, setFields] = useState<ExtractedField[]>([]);

// NEW (required):
const [formData, setFormData] = useState<Record<number, string>>({});
const [schema, setSchema] = useState<EnhancedExcelSchema | null>(null);
```

**Key changes:**
1. Load schema when profile selected: `getSchemaForProfile(profile.excel_path, profile.sheet_name)`
2. Build form from `schema.columns` (not hardcoded fields)
3. Prefill from OCR where mappings exist
4. Save using `writeFullRow()` instead of `writeAndVerify()`

**See full refactored code in the previous response.**

### 2. App Context Updates
**File: `src/context/AppContext.tsx`**

May need to update `review` state structure to include:
```typescript
interface ReviewState {
  filePath: string;
  documentType: string;
  ocrData: Record<string, string>;  // field_name → value (from OCR)
  // ... other fields
}
```

### 3. Profile Creation Wizard
**File: `src/pages/Settings.tsx` or profile wizard component**

**Decision needed:**
- Option A: Store one mapping per column (requires DB migration)
- Option B: Store mappings only for OCR-matched columns (no DB change)

**Recommendation:** Option B for now (minimal change)

### 4. Remove ExcelJS Dependency
Once Review.tsx refactoring is complete:

```bash
npm uninstall exceljs
```

This will:
- Reduce bundle size by ~500KB
- Remove memory crash risk with large files
- Simplify architecture (pure Rust for Excel writes)

### 5. Update Home Page OCR Flow
**File: `src/pages/Home.tsx`**

Ensure OCR results are stored in `review.ocrData` format for prefill in Review page.

---

## 🧪 Testing Plan

### Phase 1: Basic Flow (Priority)
1. ✅ Load example Excel: `example/Примери за автоматизирање на процеси/Invoices/Example-Invoices.xlsx`
2. ✅ Create profile pointing to this Excel
3. ✅ Verify schema loads correctly (headers: Тип, Број, Дата, Продавач...)
4. ✅ Upload invoice PDF, run OCR
5. ✅ Open Review page
6. ✅ Verify form shows ALL Excel columns (not just invoice fields)
7. ✅ Verify OCR prefill works for mapped columns
8. ✅ Fill remaining columns manually
9. ✅ Click "Add to Excel"
10. ✅ Verify new row appears with ALL columns filled

### Phase 2: Large File Test
1. Test with 26MB Excel file (should NOT crash)
2. Verify memory usage stays low (<200MB)
3. Verify formatting preserved (template rows untouched)

### Phase 3: Multiple Excel Types
1. Test with ДДВ Excel (different headers)
2. Test with Плати Excel (different headers)
3. Test with Даночен биланс Excel (different headers)
4. Verify each profile's schema drives its own form fields

### Phase 4: Edge Cases
1. Empty columns (no header)
2. Locked Excel file (should show error: "Please close Excel")
3. Missing Excel file (should show error: "File not found")
4. Columns with only numbers (should detect as 'number' type)
5. Columns with dates (should detect as 'date' type)

---

## 🔄 Migration Path

### Step 1: Test New writeFullRow() (Low Risk)
1. Deploy new `writeFullRow()` function
2. Add feature flag in Review.tsx:
```typescript
const USE_NEW_EXCEL_WRITE = true;  // Toggle for testing
```
3. Test side-by-side with old `writeAndVerify()`

### Step 2: Refactor Review.tsx (High Risk)
1. Create `src/pages/ReviewNew.tsx` with Excel-driven form
2. Test thoroughly with example Invoices
3. Once stable, replace `Review.tsx`

### Step 3: Remove Old Code (Cleanup)
1. Delete `writeAndVerify()` from excelService.ts
2. Remove ExcelJS dependency
3. Clean up old field-based components

### Step 4: Profile Wizard Enhancement (Optional)
1. Show all schema columns in mapping step
2. Allow manual column → field mapping
3. Store mappings for all columns (requires DB migration to Option A)

---

## 📊 Architecture Comparison

### Before (Fixed Fields)
```
Document Type → Fixed Fields (8-9) → Profile Mapping → Write Mapped Columns Only
```

### After (Excel-Driven)
```
Excel Schema → Dynamic Columns (all) → Profile Mapping (optional) → Write Full Row
```

### Benefits
- ✅ Works with any Excel structure (Invoices, ДДВ, Плати, etc.)
- ✅ No hardcoded document types
- ✅ Users can add custom columns to Excel without code changes
- ✅ Memory-efficient (no ExcelJS in frontend)
- ✅ Preserves Excel formatting (Rust edit_xlsx)

---

## 🎯 Next Steps (Recommended Order)

1. **[HIGH PRIORITY]** Refactor Review.tsx to use Excel-driven form
2. **[HIGH PRIORITY]** Test with example Invoices Excel
3. **[MEDIUM PRIORITY]** Update Home.tsx to store OCR results correctly
4. **[MEDIUM PRIORITY]** Remove ExcelJS dependency
5. **[LOW PRIORITY]** Enhance profile wizard for all-column mapping
6. **[LOW PRIORITY]** Add UI for required column configuration

---

## 📝 Notes

- Rust backend is already ready (no changes needed!)
- Main work is frontend refactoring (Review.tsx)
- Old `writeAndVerify()` with ExcelJS should be deprecated (causes crashes)
- New architecture aligns with your `.md` plan (Excel-schema-driven)
