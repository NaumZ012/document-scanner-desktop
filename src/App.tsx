import { lazy, Suspense, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ToastProvider } from "@/context/ToastContext";
import { ToastContainer } from "@/components/Toast";
import { useToast } from "@/context/ToastContext";
import { AppProvider, useApp } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Home, History, Settings, LogOut, User, SunMedium, Moon, Monitor, Shield } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import styles from "./App.module.css";

const HomePage = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const AuthPage = lazy(() => import("@/pages/Auth").then((m) => ({ default: m.AuthPage })));
const Review = lazy(() => import("@/pages/Review").then((m) => ({ default: m.Review })));
const BatchReview = lazy(() => import("@/pages/BatchReview").then((m) => ({ default: m.BatchReview })));
const HistoryPage = lazy(() => import("@/pages/History").then((m) => ({ default: m.History })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })));
const ProfilePage = lazy(() => import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })));
const AdminPage = lazy(() => import("@/pages/Admin").then((m) => ({ default: m.AdminPage })));

function AppContent() {
  const { screen, setScreen, currentSessionUser, setCurrentSessionUser, theme, setTheme } = useApp();
  const { user, profile, loading, signOut } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    try {
      const win = getCurrentWindow();
      win.setTitle("Document Scanner");
    } catch {
      /* not in Tauri (e.g. browser) */
    }
  }, []);

  useEffect(() => {
    // On launch: silently check for updates in the background. Do not block the app.
    let cancelled = false;
    (async () => {
      try {
        const updater = await import("@tauri-apps/plugin-updater");
        const update = await updater.check();
        if (cancelled || !update) return;

        showToast(`Update ${update.version} available. Restart to install.`, "info", {
          action: {
            label: "Download and restart",
            onAction: async () => {
              showToast("Installing update…", "info");
              await update.downloadAndInstall();
              // Tauri will relaunch the app after install.
            },
          },
        });
      } catch {
        // Ignore updater errors (offline, not in Tauri, misconfigured endpoints)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const navItems = [
    { id: "home" as const, icon: Home, label: "Home" },
    { id: "history" as const, icon: History, label: "History" },
    { id: "settings" as const, icon: Settings, label: "Settings" },
  ] as const;

  const isAdmin = profile?.role === "admin";
  const navItemsWithAdmin = isAdmin
    ? [...navItems, { id: "admin" as const, icon: Shield, label: "Admin" }]
    : navItems;

  const showSidebar =
    user != null &&
    (screen === "home" ||
      screen === "history" ||
      screen === "settings" ||
      screen === "review" ||
      screen === "profile" ||
      screen === "admin");

  if (loading) {
    return <div className={styles.loading}>Loading…</div>;
  }

  if (!user && screen !== "auth") {
    setScreen("auth");
  }

  if (!user) {
    return (
      <div className={`${styles.app} ${styles.appAuth}`}>
        <button
          type="button"
          className={styles.themeToggle}
          onClick={() => {
            const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
            setTheme(next);
          }}
          title={`Theme: ${theme}`}
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <SunMedium size={18} aria-hidden />
          ) : theme === "dark" ? (
            <Moon size={18} aria-hidden />
          ) : (
            <Monitor size={18} aria-hidden />
          )}
        </button>
        <main className={styles.main}>
          <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
            <AuthPage />
          </Suspense>
        </main>
        <ToastContainer />
      </div>
    );
  }

  if (user && screen === "auth") {
    setScreen("home");
  }

  const fullScreenAuthLayout = screen === "profile";
  if (!isAdmin && screen === "admin") {
    setScreen("home");
  }
  return (
    <div className={`${styles.app} ${showSidebar ? styles.appWithSidebar : ""} ${fullScreenAuthLayout ? styles.appAuth : ""}`}>
      <button
        type="button"
        className={styles.themeToggle}
        onClick={() => {
          const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
          setTheme(next);
        }}
        title={`Theme: ${theme}`}
        aria-label="Toggle theme"
      >
        {theme === "light" ? (
          <SunMedium size={18} aria-hidden />
        ) : theme === "dark" ? (
          <Moon size={18} aria-hidden />
        ) : (
          <Monitor size={18} aria-hidden />
        )}
      </button>
      {showSidebar && (
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <span className={styles.logo}>IS</span>
        </div>
        <nav className={styles.sidebarNav}>
          {navItemsWithAdmin.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              className={screen === id ? styles.navActive : ""}
              onClick={() => setScreen(id)}
              title={label}
              aria-label={label}
            >
              <span className={styles.iconWrap}>
                <Icon size={22} strokeWidth={2} aria-hidden />
              </span>
              <span className={styles.navLabel}>{label}</span>
            </button>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <button
            type="button"
            className={styles.profileBlock}
            title={currentSessionUser?.name ?? profile?.full_name ?? user?.email ?? "User"}
            onClick={() => setScreen("profile")}
          >
            <span className={styles.profileIcon}>
              <User size={18} strokeWidth={2} aria-hidden />
            </span>
            <span className={styles.profileName}>
              {currentSessionUser?.name ?? profile?.full_name ?? user?.email ?? "User"}
            </span>
          </button>
          <button
            type="button"
            className={styles.logoutBtn}
            onClick={async () => {
              setCurrentSessionUser(null);
              setScreen("auth");
              await signOut();
            }}
            title="Log out"
            aria-label="Log out"
          >
            <span className={styles.iconWrap}>
              <LogOut size={20} strokeWidth={2} aria-hidden />
            </span>
            <span className={styles.navLabel}>Log out</span>
          </button>
        </div>
      </aside>
      )}
      <main className={styles.main}>
        <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
          {screen === "auth" && <AuthPage />}
          {screen === "home" && <HomePage />}
          {screen === "review" && <Review />}
          {screen === "batchReview" && <BatchReview />}
          {screen === "history" && <HistoryPage />}
          {screen === "settings" && <SettingsPage />}
          {screen === "profile" && <ProfilePage />}
          {screen === "admin" && <AdminPage />}
        </Suspense>
      </main>
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AuthProvider>
          <ErrorBoundary>
            <AppContent />
          </ErrorBoundary>
        </AuthProvider>
      </AppProvider>
    </ToastProvider>
  );
}
