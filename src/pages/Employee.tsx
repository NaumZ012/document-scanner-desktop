import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { getSupabaseClient, getSupabaseEnv } from "@/services/supabaseClient";
import styles from "./Auth.module.css";

interface EmployeeRow {
  id: string;
  name: string;
}

export function EmployeePage() {
  const { user, session } = useAuth();
  const { setScreen, setCurrentSessionUser, setCurrentAppSessionId } = useApp();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | "new" | "skip">("skip");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !user) {
      setEmployees([]);
      setLoadingList(false);
      return;
    }

    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("employees")
          .select("*")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false });
        if (!active) return;
        if (error) {
          setEmployees([]);
        } else {
          const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; name: string }>;
          setEmployees(rows.map((r) => ({ id: r.id, name: r.name })));
        }
      } finally {
        if (active) setLoadingList(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user, session]);

  const handleContinue = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!user || !session?.access_token) {
        setError("Not authenticated.");
        return;
      }
      const env = getSupabaseEnv();
      if (!env) {
        setError("Supabase is not configured.");
        return;
      }

      const mode =
        selectedEmployeeId === "skip" ? "skip" : selectedEmployeeId === "new" ? "new" : "existing";
      if (mode === "new" && (!name.trim() || !pin.trim())) {
        setError("Name and PIN are required.");
        return;
      }
      if (mode === "existing" && !pin.trim()) {
        setError("PIN is required.");
        return;
      }

      const res = await fetch(`${env.url}/functions/v1/start_session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          mode,
          employee_id: mode === "existing" ? selectedEmployeeId : null,
          name: mode === "new" ? name.trim() : null,
          pin: mode === "new" || mode === "existing" ? pin : null,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        setError(msg || "Could not start session.");
        return;
      }

      const data = (await res.json()) as {
        app_session_id: string;
        employee: { id: string; name: string } | null;
      };

      setCurrentAppSessionId(data.app_session_id);
      if (data.employee) {
        setCurrentSessionUser({ id: data.employee.id, name: data.employee.name });
      } else {
        setCurrentSessionUser({ id: null, name: "Owner" });
      }
      setScreen("home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error while selecting employee. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.authRoot}>
      <div className={styles.shell}>
        <div className={styles.visual}>
          <div className={styles.visualInner}>
            <div className={styles.brandMark}>Workspace context</div>
            <p className={styles.brandTagline}>Pick who&apos;s using the app so sessions, devices, and exports stay organized.</p>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.card}>
            <header className={styles.header}>
              <h1 className={styles.title}>Who is using the app?</h1>
              <p className={styles.subtitle}>
                Choose an employee profile for this session, or skip to use the owner account only.
              </p>
            </header>

            <div className={styles.form}>
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="employee-select">
                    Employee
                  </label>
                  {loadingList && (
                    <span className={styles.hint}>Loading…</span>
                  )}
                </div>
                <div className={styles.inputRow}>
                  <div className={styles.employeeOptions}>
                    <button
                      type="button"
                      id="employee-select"
                      className={`${styles.optionButton} ${
                        selectedEmployeeId === "skip" ? styles.optionButtonActive : ""
                      }`}
                      onClick={() => {
                        setSelectedEmployeeId("skip");
                        setPin("");
                        setName("");
                        setError(null);
                        setShowPin(false);
                      }}
                    >
                      Skip (use owner only)
                    </button>
                    {employees.map((emp) => (
                      <button
                        key={emp.id}
                        type="button"
                        className={`${styles.optionButton} ${
                          selectedEmployeeId === emp.id ? styles.optionButtonActive : ""
                        }`}
                        onClick={() => {
                          setSelectedEmployeeId(emp.id);
                          setPin("");
                          setName("");
                          setError(null);
                          setShowPin(false);
                        }}
                      >
                        {emp.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`${styles.optionButton} ${
                        selectedEmployeeId === "new" ? styles.optionButtonActive : ""
                      }`}
                      onClick={() => {
                        setSelectedEmployeeId("new");
                        setPin("");
                        setName("");
                        setError(null);
                        setShowPin(false);
                      }}
                    >
                      Create new employee…
                    </button>
                  </div>
                </div>
              </div>

              {selectedEmployeeId === "new" && (
                <>
                  <div className={styles.field}>
                    <div className={styles.labelRow}>
                      <label className={styles.label} htmlFor="name">
                        Employee name
                      </label>
                    </div>
                    <div className={styles.inputRow}>
                      <input
                        id="name"
                        className={styles.input}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                      />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.labelRow}>
                      <label className={styles.label} htmlFor="pin">
                        PIN
                      </label>
                    </div>
                    <div className={styles.inputRow}>
                      <input
                        id="pin"
                        className={styles.input}
                        type={showPin ? "text" : "password"}
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className={styles.passwordToggle}
                        onClick={() => setShowPin((v) => !v)}
                      >
                        {showPin ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {selectedEmployeeId !== "new" && selectedEmployeeId !== "skip" && (
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label className={styles.label} htmlFor="pinExisting">
                      PIN
                    </label>
                  </div>
                  <div className={styles.inputRow}>
                    <input
                      id="pinExisting"
                      className={styles.input}
                      type={showPin ? "text" : "password"}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowPin((v) => !v)}
                    >
                      {showPin ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              )}

              {error && <div className={styles.error}>{error}</div>}

              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleContinue}
                disabled={loading}
              >
                {loading ? "Please wait…" : "Continue to app"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

