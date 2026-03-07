import { getSupabaseClient } from "@/services/supabaseClient";

export type AuditEventType =
  | "login_success"
  | "login_failed"
  | "logout"
  | "employee_pin_success"
  | "employee_pin_failed"
  | "scan_completed"
  | "rate_limit_hit";

/**
 * Log an audit event via the audit_event edge function. Always sends the current session
 * JWT when available so the backend can set owner_id = auth.uid(). Caller can pass
 * accessToken to override (e.g. right after sign-in before context has updated).
 */
export async function logAuditEvent(params: {
  eventType: AuditEventType;
  accessToken?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    let token = params.accessToken;
    if (token == null) {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? undefined;
    }
    await supabase.functions.invoke("audit_event", {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: {
        event_type: params.eventType,
        metadata: params.metadata ?? null,
      },
    });
  } catch {
    // Non-blocking by design; audit failures must not break UX.
  }
}

/**
 * Check if the current user is within rate limits before starting an Azure scan.
 * Call this before invoking OCR. Returns true if allowed, false if rate limited or error.
 */
export async function checkRateLimitBeforeScan(): Promise<{ allowed: boolean; message?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { allowed: true };

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { allowed: true };

    const { data: result, error } = await supabase.functions.invoke("check_rate_limit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (error) return { allowed: true };
    if (result?.ok === false || result?.error === "rate_limited") {
      return { allowed: false, message: "Too many requests. Please try again in a few minutes." };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

