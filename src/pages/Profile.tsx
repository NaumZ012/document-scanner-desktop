import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import styles from "./Auth.module.css";

export function ProfilePage() {
  const { currentSessionUser, setCurrentSessionUser, setScreen } = useApp();
  const { user, profile, signOut } = useAuth();

  const displayName = currentSessionUser?.name ?? profile?.full_name ?? user?.email ?? "User";

  return (
    <div className={styles.authRoot}>
      <div className={styles.shell}>
        <div className={styles.visual}>
          <div className={styles.visualInner}>
            <div className={styles.brandMark}>Account</div>
            <p className={styles.brandTagline}>Review who is using the app and sign out when you’re done.</p>
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.card}>
            <header className={styles.header}>
              <h1 className={styles.title}>Profile</h1>
              <p className={styles.subtitle}>You are currently using the app as:</p>
            </header>

            <div className={styles.form}>
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <span className={styles.label}>Session user</span>
                </div>
                <div className={styles.inputRow}>
                  <div className={styles.inputLikeButton}>{displayName}</div>
                </div>
              </div>

              {user && (
                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <span className={styles.label}>Workspace owner email</span>
                  </div>
                  <div className={styles.inputRow}>
                    <div className={styles.inputLikeButton}>{user.email}</div>
                  </div>
                </div>
              )}

              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setScreen("home")}
              >
                Back to app
              </button>
              <button
                type="button"
                className={styles.logoutButton}
                onClick={async () => {
                  setCurrentSessionUser(null);
                  setScreen("auth");
                  try {
                    await signOut();
                  } catch {
                    // Still show auth screen even if Supabase signOut fails
                  }
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

