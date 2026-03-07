type LogLevel = "debug" | "info" | "warn" | "error";

interface LogMeta {
  [key: string]: unknown;
}

const isDev = import.meta.env.DEV ?? false;

function baseLog(level: LogLevel, message: string, meta?: LogMeta) {
  if (!isDev) return;
  const payload = meta && Object.keys(meta).length > 0 ? meta : undefined;
  const entry = { level, message, meta: payload, timestamp: new Date().toISOString() };
  switch (level) {
    case "debug":
      console.debug(entry);
      break;
    case "info":
      console.info(entry);
      break;
    case "warn":
      console.warn(entry);
      break;
    default:
      console.error(entry);
  }
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

