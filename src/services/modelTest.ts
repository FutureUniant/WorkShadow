import type { ModelConfig } from "../types";
import { extractChatCompletionText } from "./chatCompletionParse";
import { modelConfigForRequest, modelProtocol } from "./modelProviders";

function testMaxTokens(model: string): number {
  const name = model.trim().toLowerCase();
  if (name.includes("reasoner") || name.includes("r1") || name.includes("thinking")) return 512;
  return 64;
}

async function callChatCompletions(config: ModelConfig, messages: { role: "system" | "user"; content: string }[], errorLabel: string) {
  const normalized = modelConfigForRequest(config);
  if (!normalized.baseUrl || !normalized.apiKey || !normalized.model) {
    throw new Error("Fill in Base URL, API Key, and model name first.");
  }

  if (modelProtocol(config) === "anthropic") {
    const response = await fetch(`${normalized.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": normalized.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: normalized.model,
        system: messages.find((m) => m.role === "system")?.content,
        messages: messages.filter((m) => m.role === "user"),
        temperature: 0,
        max_tokens: 32
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${errorLabel} request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }
    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = data.content?.find((part) => part.type === "text" && part.text)?.text?.trim();
    if (!text) throw new Error(`${errorLabel} returned an empty response.`);
    return text;
  }

  const response = await fetch(`${normalized.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalized.apiKey}`
    },
    body: JSON.stringify({
      model: normalized.model,
      messages,
      temperature: 0,
      max_tokens: testMaxTokens(normalized.model)
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${errorLabel} request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  const data = await response.json();
  const text = extractChatCompletionText(data, { allowReasoningFallback: true });
  if (!text) {
    const model = normalized.model.toLowerCase();
    const hint =
      model.includes("reasoner") || model.includes("r1")
        ? " DeepSeek 推理模型请优先使用 deepseek-chat 作为 LLM，或增大 max_tokens。"
        : "";
    throw new Error(`${errorLabel} returned an empty response.${hint}`);
  }
  return text;
}

export async function testLlmConfig(config: ModelConfig): Promise<string> {
  return callChatCompletions(
    config,
    [
      {
        role: "system",
        content:
          "Reply with exactly: OK. Do not explain or reason; output only the two letters OK."
      },
      { role: "user", content: "Connectivity test." }
    ],
    "LLM"
  );
}

export async function testEmbeddingConfig(config: ModelConfig): Promise<string> {
  const normalized = modelConfigForRequest(config);
  if (!normalized.baseUrl || !normalized.apiKey || !normalized.model) {
    throw new Error("Fill in Base URL, API Key, and model name first.");
  }
  if (modelProtocol(config) === "anthropic") {
    throw new Error("Anthropic does not provide an embeddings endpoint. Choose an OpenAI-compatible embedding provider.");
  }

  const response = await fetch(`${normalized.baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalized.apiKey}`
    },
    body: JSON.stringify({
      model: normalized.model,
      input: ["Connectivity test"]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Embedding request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
    );
  }

  const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const dim = data.data?.[0]?.embedding?.length;
  if (!dim) throw new Error("Embedding returned no vector.");
  return String(dim);
}
