import { invoke } from "@tauri-apps/api/core";
import { formatLocalRFC3339 } from "./dateTime";
import { isTauriRuntime } from "./storage";
import { redactForDiagnostics } from "./errorReporting";

export type AppLogLevel = "debug" | "info" | "warn" | "error";

const DEV_MEMORY_MAX = 500;
const devMemory: string[] = [];

function pushDevMemory(line: string) {
  devMemory.push(line);
  if (devMemory.length > DEV_MEMORY_MAX) {
    devMemory.splice(0, devMemory.length - DEV_MEMORY_MAX);
  }
}

function formatLine(level: AppLogLevel, target: string, message: string, fields?: Record<string, unknown>): string {
  const ts = formatLocalRFC3339();
  const fieldsPart =
    fields && Object.keys(fields).length > 0
      ? ` ${redactForDiagnostics(JSON.stringify(fields))}`
      : "";
  return `${ts} ${level.toUpperCase().padEnd(5)} ${target} ${redactForDiagnostics(message)}${fieldsPart}`;
}

export async function appLog(
  level: AppLogLevel,
  target: string,
  message: string,
  fields?: Record<string, unknown>
): Promise<void> {
  const line = formatLine(level, target, message, fields);
  pushDevMemory(line);
  if (import.meta.env.DEV) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${target}]`, message, fields ?? "");
  }
  if (!isTauriRuntime()) return;
  try {
    await invoke("app_log_write", {
      level,
      target,
      message: redactForDiagnostics(message),
      fields: fields ?? null
    });
  } catch {
    /* avoid recursive failure */
  }
}
