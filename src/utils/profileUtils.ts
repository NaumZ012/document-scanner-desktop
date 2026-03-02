import type { DocumentType } from "@/shared/types";

/** Profile tuple: [id, name, excel_path, sheet_name, mappingJson] */
export type ProfileTuple = [number, string, string, string, string];

/**
 * Infer which document type a profile is intended for, based on the field keys
 * referenced in its column mapping JSON.
 *
 * This avoids DB migrations by deriving doc type from mapping content.
 */
export function inferProfileDocumentType(mappingJson: string): DocumentType {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(mappingJson) as Record<string, unknown>;
  } catch {
    return "faktura";
  }

  const keys = new Set(
    Object.values(parsed)
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .filter((v) => v !== "_headerRow" && v !== "_schemaHash")
  );

  // Tax balance (Даночен биланс)
  if (
    keys.has("taxYear") ||
    keys.has("financialResultFromPL") ||
    keys.has("taxBaseAfterReduction") ||
    keys.has("calculatedProfitTax") ||
    keys.has("amountToPayOrOverpaid")
  ) {
    return "smetka";
  }

  // VAT return (ДДВ)
  if (
    keys.has("taxPeriod") ||
    keys.has("totalOutputVat") ||
    keys.has("totalInputVat") ||
    keys.has("vatPayableOrRefund") ||
    keys.has("totalTaxBase")
  ) {
    return "generic";
  }

  // Payroll (Плати)
  if (
    keys.has("totalGrossSalary") ||
    keys.has("totalNetSalary") ||
    keys.has("totalPayrollCost") ||
    keys.has("monthlyRows")
  ) {
    return "plata";
  }

  return "faktura";
}

export function filterProfilesForDocumentType(
  profiles: ProfileTuple[],
  documentType: DocumentType
): ProfileTuple[] {
  return profiles.filter((p) => inferProfileDocumentType(p[4]) === documentType);
}

