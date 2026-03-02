import type { AzureFieldsInput } from "@/utils/parseAzureExtraction";

/**
 * Lightweight Azure Content Understanding client for the frontend/Node side.
 *
 * IMPORTANT:
 * - Uses the new Content Understanding endpoint (NOT Form Recognizer / Document Intelligence).
 * - Endpoint shape:
 *   POST {endpoint}/contentunderstanding/analyzers/{analyzerId}:analyze?api-version=2025-05-01-preview
 *   Body: { "base64Source": "<base64 string>" }
 *   202 Accepted with Operation-Location header pointing to analyzeResults URL.
 *   Poll GET {Operation-Location} until { status: "succeeded" }.
 *
 * Env vars expected:
 * - AZURE_OCR_KEY
 * - AZURE_OCR_ENDPOINT
 * - AZURE_CU_ANALYZER_FAKTURA
 * - AZURE_CU_ANALYZER_SMETKA
 * - AZURE_CU_ANALYZER_GENERIC
 * - AZURE_CU_ANALYZER_PLATA
 */

type AnyRecord = Record<string, any>;

interface AnalyzeResultEnvelope {
  status?: string;
  result?: {
    contents?: Array<{
      fields?: AzureFieldsInput;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  error?: {
    message?: string;
    code?: string;
    innererror?: { message?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function getEnvVar(name: string): string {
  // Vite / Tauri (frontend) – import.meta.env.*
  const metaEnv = (typeof import.meta !== "undefined" && (import.meta as any).env) || undefined;
  if (metaEnv && typeof metaEnv[name] === "string" && metaEnv[name]) {
    return metaEnv[name] as string;
  }

  // Node / tests – process.env.*
  const nodeEnv =
    typeof process !== "undefined" && typeof (process as any).env !== "undefined"
      ? (process as any).env
      : undefined;
  if (nodeEnv && typeof nodeEnv[name] === "string" && nodeEnv[name]) {
    return nodeEnv[name] as string;
  }

  throw new Error(`Environment variable ${name} is not set.`);
}

function getAzureConfig() {
  const key = getEnvVar("AZURE_OCR_KEY");
  const rawEndpoint = getEnvVar("AZURE_OCR_ENDPOINT");
  const endpoint = rawEndpoint.replace(/\/+$/, "");
  return { key, endpoint };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recursively extract primitive values from Azure field objects:
 * - valueString → string
 * - valueNumber → number
 * - valueDate   → string
 * - valueArray  → array (recursively extracted)
 * - valueObject → object (recursively extracted)
 */
export function extractFields(rawFields: AnyRecord): AnyRecord {
  if (!rawFields || typeof rawFields !== "object") return {};

  const result: AnyRecord = {};
  for (const [key, value] of Object.entries(rawFields)) {
    result[key] = extractFieldValue(value);
  }
  return result;
}

function extractFieldValue(node: any): any {
  if (node == null) return null;

  // Already a primitive (string/number/boolean) – return as-is.
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return node;
  }

  // Arrays of anything – map recursively.
  if (Array.isArray(node)) {
    return node.map((item) => extractFieldValue(item));
  }

  if (typeof node !== "object") {
    return null;
  }

  const type = node.type as string | undefined;

  // New Content Understanding shape:
  // {
  //   "type": "string" | "number" | "date" | "array" | "object",
  //   "valueString"?: string,
  //   "valueNumber"?: number,
  //   "valueDate"?: string,
  //   "valueArray"?: [...],
  //   "valueObject"?: { ... }
  // }

  // Array field
  if (type === "array" || Array.isArray(node.valueArray)) {
    const arr: any[] = Array.isArray(node.valueArray) ? node.valueArray : [];
    return arr.map((item) => extractFieldValue(item));
  }

  // Object field
  if (type === "object" || (node.valueObject && typeof node.valueObject === "object")) {
    const valueObject = node.valueObject as AnyRecord;
    const out: AnyRecord = {};
    for (const [subKey, subVal] of Object.entries(valueObject)) {
      out[subKey] = extractFieldValue(subVal);
    }
    return out;
  }

  // String-like
  if (typeof node.valueString === "string") {
    return node.valueString;
  }
  if (typeof node.valueDate === "string") {
    return node.valueDate;
  }

  // Numeric
  if (typeof node.valueNumber === "number") {
    return node.valueNumber;
  }

  // Fallback: if there's a "value" or "content" field, use that.
  if (typeof node.value === "string" || typeof node.value === "number") {
    return node.value;
  }
  if (typeof node.content === "string") {
    return node.content;
  }

  // As a last resort, if it's an object without the Azure shape, recurse shallowly.
  const plainObj = node as AnyRecord;
  const out: AnyRecord = {};
  let hasProps = false;
  for (const [k, v] of Object.entries(plainObj)) {
    if (k === "type" || k === "confidence") continue;
    hasProps = true;
    out[k] = extractFieldValue(v);
  }
  return hasProps ? out : null;
}

async function submitAnalysis(
  analyzerId: string,
  fileBase64: string
): Promise<string> {
  const { key, endpoint } = getAzureConfig();
  const url = `${endpoint}/contentunderstanding/analyzers/${encodeURIComponent(
    analyzerId
  )}:analyze?api-version=2025-11-01`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ base64Source: fileBase64 }),
  });

  if (response.status !== 202) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Azure Content Understanding analyze failed (${response.status}): ${
        text || "Unexpected response status"
      }`
    );
  }

  const opLocation = response.headers.get("Operation-Location");
  if (!opLocation) {
    throw new Error("Azure Content Understanding response missing Operation-Location header.");
  }

  return opLocation;
}

async function pollForResult(
  operationLocation: string,
  keyOverride?: string,
  {
    intervalMs = 1500,
    maxAttempts = 60,
  }: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<AnalyzeResultEnvelope> {
  const key = keyOverride ?? getAzureConfig().key;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(intervalMs);

    const resp = await fetch(operationLocation, {
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
      },
    });

    const json = (await resp.json().catch(() => ({}))) as AnalyzeResultEnvelope;
    const status = (json.status || "").toLowerCase();

    if (status === "succeeded") {
      return json;
    }

    if (status === "failed") {
      const message =
        json.error?.innererror?.message ||
        json.error?.message ||
        `Azure Content Understanding analysis failed.`;
      throw new Error(message);
    }
  }

  throw new Error("Azure Content Understanding analysis timed out.");
}

/**
 * Internal helper: run analysis and return both the raw result JSON and the raw fields object.
 */
export async function analyzeDocumentRaw(
  analyzerEnvKey: string,
  fileBase64: string
): Promise<{ rawResult: AnalyzeResultEnvelope; rawFields: AzureFieldsInput }> {
  const analyzerId = getEnvVar(analyzerEnvKey);
  const opLocation = await submitAnalysis(analyzerId, fileBase64);
  const { key } = getAzureConfig();
  const result = await pollForResult(opLocation, key);

  const fields =
    (result.result?.contents &&
      Array.isArray(result.result.contents) &&
      (result.result.contents[0]?.fields as AzureFieldsInput | undefined)) ||
    ({} as AzureFieldsInput);

  return {
    rawResult: result,
    rawFields: fields,
  };
}

/**
 * High-level helper: run analysis and return a flat object of extracted values
 * (valueString / valueNumber / valueDate / valueArray / valueObject recursively).
 */
export async function analyzeDocument(
  analyzerEnvKey: string,
  fileBase64: string
): Promise<Record<string, any>> {
  const { rawFields } = await analyzeDocumentRaw(analyzerEnvKey, fileBase64);
  return extractFields(rawFields);
}

// Convenience functions for the 4 configured analyzers.

export function getFakturaAnalyzerEnvKey(): string {
  return "AZURE_CU_ANALYZER_FAKTURA";
}

export function getSmetkaAnalyzerEnvKey(): string {
  return "AZURE_CU_ANALYZER_SMETKA";
}

export function getGenericAnalyzerEnvKey(): string {
  return "AZURE_CU_ANALYZER_GENERIC";
}

export function getPlataAnalyzerEnvKey(): string {
  return "AZURE_CU_ANALYZER_PLATA";
}

export async function analyzeFaktura(base64: string): Promise<Record<string, any>> {
  return analyzeDocument(getFakturaAnalyzerEnvKey(), base64);
}

export async function analyzeSmetka(base64: string): Promise<Record<string, any>> {
  return analyzeDocument(getSmetkaAnalyzerEnvKey(), base64);
}

export async function analyzeGeneric(base64: string): Promise<Record<string, any>> {
  return analyzeDocument(getGenericAnalyzerEnvKey(), base64);
}

export async function analyzePlata(base64: string): Promise<Record<string, any>> {
  return analyzeDocument(getPlataAnalyzerEnvKey(), base64);
}

/**
 * Utility for browser environments: convert a File to a base64 string (without the data URL prefix).
 */
export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string | null;
      if (!result) {
        reject(new Error("Failed to read file as Data URL."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unknown FileReader error."));
    };
    reader.readAsDataURL(file);
  });
}

