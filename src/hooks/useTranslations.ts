import { useApp } from "@/context/AppContext";
import { FIELD_LABELS, FIELD_LABELS_MK, GROUP_LABELS, GROUP_LABELS_MK } from "@/shared/constants";
import type { FieldKey } from "@/shared/constants";

type GroupKey = keyof typeof GROUP_LABELS;

const UI_EN: Record<string, string> = {
  settings: "Settings",
  theme: "Theme",
  design: "Design",
  language: "Language",
  defaultDocumentType: "Default document type",
  openDataFolder: "Open data folder",
  confidenceThreshold: "Confidence threshold",
  dateFormat: "Date format",
  defaultFolder: "Default folder",
  defaultFolderAll: "All (no default)",
  historyPageSize: "Items per page",
  defaultProfile: "Default Excel profile",
  confirmBeforeExport: "Confirm before export",
  fontSize: "Font size",
  compactMode: "Compact mode",
  clearLearnedMappings: "Clear learned mappings",
  clearLearnedMappingsConfirm: "Are you sure? This removes all learned column mappings.",
  appVersion: "Version",
  azureStatus: "Azure status",
  macedonian: "Macedonian",
  english: "English",
  none: "None",
  configured: "Configured",
  notConfigured: "Not configured",
  checkConnection: "Check connection",
  small: "Small",
  medium: "Medium",
  large: "Large",
};

const UI_MK: Record<string, string> = {
  settings: "Поставки",
  theme: "Тема",
  design: "Дизајн",
  language: "Јазик",
  defaultDocumentType: "Стандарден тип на документ",
  openDataFolder: "Отвори папка со податоци",
  confidenceThreshold: "Праг на доверба",
  dateFormat: "Формат на дата",
  defaultFolder: "Стандардна папка",
  defaultFolderAll: "Сите (нема стандардна)",
  historyPageSize: "Ставки по страница",
  defaultProfile: "Стандарден Excel профил",
  confirmBeforeExport: "Потврди пред извоз",
  fontSize: "Големина на фонт",
  compactMode: "Компактен режим",
  clearLearnedMappings: "Избриши научени мапирања",
  clearLearnedMappingsConfirm: "Дали сте сигурни? Ќе се отстранат сите научени мапирања.",
  appVersion: "Верзија",
  azureStatus: "Azure статус",
  macedonian: "Македонски",
  english: "Англиски",
  none: "Нема",
  configured: "Конфигурирано",
  notConfigured: "Не е конфигурирано",
  checkConnection: "Провери врска",
  small: "Мал",
  medium: "Среден",
  large: "Голем",
};

export function useTranslations() {
  const { language } = useApp();
  const isMk = language === "mk";

  const t = (key: string): string => {
    const dict = isMk ? UI_MK : UI_EN;
    return dict[key] ?? key;
  };

  const getFieldLabel = (key: FieldKey): string => {
    return isMk ? FIELD_LABELS_MK[key] : FIELD_LABELS[key];
  };

  const getGroupLabel = (key: GroupKey): string => {
    return isMk ? GROUP_LABELS_MK[key] : GROUP_LABELS[key];
  };

  return { t, getFieldLabel, getGroupLabel, language, isMk };
}
