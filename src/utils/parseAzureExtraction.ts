import type { InvoiceData, InvoiceFieldValue } from "@/shared/types";

/**
 * Parses Azure Document Intelligence / Content Understanding result.contents[0].fields
 * into a flat object suitable for UI and database storage.
 *
 * Correctly traverses Azure's type-specific keys: valueString, valueNumber, valueDate,
 * valueCurrency, valueArray, valueObject. Sanitizes generated "description" to remove
 * Markdown code blocks (```text, ```json, ```) when the model ignores schema instructions.
 */

/** Raw Azure field: may have type + valueString / valueNumber / valueDate / valueArray / valueObject / valueCurrency */
export type AzureFieldValue = Record<string, unknown>;

/** Raw Azure fields object: result.contents[0].fields */
export type AzureFieldsInput = Record<string, unknown>;

/** Flat output: canonical keys and string/number values, ready for DB */
export type ParsedExtraction = Record<string, string | number>;

/** Maps Azure/custom-analyzer field names to app canonical keys (e.g. seller_name, invoice_number). */
const AZURE_KEY_TO_CANONICAL: Record<string, string> = {
  documentType: "document_type",
  DocumentType: "document_type",
  invoiceNumber: "invoice_number",
  InvoiceNumber: "invoice_number",
  invoiceDate: "date",
  date: "date",
  Date: "date",
  dueDate: "due_date",
  DueDate: "due_date",
  sellerName: "seller_name",
  SellerName: "seller_name",
  buyerName: "buyer_name",
  BuyerName: "buyer_name",
  companyName: "seller_name",
  CompanyName: "seller_name",
  companyTaxId: "seller_tax_id",
  sellerTaxId: "seller_tax_id",
  buyerTaxId: "buyer_tax_id",
  netAmount: "net_amount",
  NetAmount: "net_amount",
  vat18Amount: "tax_amount",
  vatTax: "tax_amount",
  VatTax: "tax_amount",
  totalAmount: "total_amount",
  TotalAmount: "total_amount",
  currency: "currency",
  Currency: "currency",
  description: "description",
  Description: "description",
  VendorName: "seller_name",
  CustomerName: "buyer_name",
  InvoiceTotal: "total_amount",
  SubTotal: "net_amount",
  TotalTax: "tax_amount",
  taxYear: "date",
  year: "date",
  taxPeriod: "date",
  financialResultFromPL: "net_amount",
  taxBaseAfterReduction: "net_amount",
  calculatedProfitTax: "total_amount",
  calculatedTaxAfterReduction: "total_amount",
  amountToPayOrOverpaid: "total_amount",
  advanceTaxPaid: "tax_amount",
  totalTaxBase: "net_amount",
  totalOutputVat: "tax_amount",
  totalInputVat: "tax_amount",
  vatPayableOrRefund: "total_amount",
  totalGrossSalary: "total_amount",
  totalNetSalary: "net_amount",
  totalPayrollCost: "tax_amount",
};

/**
 * Strip Markdown code blocks from description (Опис).
 * The AI often wraps in ```text ... ``` or ``` ... ```; strip before setting state.
 */
export function sanitizeDescription(raw: string): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  // Strip leading ```text, ```json, ``` (match user regex: /^```[a-z]*\n/g)
  s = s.replace(/^```[a-z]*\n?/gi, "");
  // Strip trailing ```
  s = s.replace(/\n?```\s*$/gi, "");
  // Replace Markdown images/links with their alt text or label only.
  s = s.replace(/!\[([^\]]*)]\([^)]*\)/g, "$1"); // images: keep alt text
  s = s.replace(/\[([^\]]*)]\([^)]*\)/g, "$1"); // links: keep label
  // Remove Markdown headings (#, ##, ###, …) at line start.
  s = s.replace(/^\s*#{1,6}\s*/gm, "");
  // Strip simple HTML tags that sometimes appear in generated summaries.
  s = s.replace(/<\/?[^>\n]+>/g, " ");
  // Collapse multiple spaces and blank lines.
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * Extract a single primitive value from an Azure field object using type-specific keys.
 * Returns string or number; uses optional chaining and safe fallbacks.
 */
function extractAzureFieldValue(obj: unknown): string | number | null {
  if (obj == null) return null;
  // Azure sometimes returns a plain string for a field value
  if (typeof obj === "string") {
    const s = obj.trim();
    return s !== "" ? s : null;
  }
  if (typeof obj !== "object") return null;

  const o = obj as { [key: string]: unknown };

  // String-like
  const valueString = (o as any).valueString ?? (o as any).content ?? (o as any).value;
  if (valueString != null && typeof valueString === "string") {
    const trimmed = valueString.trim();
    if (trimmed !== "") return trimmed;
  }

  // Date
  const valueDate = (o as any).valueDate;
  if (valueDate != null && typeof valueDate === "string") {
    const trimmed = valueDate.trim();
    if (trimmed !== "") return trimmed;
  }

  // Number
  const valueNumber = (o as any).valueNumber ?? (o as any).valueInteger;
  if (typeof valueNumber === "number" && !Number.isNaN(valueNumber)) return valueNumber;
  if (typeof valueNumber === "string") {
    const n = parseFloat(valueNumber);
    if (!Number.isNaN(n)) return n;
  }

  // Currency: valueCurrency.amount
  const valueCurrency = (o as any).valueCurrency as { amount?: number | string } | undefined;
  if (valueCurrency != null && typeof valueCurrency === "object") {
    const amount = valueCurrency.amount;
    if (typeof amount === "number" && !Number.isNaN(amount)) return amount;
    if (typeof amount === "string") {
      const n = parseFloat(amount);
      if (!Number.isNaN(n)) return n;
    }
  }

  // Fallback: content / valueString again (already checked above)
  return null;
}

/**
 * Flatten a valueArray of valueObject items into a single string (e.g. "row0_label: x; row0_amount: 123; row1_...")
 * or return JSON string for complex arrays. For simple arrays of primitives, join with newlines.
 */
function flattenValueArray(arr: unknown[], fieldKey: string): string {
  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (item != null && typeof item === "object" && "valueObject" in item) {
      const vo = (item as { valueObject?: Record<string, AzureFieldValue> }).valueObject;
      if (vo && typeof vo === "object") {
        for (const [k, v] of Object.entries(vo)) {
          const val = extractAzureFieldValue(v as AzureFieldValue);
          if (val !== null) parts.push(`${fieldKey}_${i}_${k}=${val}`);
        }
      }
    } else {
      const val = extractAzureFieldValue(item as AzureFieldValue);
      if (val !== null) parts.push(String(val));
    }
  }
  return parts.length > 0 ? parts.join("; ") : "";
}

function sanitizeDocumentType(raw: string): string {
  if (typeof raw !== "string") return "";
  // Remove any HTML comments like <!-- PageHeader: ... --> that Azure sometimes injects.
  let s = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
  // Collapse repeated whitespace.
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

/**
 * Parse raw Azure result.contents[0].fields into a flat object.
 * - Uses .valueString, .valueNumber, .valueDate, .valueCurrency.amount, .valueArray, .valueObject.
 * - Maps known Azure keys to canonical keys (seller_name, invoice_number, etc.).
 * - Sanitizes the "description" field to remove ``` code blocks.
 * - Safe fallbacks: "" for strings, 0 for numbers when extraction fails.
 */
export function parseAzureExtraction(azureFields: AzureFieldsInput): ParsedExtraction {
  const out: ParsedExtraction = {};

  if (!azureFields || typeof azureFields !== "object") return out;

  for (const [key, raw] of Object.entries(azureFields)) {
    if (raw == null) continue;

    let value: string | number | null = null;
    if (typeof raw === "string" || typeof raw === "number") {
      value = typeof raw === "string" ? (raw.trim() || null) : raw;
    } else if (typeof raw !== "object") {
      continue;
    } else if (Array.isArray((raw as { valueArray?: unknown }).valueArray)) {
      const arr = (raw as { valueArray: unknown[] }).valueArray;
      value = flattenValueArray(arr, key);
      if (value === "") value = null;
    } else {
      value = extractAzureFieldValue(raw as AzureFieldValue);
    }

    if (value === null) continue;

    // Normalize Azure keys that encode AOP line numbers into canonical "aop_N" keys so
    // Даночен биланс form rows (aop_1…aop_59) are always populated, regardless of backend mapping.
    // Examples:
    // - "aop_45 p.2"           -> "aop_45"
    // - "namaluvanjeDanok...AOP52" -> "aop_52"
    let baseKey: string;
    const aopSuffixMatch = key.match(/AOP(\d{1,2})$/i);
    if (aopSuffixMatch) {
      baseKey = `aop_${parseInt(aopSuffixMatch[1]!, 10)}`;
    } else if (key.startsWith("aop_") && key.includes(" ")) {
      baseKey = key.split(/\s+/)[0]!;
    } else {
      baseKey = key;
    }
    const canonicalKey = AZURE_KEY_TO_CANONICAL[key] ?? baseKey;
    const isDescription = canonicalKey === "description" || key === "description";
    const isDocType = canonicalKey === "document_type";

    if (typeof value === "string") {
      if (isDescription) {
        out[canonicalKey] = sanitizeDescription(value);
      } else if (isDocType) {
        out[canonicalKey] = sanitizeDocumentType(value);
      } else {
        out[canonicalKey] = value;
      }
    } else {
      out[canonicalKey] = value;
    }
  }

  return out;
}

/** Convert flat parsed extraction to InvoiceData for the UI (valueString/valueNumber/valueDate already extracted). */
export function parsedExtractionToInvoiceData(parsed: ParsedExtraction): InvoiceData {
  const fields: Record<string, InvoiceFieldValue> = {};
  for (const [k, v] of Object.entries(parsed)) {
    fields[k] = { value: String(v ?? "") };
  }
  return { fields };
}

/** Keys that are arrays in Azure result; backend flattens them — do not overwrite with a single string. */
const SKIP_RAW_ARRAY_KEYS = new Set(["nonRecognizedExpenseRows", "periodRows", "monthlyRows"]);

/**
 * Parse raw Azure result.contents[0].fields into InvoiceFieldValue map (value + confidence).
 * Skips array-type keys (e.g. nonRecognizedExpenseRows) so backend-flattened data is preserved.
 * Uses AZURE_KEY_TO_CANONICAL for key mapping; preserves original key if not in map.
 */
export function parseAzureFieldsWithConfidence(
  azureFields: AzureFieldsInput
): Record<string, InvoiceFieldValue> {
  const out: Record<string, InvoiceFieldValue> = {};
  if (!azureFields || typeof azureFields !== "object") return out;

  for (const [key, raw] of Object.entries(azureFields)) {
    if (raw == null) continue;
    if (SKIP_RAW_ARRAY_KEYS.has(key)) continue;

    let value: string | number | null = null;
    if (typeof raw === "string" || typeof raw === "number") {
      value = typeof raw === "string" ? (raw.trim() || null) : raw;
    } else if (typeof raw === "object" && !Array.isArray((raw as { valueArray?: unknown }).valueArray)) {
      value = extractAzureFieldValue(raw as AzureFieldValue);
    }

    if (value === null) continue;

    // Normalize Azure keys that encode AOP line numbers into canonical "aop_N" so UI schema matches.
    // Handles both:
    // - "aop_45 p.2"
    // - "namaluvanjeDanokFiskalniSistemiAOP52"
    let baseKey: string;
    const aopSuffixMatch = key.match(/AOP(\d{1,2})$/i);
    if (aopSuffixMatch) {
      baseKey = `aop_${parseInt(aopSuffixMatch[1]!, 10)}`;
    } else if (key.startsWith("aop_") && key.includes(" ")) {
      baseKey = key.split(/\s+/)[0]!;
    } else {
      baseKey = key;
    }
    const canonicalKey = AZURE_KEY_TO_CANONICAL[key] ?? baseKey;
    const confidence =
      typeof raw === "object" && raw !== null && "confidence" in raw
        ? (raw as { confidence?: number }).confidence
        : undefined;
    const isDescription = canonicalKey === "description" || key === "description";
    const isDocType = canonicalKey === "document_type";
    const rawStr = String(value);
    const strValue = isDescription
      ? sanitizeDescription(rawStr)
      : isDocType
      ? sanitizeDocumentType(rawStr)
      : rawStr;
    if (strValue.trim() !== "" || typeof value === "number") {
      out[canonicalKey] = { value: strValue, confidence };
    }
  }
  return out;
}
