import type { TFunction } from "i18next";
import type { ConfirmOptions, ModelConfig } from "../types";
import { normalizeModelProvider } from "./modelProviders";
import { testEmbeddingConfig } from "./modelTest";

export function normalizeEmbeddingConfig(config: ModelConfig): ModelConfig {
  return {
    provider: normalizeModelProvider(config.provider),
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim()
  };
}

export function isEmbeddingConfigComplete(config: ModelConfig): boolean {
  const n = normalizeEmbeddingConfig(config);
  return Boolean(n.baseUrl && n.apiKey && n.model);
}

export function embeddingConfigEqual(a: ModelConfig, b: ModelConfig): boolean {
  const left = normalizeEmbeddingConfig(a);
  const right = normalizeEmbeddingConfig(b);
  return (
    left.provider === right.provider &&
    left.baseUrl === right.baseUrl &&
    left.apiKey === right.apiKey &&
    left.model === right.model
  );
}

export type EmbeddingCommitResult =
  | { applied: true; needsVectorRebuild: boolean }
  | { applied: false; reason: "unchanged" | "cancelled" | "testFailed" };

/**
 * 校验并决定是否应用嵌入配置变更：模型名变更确认、连接测试、失败回滚。
 */
export async function commitEmbeddingConfigChange(params: {
  previous: ModelConfig;
  next: ModelConfig;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  t: TFunction;
  onTestFailed?: (message: string) => void;
}): Promise<EmbeddingCommitResult> {
  const { previous, next, confirm, t, onTestFailed } = params;
  const prev = normalizeEmbeddingConfig(previous);
  const draft = normalizeEmbeddingConfig(next);

  if (embeddingConfigEqual(prev, draft)) {
    return { applied: false, reason: "unchanged" };
  }

  const prevComplete = isEmbeddingConfigComplete(previous);
  const nextComplete = isEmbeddingConfigComplete(next);
  const modelChanged = prev.model !== draft.model;
  const providerChanged = prev.provider !== draft.provider;
  const connectionChanged = providerChanged || prev.baseUrl !== draft.baseUrl || prev.apiKey !== draft.apiKey || modelChanged;

  if (modelChanged && prevComplete && draft.model !== prev.model) {
    const ok = await confirm({
      title: t("embeddingModelChangeTitle"),
      message: t("embeddingModelChangeMessage")
    });
    if (!ok) return { applied: false, reason: "cancelled" };
  }

  if (connectionChanged && nextComplete) {
    try {
      await testEmbeddingConfig(next);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      onTestFailed?.(message);
      return { applied: false, reason: "testFailed" };
    }
  }

  const needsVectorRebuild = Boolean((providerChanged || modelChanged) && prevComplete && nextComplete);
  return { applied: true, needsVectorRebuild };
}
