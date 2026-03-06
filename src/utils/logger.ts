type LogLevel = "debug" | "info" | "warn" | "error";

interface LogMeta {
  [key: string]: unknown;
}

const isDev = import.meta.env.DEV ?? false;

function baseLog(level: LogLevel, message: string, meta?: LogMeta) {
  const payload = meta && Object.keys(meta).length > 0 ? meta : undefined;
  const entry = {
    level,
    message,
    meta: payload,
    timestamp: new Date().toISOString(),
  };

  // In development, always log to the console for easier debugging.
  if (isDev) {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "debug" : level](entry);
    return;
  }

  // In production we can later route this to a file, telemetry, or keep as a
  // thin wrapper around console.
  // eslint-disable-next-line no-console
  console[level === "debug" ? "debug" : level](entry);
}

export const logger = {
  debug(message: string, meta?: LogMeta) {
    baseLog("debug", message, meta);
  },
  info(message: string, meta?: LogMeta) {
    baseLog("info", message, meta);
  },
  warn(message: string, meta?: LogMeta) {
    baseLog("warn", message, meta);
  },
  error(message: string, meta?: LogMeta) {
    baseLog("error", message, meta);
  },
};

