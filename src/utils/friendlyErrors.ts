/**
 * Map technical error messages to user-friendly, plain-language messages.
 * Used so the UI never shows raw error objects or stack traces.
 */
export function toFriendlyScanError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("bad request")) return "The document could not be processed. Try a different file or format.";
  if (m.includes("rate limit") || m.includes("429")) return "Too many requests. Please try again in a few minutes.";
  if (m.includes("timeout") || m.includes("timed out")) return "The request took too long. Check your connection and try again.";
  if (m.includes("network") || m.includes("fetch") || m.includes("connection")) return "Network error. Check your internet connection and try again.";
  if (m.includes("not set") || m.includes("configured")) return "Scanning is not configured. Please contact support.";
  if (m.includes("file not found")) return "File not found. It may have been moved or deleted.";
  if (m.includes("invalid") && m.includes("request")) return "The file format may not be supported.";
  return msg;
}
