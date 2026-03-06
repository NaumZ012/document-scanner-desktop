const DEVICE_ID_KEY = "document-scanner-device-id";

export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "unknown";
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return "unknown";
  }
}

export function getDeviceLabel(): string {
  try {
    const platform = typeof navigator !== "undefined" ? navigator.platform : "";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const label = [platform, ua].filter(Boolean).join(" · ");
    return label || "Unknown device";
  } catch {
    return "Unknown device";
  }
}

