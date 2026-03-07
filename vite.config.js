import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// Config runs in Node; TAURI_DEBUG comes from process.env when Tauri runs the build.
const tauriDebug = process.env.TAURI_DEBUG;
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
        target: ["es2021", "chrome100", "safari13"],
        minify: !tauriDebug,
        sourcemap: !!tauriDebug,
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
                        return "react";
                    }
                    if (id.includes("node_modules/exceljs")) {
                        return "exceljs";
                    }
                },
            },
        },
        chunkSizeWarningLimit: 600,
    },
});
