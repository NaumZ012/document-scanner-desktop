import { memo, useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import type { ExtractedField } from "@/shared/types";
import { FIELD_INPUT_TYPE, FIELD_TEXTAREA, ANALYZER_FIELD_INPUT_TYPE } from "@/shared/constants";
import type { FieldKey } from "@/shared/constants";
import { formatAmountForDisplay, normalizeAmountInput } from "@/utils/fieldUtils";
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
  const inputType = FIELD_INPUT_TYPE[field.key as FieldKey] ?? ANALYZER_FIELD_INPUT_TYPE[field.key];
  const useTextarea = FIELD_TEXTAREA.includes(field.key as FieldKey) || field.key === "description";
  const isAmount = inputType === "amount";
  const type =
    inputType === "date" ? "date" : inputType === "amount" ? "text" : "text";
  const placeholder = hasValue ? "" : `${placeholderPrefix} ${field.label.toLowerCase()}`;

  // For amount fields, format for display but store raw value
  const [displayValue, setDisplayValue] = useState<string>("");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      // Only update display value when not focused (to avoid interfering with user typing)
      if (isAmount && field.value) {
        setDisplayValue(formatAmountForDisplay(field.value));
      } else {
        setDisplayValue(field.value);
      }
    }
  }, [field.value, isAmount, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setDisplayValue(newValue);
    if (isAmount) {
      // Normalize formatted value back to canonical "dot decimal, no thousands" for storage.
      const normalized = normalizeAmountInput(newValue);
      onChange(field.key, normalized);
    } else {
      onChange(field.key, newValue);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Re-format on blur to ensure proper formatting
    if (isAmount && field.value) {
      setDisplayValue(formatAmountForDisplay(field.value));
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  return (
    <div className={`${styles.card} ${isLowConfidence ? styles.lowConfidence : ""} ${hasValue ? styles.filled : ""}`}>
      <div className={styles.labelRow}>
        <label className={styles.label}>{field.label}</label>
        <span
          className={field.confidence != null ? `${styles.confidenceBadge} ${isLowConfidence ? styles.confidenceLow : styles.confidenceOk}` : styles.confidenceMissing}
          title="Доверба (од моделот)"
        >
          {field.confidence != null ? `${Math.round(field.confidence * 100)}%` : "—"}
        </span>
      </div>
      {useTextarea ? (
        <textarea
          className={styles.textarea}
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <input
          type={type}
          className={styles.input}
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholder={placeholder}
          inputMode={inputType === "amount" ? "decimal" : undefined}
        />
      )}
    </div>
  );
}

export const DataCard = memo(DataCardInner);
