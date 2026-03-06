import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function getIpAddress(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff && xff.trim()) return xff.split(",")[0]!.trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) return realIp.trim();
  return null;
}

function pickAnalyzerId(documentType: string | null): string {
  // Mirror Rust behavior: only use custom analyzers when explicit document type is provided.
  const dt = (documentType ?? "").trim();
  if (dt === "faktura") return Deno.env.get("AZURE_CU_ANALYZER_FAKTURA") ?? "prebuilt-invoice";
  if (dt === "smetka") return Deno.env.get("AZURE_CU_ANALYZER_SMETKA") ?? "prebuilt-document";
  if (dt === "generic") return Deno.env.get("AZURE_CU_ANALYZER_GENERIC") ?? "prebuilt-document";
  if (dt === "plata") return Deno.env.get("AZURE_CU_ANALYZER_PLATA") ?? "prebuilt-document";
  return "prebuilt-document";
}

function parseRateLimitResult(data: unknown): boolean {
  // Treat: true => allowed, false => limited.
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
  // Default to allowed if schema is unknown; DB function should be authoritative.
  return true;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const azureKey = Deno.env.get("AZURE_OCR_KEY");
  const azureEndpoint = Deno.env.get("AZURE_OCR_ENDPOINT")?.replace(/\/$/, "");
  if (!supabaseUrl || !supabaseAnonKey || !azureKey || !azureEndpoint) {
    return new Response("Server not configured", { status: 500 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await supabase.auth.getUser();
  const ownerId = userData.user?.id ?? null;
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const employeeId = (req.headers.get("x-employee-id") ?? "").trim() || null;
  const appSessionId = (req.headers.get("x-app-session-id") ?? "").trim() || null;
  const fileName = (req.headers.get("x-file-name") ?? "").trim() || null;
  const pagesHeader = (req.headers.get("x-pages") ?? "").trim();
  const pages = pagesHeader ? Number.parseInt(pagesHeader, 10) : null;
  const documentType = (req.headers.get("x-document-type") ?? "").trim() || null;

  const ip = getIpAddress(req);
  const userAgent = req.headers.get("user-agent");

  // Rate limit check (DB RPC)
  const { data: rlData, error: rlErr } = await supabase.rpc("check_rate_limit");
  if (rlErr) return new Response("Rate limit check failed", { status: 500 });
  const allowed = parseRateLimitResult(rlData);
  if (!allowed) {
    await supabase.from("api_calls").insert({
      owner_id: ownerId,
      employee_id: employeeId,
      endpoint: "ocr_invoice",
      status_code: 429,
      file_name: fileName,
      pages,
    });
    await supabase.from("audit_log").insert({
      owner_id: ownerId,
      event_type: "rate_limit_hit",
      ip_address: ip,
      user_agent: userAgent,
      metadata: { file_name: fileName, pages, employee_id: employeeId, app_session_id: appSessionId },
    });
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const analyzerId = pickAnalyzerId(documentType);
  const analyzeUrl = `${azureEndpoint}/contentunderstanding/analyzers/${encodeURIComponent(analyzerId)}:analyzeBinary?api-version=2025-11-01`;
  const contentType = req.headers.get("Content-Type") ?? "application/octet-stream";

  const bytes = new Uint8Array(await req.arrayBuffer());

  const analyzeResp = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": azureKey,
      "Content-Type": contentType,
    },
    body: bytes,
  });

  if (!analyzeResp.ok) {
    const text = await analyzeResp.text().catch(() => "");
    await supabase.from("api_calls").insert({
      owner_id: ownerId,
      employee_id: employeeId,
      endpoint: "ocr_invoice",
      status_code: analyzeResp.status,
      file_name: fileName,
      pages,
    });
    return new Response(text || "Azure OCR failed", { status: analyzeResp.status });
  }

  const opLoc = analyzeResp.headers.get("Operation-Location");
  if (!opLoc) {
    await supabase.from("api_calls").insert({
      owner_id: ownerId,
      employee_id: employeeId,
      endpoint: "ocr_invoice",
      status_code: 502,
      file_name: fileName,
      pages,
    });
    return new Response("No Operation-Location from Azure", { status: 502 });
  }

  // Poll (max ~120s)
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const pollResp = await fetch(opLoc, {
      headers: { "Ocp-Apim-Subscription-Key": azureKey },
    });
    const pollJson = await pollResp.json().catch(() => null);
    const status = (pollJson && typeof pollJson === "object" && (pollJson as any).status) ? String((pollJson as any).status) : "";

    if (status.toLowerCase() === "succeeded") {
      await supabase.from("api_calls").insert({
        owner_id: ownerId,
        employee_id: employeeId,
        endpoint: "ocr_invoice",
        status_code: 200,
        file_name: fileName,
        pages,
      });
      await supabase.from("audit_log").insert({
        owner_id: ownerId,
        event_type: "scan_completed",
        ip_address: ip,
        user_agent: userAgent,
        metadata: { file_name: fileName, pages, employee_id: employeeId, app_session_id: appSessionId },
      });
      return new Response(JSON.stringify(pollJson), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (status.toLowerCase() === "failed") {
      await supabase.from("api_calls").insert({
        owner_id: ownerId,
        employee_id: employeeId,
        endpoint: "ocr_invoice",
        status_code: 502,
        file_name: fileName,
        pages,
      });
      return new Response(JSON.stringify(pollJson ?? { error: "azure_failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  await supabase.from("api_calls").insert({
    owner_id: ownerId,
    employee_id: employeeId,
    endpoint: "ocr_invoice",
    status_code: 504,
    file_name: fileName,
    pages,
  });
  return new Response(JSON.stringify({ error: "timeout" }), {
    status: 504,
    headers: { "Content-Type": "application/json" },
  });
});

