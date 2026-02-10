import { lazy, Suspense } from "react";
import { ToastProvider } from "@/context/ToastContext";
import { ToastContainer } from "@/components/Toast";
import { AppProvider, useApp } from "@/context/AppContext";
import { Home, History, Settings } from "lucide-react";
import styles from "./App.module.css";

const HomePage = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const Review = lazy(() => import("@/pages/Review").then((m) => ({ default: m.Review })));
const BatchReview = lazy(() => import("@/pages/BatchReview").then((m) => ({ default: m.BatchReview })));
const HistoryPage = lazy(() => import("@/pages/History").then((m) => ({ default: m.History })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.Settings })));

function AppContent() {
  const { screen, setScreen } = useApp();

  const navItems = [
    { id: "home" as const, icon: Home, label: "Home" },
    { id: "history" as const, icon: History, label: "History" },
    { id: "settings" as const, icon: Settings, label: "Settings" },
  ] as const;

  const showSidebar = screen === "home" || screen === "history" || screen === "settings" || screen === "review";

  return (
    <div className={`${styles.app} ${showSidebar ? styles.appWithSidebar : ""}`}>
      {showSidebar && (
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <span className={styles.logo}>IS</span>
        </div>
        <nav className={styles.sidebarNav}>
          {navItems.map(({ id, icon: Icon, label }) => (
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
      </aside>
      )}
      <main className={styles.main}>
        <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
          {screen === "home" && <HomePage />}
          {screen === "review" && <Review />}
          {screen === "batchReview" && <BatchReview />}
          {screen === "history" && <HistoryPage />}
          {screen === "settings" && <SettingsPage />}
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
        <AppContent />
      </AppProvider>
    </ToastProvider>
  );
}
