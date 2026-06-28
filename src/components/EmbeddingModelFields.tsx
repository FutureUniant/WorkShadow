import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings, ConfirmOptions, ModelConfig, ModelProfiles } from "../types";
import {
  commitEmbeddingConfigChange,
  embeddingConfigEqual,
  isEmbeddingConfigComplete
} from "../services/embeddingConfig";
import { upsertModelProfile, switchModelProviderProfile } from "../services/modelProfiles";
import { MODEL_PROVIDER_PRESETS } from "../services/modelProviders";
import { testEmbeddingConfig } from "../services/modelTest";
import { SettingsSelect } from "./SettingsSelect";

type ModelTestState = { status: "idle" } | { status: "running" } | { status: "ok"; message: string } | { status: "fail"; message: string };

interface Props {
  committed: ModelConfig;
  profiles?: ModelProfiles;
  appSettings?: AppSettings;
  locked?: boolean;
  onProfilesChange: (profiles: ModelProfiles) => void;
  onCommit: (
    embedding: ModelConfig,
    options: { needsVectorRebuild: boolean; forceReindex?: boolean }
  ) => void | Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onRegisterFlush?: (flush: () => Promise<void>) => void;
}

function BlurCommitGroup({
  className,
  onCommitBlur,
  children
}: {
  className?: string;
  onCommitBlur: () => void;
  children: ReactNode;
}) {
  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    onCommitBlur();
  }

  return (
    <div className={className} onBlur={handleBlur}>
      {children}
    </div>
  );
}

export function EmbeddingModelFields({
  committed,
  profiles,
  appSettings,
  locked = false,
  onProfilesChange,
  onCommit,
  confirm,
  onRegisterFlush
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(committed);
  const [test, setTest] = useState<ModelTestState>({ status: "idle" });
  const [committing, setCommitting] = useState(false);
  const draftRef = useRef(draft);
  const committedRef = useRef(committed);
  draftRef.current = draft;
  committedRef.current = committed;

  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  async function tryCommit(options?: { forceReindex?: boolean }) {
    if (committing) return;
    const prev = committedRef.current;
    const next = draftRef.current;
    const forceReindex = Boolean(options?.forceReindex);

    if (embeddingConfigEqual(prev, next)) {
      if (!forceReindex) return;
      if (!isEmbeddingConfigComplete(next)) {
        setTest({ status: "fail", message: t("embeddingConfigIncomplete") });
        return;
      }
      setCommitting(true);
      try {
        await onCommit(next, { needsVectorRebuild: true, forceReindex: true });
        setTest({ status: "idle" });
      } finally {
        setCommitting(false);
      }
      return;
    }

    setCommitting(true);
    try {
      const result = await commitEmbeddingConfigChange({
        previous: prev,
        next,
        confirm,
        t,
        onTestFailed: (message) => {
          setTest({ status: "fail", message: t("modelTestFailed", { message }) });
        }
      });

      if (!result.applied) {
        if (result.reason === "cancelled") {
          setDraft(prev);
        }
        return;
      }

      onProfilesChange(upsertModelProfile(profiles, next));
      await onCommit(next, {
        needsVectorRebuild: result.needsVectorRebuild,
        forceReindex: forceReindex || result.needsVectorRebuild
      });
      setTest({ status: "idle" });
    } finally {
      setCommitting(false);
    }
  }

  const tryCommitRef = useRef(tryCommit);
  tryCommitRef.current = tryCommit;
  useEffect(() => {
    onRegisterFlush?.(() => tryCommitRef.current());
    return () => onRegisterFlush?.(() => Promise.resolve());
  }, [onRegisterFlush]);
  function updateDraft(next: ModelConfig) {
    setDraft(next);
    onProfilesChange(upsertModelProfile(profiles, next));
  }

  function changeProvider(provider: NonNullable<ModelConfig["provider"]>) {
    const { profiles: nextProfiles, active } = switchModelProviderProfile(profiles, draft, provider);
    onProfilesChange(nextProfiles);
    setDraft(active);
    setTest({ status: "idle" });
  }

  async function runManualTest() {
    setTest({ status: "running" });
    try {
      const dim = await testEmbeddingConfig(draftRef.current);
      onProfilesChange(upsertModelProfile(profiles, draft));
      setTest({ status: "ok", message: t("modelTestSuccessEmbedding", { dim }) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setTest({ status: "fail", message: t("modelTestFailed", { message }) });
    }
  }

  const inputsDisabled = locked || committing;

  return (
    <BlurCommitGroup
      className={`settings-model-block${locked ? " is-locked" : ""}`}
      onCommitBlur={() => {
        if (!locked) void tryCommit();
      }}
    >
      <p className="settings-field-hint muted">{t("modelProviderProfilesHint")}</p>
      <label className="settings-field">
        <span className="settings-field-label">{t("modelProvider")}</span>
        <SettingsSelect
          disabled={locked}
          value={draft.provider ?? "openaiCompatible"}
          options={MODEL_PROVIDER_PRESETS.filter((preset) => preset.supportsEmbedding).map((preset) => ({
            value: preset.id,
            label: t(preset.labelKey)
          }))}
          onChange={(provider) => changeProvider(provider as NonNullable<ModelConfig["provider"]>)}
        />
      </label>
      <label className="settings-field">
        <span className="settings-field-label">{t("baseUrl")}</span>
        <input
          value={draft.baseUrl}
          disabled={inputsDisabled}
          onChange={(event) => updateDraft({ ...draft, baseUrl: event.target.value })}
        />
      </label>
      <label className="settings-field">
        <span className="settings-field-label">{t("apiKey")}</span>
        <input
          type="password"
          value={draft.apiKey}
          disabled={inputsDisabled}
          onChange={(event) => updateDraft({ ...draft, apiKey: event.target.value })}
        />
      </label>
      <label className="settings-field">
        <span className="settings-field-label">{t("modelName")}</span>
        <input
          value={draft.model}
          disabled={inputsDisabled}
          onChange={(event) => updateDraft({ ...draft, model: event.target.value })}
        />
      </label>
      <div className="settings-model-test--actions">
        <button
          type="button"
          className="primary small"
          disabled={inputsDisabled}
          onClick={() => void tryCommit({ forceReindex: true })}
        >
          {committing ? t("embeddingConfigApplying") : t("embeddingConfigApply")}
        </button>
        <button
          type="button"
          className="settings-model-test-btn small"
          disabled={locked || test.status === "running" || committing}
          onClick={() => void runManualTest()}
        >
          {test.status === "running" ? t("modelTestRunning") : t("modelTestConnection")}
        </button>
      </div>
      {test.status === "ok" ? <p className="settings-model-test-msg settings-model-test-msg--ok">{test.message}</p> : null}
      {test.status === "fail" ? <p className="settings-model-test-msg settings-model-test-msg--fail">{test.message}</p> : null}
    </BlurCommitGroup>
  );
}
