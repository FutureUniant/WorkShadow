import type { AppSettings, LogNode, MemoryEntry } from "../types";
import { streamChatText } from "./ai";
import { isDevVerboseApiLogging, traceLogSummary } from "./apiTrace";
import { formatUnknownError } from "./errorReporting";
import {
  LOG_SUMMARY_MAX_DIGEST_CHARS,
  LOG_SUMMARY_MAX_MEMORY_CHARS,
  LOG_SUMMARY_MAX_PER_LOG_CHARS,
  assertLogSummaryInputWithinLimit
} from "./llmInputLimits";
import { buildLogSummarySystem } from "./workshadowPrompt";

export { LlmInputTooLongError } from "./llmInputLimits";

export function collectLogsByIds(nodes: LogNode[], ids: string[]): LogNode[] {
  const idSet = new Set(ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return nodes
    .filter((n) => n.kind === "log" && idSet.has(n.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated)`;
}

export function buildMemoryContext(memory: MemoryEntry[], maxChars: number): string {
  if (!memory.length) return "";
  const lines: string[] = [];
  let used = 0;
  for (const m of memory) {
    if (!m.title.trim() && !m.body.trim()) continue;
    const block = `### ${m.title || "(untitled)"}\n${m.body}\n`;
    if (used + block.length > maxChars) break;
    lines.push(block);
    used += block.length;
  }
  return lines.join("\n");
}

export function buildLogsDigest(logs: LogNode[], maxPerLog: number, maxTotal: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const log of logs) {
    const block = `## ${log.title}\n${truncate(log.markdown || "", maxPerLog)}\n`;
    if (used + block.length > maxTotal) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n");
}

export interface ReportStylePreferences {
  focus: string;
  style: string;
}

/**
 * 组装日志总结的 user 消息：长期记忆 → 写作偏好 → 日志摘录 → 任务说明。
 * 相对稳定的内容靠前，便于部分模型对前缀做 prompt 缓存；篇数等易变信息放在末尾。
 */
export function buildLogSummaryUserMessage(
  localeZh: boolean,
  parts: { memory: string; preferences: string; logDigest: string; logCount: number }
): string {
  const sections: string[] = [];
  if (localeZh) {
    sections.push(`## 长期记忆（用户维护）\n${parts.memory || "（无）"}`);
    if (parts.preferences.trim()) sections.push(parts.preferences.trim());
    sections.push(`## 所选日志摘录\n${parts.logDigest || "（无内容）"}`);
    const countLabel = parts.logCount > 0 ? `共 ${parts.logCount} 篇` : "0 篇";
    sections.push(`---\n任务：根据以上长期记忆、写作偏好与日志摘录，生成一份 Markdown 格式的工作总结（本次勾选 ${countLabel}）。`);
  } else {
    sections.push(`## Memory notes\n${parts.memory || "(none)"}`);
    if (parts.preferences.trim()) sections.push(parts.preferences.trim());
    sections.push(`## Selected log excerpts\n${parts.logDigest || "(empty)"}`);
    const countLabel = parts.logCount === 1 ? "1 log" : `${parts.logCount} logs`;
    sections.push(`---\nTask: From the memory, preferences, and excerpts above, write a Markdown work summary (${countLabel} selected).`);
  }
  return `${sections.join("\n\n")}\n`;
}

export function buildPreferencesInstructions(prefs: ReportStylePreferences | undefined, localeZh: boolean): string {
  const focus = prefs?.focus?.trim() ?? "";
  const style = prefs?.style?.trim() ?? "";
  if (!focus && !style) return "";
  if (localeZh) {
    const parts: string[] = [];
    if (focus) parts.push(`用户偏好的关注点与侧重：\n${focus}`);
    if (style) parts.push(`用户偏好的语气与结构风格：\n${style}`);
    return `\n\n## 写作偏好（用户设定）\n${parts.join("\n\n")}\n`;
  }
  const parts: string[] = [];
  if (focus) parts.push(`Focus preferences:\n${focus}`);
  if (style) parts.push(`Tone / structure preferences:\n${style}`);
  return `\n\n## Writing preferences (user)\n${parts.join("\n\n")}\n`;
}

export async function generateLogSummary(
  settings: AppSettings,
  input: {
    logIds: string[];
    nodes: LogNode[];
    memory: MemoryEntry[];
    localeZh: boolean;
    preferences?: ReportStylePreferences;
    onDelta?: (delta: string) => void;
  }
): Promise<string> {
  const logs = collectLogsByIds(input.nodes, input.logIds);
  const verbose = isDevVerboseApiLogging();

  await traceLogSummary(
    "summary_start",
    verbose
      ? { logIds: input.logIds, logTitles: logs.map((l) => l.title) }
      : { logCount: logs.length, logIds: input.logIds }
  );

  try {
    assertLogSummaryInputWithinLimit(logs, input.memory, input.localeZh, input.preferences);

    const digest = buildLogsDigest(logs, LOG_SUMMARY_MAX_PER_LOG_CHARS, LOG_SUMMARY_MAX_DIGEST_CHARS);
    const mem = buildMemoryContext(input.memory, LOG_SUMMARY_MAX_MEMORY_CHARS);
    const prefBlock = buildPreferencesInstructions(input.preferences, input.localeZh);

    const system = buildLogSummarySystem(input.localeZh);

    const user = buildLogSummaryUserMessage(input.localeZh, {
      memory: mem,
      preferences: prefBlock,
      logDigest: digest,
      logCount: logs.length
    });

    if (verbose) {
      await traceLogSummary("llm_prompt", { system, user, memoryChars: mem.length, digestChars: digest.length });
    }

    const text = await streamChatText(settings, system, user, {
      purpose: "log_summary",
      onDelta: (delta) => input.onDelta?.(delta)
    });

    await traceLogSummary(
      "summary_done",
      verbose ? { output: text, outputChars: text.length } : { outputChars: text.length }
    );

    return text;
  } catch (e) {
    await traceLogSummary("summary_failed", { error: formatUnknownError(e) });
    throw e;
  }
}
