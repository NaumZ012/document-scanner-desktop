import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { getSupabaseClient } from "@/services/supabaseClient";
import styles from "./Auth.module.css";

interface EmployeeRow {
  id: string;
  name: string;
}

const NETWORK_TIMEOUT_MS = 10000;

function withTimeout<T>(p: PromiseLike<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
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
        // RLS enforces owner_id = auth.uid(); explicit filter for defense in depth.
        const { data, error } = await withTimeout(
          supabase
            .from("employees")
            .select("*")
            .eq("owner_id", user.id)
            .order("created_at", { ascending: false }),
          NETWORK_TIMEOUT_MS,
          "Employee list timed out. Please check your internet connection and try again.",
        );
        if (!active) return;
        if (error) {
          setEmployees([]);
        } else {
          const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; name: string }>;
          setEmployees(rows.map((r) => ({ id: r.id, name: r.name })));
        }
      } catch {
        if (!active) return;
        setEmployees([]);
        setError("Could not load employees. Please check your connection and try again.");
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
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError("Service is not configured. Please try again later.");
        return;
      }
      if (!user || !session?.access_token) {
        setError("Please sign in again and try again.");
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

      const { data, error } = await withTimeout(
        supabase.functions.invoke("start_session", {
          body: {
            mode,
            employee_id: mode === "existing" ? selectedEmployeeId : null,
            name: mode === "new" ? name.trim() : null,
            pin: mode === "new" || mode === "existing" ? pin : null,
          },
        }),
        NETWORK_TIMEOUT_MS,
        "Starting session timed out. Please check your internet connection and try again.",
      );

      if (error) {
        setError("Could not start session. Please check your PIN and try again.");
        return;
      }

      const payload = data as {
        app_session_id?: string;
        employee?: { id: string; name: string } | null;
      } | null;

      if (!payload?.app_session_id) {
        setError("Could not start session.");
        return;
      }

      setCurrentAppSessionId(payload.app_session_id);
      if (payload.employee) {
        setCurrentSessionUser({ id: payload.employee.id, name: payload.employee.name });
      } else {
        setCurrentSessionUser({ id: null, name: "Owner" });
      }
      setScreen("home");
    } catch {
      setError("Something went wrong. Please try again.");
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

