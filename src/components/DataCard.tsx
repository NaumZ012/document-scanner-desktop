import { memo } from "react";
import { useApp } from "@/context/AppContext";
import type { ExtractedField } from "@/shared/types";
import { FIELD_INPUT_TYPE, FIELD_TEXTAREA } from "@/shared/constants";
import type { FieldKey } from "@/shared/constants";
import styles from "./DataCard.module.css";

interface DataCardProps {
  field: ExtractedField;
  onChange: (key: string, value: string) => void;
  placeholderPrefix?: string; // e.g. "Внеси" for Macedonian
}

function DataCardInner({ field, onChange, placeholderPrefix = "Enter" }: DataCardProps) {
  const { confidenceThreshold } = useApp();
  const isLowConfidence =
    field.confidence != null && field.confidence < confidenceThreshold;
  const hasValue = !!field.value?.trim();
  const inputType = FIELD_INPUT_TYPE[field.key as FieldKey];
  const useTextarea = FIELD_TEXTAREA.includes(field.key as FieldKey);
  const type =
    inputType === "date" ? "date" : inputType === "amount" ? "text" : "text";
  const placeholder = hasValue ? "" : `${placeholderPrefix} ${field.label.toLowerCase()}`;

  return (
    <div className={`${styles.card} ${isLowConfidence ? styles.lowConfidence : ""} ${hasValue ? styles.filled : ""}`}>
      <label className={styles.label}>{field.label}</label>
      {useTextarea ? (
        <textarea
          className={styles.textarea}
          value={field.value}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <input
          type={type}
          className={styles.input}
          value={field.value}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={placeholder}
          inputMode={inputType === "amount" ? "decimal" : undefined}
        />
      )}
    </div>
  );
}

export const DataCard = memo(DataCardInner);
