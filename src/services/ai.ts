import type { AppSettings, ModelConfig } from "../types";
import { isDevVerboseApiLogging, logLlmRequest, logLlmResponse, logUserAction } from "./apiTrace";
import {
  extractChatCompletionDeltaFromSseLine,
  extractChatCompletionText
} from "./chatCompletionParse";
import { readChatCompletionStream } from "./chatCompletionStream";
import { modelConfigForRequest, modelProtocol } from "./modelProviders";

interface ChatMessage {
  role: "system" | "user";
  content: unknown;
}

export interface CompleteChatTextMeta {
  /** 用于应用日志区分场景，如 log_summary / log_qa */
  purpose: string;
}

export interface StreamChatTextOptions {
  purpose: string;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

/** 从 OpenAI 兼容 SSE 单行解析 content delta；非 data 行或 [DONE] 返回 null */
export function extractContentDeltaFromSseLine(line: string): string | null {
  return extractChatCompletionDeltaFromSseLine(line);
}

/** 将 SSE 文本块按行解析并回调增量（供测试与流式读取共用） */
export function consumeSseChatBuffer(buffer: string, onDelta: (delta: string) => void): string {
  const lines = buffer.split("\n");
  let out = "";
  for (const line of lines) {
    const delta = extractContentDeltaFromSseLine(line);
    if (delta) {
      out += delta;
      onDelta(delta);
    }
  }
  return out;
}

export function extractContentDeltaFromAnthropicSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (json.type === "content_block_delta" && json.delta?.type === "text_delta" && json.delta.text) {
      return json.delta.text;
    }
  } catch {
    return null;
  }
  return null;
}

export { readChatCompletionStream } from "./chatCompletionStream";

async function readAnthropicMessageStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Anthropic stream response has no body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const delta = extractContentDeltaFromAnthropicSseLine(line);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }
  if (buffer.trim()) {
    const delta = extractContentDeltaFromAnthropicSseLine(buffer);
    if (delta) {
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}

async function postChatCompletions(
  config: ModelConfig,
  body: Record<string, unknown>,
  errorLabel: string,
  init?: RequestInit
) {
  const normalized = modelConfigForRequest(config);
  if (!normalized.baseUrl || !normalized.apiKey || !normalized.model) {
    return null;
  }
  const response = await fetch(`${normalized.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalized.apiKey}`
    },
    body: JSON.stringify(body),
    signal: init?.signal
  });
  if (!response.ok) {
    throw new Error(`${errorLabel} request failed: ${response.status} ${response.statusText}`);
  }
  return response;
}

async function postAnthropicMessages(
  config: ModelConfig,
  body: Record<string, unknown>,
  errorLabel: string,
  init?: RequestInit
) {
  const normalized = modelConfigForRequest(config);
  if (!normalized.baseUrl || !normalized.apiKey || !normalized.model) {
    return null;
  }
  const response = await fetch(`${normalized.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": normalized.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body),
    signal: init?.signal
  });
  if (!response.ok) {
    throw new Error(`${errorLabel} request failed: ${response.status} ${response.statusText}`);
  }
  return response;
}

function anthropicMessages(config: ModelConfig, messages: ChatMessage[]) {
  const normalized = modelConfigForRequest(config);
  const system = messages.find((m) => m.role === "system")?.content;
  const userMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return {
    model: normalized.model,
    system,
    messages: userMessages,
    temperature: 0.2,
    max_tokens: 4096
  };
}

async function callChatCompletions(config: ModelConfig, messages: ChatMessage[], errorLabel: string) {
  if (modelProtocol(config) === "anthropic") {
    const response = await postAnthropicMessages(config, anthropicMessages(config, messages), errorLabel);
    if (!response) return null;
    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    return data.content?.find((part) => part.type === "text" && part.text)?.text?.trim() ?? null;
  }

  const normalized = modelConfigForRequest(config);
  const response = await postChatCompletions(
    config,
    { model: normalized.model, messages, temperature: 0.2 },
    errorLabel
  );
  if (!response) return null;
  const data = await response.json();
  return extractChatCompletionText(data) || null;
}

function resolveLlmConfig(settings: AppSettings): ModelConfig {
  return modelConfigForRequest(settings.llm);
}

/** 文本 LLM：用于日志总结、日志问答等（使用设置中的 LLM 配置） */
export async function completeChatText(
  settings: AppSettings,
  system: string,
  user: string,
  meta?: CompleteChatTextMeta
): Promise<string> {
  const config = resolveLlmConfig(settings);
  const model = config.model.trim();
  const purpose = meta?.purpose ?? "llm";

  if (isDevVerboseApiLogging()) {
    await logLlmRequest(purpose, system, user, model);
  } else if (meta?.purpose && meta.purpose !== "log_qa" && meta.purpose !== "log_summary") {
    await logUserAction("llm", meta.purpose, {
      model,
      systemChars: system.length,
      userChars: user.length
    });
  }

  const text = await callChatCompletions(
    config,
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    "LLM"
  );

  if (text == null || !text.trim()) {
    throw new Error("LLM is not configured or returned empty text. Set Base URL, API Key, and model in Settings.");
  }

  if (isDevVerboseApiLogging()) {
    await logLlmResponse(purpose, text, model);
  }

  return text;
}

/** 流式文本 LLM（OpenAI 兼容 SSE）；返回完整拼接文本 */
export async function streamChatText(
  settings: AppSettings,
  system: string,
  user: string,
  options: StreamChatTextOptions
): Promise<string> {
  const config = resolveLlmConfig(settings);
  const model = config.model.trim();
  const purpose = options.purpose;

  if (isDevVerboseApiLogging()) {
    await logLlmRequest(purpose, system, user, model);
  }

  if (modelProtocol(config) === "anthropic") {
    const response = await postAnthropicMessages(
      config,
      {
        ...anthropicMessages(config, [
          { role: "system", content: system },
          { role: "user", content: user }
        ]),
        stream: true
      },
      "LLM stream",
      { signal: options.signal }
    );

    if (!response) {
      throw new Error("LLM is not configured. Set Base URL, API Key, and model in Settings.");
    }

    const text = (await readAnthropicMessageStream(response, options.onDelta)).trim();
    if (!text) {
      throw new Error("Anthropic stream returned empty text. Check model and API key.");
    }

    if (isDevVerboseApiLogging()) {
      await logLlmResponse(purpose, text, model);
    }

    return text;
  }

  const normalized = modelConfigForRequest(config);
  const response = await postChatCompletions(
    config,
    {
      model: normalized.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.2,
      stream: true
    },
    "LLM stream",
    { signal: options.signal }
  );

  if (!response) {
    throw new Error("LLM is not configured. Set Base URL, API Key, and model in Settings.");
  }

  const text = (await readChatCompletionStream(response, options.onDelta)).trim();
  if (!text) {
    throw new Error("LLM stream returned empty text. Check model and API compatibility with streaming.");
  }

  if (isDevVerboseApiLogging()) {
    await logLlmResponse(purpose, text, model);
  }

  return text;
}
