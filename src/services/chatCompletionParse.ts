/** OpenAI 兼容 chat/completions 响应正文提取（含 DeepSeek reasoning_content 等扩展字段） */

type MessageLike = {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
};

type ChoiceLike = {
  message?: MessageLike;
  delta?: MessageLike;
};

type CompletionLike = {
  choices?: ChoiceLike[];
  error?: { message?: string };
};

function textFromContentField(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const part of value) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: string; text?: string };
    if (row.type === "text" && typeof row.text === "string") parts.push(row.text);
  }
  return parts.join("").trim();
}

function textFromMessage(message: MessageLike | undefined, mode: "answer" | "any"): string {
  if (!message) return "";
  const content = textFromContentField(message.content);
  if (content) return content;
  if (mode === "any") {
    const reasoning = textFromContentField(message.reasoning_content ?? message.reasoning);
    if (reasoning) return reasoning;
  }
  return "";
}

/** 从 chat/completions JSON 提取助手回复；connectivity 模式允许 reasoning 字段证明连通 */
export function extractChatCompletionText(
  data: unknown,
  options?: { allowReasoningFallback?: boolean }
): string {
  const payload = data as CompletionLike;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }
  const choice = payload.choices?.[0];
  if (!choice) return "";
  const mode = options?.allowReasoningFallback ? "any" : "answer";
  const fromMessage = textFromMessage(choice.message, mode);
  if (fromMessage) return fromMessage;
  return textFromMessage(choice.delta, mode);
}

export function extractChatCompletionDelta(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const row = delta as MessageLike;
  return textFromContentField(row.content);
}

export function extractChatCompletionDeltaFromSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as CompletionLike;
    const delta = json.choices?.[0]?.delta;
    if (!delta) return null;
    const content = extractChatCompletionDelta(delta);
    if (content) return content;
  } catch {
    return null;
  }
  return null;
}

export function extractChatCompletionErrorFromSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as CompletionLike;
    return json.error?.message?.trim() || null;
  } catch {
    return null;
  }
}
