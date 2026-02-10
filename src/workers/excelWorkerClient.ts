/**
 * Client for excelParse.worker. Runs ExcelJS parsing off the main thread.
 */
import type { GetSheetNamesResult, AnalyzeSchemaResult, WorkerError } from "./excelParse.worker";

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./excelParse.worker.ts", import.meta.url),
      { type: "module" }
    );
  }
  return worker;
}

let nextId = 0;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
const pending = new Map<number, Pending>();

function initListener(): void {
  const w = getWorker();
  w.onmessage = (e: MessageEvent<GetSheetNamesResult | AnalyzeSchemaResult | WorkerError>) => {
    const data = e.data as { id?: number } & (GetSheetNamesResult | AnalyzeSchemaResult | WorkerError);
    const id = data.id;
    if (id != null && pending.has(id)) {
      const p = pending.get(id)!;
      pending.delete(id);
      if (data.type === "error") {
        p.reject(new Error((data as WorkerError).message));
      } else {
        p.resolve(data);
      }
    }
  };
  w.onerror = (err) => {
    pending.forEach((p) => p.reject(err instanceof Error ? err : new Error(String(err))));
    pending.clear();
  };
}

export function runGetSheetNames(buffer: ArrayBuffer): Promise<string[]> {
  if (pending.size === 0) initListener();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => resolve((v as GetSheetNamesResult).sheetNames),
      reject,
    });
    getWorker().postMessage({ id, type: "getSheetNames", buffer }, [buffer]);
  });
}

export interface AnalyzeSchemaPayload {
  worksheetName: string;
  headers: string[];
  columnSamples: string[][];
  lastDataRow: number;
}

export function runAnalyzeSchema(
  buffer: ArrayBuffer,
  headerRow: number,
  sheetName?: string
): Promise<AnalyzeSchemaPayload> {
  if (pending.size === 0) initListener();
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (v) => {
        const r = v as AnalyzeSchemaResult;
        resolve({
          worksheetName: r.worksheetName,
          headers: r.headers,
          columnSamples: r.columnSamples,
          lastDataRow: r.lastDataRow,
        });
      },
      reject,
    });
    getWorker().postMessage({ id, type: "analyzeSchema", buffer, headerRow, sheetName }, [buffer]);
  });
}
