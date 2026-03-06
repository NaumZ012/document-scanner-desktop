import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getSupabaseClient } from "@/services/supabaseClient";
import styles from "./Admin.module.css";

type Tab = "api_calls" | "audit_log";

type ApiCallRow = {
  id: string;
  owner_id: string;
  employee_id: string | null;
  endpoint: string;
  status_code: number | null;
  file_name: string | null;
  pages: number | null;
  called_at: string | null;
};

type AuditLogRow = {
  id: string;
  owner_id: string | null;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

function formatIso(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { hour12: false });
  } catch {
    return iso;
  }
}

export function AdminPage() {
  const { user, profile } = useAuth();
  const supabase = getSupabaseClient();
  const isAdmin = profile?.role === "admin";

  const [tab, setTab] = useState<Tab>("api_calls");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiCalls, setApiCalls] = useState<ApiCallRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([]);

  const title = useMemo(() => (tab === "api_calls" ? "API calls" : "Audit log"), [tab]);

  useEffect(() => {
    if (!user || !supabase) return;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (tab === "api_calls") {
          let q = supabase.from("api_calls").select("*").order("called_at", { ascending: false }).limit(200);
          if (!isAdmin) q = q.eq("owner_id", user.id);
          const { data, error } = await q;
          if (error) {
            setError(error.message);
            setApiCalls([]);
            return;
          }
          setApiCalls((Array.isArray(data) ? (data as any[]) : []) as ApiCallRow[]);
        } else {
          let q = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
          if (!isAdmin) q = q.eq("owner_id", user.id);
          const { data, error } = await q;
          if (error) {
            setError(error.message);
            setAuditLog([]);
            return;
          }
          setAuditLog((Array.isArray(data) ? (data as any[]) : []) as AuditLogRow[]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load admin data.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [tab, user, supabase, isAdmin]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin</h1>
          <p className={styles.subtitle}>
            {loading ? "Loading…" : isAdmin ? "Viewing all workspaces (admin role)." : "Viewing your workspace only."} · {title}
          </p>
        </div>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tabBtn} ${tab === "api_calls" ? styles.tabBtnActive : ""}`}
            onClick={() => setTab("api_calls")}
          >
            API calls
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${tab === "audit_log" ? styles.tabBtnActive : ""}`}
            onClick={() => setTab("audit_log")}
          >
            Audit log
          </button>
        </div>
      </div>

      <div className={styles.panel}>
        {error && <div className={styles.error}>{error}</div>}
        {!error && tab === "api_calls" && apiCalls.length === 0 && !loading && <div className={styles.empty}>No rows.</div>}
        {!error && tab === "audit_log" && auditLog.length === 0 && !loading && <div className={styles.empty}>No rows.</div>}

        {!error && tab === "api_calls" && apiCalls.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>When</th>
                <th className={styles.th}>Owner</th>
                <th className={styles.th}>Employee</th>
                <th className={styles.th}>Endpoint</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>File</th>
                <th className={styles.th}>Pages</th>
              </tr>
            </thead>
            <tbody>
              {apiCalls.map((r) => (
                <tr key={r.id}>
                  <td className={styles.td}>{formatIso(r.called_at)}</td>
                  <td className={`${styles.td} ${styles.mono}`}>{r.owner_id.slice(0, 8)}</td>
                  <td className={`${styles.td} ${styles.mono}`}>{r.employee_id ? r.employee_id.slice(0, 8) : "—"}</td>
                  <td className={styles.td}>{r.endpoint}</td>
                  <td className={styles.td}>{r.status_code ?? "—"}</td>
                  <td className={styles.td}>{r.file_name ?? "—"}</td>
                  <td className={styles.td}>{r.pages ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!error && tab === "audit_log" && auditLog.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>When</th>
                <th className={styles.th}>Owner</th>
                <th className={styles.th}>Event</th>
                <th className={styles.th}>IP</th>
                <th className={styles.th}>User agent</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.map((r) => (
                <tr key={r.id}>
                  <td className={styles.td}>{formatIso(r.created_at)}</td>
                  <td className={`${styles.td} ${styles.mono}`}>{r.owner_id ? r.owner_id.slice(0, 8) : "—"}</td>
                  <td className={styles.td}>{r.event_type}</td>
                  <td className={`${styles.td} ${styles.mono}`}>{r.ip_address ?? "—"}</td>
                  <td className={styles.td}>{r.user_agent ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

