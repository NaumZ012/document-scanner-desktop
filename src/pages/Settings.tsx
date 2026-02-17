import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import type { DesignVariant, ThemePreference } from "@/context/AppContext";
import { useTranslations } from "@/hooks/useTranslations";
import {
  openAppDataFolder,
  getFolders,
  getProfiles,
  getAppVersion,
  getAzureStatus,
  clearLearnedMappings,
} from "@/services/api";
import { DOCUMENT_TYPES } from "@/shared/constants";
import type { DocumentType } from "@/shared/types";
import styles from "./Settings.module.css";

function useResolvedTheme(theme: ThemePreference): "light" | "dark" {
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (theme === "light") return "light";
    if (theme === "dark") return "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  });
  useEffect(() => {
    if (theme !== "system") {
      setResolved(theme);
      return;
    }
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => setResolved(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);
  return resolved;
}

const LIGHT_DESIGNS: { id: DesignVariant; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "purple", label: "Purple" },
];

const DARK_DESIGNS: { id: DesignVariant; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "purple", label: "Purple" },
  { id: "oled", label: "OLED" },
];

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  faktura: "Faktura",
  plata: "Plata",
  smetka: "Smetka",
  generic: "Generic",
};

const DOC_TYPE_LABELS_MK: Record<DocumentType, string> = {
  faktura: "Фактура",
  plata: "Плата",
  smetka: "Сметка",
  generic: "Општо",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function Settings() {
  const {
    theme,
    setTheme,
    design,
    setDesign,
    language,
    setLanguage,
    defaultDocumentType,
    setDefaultDocumentType,
    confidenceThreshold,
    setConfidenceThreshold,
    dateFormat,
    setDateFormat,
    defaultFolderId,
    setDefaultFolderId,
    historyPageSize,
    setHistoryPageSize,
    defaultProfileId,
    setDefaultProfileId,
    confirmBeforeExport,
    setConfirmBeforeExport,
    fontSize,
    setFontSize,
    compactMode,
    setCompactMode,
  } = useApp();
  const { t, isMk } = useTranslations();
  const { success } = useToast();
  const resolvedTheme = useResolvedTheme(theme);

  const isLight = resolvedTheme === "light";
  const designs = isLight ? LIGHT_DESIGNS : DARK_DESIGNS;
  const docTypeLabels = isMk ? DOC_TYPE_LABELS_MK : DOC_TYPE_LABELS;

  const [folders, setFolders] = useState<[number, string, string][]>([]);
  const [profiles, setProfiles] = useState<[number, string, string, string, string][]>([]);
  const [appVersion, setAppVersion] = useState<string>("");
  const [azureStatus, setAzureStatus] = useState<string>("");
  useEffect(() => {
    getFolders().then(setFolders).catch(() => setFolders([]));
  }, []);
  useEffect(() => {
    getProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, []);
  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion("—"));
  }, []);
  useEffect(() => {
    getAzureStatus().then(setAzureStatus).catch(() => setAzureStatus("unknown"));
  }, []);

  const handleClearLearnedMappings = async () => {
    if (!window.confirm(t("clearLearnedMappingsConfirm"))) return;
    try {
      await clearLearnedMappings();
      success("Learned mappings cleared.");
    } catch {
      // error handled by toast if needed
    }
  };

  const handleOpenDataFolder = async () => {
    try {
      await openAppDataFolder();
    } catch {
      // error handling via toast if needed
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t("settings")}</h1>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("theme")}</h2>
        <p className={styles.sectionHint}>Light, dark, or follow system</p>
        <div className={styles.themeCards}>
          {(["light", "dark", "system"] as ThemePreference[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.themeCard} ${theme === t ? styles.themeCardActive : ""}`}
              onClick={() => setTheme(t)}
            >
              <span className={styles.themeCardIcon}>
                {t === "light" ? "☀" : t === "dark" ? "🌙" : "◐"}
              </span>
              <span className={styles.themeCardLabel}>
                {t === "light" ? "Light" : t === "dark" ? "Dark" : "System"}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("design")} — {isLight ? "Light" : "Dark"}</h2>
        <p className={styles.sectionHint}>
          {isLight
            ? "Choose a style for light mode"
            : "Choose a style for dark mode"}
        </p>
        <div className={styles.themeCards}>
          {designs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`${styles.themeCard} ${design === id ? styles.themeCardActive : ""}`}
              onClick={() => setDesign(id)}
            >
              <span className={`${styles.designPreview} ${styles[`design_${id}`]}`} />
              <span className={styles.themeCardLabel}>{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("language")}</h2>
        <p className={styles.sectionHint}>App language for labels</p>
        <div className={styles.themeCards}>
          <button
            type="button"
            className={`${styles.themeCard} ${language === "mk" ? styles.themeCardActive : ""}`}
            onClick={() => setLanguage("mk")}
          >
            <span className={styles.themeCardLabel}>{t("macedonian")}</span>
          </button>
          <button
            type="button"
            className={`${styles.themeCard} ${language === "en" ? styles.themeCardActive : ""}`}
            onClick={() => setLanguage("en")}
          >
            <span className={styles.themeCardLabel}>{t("english")}</span>
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("defaultDocumentType")}</h2>
        <p className={styles.sectionHint}>Default when OCR does not detect document type</p>
        <select
          className={styles.select}
          value={defaultDocumentType}
          onChange={(e) => setDefaultDocumentType(e.target.value as DocumentType)}
        >
          {DOCUMENT_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {docTypeLabels[dt]}
            </option>
          ))}
        </select>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("confidenceThreshold")}</h2>
        <p className={styles.sectionHint}>
          Fields below this confidence are highlighted for review (0–1)
        </p>
        <div className={styles.sliderRow}>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={confidenceThreshold}
            onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.sliderValue}>{Math.round(confidenceThreshold * 100)}%</span>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("dateFormat")}</h2>
        <p className={styles.sectionHint}>How dates are displayed</p>
        <div className={styles.themeCards}>
          <button
            type="button"
            className={`${styles.themeCard} ${dateFormat === "DMY" ? styles.themeCardActive : ""}`}
            onClick={() => setDateFormat("DMY")}
          >
            <span className={styles.themeCardLabel}>DD.MM.YYYY</span>
          </button>
          <button
            type="button"
            className={`${styles.themeCard} ${dateFormat === "YMD" ? styles.themeCardActive : ""}`}
            onClick={() => setDateFormat("YMD")}
          >
            <span className={styles.themeCardLabel}>YYYY-MM-DD</span>
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("defaultFolder")}</h2>
        <p className={styles.sectionHint}>New history records are assigned to this folder</p>
        <select
          className={styles.select}
          value={defaultFolderId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setDefaultFolderId(v === "" ? null : Number(v));
          }}
        >
          <option value="">{t("defaultFolderAll")}</option>
          {folders.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("historyPageSize")}</h2>
        <p className={styles.sectionHint}>Number of items per page in History</p>
        <div className={styles.themeCards}>
          {PAGE_SIZE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={`${styles.themeCard} ${historyPageSize === n ? styles.themeCardActive : ""}`}
              onClick={() => setHistoryPageSize(n)}
            >
              <span className={styles.themeCardLabel}>{n}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("defaultProfile")}</h2>
        <p className={styles.sectionHint}>Initial Excel profile on Review page</p>
        <select
          className={styles.select}
          value={defaultProfileId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setDefaultProfileId(v === "" ? null : Number(v));
          }}
        >
          <option value="">{t("none")}</option>
          {profiles.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("fontSize")}</h2>
        <p className={styles.sectionHint}>Base font size for the app</p>
        <div className={styles.themeCards}>
          {(["small", "medium", "large"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.themeCard} ${fontSize === f ? styles.themeCardActive : ""}`}
              onClick={() => setFontSize(f)}
            >
              <span className={styles.themeCardLabel}>{t(f)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("compactMode")}</h2>
        <p className={styles.sectionHint}>Reduce spacing for denser layout</p>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={compactMode}
            onChange={(e) => setCompactMode(e.target.checked)}
          />
          <span>{compactMode ? "Enabled" : "Disabled"}</span>
        </label>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("confirmBeforeExport")}</h2>
        <p className={styles.sectionHint}>Show confirmation dialog before writing to Excel</p>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={confirmBeforeExport}
            onChange={(e) => setConfirmBeforeExport(e.target.checked)}
          />
          <span>{confirmBeforeExport ? "Enabled" : "Disabled"}</span>
        </label>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("openDataFolder")}</h2>
        <p className={styles.sectionHint}>Database, learned mappings, and cache are stored here</p>
        <button type="button" className={styles.newBtn} onClick={handleOpenDataFolder}>
          {t("openDataFolder")}
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("clearLearnedMappings")}</h2>
        <p className={styles.sectionHint}>
          Clears cached column-to-field mappings. Mapping will be re-learned on next export.
        </p>
        <button
          type="button"
          className={`${styles.newBtn} ${styles.danger}`}
          onClick={handleClearLearnedMappings}
        >
          {t("clearLearnedMappings")}
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("appVersion")}</h2>
        <p className={styles.sectionHint}>{appVersion || "…"}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t("azureStatus")}</h2>
        <p className={styles.sectionHint}>
          {azureStatus === "configured" ? t("configured") : t("notConfigured")}
        </p>
      </section>
    </div>
  );
}
