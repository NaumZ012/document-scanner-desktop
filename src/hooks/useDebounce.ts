import { useEffect, useState } from "react";

/**
 * Return a value that updates only after `delay` ms of no changes.
 * Use for search/filter inputs to avoid firing API on every keystroke.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
