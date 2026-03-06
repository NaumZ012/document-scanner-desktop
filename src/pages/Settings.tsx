import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import type { DesignVariant, ThemePreference } from "@/context/AppContext";
import { useTranslations } from "@/hooks/useTranslations";
import { openAppDataFolder, getFolders } from "@/services/api";
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

export function Settings() {
  const {
    theme,
    setTheme,
    design,
    setDesign,
    language,
    setLanguage,
    defaultFolderId,
    setDefaultFolderId,
    confirmBeforeExport,
    setConfirmBeforeExport,
    compactMode,
    setCompactMode,
  } = useApp();
  const { t } = useTranslations();
  const resolvedTheme = useResolvedTheme(theme);

  const isLight = resolvedTheme === "light";
  const designs = isLight ? LIGHT_DESIGNS : DARK_DESIGNS;

  const [folders, setFolders] = useState<[number, string, string][]>([]);
  useEffect(() => {
    getFolders().then(setFolders).catch(() => setFolders([]));
  }, []);

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
    </div>
  );
}
