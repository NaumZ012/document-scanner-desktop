import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useDebounce } from "@/hooks/useDebounce";
import { getHistory, getFolders, createFolder, deleteFolder, assignHistoryToFolder, deleteHistoryRecord } from "@/services/api";
import type { ExtractedField } from "@/shared/types";
import type { OcrResult } from "@/shared/types";
import {
  FIELD_LABELS,
  TAX_FIELD_LABELS_MK,
  DDV_FIELD_LABELS_MK,
  PAYROLL_FIELD_LABELS_MK,
} from "@/shared/constants";
import { sanitizeDescription } from "@/utils/parseAzureExtraction";
import styles from "./History.module.css";

type HistoryRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number | null,
  string | null,
];

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${date} · ${time}`;
  } catch {
    return iso;
  }
}

function fileNameFromPath(pathOrName: string): string {
  const parts = pathOrName.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || pathOrName;
}

function parseExtractedData(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function extractedDataToFields(extractedDataJson: string): ExtractedField[] {
  const data = parseExtractedData(extractedDataJson);
  const confidenceMap =
    typeof data._confidence === "object" && data._confidence !== null && !Array.isArray(data._confidence)
      ? (data._confidence as Record<string, number>)
      : {};
  return Object.entries(data)
    .filter(([key]) => key !== "_confidence")
    .map(([key, raw]) => {
      let value = String(raw ?? "");
      if (key === "description" && value) {
        value = sanitizeDescription(value);
      }
      const label =
        (FIELD_LABELS as Record<string, string>)[key] ??
        TAX_FIELD_LABELS_MK[key] ??
        DDV_FIELD_LABELS_MK[key] ??
        PAYROLL_FIELD_LABELS_MK[key] ??
        key.replace(/_/g, " ");
      return {
        key,
        value,
        confidence: confidenceMap[key],
        label,
      };
    });
}

/** Infer logical document type from extracted data keys (fallback when DB type is generic/faktura). */
function inferDocumentTypeFromExtractedData(
  extractedDataJson: string,
  fallback: string
): string {
  const data = parseExtractedData(extractedDataJson);
  const keysArr = Object.keys(data).filter((k) => k !== "_confidence");
  const keys = new Set(keysArr);

  // Даночен биланс (Tax balance)
  const hasAopKey =
    keysArr.some((k) => k.startsWith("aop_")) ||
    keysArr.some((k) => /AOP\d+/i.test(k));
  if (
    hasAopKey ||
    keys.has("finansiskiRezultatAOP1") ||
    keys.has("companyTaxId") ||
    keys.has("taxPeriodStart") ||
    keys.has("taxPeriodEnd") ||
    keys.has("financialResultFromPL") ||
    keys.has("taxBaseAfterReduction") ||
    keys.has("calculatedProfitTax") ||
    keys.has("amountToPayOrOverpaid")
  ) {
    return "smetka";
  }

  // ДДВ (VAT return)
  if (
    keys.has("prometOpshtaStapkaOsnova") ||
    keys.has("vlezenPrometOsnova") ||
    keys.has("danochenDolgIliPobaruvanje") ||
    keys.has("taxPeriod") ||
    keys.has("totalTaxBase") ||
    keys.has("totalOutputVat") ||
    keys.has("vatPayableOrRefund")
  ) {
    return "generic";
  }

  // Плати (Payroll)
  if (
    keys.has("brutoPlata") ||
    keys.has("vkupnaNetoPlata") ||
    keys.has("pridonesPIO") ||
    keys.has("pridonesZdravstvo") ||
    keys.has("pridonesProfesionalnoZaboluvanje") ||
    keys.has("pridonesVrabotuvanje") ||
    keys.has("personalenDanok") ||
    keys.has("year") ||
    keys.has("totalGrossSalary") ||
    keys.has("totalNetSalary") ||
    keys.has("totalPayrollCost")
  ) {
    return "plata";
  }

  return fallback;
}

function rowToReviewState(row: HistoryRow): {
  filePath: string;
  fileName: string;
  ocrResult: OcrResult;
  documentType: string;
  fields: ExtractedField[];
  historyId: number;
  fromHistory: true;
  status: string;
} {
  const [id, createdAt, docType, filePathOrName, extractedDataJson, rowStatus] = row;
  const filePath = filePathOrName;
  const fileName = fileNameFromPath(filePathOrName);
  const inferredType = inferDocumentTypeFromExtractedData(extractedDataJson || "{}", docType);
  const fields = extractedDataToFields(extractedDataJson || "{}");
  return {
    filePath,
    fileName,
    ocrResult: { lines: [], content: "" },
    documentType: inferredType,
    fields,
    historyId: id,
    fromHistory: true,
    status: rowStatus ?? "pending",
    historyCreatedAt: createdAt,
  };
}

export function History() {
  const { setScreen, setReview, historyPageSize } = useApp();
  const { success, error: showError } = useToast();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [folders, setFolders] = useState<[number, string, string][]>([]);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<number | null>(null); // null = Сите (all)
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<"createFolder" | null>(null);
  const [folderName, setFolderName] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const debouncedSearch = useDebounce(search, 300);
  const debouncedFolder = useDebounce(folderFilter, 200);

  const loadFolders = useCallback(() => {
    getFolders()
      .then(setFolders)
      .catch(() => setFolders([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    getHistory({
      search: debouncedSearch || undefined,
      folder_id: debouncedFolder,
    })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [debouncedSearch, debouncedFolder]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setCurrentPage(0);
  }, [debouncedSearch, debouncedFolder]);

  const totalPages = Math.max(1, Math.ceil(rows.length / historyPageSize));
  const paginatedRows = rows.slice(
    currentPage * historyPageSize,
    (currentPage + 1) * historyPageSize
  );

  const openCreateFolder = useCallback(() => {
    setFolderName("");
    setModalMode("createFolder");
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    if (!folderName.trim()) {
      showError("Внесете име на папка.");
      return;
    }
    setSaving(true);
    try {
      await createFolder(folderName.trim());
      success("Папката е креирана.");
      closeModal();
      loadFolders();
      load();
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [folderName, closeModal, loadFolders, load, success, showError]);

  const handleDeleteFolder = useCallback(
    async (id: number) => {
      if (!window.confirm("Да ја избришам папката? Записите ќе останат некатегоризирани.")) return;
      try {
        await deleteFolder(id);
        success("Папката е избришана.");
        loadFolders();
        if (folderFilter === id) setFolderFilter(null);
        load();
      } catch (e) {
        showError(e instanceof Error ? e.message : String(e));
      }
    },
    [folderFilter, loadFolders, load, success, showError]
  );

  const handleOpenReview = useCallback(
    (row: HistoryRow) => {
      setReview(rowToReviewState(row));
      setScreen("review");
    },
    [setReview, setScreen]
  );

  const handleDeleteHistory = useCallback(
    async (id: number) => {
      if (!window.confirm("Да го избришам овој запис од историјата?")) return;
      try {
        await deleteHistoryRecord(id);
        success("Записот е избришан.");
        load();
      } catch (e) {
        showError(e instanceof Error ? e.message : String(e));
      }
    },
    [load, success, showError]
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Историја</h1>
        <button type="button" className={styles.addBtn} onClick={openCreateFolder}>
          Креирај папка
        </button>
      </div>

      <div className={styles.filters}>
        <input
          type="text"
          placeholder="Пребарај..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      <nav className={styles.folderNav}>
        <button
          type="button"
          className={folderFilter === null ? styles.folderTabActive : styles.folderTab}
          onClick={() => setFolderFilter(null)}
        >
          Сите
        </button>
        {folders.map(([id, name]) => (
          <span key={id} className={styles.folderTabWrap}>
            <button
              type="button"
              className={folderFilter === id ? styles.folderTabActive : styles.folderTab}
              onClick={() => setFolderFilter(id)}
            >
              {name}
            </button>
            <button
              type="button"
              className={styles.folderTabDelete}
              onClick={(e) => { e.stopPropagation(); handleDeleteFolder(id); }}
              title="Избриши папка"
              aria-label="Избриши папка"
            >
              ×
            </button>
          </span>
        ))}
      </nav>

      {loading ? (
        <p className={styles.loading}>Се вчитува…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>Нема историја.</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Име</th>
                  <th>Тип</th>
                  <th>Време на скенирање</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row) => {
                  const [id, createdAt, docType, filePathOrName] = row;
                  const name = fileNameFromPath(filePathOrName);
                  return (
                    <tr key={id}>
                      <td className={styles.nameCell}>{name}</td>
                      <td className={styles.typeCell}>{docType}</td>
                      <td className={styles.dateCell}>{formatDate(createdAt)}</td>
                      <td className={styles.actionsCell}>
                        <select
                          className={styles.moveSelect}
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            e.target.value = "";
                            if (!v) return;
                            const folderId = v === "none" ? null : Number(v);
                            assignHistoryToFolder(id, folderId)
                              .then(() => {
                                success("Преместено.");
                                load();
                              })
                              .catch((err) =>
                                showError(err instanceof Error ? err.message : String(err))
                              );
                          }}
                          title="Премести во папка"
                        >
                          <option value="">Премести…</option>
                          <option value="none">Некатегоризирани</option>
                          {folders.map(([fid, fname]) => (
                            <option key={fid} value={fid}>
                              {fname}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={styles.reviewBtn}
                          onClick={() => handleOpenReview(row)}
                        >
                          Преглед
                        </button>
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteHistory(id)}
                          title="Избриши запис"
                          aria-label="Избриши запис"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <nav className={styles.pagination}>
              <button
                type="button"
                className={styles.paginationBtn}
                disabled={currentPage === 0}
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              >
                ←
              </button>
              <span className={styles.paginationInfo}>
                {currentPage * historyPageSize + 1}–{Math.min((currentPage + 1) * historyPageSize, rows.length)} од {rows.length}
              </span>
              <button
                type="button"
                className={styles.paginationBtn}
                disabled={currentPage >= totalPages - 1}
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                →
              </button>
            </nav>
          )}
        </>
      )}

      {modalMode === "createFolder" && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Креирај папка</h2>
            <div className={styles.form}>
              <label className={styles.label}>
                Име на папка
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  className={styles.input}
                  placeholder="на пр. Фактури 2024"
                  autoFocus
                />
              </label>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={closeModal}>
                Откажи
              </button>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={handleCreateFolder}
                disabled={saving || !folderName.trim()}
              >
                {saving ? "Се зачувува…" : "Креирај"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
