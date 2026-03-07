import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getIpAddress(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  return null;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

function parseRateLimitResult(data: unknown): boolean {
  if (typeof data === "boolean") return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const allowed =
      (typeof obj.allowed === "boolean" && obj.allowed) ||
      (typeof obj.ok === "boolean" && obj.ok) ||
      (typeof obj.is_allowed === "boolean" && obj.is_allowed);
    const limited =
      (typeof obj.allowed === "boolean" && obj.allowed === false) ||
      (typeof obj.ok === "boolean" && obj.ok === false) ||
      (typeof obj.is_allowed === "boolean" && obj.is_allowed === false);
    if (limited) return false;
    if (allowed) return true;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return text(405, "Method not allowed");

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return text(500, "Server not configured");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return text(401, "Unauthorized");

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return text(401, "Unauthorized");
  const ownerId = userData.user.id;

  const { data: rlData, error: rlErr } = await supabase.rpc("check_rate_limit");
  if (rlErr) return text(500, "Rate limit check failed");
  const allowed = parseRateLimitResult(rlData);

  if (!allowed) {
    const ip = getIpAddress(req);
    const userAgent = req.headers.get("user-agent");
    await supabase.from("audit_log").insert({
      owner_id: ownerId,
      event_type: "rate_limit_hit",
      ip_address: ip,
      user_agent: userAgent,
      metadata: { source: "check_rate_limit" },
    });
    return json(429, { ok: false, error: "rate_limited" });
  }

  return json(200, { ok: true });
});
