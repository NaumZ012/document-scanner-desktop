# Document analyzer schemas

## Даночен биланс (Tax balance) — two possible model schemas

The app’s **Преглед** (Review) form and Excel export expect **59 AOP fields** (`aop_1`…`aop_59`) as in **`MacedonianProfitTaxAnalyzer.json`** (FullTaxBalanceAnalyzer).

### 1. TaxBalance02 (summary-style schema)

If the deployed Azure analyzer is **TaxBalance02**, it returns **summary-style** fields, for example:

- `companyName`, `companyTaxId`, `taxYear`
- `financialResultFromPL`, `nonRecognizedExpensesTotal`, `nonRecognizedExpenseRows`
- `taxBaseBeforeReduction`, `taxBaseReductionTotal`, `taxBaseAfterReduction`
- `calculatedProfitTax`, `calculatedTaxReductionTotal`, `calculatedTaxAfterReduction`
- `advanceTaxPaid`, `overpaidCarriedForward`, `amountToPayOrOverpaid`

The backend maps these into the AOP slots used by the app:

- `aop_1`, `aop_2` from financial result and non-recognized total
- `aop_39` = III. Даночна основа (I+II) ← `taxBaseBeforeReduction`
- `aop_40` = IV. Намалување на даночна основа ← `taxBaseReductionTotal`
- `aop_49`…`aop_50`, `aop_51`, `aop_56`…`aop_59` from the other summary fields
- **AOP 3–38** from `nonRecognizedExpenseRows` (when present)

**Individual lines** such as AOP 41–48 (reduction items 38–44) and AOP 52–55 (tax reduction items 45–48) are **not** returned by TaxBalance02, so those rows stay **empty** (—) in the app unless you switch to the full schema.

### 2. FullTaxBalanceAnalyzer (aop_1…aop_59)

**`MacedonianProfitTaxAnalyzer.json`** describes the **full** schema: 4 metadata fields plus **59 AOP fields** (`aop_1`…`aop_59`), one per line of the form.

If you deploy an Azure custom analyzer that uses **this** schema (same field names and structure), the API will return all 59 AOP fields (often with page suffixes like `aop_45 p.2`). The app normalizes those to `aop_1`…`aop_59`, so every row in Преглед and in Excel can be filled from the model.

### Summary

- **Empty AOP 40–48 / 51–55** with TaxBalance02 is expected: that model does not output those individual lines, only summary totals. The app fills the summary lines (e.g. III, IV, V, VI, VII, 49, 50, 51, 56–59) from TaxBalance02.
- For **all 59 lines** to be filled from the model, the Azure analyzer must use the **same** schema as **`MacedonianProfitTaxAnalyzer.json`** (FullTaxBalanceAnalyzer).
