import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AuditEventRequest = {
  event_type: string;
  metadata?: Record<string, unknown> | null;
};

function getIpAddress(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  return null;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return text(405, "Method not allowed");

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return text(500, "Server not configured");
  }

  let payload: AuditEventRequest;
  try {
    payload = (await req.json()) as AuditEventRequest;
  } catch {
    return text(400, "Invalid JSON");
  }

  const eventType = String(payload?.event_type ?? "").trim();
  if (!eventType) return text(400, "Missing event_type");

  const authHeader = req.headers.get("Authorization") ?? "";

  // 1) Resolve owner_id when a valid JWT is provided (uses anon key).
  let ownerId: string | null = null;
  if (authHeader.startsWith("Bearer ")) {
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await authClient.auth.getUser();
    ownerId = data.user?.id ?? null;
  }

  // 2) Insert audit row using service role key so logging never depends on RLS.
  const supabaseAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ip = getIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  const { error } = await supabaseAdmin.from("audit_log").insert({
    owner_id: ownerId,
    event_type: eventType,
    ip_address: ip,
    user_agent: userAgent,
    metadata: payload?.metadata ?? null,
  });

  if (error) {
    // Avoid leaking internal details to clients; caller will show a user-facing message if needed.
    return text(500, "Failed to write audit log");
  }

  return json(200, { ok: true });
});

