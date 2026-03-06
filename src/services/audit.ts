import { getSupabaseEnv } from "@/services/supabaseClient";

export type AuditEventType =
  | "login_success"
  | "login_failed"
  | "employee_pin_success"
  | "employee_pin_failed"
  | "scan_completed"
  | "rate_limit_hit";

export async function logAuditEvent(params: {
  eventType: AuditEventType;
  accessToken?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const env = getSupabaseEnv();
  if (!env) return;

  try {
    await fetch(`${env.url}/functions/v1/audit_event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(params.accessToken ? { Authorization: `Bearer ${params.accessToken}` } : {}),
      },
      body: JSON.stringify({
        event_type: params.eventType,
        metadata: params.metadata ?? null,
      }),
    });
  } catch {
    // Non-blocking by design; audit failures must not break UX.
  }
}

