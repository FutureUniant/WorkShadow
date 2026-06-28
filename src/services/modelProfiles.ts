import type { ModelConfig, ModelProvider, ModelProfiles } from "../types";
import { applyModelProvider, MODEL_PROVIDER_PRESETS, normalizeModelProvider } from "./modelProviders";

const PROVIDER_IDS = new Set<ModelProvider>(MODEL_PROVIDER_PRESETS.map((preset) => preset.id));

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownProviderId(id: ModelProvider): boolean {
  return PROVIDER_IDS.has(id);
}

export function normalizeModelConfig(raw: unknown): ModelConfig {
  const m = isPlainObject(raw) ? raw : {};
  return {
    provider: normalizeModelProvider(m.provider),
    baseUrl: typeof m.baseUrl === "string" ? m.baseUrl : "",
    apiKey: typeof m.apiKey === "string" ? m.apiKey : "",
    model: typeof m.model === "string" ? m.model : ""
  };
}

/** 将历史/异常数据收敛为单条配置（数组时仅保留最后一条） */
export function coerceSingleModelProfile(raw: unknown): ModelConfig | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return normalizeModelConfig(raw[raw.length - 1]);
  }
  if (!isPlainObject(raw)) return null;
  return normalizeModelConfig(raw);
}

/**
 * 每个服务商至多一条 API 配置：剔除未知键，同一 provider 只保留一项。
 */
export function sanitizeModelProfiles(profiles: ModelProfiles | undefined): ModelProfiles {
  const out: ModelProfiles = {};
  if (!profiles || typeof profiles !== "object") return out;

  for (const [key, value] of Object.entries(profiles)) {
    if (!isKnownProviderId(key as ModelProvider)) continue;
    const provider = key as ModelProvider;

    const row = coerceSingleModelProfile(value);
    if (!row) continue;
    out[provider] = normalizeModelConfig({ ...row, provider });
  }

  return out;
}

/** 从持久化数据恢复各服务商配置；并用当前生效配置回填对应项 */
export function normalizeModelProfiles(raw: unknown, active?: ModelConfig): ModelProfiles {
  const merged: ModelProfiles = {};

  if (isPlainObject(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!isKnownProviderId(key as ModelProvider)) continue;
      const provider = key as ModelProvider;

      const row = coerceSingleModelProfile(value);
      if (!row) continue;
      merged[provider] = normalizeModelConfig({ ...row, provider });
    }
  }

  if (active) {
    const provider = normalizeModelProvider(active.provider);
    merged[provider] = normalizeModelConfig(active);
  }

  return sanitizeModelProfiles(merged);
}

/** 写入或覆盖某服务商的唯一配置项 */
export function upsertModelProfile(profiles: ModelProfiles | undefined, config: ModelConfig): ModelProfiles {
  const provider = normalizeModelProvider(config.provider);
  const next: ModelProfiles = { ...profiles, [provider]: normalizeModelConfig({ ...config, provider }) };
  return sanitizeModelProfiles(next);
}

/** 切换服务商：保存当前配置，加载目标服务商已存配置或预设默认值 */
export function switchModelProviderProfile(
  profiles: ModelProfiles | undefined,
  current: ModelConfig,
  nextProvider: ModelProvider
): { profiles: ModelProfiles; active: ModelConfig } {
  const saved = upsertModelProfile(profiles, current);
  const existing = saved[nextProvider];
  if (existing) {
    return {
      profiles: saved,
      active: { ...existing, provider: nextProvider }
    };
  }
  return {
    profiles: saved,
    active: applyModelProvider(
      { provider: nextProvider, baseUrl: "", apiKey: "", model: "" },
      nextProvider
    )
  };
}

export function hasStoredModelProfile(profiles: ModelProfiles | undefined, provider: ModelProvider): boolean {
  const row = sanitizeModelProfiles(profiles)[provider];
  if (!row) return false;
  return Boolean(row.baseUrl || row.apiKey || row.model);
}
