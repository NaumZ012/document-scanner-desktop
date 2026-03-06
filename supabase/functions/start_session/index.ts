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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return new Response("Server not configured", { status: 500 });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });

  let body: StartSessionRequest;
  try {
    body = (await req.json()) as StartSessionRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
  const ownerId = userData.user.id;

  const ip = getIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  const mode = body?.mode;
  if (mode !== "skip" && mode !== "existing" && mode !== "new") {
    return new Response("Invalid mode", { status: 400 });
  }

  let employeeId: string | null = null;
  let employeeName: string | null = null;

  if (mode === "skip") {
    employeeId = null;
    employeeName = null;
  } else if (mode === "new") {
    const name = String(body?.name ?? "").trim();
    const pin = String(body?.pin ?? "").trim();
    if (!name || !pin) return new Response("Name and PIN are required", { status: 400 });

    const { data, error } = await supabase.rpc("create_employee", {
      p_name: name,
      p_pin: pin,
    });
    if (error || !data) return new Response("Failed to create employee", { status: 500 });

    employeeId = String(data);
    employeeName = name;
  } else {
    const empId = String(body?.employee_id ?? "").trim();
    const pin = String(body?.pin ?? "").trim();
    if (!empId || !pin) return new Response("Employee and PIN are required", { status: 400 });

    const { data: ok, error } = await supabase.rpc("verify_employee_pin", {
      p_employee_id: empId,
      p_pin: pin,
    });

    if (error) return new Response("PIN verification failed", { status: 500 });

    if (!ok) {
      // Audit failed attempt
      await supabase.from("audit_log").insert({
        owner_id: ownerId,
        event_type: "employee_pin_failed",
        ip_address: ip,
        user_agent: userAgent,
        metadata: { employee_id: empId },
      });
      return new Response("Incorrect PIN", { status: 401 });
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

  if (sessionErr || !sessionRow?.id) return new Response("Failed to create session", { status: 500 });

  const resp = {
    app_session_id: sessionRow.id as string,
    employee: employeeId ? { id: employeeId, name: employeeName ?? "Employee" } : null,
  };

  return new Response(JSON.stringify(resp), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

