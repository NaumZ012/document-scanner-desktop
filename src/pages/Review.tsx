import { useCallback, useState, useEffect, useMemo } from "react";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { DataCard } from "@/components/DataCard";
import { DocumentPreview } from "@/components/DocumentPreview";
import {
  getProfiles,
  updateHistoryStatus,
  updateHistoryRecord,
  deleteHistoryRecord,
  validateExcelFile,
  appendToExcelFast,
} from "@/services/api";
import type { ExtractedField } from "@/shared/types";
import { FIELD_LABELS_MK, GROUP_LABELS_MK } from "@/shared/constants";
import type { FieldKey } from "@/shared/constants";
import { sortFieldsByData, groupFieldsForDisplay, buildProfileDisplayFields } from "@/utils/fieldUtils";
import { fixDisplayValue } from "@/utils/displayFix";
import { analyzeSchema } from "@/services/schemaService";
import { appendRowViaBackend } from "@/services/excelService";
import { recordMapping } from "@/services/learningService";
import type { FieldMapping } from "@/services/mappingService";

type GroupedFieldItem = ReturnType<typeof groupFieldsForDisplay>[number];
import styles from "./Review.module.css";

export function Review() {
  const {
    review,
    setScreen,
    setReview,
    selectedProfileId,
    setSelectedProfileId,
    defaultProfileId,
    confirmBeforeExport,
  } = useApp();
  const { success, error: showError } = useToast();
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [profiles, setProfiles] = useState<[number, string, string, string, string][]>([]);
  const [profileSchemaHeaders, setProfileSchemaHeaders] = useState<string[] | null>(null);
  const [profileSchemaLoading, setProfileSchemaLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fromHistory = review?.fromHistory === true;

  useEffect(() => {
    if (review) {
      setFields(
        review.fields.map((f) => ({ ...f, value: fixDisplayValue(f.value) }))
      );
    }
  }, [review]);

  useEffect(() => {
    getProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, []);

  useEffect(() => {
    if (profiles.length > 0 && selectedProfileId == null && defaultProfileId != null) {
      const exists = profiles.some((p) => p[0] === defaultProfileId);
      if (exists) setSelectedProfileId(defaultProfileId);
    }
  }, [profiles, selectedProfileId, defaultProfileId, setSelectedProfileId]);

  // Load Excel schema (headers) when profile is selected so we show Excel-driven fields.
  // When no profile is selected but profiles exist, use first profile so Excel-driven view is default.
  // Clear headers when starting load so we never flash stale or English view; keep "Loading…" until schema is ready.
  useEffect(() => {
    const effectiveId = selectedProfileId ?? profiles[0]?.[0];
    const profile = effectiveId != null ? profiles.find((p) => p[0] === effectiveId) : null;
    if (!profile) {
      setProfileSchemaHeaders(null);
      setProfileSchemaLoading(false);
      return;
    }
    const [, , excelPath, sheetName, mappingJson] = profile;
    let parsed: Record<string, string & number> = {};
    try {
      parsed = JSON.parse(mappingJson) as Record<string, string & number>;
    } catch {
      setProfileSchemaHeaders(null);
      setProfileSchemaLoading(false);
      return;
    }
    const headerRow = (typeof parsed._headerRow === "number" && parsed._headerRow >= 1)
      ? parsed._headerRow
      : 1;
    setProfileSchemaHeaders(null);
    setProfileSchemaLoading(true);
    analyzeSchema(excelPath, headerRow, sheetName)
      .then((schema) => setProfileSchemaHeaders(schema.headers))
      .catch(() => setProfileSchemaHeaders(null))
      .finally(() => setProfileSchemaLoading(false));
  }, [selectedProfileId, profiles]);

  const groupedFields = useMemo(
    () => groupFieldsForDisplay(sortFieldsByData(fields)),
    [fields]
  );

  // Effective profile (selected or first) for display; show loading until its schema is ready.
  const hasEffectiveProfile =
    (selectedProfileId ?? profiles[0]?.[0]) != null && profiles.some((p) => p[0] === (selectedProfileId ?? profiles[0]?.[0]));
  const schemaNotReady = hasEffectiveProfile && profileSchemaLoading;

  // When a profile is selected (or defaulted to first) and its schema is loaded, show only that Excel's columns (in order) with header labels.
  const profileDisplayFields = useMemo(() => {
    const effectiveId = selectedProfileId ?? profiles[0]?.[0];
    const profile = effectiveId != null ? profiles.find((p) => p[0] === effectiveId) : null;
    if (!profile || !profileSchemaHeaders?.length) return null;
    const [, , , , mappingJson] = profile;
    let parsed: Record<string, string> = {};
    try {
      parsed = JSON.parse(mappingJson) as Record<string, string>;
    } catch {
      return null;
    }
    const columnMapping: Record<string, string> = {};
    for (const [col, fieldKey] of Object.entries(parsed)) {
      if (col !== "_headerRow" && col !== "_schemaHash" && fieldKey) columnMapping[col] = fieldKey;
    }
    return buildProfileDisplayFields(profileSchemaHeaders, columnMapping, fields);
  }, [selectedProfileId, profiles, profileSchemaHeaders, fields]);

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
    const extractedData = Object.fromEntries(fields.map((f) => [f.key, f.value]));
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

  const addToExcelWithProfile = useCallback(
    async (profileId: number, excelPath: string, sheetName: string, mappingJson: string) => {
      const data = Object.fromEntries(fields.map((f) => [f.key, f.value]));
      const invoiceData = {
        fields: Object.fromEntries(fields.map((f) => [f.key, { value: f.value }])),
      };
      try {
        await appendToExcelFast(profileId, invoiceData);
        return;
      } catch {
        /* Fallback: no cached schema, use full analyze + append */
      }
      const excelVal = await validateExcelFile(excelPath);
      if (!excelVal.valid) {
        throw new Error(excelVal.error ?? "Excel file cannot be used. Please close it if open and try again.");
      }
      let parsed: Record<string, string> = {};
      try {
        parsed = JSON.parse(mappingJson);
      } catch {
        throw new Error("Invalid profile mapping.");
      }
      const headerRow = (typeof parsed._headerRow === "number" && parsed._headerRow >= 1)
        ? parsed._headerRow
        : 1;
      const schema = await analyzeSchema(excelPath, headerRow, sheetName);
      const columnToField: Record<string, string> = {};
      for (const [col, fieldKey] of Object.entries(parsed)) {
        if (col !== "_headerRow" && col !== "_schemaHash" && fieldKey) columnToField[col] = fieldKey;
      }
      const fieldMapping: FieldMapping = {
        columnToField,
        confidenceMap: {},
        requiresReview: false,
        schemaHash: schema.schemaHash,
        worksheetName: sheetName,
        headers: schema.headers,
      };
      await appendRowViaBackend(excelPath, sheetName, fieldMapping, data, schema.lastDataRow);
      await recordMapping(schema, fieldMapping);
    },
    [fields]
  );

  const handleExport = useCallback(async () => {
    if (!review?.fromHistory || review.historyId == null) return;
    if (confirmBeforeExport && !window.confirm("Да го извезам во Excel?")) return;
    const profileId = selectedProfileId ?? profiles[0]?.[0];
    if (!profileId) {
      showError("Нема Excel профил. Оди во Поставки за да креираш.");
      return;
    }
    const profile = profiles.find((p) => p[0] === profileId);
    if (!profile) {
      showError("Профилот не е пронајден.");
      return;
    }
    const [, , excelPath, sheetName, mappingJson] = profile;
    setAdding(true);
    try {
      await addToExcelWithProfile(profileId, excelPath, sheetName, mappingJson);
      await updateHistoryStatus({
        id: review.historyId,
        status: "added_to_excel",
        excel_profile_id: profileId,
      });
      success("Извезено во Excel.");
      setReview(null);
      setScreen("history");
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }, [review, profiles, selectedProfileId, confirmBeforeExport, addToExcelWithProfile, setReview, setScreen, success, showError]);

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
    if (confirmBeforeExport && !window.confirm("Да го додадам во Excel?")) return;
    const profileId = selectedProfileId ?? profiles[0]?.[0];
    if (!profileId || !review) {
      showError("Нема Excel профил. Оди во Поставки за да креираш.");
      return;
    }
    const profile = profiles.find((p) => p[0] === profileId);
    if (!profile) {
      showError("Профилот не е пронајден.");
      return;
    }
    const [, , excelPath, sheetName, mappingJson] = profile;
    setAdding(true);
    try {
      await addToExcelWithProfile(profileId, excelPath, sheetName, mappingJson);
      if (review.historyId != null) {
        await updateHistoryStatus({
          id: review.historyId,
          status: "added_to_excel",
          excel_profile_id: profileId,
        });
      }
      success("Додадено во Excel");
      setReview(null);
      setScreen(review.historyId != null ? "history" : "home");
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }, [
    selectedProfileId,
    profiles,
    review,
    confirmBeforeExport,
    addToExcelWithProfile,
    setReview,
    setScreen,
    success,
    showError,
  ]);

  const fieldWithMkLabel = (f: ExtractedField): ExtractedField => ({
    ...f,
    label: (FIELD_LABELS_MK[f.key as FieldKey] ?? f.label),
  });

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

  // History review: data fields only, no PDF/zoom, CRUD (Save, Export, Delete)
  if (fromHistory) {
    const showProfileFields = profileDisplayFields != null && profileDisplayFields.length > 0;
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>Преглед</h1>
          <span className={styles.fileName}>{review.fileName}</span>
        </div>
        <div className={styles.layoutHistory}>
          <div className={styles.fields}>
            {profiles.length > 0 && (
              <div className={styles.profileSelect}>
                <label>Excel профил (за извоз)</label>
                <select
                  value={selectedProfileId ?? profiles[0]?.[0] ?? ""}
                  onChange={(e) => setSelectedProfileId(Number(e.target.value) || null)}
                >
                  {profiles.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <h2 className={styles.fieldsTitle}>
              {showProfileFields ? "Полиња за Excel" : "Извлечени податоци"}
            </h2>
            {schemaNotReady ? (
              <p className={styles.loadingSchema}>Се вчитуваат колони…</p>
            ) : showProfileFields ? (
              <div className={styles.fieldGroup}>
                {profileDisplayFields!.map((f: ExtractedField) => (
                  <DataCard key={`${f.key}-${f.label}`} field={fieldWithMkLabel(f)} onChange={handleFieldChange} placeholderPrefix="Внеси" />
                ))}
              </div>
            ) : (
              groupedFields.map(({ group, fields: groupFields }: GroupedFieldItem) => (
                <div key={group} className={styles.fieldGroup}>
                  <h3 className={styles.groupTitle}>{GROUP_LABELS_MK[group]}</h3>
                  {groupFields.map((f: ExtractedField) => (
                    <DataCard key={f.key} field={fieldWithMkLabel(f)} onChange={handleFieldChange} placeholderPrefix="Внеси" />
                  ))}
                </div>
              ))
            )}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.secondary}
                onClick={handleCancel}
              >
                Назад кон историја
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Се зачувува…" : "Зачувај"}
              </button>
              {profiles.length > 0 && (
                <button
                  type="button"
                  className={styles.exportBtn}
                  onClick={handleExport}
                  disabled={adding}
                >
                  {adding ? "Се извезува…" : "Извези во Excel"}
                </button>
              )}
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "…" : "Избриши"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // After-scan review: full layout with PDF preview, OCR, Add to Excel
  const showProfileFields = profileDisplayFields != null && profileDisplayFields.length > 0;
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Преглед</h1>
        <span className={styles.fileName}>{review.fileName}</span>
      </div>
      <div className={styles.layout}>
        <div className={styles.previewSection}>
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
        <div className={styles.fields}>
          {profiles.length > 0 && (
            <div className={styles.profileSelect}>
              <label>Excel профил</label>
              <select
                value={selectedProfileId ?? profiles[0]?.[0] ?? ""}
                onChange={(e) => setSelectedProfileId(Number(e.target.value) || null)}
              >
                {profiles.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <h2 className={styles.fieldsTitle}>
            {showProfileFields ? "Полиња за Excel" : "Извлечени податоци"}
          </h2>
          {schemaNotReady ? (
            <p className={styles.loadingSchema}>Се вчитуваат колони…</p>
          ) : showProfileFields ? (
            <div className={styles.fieldGroup}>
              {profileDisplayFields!.map((f: ExtractedField) => (
                <DataCard key={`${f.key}-${f.label}`} field={fieldWithMkLabel(f)} onChange={handleFieldChange} placeholderPrefix="Внеси" />
              ))}
            </div>
          ) : (
            groupedFields.map(({ group, fields: groupFields }: GroupedFieldItem) => (
              <div key={group} className={styles.fieldGroup}>
                <h3 className={styles.groupTitle}>{GROUP_LABELS_MK[group]}</h3>
                {groupFields.map((f: ExtractedField) => (
                  <DataCard key={f.key} field={fieldWithMkLabel(f)} onChange={handleFieldChange} placeholderPrefix="Внеси" />
                ))}
              </div>
            ))
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={handleCancel}
            >
              Откажи
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={handleAddToExcel}
              disabled={adding || profiles.length === 0}
            >
              {adding ? "Се додава…" : "Додај во Excel"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
