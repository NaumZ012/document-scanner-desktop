import { useCallback, useState, useEffect, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { DataCard } from "@/components/DataCard";
import { DocumentPreview } from "@/components/DocumentPreview";
import { save } from "@tauri-apps/plugin-dialog";
import {
  updateHistoryStatus,
  updateHistoryRecord,
  deleteHistoryRecord,
  buildExtractedDataWithConfidence,
  exportInvoicesToNewExcel,
  copyTemplateAndFillTaxBalance,
} from "@/services/api";
import type { ExtractedField } from "@/shared/types";
import { getSchemaForDocumentType, normalizeDocumentType, TAX_BALANCE_FORM_ROWS } from "@/shared/documentTypeSchemas";
import { fixDisplayValue } from "@/utils/displayFix";
import { formatNumberForExcel } from "@/utils/fieldUtils";
import styles from "./Review.module.css";

export function Review() {
  const {
    review,
    setScreen,
    setReview,
    confirmBeforeExport,
    confidenceThreshold,
  } = useApp();
  const { success, error: showError } = useToast();
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [splitView, setSplitView] = useState(true);

  const fromHistory = review?.fromHistory === true;
  const docTypeId = useMemo(() => normalizeDocumentType(review?.documentType), [review?.documentType]);

  useEffect(() => {
    if (review) {
      setFields(
        review.fields.map((f) => ({ ...f, value: fixDisplayValue(f.value) }))
      );
    }
  }, [review]);

  const schema = useMemo(
    () => getSchemaForDocumentType(review?.documentType),
    [review?.documentType]
  );

  const keyToField = useMemo(() => {
    const map = new Map<string, ExtractedField>();
    for (const f of fields) map.set(f.key, f);
    return map;
  }, [fields]);

  const displayFields = useMemo((): ExtractedField[] => {
    if (!schema) return [];
    // Only show fields that are part of the fixed schema for this document type.
    const schemaPart: ExtractedField[] = schema.fields.map((def) => {
      const existing = keyToField.get(def.key);
      return {
        key: def.key,
        label: def.label,
        value: existing?.value ?? "",
        confidence: existing?.confidence,
      };
    });
    return schemaPart;
  }, [schema, keyToField]);

  /** Sorted by confidence descending: highest first, lowest/undefined last. */
  const sortedDisplayFields = useMemo((): ExtractedField[] => {
    return [...displayFields].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  }, [displayFields]);

  /** Average confidence over fields that have a confidence value (0–1). */
  const averageConfidence = useMemo((): number | null => {
    const withConf = displayFields.filter((f) => f.confidence != null);
    if (withConf.length === 0) return null;
    const sum = withConf.reduce((acc, f) => acc + (f.confidence ?? 0), 0);
    return sum / withConf.length;
  }, [displayFields]);

  /** Summary of empty and low-confidence fields for user warnings. */
  const reviewWarnings = useMemo(() => {
    if (!schema) return { empty: 0, lowConfidence: 0 };
    let empty = 0;
    let lowConfidence = 0;
    for (const def of schema.fields) {
      const f = keyToField.get(def.key);
      const value = f?.value?.trim() ?? "";
      const conf = f?.confidence;
      if (!value) {
        empty += 1;
      } else if (conf != null && conf < confidenceThreshold) {
        lowConfidence += 1;
      }
    }
    return { empty, lowConfidence };
  }, [schema, keyToField, confidenceThreshold]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.key === key);
      if (idx >= 0) return prev.map((f) => (f.key === key ? { ...f, value } : f));
      return [...prev, { key, value, label: key, confidence: undefined }];
    });
  }, []);

  const handleCancel = useCallback(() => {
    setReview(null);
    setScreen(fromHistory ? "history" : "home");
  }, [setReview, setScreen, fromHistory]);

  const handleSave = useCallback(async () => {
    if (!review?.fromHistory || review.historyId == null) return;
    const extractedData = buildExtractedDataWithConfidence(fields);
    setSaving(true);
    try {
      await updateHistoryRecord({
        id: review.historyId,
        document_type: review.documentType,
        file_path_or_name: review.filePath,
        extracted_data: extractedData,
        status: review.status ?? "pending",
      });
      success("Ставката е зачувана.");
      setReview(null);
      setScreen("history");
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [review, fields, setReview, setScreen, success, showError]);

  const handleExport = useCallback(async () => {
    if (!review?.fromHistory || review.historyId == null) return;
    if (confirmBeforeExport && !window.confirm("Да го извезам во Excel?")) return;
    setAdding(true);
    try {
      const docType = docTypeId;
      if (docType === "smetka") {
        // Даночен биланс: copy official template and fill AOP column (D).
        const path = await save({
          filters: [{ name: "Excel", extensions: ["xlsx"] }],
          defaultPath: `Даночен_биланс_${new Date().toISOString().slice(0, 10)}.xlsx`,
          title: "Зачувај како",
        });
        if (path == null) {
          setAdding(false);
          return;
        }
        const invoiceData = {
          fields: Object.fromEntries(
            fields.map((f) => [
              f.key,
              {
                value: f.value,
              },
            ])
          ),
        };
        await copyTemplateAndFillTaxBalance(0, path, invoiceData);
      } else if (docType === "faktura") {
        // Invoices: append single row into a new workbook with fixed Example-Invoices layout.
        const defaultName = `Фактури_${new Date().toISOString().slice(0, 10)}_${Date.now()
          .toString()
          .slice(-6)}.xlsx`;
        const path = await save({
          filters: [{ name: "Excel", extensions: ["xlsx"] }],
          defaultPath: defaultName,
          title: "Зачувај како",
        });
        if (path == null) {
          setAdding(false);
          return;
        }
        const invoiceData = {
          fields: Object.fromEntries(
            fields.map((f) => [
              f.key,
              {
                value:
                  f.key === "net_amount" ||
                  f.key === "tax_amount" ||
                  f.key === "total_amount"
                    ? formatNumberForExcel(f.value)
                    : f.value,
              },
            ])
          ),
        } as any;
        await exportInvoicesToNewExcel([invoiceData] as any, path, "Invoices");
      } else {
        // For ДДВ и Плати we'll wire dedicated templates via batch export; from history we just save edits.
        showError("Извозот во Excel за овој тип користи групен извоз. Користи „Преглед на скенирани документи“ за извоз.");
        setAdding(false);
        return;
      }
      await updateHistoryStatus({
        id: review.historyId,
        status: "added_to_excel",
        excel_profile_id: null,
      });
      success("Извезено во Excel.");
      setReview(null);
      setScreen("history");
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }, [review, fields, docTypeId, confirmBeforeExport, setReview, setScreen, success, showError]);

  const handleDelete = useCallback(async () => {
    if (!review?.fromHistory || review.historyId == null) return;
    if (!window.confirm("Да ја избришам оваа ставка?")) return;
    setDeleting(true);
    try {
      await deleteHistoryRecord(review.historyId);
      success("Ставката е избришана.");
      setReview(null);
      setScreen("history");
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }, [review, setReview, setScreen, success, showError]);

  const handleAddToExcel = useCallback(async () => {
    // For new scans (not from history) we route users to batch export instead of single-record Excel write.
    if (confirmBeforeExport && !window.confirm("Да го додадеш документот во групен преглед за извоз?")) return;
    setReview(null);
    setScreen("batchReview");
  }, [confirmBeforeExport, setReview, setScreen]);

  const formatHistoryTimestamp = (iso?: string): string => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const date = d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const time = d.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      return `${date} · ${time}`;
    } catch {
      return iso;
    }
  };

  if (!review) {
    return (
      <div className={styles.page}>
        <p className={styles.emptyMessage}>Нема документ за преглед.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => setScreen("history")}>
            Назад кон историја
          </button>
          <button type="button" className={styles.primary} onClick={() => setScreen("home")}>
            Почетна
          </button>
        </div>
      </div>
    );
  }

  const pageTitle = schema ? `Преглед — ${schema.title}` : "Преглед";

  const formSection = (
    <div className={styles.fields}>
      <h2 className={styles.fieldsTitle}>
        {schema ? schema.title : "Податоци"}
      </h2>
      {(reviewWarnings.empty > 0 || reviewWarnings.lowConfidence > 0) && (
        <p className={styles.reviewWarning}>
          Има полиња за проверка: {reviewWarnings.empty} празни, {reviewWarnings.lowConfidence} со ниска доверба.
        </p>
      )}
      {averageConfidence != null && (
        <p className={styles.averageConfidence} title="Просек од довербата што ја враќа Azure моделот за полето (не е фиксна вредност)">
          Просечна доверба (од моделот): {Math.round(averageConfidence * 100)}%
        </p>
      )}
      {docTypeId === "smetka" ? (
        <>
          <div className={styles.fieldGroup}>
            {["companyName", "companyTaxId", "taxPeriodStart", "taxPeriodEnd"].map((key) => {
              const f = sortedDisplayFields.find((x) => x.key === key) ?? {
                key,
                label: key,
                value: keyToField.get(key)?.value ?? "",
                confidence: keyToField.get(key)?.confidence,
              };
              return (
                <DataCard
                  key={f.key}
                  field={f}
                  onChange={handleFieldChange}
                  placeholderPrefix="Внеси"
                />
              );
            })}
          </div>
          <h3 className={styles.groupTitle}>Утврдување на данок од добивка на непризнаени расходи</h3>
          <div className={styles.taxBalanceTableWrap}>
            <table className={styles.taxBalanceTable}>
              <thead>
                <tr>
                  <th className={styles.taxBalanceSection}>Бр.</th>
                  <th className={styles.taxBalanceDesc}>Опис</th>
                  <th className={styles.taxBalanceConfidence}>Доверба</th>
                  <th className={styles.taxBalanceValue}>Износ</th>
                </tr>
              </thead>
              <tbody>
                {TAX_BALANCE_FORM_ROWS.map((row) => {
                  const f = row.fieldKey ? keyToField.get(row.fieldKey) : undefined;
                  const rawValue = f?.value ?? "";
                  // Treat UI placeholders as empty (we still want 0 to show as 0).
                  const value = rawValue === "—" ? "" : rawValue;
                  const confidence = f?.confidence;
                  const isLowConfidence =
                    confidence != null && confidence < confidenceThreshold;
                  return (
                    <tr key={row.fieldKey ?? row.section}>
                      <td className={styles.taxBalanceSection}>{row.section}</td>
                      <td className={styles.taxBalanceDesc}>{row.description}</td>
                      <td className={styles.taxBalanceConfidence}>
                        {confidence != null ? (
                          <span
                            className={`${styles.taxConfidenceBadge} ${
                              isLowConfidence ? styles.taxConfidenceLow : styles.taxConfidenceOk
                            }`}
                            title="Доверба од Azure моделот (не е фиксна вредност)"
                          >
                            {Math.round(confidence * 100)}%
                          </span>
                        ) : (
                          <span className={styles.taxConfidenceMissing}>—</span>
                        )}
                      </td>
                      <td className={styles.taxBalanceValue}>
                        {row.fieldKey ? (
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => handleFieldChange(row.fieldKey!, e.target.value)}
                            className={styles.taxBalanceInput}
                            placeholder="—"
                          />
                        ) : (
                          ""
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className={styles.fieldGroup}>
          {sortedDisplayFields.map((f) => (
            <DataCard
              key={f.key}
              field={f}
              onChange={handleFieldChange}
              placeholderPrefix="Внеси"
            />
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={handleCancel}>
          {fromHistory ? "Назад кон историја" : "Откажи"}
        </button>
        {fromHistory && (
          <>
            <button
              type="button"
              className={styles.primary}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Се зачувува…" : "Зачувај"}
            </button>
            <button
              type="button"
              className={styles.exportBtn}
              onClick={handleExport}
              disabled={adding}
            >
              {adding ? "Се извезува…" : "Извези во Excel"}
            </button>
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "…" : "Избриши"}
            </button>
          </>
        )}
        {!fromHistory && (
          <button
            type="button"
            className={styles.primary}
            onClick={handleAddToExcel}
            disabled={adding}
          >
            {adding ? "Се додава…" : "Додај во Excel"}
          </button>
        )}
      </div>
    </div>
  );

  if (fromHistory) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>{pageTitle}</h1>
          <span className={styles.fileName}>{review.fileName}</span>
          {review.historyCreatedAt && (
            <span className={styles.fileMeta}>
              Скенирано: {formatHistoryTimestamp(review.historyCreatedAt)}
            </span>
          )}
        </div>
        <div className={styles.layoutHistory}>
          {formSection}
        </div>
      </div>
    );
  }

  return (
    <div className={splitView ? `${styles.page} ${styles.pageSplit}` : styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{pageTitle}</h1>
        <span className={styles.fileName}>{review.fileName}</span>
      </div>
      <div className={styles.viewToggleRow}>
        <label className={styles.viewToggleLabel}>
          <input
            type="checkbox"
            checked={splitView}
            onChange={(e) => setSplitView(e.target.checked)}
          />
          <span>Подели екран (PDF + податоци)</span>
        </label>
      </div>
      <div className={splitView ? styles.pageSplitContent : undefined}>
        <div className={splitView ? styles.layoutSplit : styles.layoutStacked}>
          <div className={splitView ? `${styles.previewSection} ${styles.scrollableCol}` : styles.previewSection}>
            <DocumentPreview
              filePath={review.filePath}
              fileName={review.fileName}
            />
            <details className={styles.ocrDetails}>
              <summary>OCR текст</summary>
              <p className={styles.ocrRaw}>
                {review.ocrResult.content
                  ? `${review.ocrResult.content.slice(0, 800)}${review.ocrResult.content.length > 800 ? "…" : ""}`
                  : "(Нема OCR текст)"}
              </p>
            </details>
          </div>
          <div className={splitView ? styles.scrollableCol : undefined}>
            {formSection}
          </div>
        </div>
      </div>
    </div>
  );
}
