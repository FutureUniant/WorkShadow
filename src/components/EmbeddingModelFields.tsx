import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AppSettings, ConfirmOptions, ModelConfig, ModelProfiles } from "../types";
import { commitEmbeddingConfigChange, isEmbeddingConfigComplete } from "../services/embeddingConfig";
import { modelConfigEqual, upsertModelProfile } from "../services/modelProfiles";
import { testEmbeddingConfig } from "../services/modelTest";
import { ModelConfigFields } from "./ModelConfigFields";

type ModelTestState = { status: "idle" } | { status: "running" } | { status: "ok"; message: string } | { status: "fail"; message: string };

interface Props {
  committed: Pick<AppSettings, "embedding" | "embeddingProfiles">;
  onCommit: (
    patch: Pick<AppSettings, "embedding" | "embeddingProfiles">,
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

function profilesSnapshot(profiles: ModelProfiles | undefined): string {
  return JSON.stringify(profiles ?? {});
}

export function EmbeddingModelFields({ committed, onCommit, confirm, onRegisterFlush }: Props) {
  const { t } = useTranslation();
  const [draftConfig, setDraftConfig] = useState(committed.embedding);
  const [draftProfiles, setDraftProfiles] = useState<ModelProfiles>(committed.embeddingProfiles ?? {});
  const [test, setTest] = useState<ModelTestState>({ status: "idle" });
  const [committing, setCommitting] = useState(false);
  const draftConfigRef = useRef(draftConfig);
  const draftProfilesRef = useRef(draftProfiles);
  const committedRef = useRef(committed);
  draftConfigRef.current = draftConfig;
  draftProfilesRef.current = draftProfiles;
  committedRef.current = committed;

  useEffect(() => {
    setDraftConfig(committed.embedding);
    setDraftProfiles(committed.embeddingProfiles ?? {});
  }, [committed]);

  function draftPatch(): Pick<AppSettings, "embedding" | "embeddingProfiles"> {
    const provider = draftConfigRef.current.provider ?? "openaiCompatible";
    const profiles = upsertModelProfile(draftProfilesRef.current, draftConfigRef.current);
    return {
      embedding: { ...draftConfigRef.current, provider },
      embeddingProfiles: profiles
    };
  }

  async function tryCommit(options?: { forceReindex?: boolean }) {
    if (committing) return;
    const prev = committedRef.current;
    const next = draftPatch();
    const forceReindex = Boolean(options?.forceReindex);

    const unchanged =
      modelConfigEqual(prev.embedding, next.embedding) &&
      profilesSnapshot(prev.embeddingProfiles) === profilesSnapshot(next.embeddingProfiles);

    if (unchanged) {
      if (!forceReindex) return;
      if (!isEmbeddingConfigComplete(next.embedding)) {
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
          setDraftConfig(prev.embedding);
          setDraftProfiles(prev.embeddingProfiles ?? {});
        }
        return;
      }

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

  async function runManualTest() {
    setTest({ status: "running" });
    try {
      const dim = await testEmbeddingConfig(draftConfigRef.current);
      setTest({ status: "ok", message: t("modelTestSuccessEmbedding", { dim }) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setTest({ status: "fail", message: t("modelTestFailed", { message }) });
    }
  }

  return (
    <BlurCommitGroup onCommitBlur={() => void tryCommit()}>
      <ModelConfigFields
        value={draftConfig}
        profiles={draftProfiles}
        embeddingOnly
        disabled={committing}
        hideTestButton
        onChange={(config, profiles) => {
          setDraftConfig(config);
          setDraftProfiles(profiles);
        }}
        onTest={testEmbeddingConfig}
        testSuccessMessage={t("modelTestSuccessEmbedding", { dim: "?" })}
        extraActions={
          <div className="settings-model-test--actions">
            <button type="button" className="primary small" disabled={committing} onClick={() => void tryCommit({ forceReindex: true })}>
              {committing ? t("embeddingConfigApplying") : t("embeddingConfigApply")}
            </button>
            <button
              type="button"
              className="settings-model-test-btn small"
              disabled={test.status === "running" || committing}
              onClick={() => void runManualTest()}
            >
              {test.status === "running" ? t("modelTestRunning") : t("modelTestConnection")}
            </button>
          </div>
        }
      />
      {test.status === "ok" ? <p className="settings-model-test-msg settings-model-test-msg--ok">{test.message}</p> : null}
      {test.status === "fail" ? <p className="settings-model-test-msg settings-model-test-msg--fail">{test.message}</p> : null}
    </BlurCommitGroup>
  );
}
