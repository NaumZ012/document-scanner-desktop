import React, { createContext, useState, useCallback, useEffect } from "react";
import type { OcrResult, InvoiceData, FailedScan } from "@/shared/types";
import type { ExtractedField } from "@/shared/types";
import type { DocumentType } from "@/shared/types";

export type Screen =
  | "auth"
  | "employee"
  | "home"
  | "review"
  | "history"
  | "settings"
  | "batchReview"
  | "profile"
  | "admin";

/** Current user of this app session: owner (skip) or selected employee. */
export interface CurrentSessionUser {
  id: string | null;
  name: string;
}

/** Current app_sessions.id for the active session (created on employee screen; null until then). */
export type CurrentAppSessionId = string | null;

interface ReviewState {
  filePath: string;
  fileName: string;
  ocrResult: OcrResult;
  documentType: string;
  fields: ExtractedField[];
  historyId: number | null;
  /** True when opened from History (data-only view, no PDF/zoom, CRUD here) */
  fromHistory?: boolean;
  /** Stored status for history record (used when saving from history review) */
  status?: string;
  /** When opened from History: original created_at timestamp for this record */
  historyCreatedAt?: string;
  /** Hint that Azure detected multiple logical documents inside this file. */
  maybeMultipleDocuments?: boolean;
}

export type Language = "mk" | "en";

interface AppContextValue {
  screen: Screen;
  setScreen: (s: Screen) => void;
  review: ReviewState | null;
  setReview: (r: ReviewState | null) => void;
  batchInvoices: InvoiceData[] | null;
  setBatchInvoices: React.Dispatch<React.SetStateAction<InvoiceData[] | null>>;
  batchFailures: FailedScan[] | null;
  setBatchFailures: React.Dispatch<React.SetStateAction<FailedScan[] | null>>;
  theme: "light" | "dark" | "system";
  setTheme: (t: "light" | "dark" | "system") => void;
  design: DesignVariant;
  setDesign: (d: DesignVariant) => void;
  language: Language;
  setLanguage: (l: Language) => void;
  defaultDocumentType: DocumentType;
  setDefaultDocumentType: (t: DocumentType) => void;
  confidenceThreshold: number;
  setConfidenceThreshold: (v: number) => void;
  dateFormat: "DMY" | "YMD";
  setDateFormat: (f: "DMY" | "YMD") => void;
  defaultFolderId: number | null;
  setDefaultFolderId: (id: number | null) => void;
  historyPageSize: number;
  setHistoryPageSize: (n: number) => void;
  confirmBeforeExport: boolean;
  setConfirmBeforeExport: (v: boolean) => void;
  fontSize: "small" | "medium" | "large";
  setFontSize: (f: "small" | "medium" | "large") => void;
  compactMode: boolean;
  setCompactMode: (v: boolean) => void;
  /** Who is using the app this session: owner or employee. */
  currentSessionUser: CurrentSessionUser | null;
  setCurrentSessionUser: (u: CurrentSessionUser | null) => void;
  currentAppSessionId: CurrentAppSessionId;
  setCurrentAppSessionId: (id: CurrentAppSessionId) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

const THEME_KEY = "document-scanner-theme";
const DESIGN_KEY = "document-scanner-design";
const LANGUAGE_KEY = "document-scanner-language";
const DEFAULT_DOC_TYPE_KEY = "document-scanner-default-doc-type";
const CONFIDENCE_THRESHOLD_KEY = "document-scanner-confidence-threshold";
const DATE_FORMAT_KEY = "document-scanner-date-format";
const DEFAULT_FOLDER_KEY = "document-scanner-default-folder";
const HISTORY_PAGE_SIZE_KEY = "document-scanner-history-page-size";
const CONFIRM_BEFORE_EXPORT_KEY = "document-scanner-confirm-before-export";
const FONT_SIZE_KEY = "document-scanner-font-size";
const COMPACT_MODE_KEY = "document-scanner-compact-mode";
const CURRENT_SESSION_USER_KEY = "document-scanner-current-session-user";
const CURRENT_APP_SESSION_ID_KEY = "document-scanner-current-app-session-id";

function loadCurrentSessionUser(): CurrentSessionUser | null {
  try {
    const raw = sessionStorage.getItem(CURRENT_SESSION_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CurrentSessionUser;
    if (parsed && typeof parsed.name === "string") return parsed;
  } catch {}
  return null;
}

function loadCurrentAppSessionId(): CurrentAppSessionId {
  try {
    const raw = sessionStorage.getItem(CURRENT_APP_SESSION_ID_KEY);
    if (!raw) return null;
    return raw;
  } catch {}
  return null;
}

export type ThemePreference = "light" | "dark" | "system";
export type DesignVariant = "default" | "warm" | "cool" | "oled" | "purple";

function loadTheme(): ThemePreference {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "dark" || t === "light" || t === "system") return t;
  } catch {}
  return "system";
}

function loadDesign(): DesignVariant {
  try {
    const d = localStorage.getItem(DESIGN_KEY);
    if (d === "default" || d === "warm" || d === "cool" || d === "oled" || d === "purple") return d;
  } catch {}
  return "cool";
}

function loadLanguage(): Language {
  try {
    const l = localStorage.getItem(LANGUAGE_KEY);
    if (l === "mk" || l === "en") return l;
  } catch {}
  return "mk";
}

function loadDefaultDocumentType(): DocumentType {
  try {
    const t = localStorage.getItem(DEFAULT_DOC_TYPE_KEY);
    if (t === "faktura" || t === "plata" || t === "smetka" || t === "generic") return t;
  } catch {}
  return "faktura";
}

function loadConfidenceThreshold(): number {
  try {
    const v = localStorage.getItem(CONFIDENCE_THRESHOLD_KEY);
    if (v != null) {
      const n = parseFloat(v);
      if (n >= 0 && n <= 1) return n;
    }
  } catch {}
  return 0.8;
}

function loadDateFormat(): "DMY" | "YMD" {
  try {
    const f = localStorage.getItem(DATE_FORMAT_KEY);
    if (f === "DMY" || f === "YMD") return f;
  } catch {}
  return "DMY";
}

function loadDefaultFolderId(): number | null {
  try {
    const v = localStorage.getItem(DEFAULT_FOLDER_KEY);
    if (v != null && v !== "null") {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n > 0) return n;
    }
  } catch {}
  return null;
}

function loadHistoryPageSize(): number {
  try {
    const v = localStorage.getItem(HISTORY_PAGE_SIZE_KEY);
    if (v != null) {
      const n = parseInt(v, 10);
      if ([25, 50, 100].includes(n)) return n;
    }
  } catch {}
  return 25;
}

function loadConfirmBeforeExport(): boolean {
  try {
    const v = localStorage.getItem(CONFIRM_BEFORE_EXPORT_KEY);
    if (v === "false") return false;
    if (v === "true") return true;
  } catch {}
  return true;
}

function loadFontSize(): "small" | "medium" | "large" {
  try {
    const v = localStorage.getItem(FONT_SIZE_KEY);
    if (v === "small" || v === "medium" || v === "large") return v;
  } catch {}
  return "medium";
}

function loadCompactMode(): boolean {
  try {
    const v = localStorage.getItem(COMPACT_MODE_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {}
  return false;
}

function getResolvedTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [screen, setScreen] = useState<Screen>("auth");
  const [review, setReview] = useState<ReviewState | null>(null);
  const [batchInvoices, setBatchInvoices] = useState<InvoiceData[] | null>(null);
  const [batchFailures, setBatchFailures] = useState<FailedScan[] | null>(null);
  const [theme, setThemeState] = useState<ThemePreference>(loadTheme);

  const setTheme = useCallback((t: ThemePreference) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  }, []);

  const [design, setDesignState] = useState<DesignVariant>(loadDesign);

  const setDesign = useCallback((d: DesignVariant) => {
    setDesignState(d);
    try {
      localStorage.setItem(DESIGN_KEY, d);
    } catch {}
  }, []);

  const [language, setLanguageState] = useState<Language>(loadLanguage);
  const setLanguage = useCallback((l: Language) => {
    setLanguageState(l);
    try {
      localStorage.setItem(LANGUAGE_KEY, l);
    } catch {}
  }, []);

  const [defaultDocumentType, setDefaultDocTypeState] = useState<DocumentType>(loadDefaultDocumentType);
  const setDefaultDocumentType = useCallback((t: DocumentType) => {
    setDefaultDocTypeState(t);
    try {
      localStorage.setItem(DEFAULT_DOC_TYPE_KEY, t);
    } catch {}
  }, []);

  const [confidenceThreshold, setConfidenceThresholdState] = useState<number>(loadConfidenceThreshold);
  const setConfidenceThreshold = useCallback((v: number) => {
    setConfidenceThresholdState(v);
    try {
      localStorage.setItem(CONFIDENCE_THRESHOLD_KEY, String(v));
    } catch {}
  }, []);

  const [dateFormat, setDateFormatState] = useState<"DMY" | "YMD">(loadDateFormat);
  const setDateFormat = useCallback((f: "DMY" | "YMD") => {
    setDateFormatState(f);
    try {
      localStorage.setItem(DATE_FORMAT_KEY, f);
    } catch {}
  }, []);

  const [defaultFolderId, setDefaultFolderIdState] = useState<number | null>(loadDefaultFolderId);
  const setDefaultFolderId = useCallback((id: number | null) => {
    setDefaultFolderIdState(id);
    try {
      localStorage.setItem(DEFAULT_FOLDER_KEY, id == null ? "null" : String(id));
    } catch {}
  }, []);

  const [historyPageSize, setHistoryPageSizeState] = useState<number>(loadHistoryPageSize);
  const setHistoryPageSize = useCallback((n: number) => {
    setHistoryPageSizeState(n);
    try {
      localStorage.setItem(HISTORY_PAGE_SIZE_KEY, String(n));
    } catch {}
  }, []);

  const [confirmBeforeExport, setConfirmBeforeExportState] = useState<boolean>(loadConfirmBeforeExport);
  const setConfirmBeforeExport = useCallback((v: boolean) => {
    setConfirmBeforeExportState(v);
    try {
      localStorage.setItem(CONFIRM_BEFORE_EXPORT_KEY, String(v));
    } catch {}
  }, []);

  const [fontSize, setFontSizeState] = useState<"small" | "medium" | "large">(loadFontSize);
  const setFontSize = useCallback((f: "small" | "medium" | "large") => {
    setFontSizeState(f);
    try {
      localStorage.setItem(FONT_SIZE_KEY, f);
    } catch {}
  }, []);

  const [compactMode, setCompactModeState] = useState<boolean>(loadCompactMode);
  const setCompactMode = useCallback((v: boolean) => {
    setCompactModeState(v);
    try {
      localStorage.setItem(COMPACT_MODE_KEY, String(v));
    } catch {}
  }, []);

  const [currentSessionUser, setCurrentSessionUserState] = useState<CurrentSessionUser | null>(loadCurrentSessionUser);
  const setCurrentSessionUser = useCallback((u: CurrentSessionUser | null) => {
    setCurrentSessionUserState(u);
    try {
      if (u) sessionStorage.setItem(CURRENT_SESSION_USER_KEY, JSON.stringify(u));
      else sessionStorage.removeItem(CURRENT_SESSION_USER_KEY);
    } catch {}
  }, []);

  const [currentAppSessionId, setCurrentAppSessionIdState] = useState<CurrentAppSessionId>(loadCurrentAppSessionId);
  const setCurrentAppSessionId = useCallback((id: CurrentAppSessionId) => {
    setCurrentAppSessionIdState(id);
    try {
      if (id) sessionStorage.setItem(CURRENT_APP_SESSION_ID_KEY, id);
      else sessionStorage.removeItem(CURRENT_APP_SESSION_ID_KEY);
    } catch {}
  }, []);

  useEffect(() => {
    const scale = fontSize === "small" ? 0.9 : fontSize === "large" ? 1.1 : 1;
    document.documentElement.style.setProperty("--font-scale", String(scale));
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.classList.toggle("compact-mode", compactMode);
  }, [compactMode]);

  useEffect(() => {
    const resolved = getResolvedTheme(theme);
    const validDesign = resolved === "light" && design === "oled" ? "default" : design;
    const attr = validDesign === "default" ? resolved : `${resolved}-${validDesign}`;
    document.documentElement.setAttribute("data-theme", attr);
  }, [theme, design]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const handler = () => {
      const resolved = mq.matches ? "dark" : "light";
      const validDesign = resolved === "light" && design === "oled" ? "default" : design;
      const attr = validDesign === "default" ? resolved : `${resolved}-${validDesign}`;
      document.documentElement.setAttribute("data-theme", attr);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, design]);

  return (
    <AppContext.Provider
      value={{
        screen,
        setScreen,
        review,
        setReview,
        batchInvoices,
        setBatchInvoices,
        batchFailures,
        setBatchFailures,
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
        confirmBeforeExport,
        setConfirmBeforeExport,
        fontSize,
        setFontSize,
        compactMode,
        setCompactMode,
        currentSessionUser,
        setCurrentSessionUser,
        currentAppSessionId,
        setCurrentAppSessionId,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
