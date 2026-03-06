import { getSupabaseClient } from "@/services/supabaseClient";

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
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    // Use Edge Function invocation (CORS-friendly in Tauri) and keep this non-blocking by design.
    await supabase.functions.invoke("audit_event", {
      headers: params.accessToken ? { Authorization: `Bearer ${params.accessToken}` } : undefined,
      body: {
        event_type: params.eventType,
        metadata: params.metadata ?? null,
      },
    });
  } catch {
    // Non-blocking by design; audit failures must not break UX.
  }
}

