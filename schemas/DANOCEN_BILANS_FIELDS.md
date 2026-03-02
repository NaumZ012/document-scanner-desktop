# Даночен биланс (Tax Balance) – extraction fields

Fields extracted from the **Даночен биланс** PDF to align with the Excel structure (from your example workbook). Use this for the TaxBalance custom analyzer and for mapping to Excel columns.

---

## Part 1: ДОБИВКА НА НЕПРИЗНАЕНИ РАСХОДИ (first table)

| Field key | Macedonian label / location | Excel meaning |
|-----------|-----------------------------|----------------|
| `financialResultFromPL` | I. Финансиски резултат во Биланс на успех | Section I total |
| `nonRecognizedExpensesTotal` | II. Непризнаени расходи за даночни цели (збир од АОП 03 до АОП 29) | Section II total |
| `representationExpenses` | Трошоци за репрезентација | Line item in Section II |
| `otherExpenseAdjustments` | Други усогласувања на расходи | Line item in Section II |

---

## Part 2: Tax base and calculated tax (sections III–VIII)

| Field key | Macedonian label / location | Excel meaning |
|-----------|-----------------------------|----------------|
| `taxBaseBeforeReduction` | III. Даночна основа (I+II) | Tax base before reduction |
| `taxBaseReductionTotal` | IV. Намалување на даночна основа (АОП 32+…+36) | Sum of Section IV items |
| `taxBaseAfterReduction` | V. Даночна основа по намалување (III-IV) | Tax base after reduction |
| `calculatedProfitTax` | VI. Пресметан данок на добивка (V x 10%) | Calculated profit tax |
| `calculatedTaxReductionTotal` | VII. Намалување на пресметаниот данок (АОП40+41+42) | Sum of Section VII items |
| `calculatedTaxAfterReduction` | VIII. Пресметан данок по намалување (VI-VII) | Tax after reduction |

---

## Part 3: Final payment block

| Field key | Macedonian label / location | Excel meaning |
|-----------|-----------------------------|----------------|
| `advanceTaxPaid` | Платени аконтации на данокот на добивка за даночниот период (line 57) | Advance payments for the period |
| `overpaidCarriedForward` | Износ на повеќе платен данок пренесен од претходните даночни (line 58) | Overpayment carried forward |
| `amountToPayOrOverpaid` | Износ за доплата / повеќе платен износ (АОП 44 - 45 - 46) (line 59) | Final amount to pay (positive) or overpaid (negative) |

---

## Header / metadata

| Field key | Macedonian label | Notes |
|-----------|------------------|--------|
| `taxYear` | Година / Даночен период | e.g. 2024 |
| `companyName` | Обврзник / Фирма | Taxpayer name |
| `companyTaxId` | ЕДБ / Даночен број | Tax ID |

---

## Generated

| Field key | Purpose |
|-----------|--------|
| `description` | Short narrative summary of the tax position (method: generate). |

---

## App display mapping (smetka)

In the review screen, these Content Understanding fields are mapped to the app’s canonical keys so the main card shows:

- **Продавач** ← `companyName` / `sellerName`
- **Даночен број** ← `companyTaxId` / `sellerTaxId`
- **Нето износ** ← one of: `financialResultFromPL`, `taxBaseAfterReduction`, `finalTaxBase`, `taxBaseBeforeReduction`
- **бруто износ** ← one of: `calculatedProfitTax`, `calculatedTaxAfterReduction`, `taxToPayOrRefund`, `amountToPayOrOverpaid`
- **ДДВ** ← `advanceTaxPaid`
- **Опис** ← `description` (generated)
- **Дата** ← `taxYear`

All other extracted fields (e.g. `overpaidCarriedForward`, `taxBaseReductionTotal`) are kept in the result under their camelCase keys for export or future Excel column mapping.
