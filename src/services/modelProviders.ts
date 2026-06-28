import type { ModelConfig, ModelProvider } from "../types";

export type ModelProtocol = "openaiCompatible" | "anthropic";

export interface ModelProviderPreset {
  id: ModelProvider;
  labelKey: string;
  baseUrl: string;
  protocol: ModelProtocol;
  supportsEmbedding: boolean;
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: "openaiCompatible",
    labelKey: "modelProviderOpenaiCompatible",
    baseUrl: "",
    protocol: "openaiCompatible",
    supportsEmbedding: true
  },
  {
    id: "openai",
    labelKey: "modelProviderOpenai",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openaiCompatible",
    supportsEmbedding: true
  },
  {
    id: "aliyun",
    labelKey: "modelProviderAliyun",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openaiCompatible",
    supportsEmbedding: true
  },
  {
    id: "gemini",
    labelKey: "modelProviderGemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    protocol: "openaiCompatible",
    supportsEmbedding: true
  },
  {
    id: "anthropic",
    labelKey: "modelProviderAnthropic",
    baseUrl: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    supportsEmbedding: false
  },
  {
    id: "siliconflow",
    labelKey: "modelProviderSiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    protocol: "openaiCompatible",
    supportsEmbedding: true
  },
  {
    id: "deepseek",
    labelKey: "modelProviderDeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    protocol: "openaiCompatible",
    supportsEmbedding: false
  },
  {
    id: "tencent",
    labelKey: "modelProviderTencent",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    protocol: "openaiCompatible",
    supportsEmbedding: true
  }
];

const PROVIDER_BY_ID = new Map(MODEL_PROVIDER_PRESETS.map((preset) => [preset.id, preset]));

export function normalizeModelProvider(raw: unknown): ModelProvider {
  return typeof raw === "string" && PROVIDER_BY_ID.has(raw as ModelProvider)
    ? (raw as ModelProvider)
    : "openaiCompatible";
}

export function getModelProvider(config: ModelConfig): ModelProviderPreset {
  return PROVIDER_BY_ID.get(normalizeModelProvider(config.provider)) ?? MODEL_PROVIDER_PRESETS[0];
}

export function modelProtocol(config: ModelConfig): ModelProtocol {
  return getModelProvider(config).protocol;
}

export function applyModelProvider(config: ModelConfig, provider: ModelProvider): ModelConfig {
  const preset = PROVIDER_BY_ID.get(provider);
  if (!preset) return { ...config, provider: "openaiCompatible" };
  return {
    ...config,
    provider,
    baseUrl: preset.baseUrl || config.baseUrl
  };
}

export function modelConfigForRequest(config: ModelConfig): Required<ModelConfig> {
  return {
    provider: normalizeModelProvider(config.provider),
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim()
  };
}
