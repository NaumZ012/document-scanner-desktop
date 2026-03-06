import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { logAuditEvent } from "@/services/audit";
import { getSupabaseClient } from "@/services/supabaseClient";
import styles from "./Auth.module.css";

type Mode = "signIn" | "signUp";

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const { setScreen } = useApp();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signIn") {
        const { error: signInError } = await signIn({ email, password });
        if (signInError) {
          setError(signInError);
          await logAuditEvent({
            eventType: "login_failed",
            metadata: { email, reason: signInError },
          });
          return;
        }
        const supabase = getSupabaseClient();
        const { data } = await supabase!.auth.getSession();
        await logAuditEvent({ eventType: "login_success", accessToken: data.session?.access_token });
      } else {
        const { error: signUpError } = await signUp({ email, password, fullName });
        if (signUpError) {
          setError(signUpError);
          await logAuditEvent({
            eventType: "login_failed",
            metadata: { email, reason: signUpError, mode: "signUp" },
          });
          return;
        }
        // Signup creates a session in many configs; treat as successful auth attempt.
        const supabase = getSupabaseClient();
        const { data } = await supabase!.auth.getSession();
        await logAuditEvent({
          eventType: "login_success",
          accessToken: data.session?.access_token,
          metadata: { mode: "signUp" },
        });
      }
      // On successful auth, go directly to the app
      setScreen("home");
    } finally {
      setLoading(false);
    }
  };

  const title = mode === "signIn" ? "Sign in" : "Create account";
  const subtitle =
    mode === "signIn"
      ? "Enter your credentials to access your invoice workspace."
      : "Create an account to manage your invoice scans and exports.";

  return (
    <div className={styles.authRoot}>
      <div className={styles.shell}>
        <div className={styles.visual}>
          <div className={styles.visualInner}>
            <div className={styles.brandMark}>Document Scanner</div>
            <p className={styles.brandTagline}>Capture, review, and export your documents in seconds.</p>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.card}>
            <header className={styles.header}>
              <h1 className={styles.title}>{title}</h1>
              <p className={styles.subtitle}>{subtitle}</p>
            </header>
            <form onSubmit={handleSubmit} className={styles.form}>
              {mode === "signUp" && (
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label className={styles.label} htmlFor="fullName">
                      Full name
                    </label>
                  </div>
                  <div className={styles.inputRow}>
                    <input
                      id="fullName"
                      className={styles.input}
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                    />
                  </div>
                </div>
              )}
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="email">
                    Email
                  </label>
                </div>
                <div className={styles.inputRow}>
                  <input
                    id="email"
                    className={styles.input}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label} htmlFor="password">
                    Password
                  </label>
                  {mode === "signUp" && (
                    <span className={styles.hint}>At least 8 characters recommended.</span>
                  )}
                </div>
                <div className={styles.inputRow}>
                  <input
                    id="password"
                    className={styles.input}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                    required
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <div className={styles.forgotRow}>
                  <button type="button" className={styles.forgotLink}>
                    Forgot password?
                  </button>
                </div>
              </div>
              {error && <div className={styles.error}>{error}</div>}
              <button type="submit" disabled={loading} className={styles.primaryButton}>
                {loading ? "Please wait…" : mode === "signIn" ? "Sign in" : "Sign up"}
              </button>
            </form>
            <div className={styles.modeSwitch}>
              <button
                type="button"
                className={styles.modeSwitchButton}
                onClick={() => {
                  setMode(mode === "signIn" ? "signUp" : "signIn");
                  setError(null);
                }}
              >
                {mode === "signIn" ? (
                  <>
                    Don&apos;t have an account? <span>Sign up</span>
                  </>
                ) : (
                  <>
                    Already have an account? <span>Sign in</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

