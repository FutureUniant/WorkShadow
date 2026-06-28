import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./storage";

/** 无法从网络或本机解析时区时的默认值（北京） */
export const BEIJING_TIME_ZONE = "Asia/Shanghai";

const NETWORK_TZ_URL = "https://worldtimeapi.org/api/ip";
const NETWORK_TIMEOUT_MS = 4000;

let cachedTimeZone: string | null = null;

function pad2(n: number, len = 2) {
  return String(n).padStart(len, "0");
}

/** 校验 IANA 时区名是否可用 */
export function normalizeTimeZone(tz?: string | null): string | null {
  if (!tz?.trim()) return null;
  const name = tz.trim();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** 读取操作系统时区（离线可用） */
export function getSystemTimeZone(): string | null {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

async function fetchTimeZoneFromNetwork(signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(NETWORK_TZ_URL, { signal, cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { timezone?: string };
    return normalizeTimeZone(data.timezone);
  } catch {
    return null;
  }
}

/**
 * 解析应用使用的时区：优先本机时区（离线可用）；
 * 仅在无法读取本机时区且联网时再尝试网络推断；仍不可用则北京。
 */
export async function resolveAppTimeZone(): Promise<string> {
  const system = getSystemTimeZone();
  if (system) return system;

  if (typeof navigator !== "undefined" && navigator.onLine) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const fromNet = await fetchTimeZoneFromNetwork(controller.signal);
      if (fromNet) return fromNet;
    } finally {
      window.clearTimeout(timer);
    }
  }
  return BEIJING_TIME_ZONE;
}

/** 当前生效的 IANA 时区（需先 initAppTimeZone，否则同步回退本机/北京） */
export function getAppTimeZone(): string {
  return cachedTimeZone ?? getSystemTimeZone() ?? BEIJING_TIME_ZONE;
}

/** 启动时解析时区并同步到桌面端日志模块 */
export async function initAppTimeZone(): Promise<string> {
  cachedTimeZone = await resolveAppTimeZone();
  if (isTauriRuntime()) {
    try {
      await invoke("app_timezone_init", { timeZone: cachedTimeZone });
    } catch {
      /* 忽略：日志仍可用 Rust 侧本机/北京回退 */
    }
  }
  return cachedTimeZone;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  });
  const tzName = dtf.formatToParts(date).find((p) => p.type === "timeZoneName")?.value;
  if (!tzName) return 0;
  if (tzName === "GMT" || tzName === "UTC") return 0;
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "+" ? 1 : -1;
  const hours = Number(m[2]);
  const mins = Number(m[3] ?? 0);
  return sign * (hours * 60 + mins);
}

function formatOffset(offsetMin: number): string {
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** 按应用时区输出 RFC3339（含偏移，如 +08:00） */
export function formatLocalRFC3339(date = new Date()): string {
  const timeZone = getAppTimeZone();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const ms = pad2(date.getMilliseconds(), 3);
  const offset = formatOffset(getTimeZoneOffsetMinutes(date, timeZone));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${ms}${offset}`;
}

/** 应用时区下的日历日 YYYY-MM-DD */
export function formatLocalDateStamp(date = new Date()): string {
  const timeZone = getAppTimeZone();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
}
