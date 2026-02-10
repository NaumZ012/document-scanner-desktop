// Kills any running invoice-scanner process so 'tauri dev' can overwrite the exe (fixes "Access is denied" on Windows).
import { execSync } from "child_process";
const name = process.platform === "win32" ? "invoice-scanner.exe" : "invoice-scanner";
try {
  if (process.platform === "win32") {
    execSync(`taskkill /IM ${name} /F`, { stdio: "ignore" });
  } else {
    execSync(`pkill -f ${name} || true`, { stdio: "ignore" });
  }
} catch (_) {}
