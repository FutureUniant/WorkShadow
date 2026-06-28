import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { LogNode } from "../types";
import { isTauriRuntime } from "./storage";
import { reportErrorToUser } from "./errorReporting";

const LOG_WINDOW_LABEL_PREFIX = "log-";

export function logWindowLabel(nodeId: string) {
  return `${LOG_WINDOW_LABEL_PREFIX}${nodeId}`;
}

function logIdFromWindowLabel(label: string): string | null {
  if (!label.startsWith(LOG_WINDOW_LABEL_PREFIX)) return null;
  const id = label.slice(LOG_WINDOW_LABEL_PREFIX.length).trim();
  return id || null;
}

/** 独立窗口与主窗口共用同一入口 URL，避免 dev 模式下重复 query 触发 431 */
function logWindowUrl() {
  if (import.meta.env.DEV) {
    return "http://localhost:1420/";
  }
  return "index.html";
}

/** 浏览器调试回退：hash 路由，不经过服务端 query */
function parseLogWindowIdFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (!hash) return null;
  const params = new URLSearchParams(hash.includes("=") ? hash : `logWindow=${hash}`);
  const id = params.get("logWindow");
  return id?.trim() || null;
}

/** 同步解析：Tauri 下从窗口 label 读取 logId（label 形如 log-{uuid}） */
export function resolveLogWindowId(): string | null {
  if (isTauriRuntime()) {
    try {
      return logIdFromWindowLabel(getCurrentWindow().label);
    } catch {
      return null;
    }
  }
  return parseLogWindowIdFromHash();
}

export async function openLogWindow(node: LogNode) {
  if (!isTauriRuntime()) {
    window.open(`${window.location.origin}${window.location.pathname}#logWindow=${encodeURIComponent(node.id)}`, "_blank");
    return;
  }
  if (node.kind !== "log") return;

  const label = logWindowLabel(node.id);
  try {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.unminimize();
      await existing.show();
      await existing.setFocus();
      return;
    }

    new WebviewWindow(label, {
      url: logWindowUrl(),
      title: node.title,
      width: 1180,
      height: 820,
      minWidth: 720,
      minHeight: 520,
      center: true,
      decorations: false,
      backgroundColor: "#f7f8fb",
      dragDropEnabled: false
    });
  } catch (e) {
    reportErrorToUser("render", e, { severity: "toast" });
  }
}
