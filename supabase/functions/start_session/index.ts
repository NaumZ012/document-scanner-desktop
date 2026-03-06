import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type StartSessionMode = "skip" | "existing" | "new";

type StartSessionRequest = {
  mode: StartSessionMode;
  employee_id?: string | null;
  name?: string | null;
  pin?: string | null;
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
  if (!url || !anonKey) return text(500, "Server not configured");

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return text(401, "Unauthorized");

  let body: StartSessionRequest;
  try {
    body = (await req.json()) as StartSessionRequest;
  } catch {
    return text(400, "Invalid JSON");
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return text(401, "Unauthorized");
  const ownerId = userData.user.id;

  const ip = getIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  const mode = body?.mode;
  if (mode !== "skip" && mode !== "existing" && mode !== "new") {
    return text(400, "Invalid mode");
  }

  let employeeId: string | null = null;
  let employeeName: string | null = null;

  if (mode === "skip") {
    employeeId = null;
    employeeName = null;
  } else if (mode === "new") {
    const name = String(body?.name ?? "").trim();
    const pin = String(body?.pin ?? "").trim();
    if (!name || !pin) return text(400, "Name and PIN are required");

    const { data, error } = await supabase.rpc("create_employee", {
      p_name: name,
      p_pin: pin,
    });
    if (error || !data) return text(500, "Failed to create employee");

    employeeId = String(data);
    employeeName = name;
  } else {
    const empId = String(body?.employee_id ?? "").trim();
    const pin = String(body?.pin ?? "").trim();
    if (!empId || !pin) return text(400, "Employee and PIN are required");

    const { data: ok, error } = await supabase.rpc("verify_employee_pin", {
      p_employee_id: empId,
      p_pin: pin,
    });

    if (error) return text(500, "PIN verification failed");

    if (!ok) {
      // Audit failed attempt
      await supabase.from("audit_log").insert({
        owner_id: ownerId,
        event_type: "employee_pin_failed",
        ip_address: ip,
        user_agent: userAgent,
        metadata: { employee_id: empId },
      });
      return text(401, "Incorrect PIN");
    }

    // Load employee name (never pin_hash)
    const { data: empRow } = await supabase
      .from("employees")
      .select("id,name")
      .eq("id", empId)
      .eq("owner_id", ownerId)
      .single();

    employeeId = empRow?.id ?? empId;
    employeeName = empRow?.name ?? null;

    await supabase.from("audit_log").insert({
      owner_id: ownerId,
      event_type: "employee_pin_success",
      ip_address: ip,
      user_agent: userAgent,
      metadata: { employee_id: employeeId },
    });
  }

  const { data: sessionRow, error: sessionErr } = await supabase
    .from("app_sessions")
    .insert({
      owner_id: ownerId,
      employee_id: employeeId,
    })
    .select("id")
    .single();

  if (sessionErr || !sessionRow?.id) return text(500, "Failed to create session");

  const resp: {
    app_session_id: string;
    employee: { id: string; name: string } | null;
  } = {
    app_session_id: sessionRow.id as string,
    employee: employeeId ? { id: employeeId, name: employeeName ?? "Employee" } : null,
  };

  return json(200, resp);
});

