import type { IndexStatus } from "../types";
import { appLog } from "./appLogger";

export type ErrorContext =
  | "persist"
  | "writeLog"
  | "loadState"
  | "vlm"
  | "index"
  | "search"
  | "searchNotice"
  | "globalShortcut"
  | "report"
  | "render";

export interface ReportOptions {
  logId?: string;
  /** 覆盖默认的严重程度 */
  severity?: "toast" | "modal" | "warning";
}

export interface ErrorSinkPayload {
  context: ErrorContext;
  severity: "toast" | "modal" | "warning" | "success";
  /** 系统/接口返回的原文，仅放在「详情」中展示 */
  rawError: string;
  detail: string;
  diagnostics: string;
  logId?: string;
  /** 弹窗主文案（如云端返回的余额不足说明）；未设置则用 i18n 默认摘要 */
  userMessage?: string;
  /** 弹窗主文案 i18n key；优先级低于 userMessage，高于默认摘要 */
  userMessageKey?: string;
  /** 弹窗次要说明（i18n key） */
  userHintKey?: string;
  /** 仅 persist 等场景：用户点击重试时调用 */
  onRetry?: () => void;
  /** 次要操作按钮文案（i18n key，如前往充值） */
  actionLabelKey?: string;
  onAction?: () => void;
  /** success 提示：直接展示文案，不展开详情 */
  noticeTitle?: string;
  noticeSummary?: string;
}

type Sink = (payload: ErrorSinkPayload) => void;

let sink: Sink | null = null;

export function registerErrorReportingSink(next: Sink | null) {
  sink = next;
}

function defaultSeverity(context: ErrorContext): "toast" | "modal" | "warning" {
  if (context === "searchNotice") return "warning";
  if (context === "persist" || context === "writeLog" || context === "loadState") return "modal";
  return "toast";
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** 复制到剪贴板或展示用：弱化 API Key 等敏感片段 */
export function redactForDiagnostics(text: string): string {
  return text
    .replace(/("apiKey"\s*:\s*")([^"]*)(")/gi, '$1***$3')
    .replace(/(Authorization\s*:\s*Bearer\s+)(\S+)/gi, "$1***")
    .replace(/(sk-[a-zA-Z0-9]{8})[a-zA-Z0-9]+/g, "$1…");
}

export function buildDiagnostics(context: ErrorContext, rawError: string, logId?: string): string {
  const lines = [
    `time: ${new Date().toISOString()}`,
    `context: ${context}`,
    `tauri: ${Boolean((globalThis as unknown as { window?: Window }).window && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)}`,
    ...(logId ? [`logId: ${logId}`] : []),
    `error: ${redactForDiagnostics(rawError)}`
  ];
  return lines.join("\n");
}

export function reportErrorToUser(context: ErrorContext, error: unknown, options?: ReportOptions) {
  const raw = formatUnknownError(error);
  const severity = options?.severity ?? defaultSeverity(context);
  const diagnostics = buildDiagnostics(context, raw, options?.logId);
  void appLog(severity === "toast" ? "warn" : "error", "frontend", raw, {
    context,
    severity,
    logId: options?.logId
  });
  sink?.({
    context,
    severity,
    rawError: raw,
    detail: diagnostics,
    diagnostics,
    logId: options?.logId,
    onRetry: undefined
  });
}

/** 右下角成功提示（如复制邮箱） */
export function reportSuccessNotice(title: string, summary?: string) {
  sink?.({
    context: "search",
    severity: "success",
    rawError: "",
    detail: "",
    diagnostics: "",
    noticeTitle: title,
    noticeSummary: summary ?? ""
  });
}

export function reportErrorWithRetry(context: ErrorContext, error: unknown, onRetry: () => void, options?: Omit<ReportOptions, "severity">) {
  const raw = formatUnknownError(error);
  const diagnostics = buildDiagnostics(context, raw, options?.logId);
  void appLog("error", "frontend", raw, { context, retry: true, logId: options?.logId });
  sink?.({
    context,
    severity: "modal",
    rawError: raw,
    detail: diagnostics,
    diagnostics,
    logId: options?.logId,
    onRetry
  });
}

export function normalizeLoadedIndexStatus(raw: unknown): IndexStatus[] {
  if (!Array.isArray(raw)) return [];
  const out: IndexStatus[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const logId = typeof r.logId === "string" ? r.logId : null;
    if (!logId) continue;
    const indexedAt = typeof r.indexedAt === "string" ? r.indexedAt : new Date().toISOString();
    const chunkCount = typeof r.chunkCount === "number" && Number.isFinite(r.chunkCount) ? r.chunkCount : 0;
    const st = typeof r.status === "string" ? r.status : "pending";
    const status: IndexStatus["status"] =
      st === "indexed" || st === "pending" || st === "failed" ? st : "pending";
    const error = typeof r.error === "string" ? r.error : undefined;
    out.push({ logId, indexedAt, chunkCount, status, error });
  }
  return out;
}
