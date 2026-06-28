import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { EditorPane } from "./components/EditorPane";
import { defaultState } from "./defaults";
import { useConfirm } from "./hooks/useConfirm";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { applyBootSplashLogos, dismissBootSplash, persistBootTheme } from "./bootSplash";
import { initAppTimeZone } from "./services/dateTime";
import { formatUnknownError, reportErrorToUser, reportSuccessNotice } from "./services/errorReporting";
import { listenLogNodeUpdated, emitLogNodeUpdated } from "./services/logWindowSync";
import { tiptapToMarkdown } from "./services/markdown";
import { hasEmbeddingConfig, WorkshadowRag } from "./services/rag";
import { isTauriRuntime, loadState, persistLogFiles, persistState } from "./services/storage";
import { resolveEffectiveLanguage } from "./services/appLocale";
import { beginActivity, endActivity } from "./services/activityHub";
import type { AppState, LogChunk, LogNode } from "./types";

interface Props {
  logId: string;
}

export function LogWindowApp({ logId }: Props) {
  const { t, i18n } = useTranslation();
  const rag = useRef(new WorkshadowRag());
  const [state, setState] = useState<AppState>(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState(false);
  const [missing, setMissing] = useState(false);
  const { options, confirm, settle } = useConfirm();
  const stateRef = useRef(state);
  const skipNextPersistRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  stateRef.current = state;

  const node = useMemo(() => state.nodes.find((item) => item.id === logId) ?? null, [logId, state.nodes]);

  useEffect(() => {
    void (async () => {
      await initAppTimeZone();
      const loadedState = await loadState();
      skipNextPersistRef.current = true;
      persistBootTheme(loadedState.settings.theme);
      applyBootSplashLogos();
      setState(loadedState);
      setMissing(!loadedState.nodes.some((item) => item.id === logId));
      setLoaded(true);
      requestAnimationFrame(() => dismissBootSplash());
    })();
  }, [logId]);

  useEffect(() => {
    if (!loaded || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listenLogNodeUpdated((updated) => {
      if (updated.id !== logId) return;
      setState((current) => ({
        ...current,
        nodes: current.nodes.map((item) => (item.id === updated.id ? updated : item))
      }));
      setMissing(false);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [loaded, logId]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
    persistBootTheme(state.settings.theme);
    void i18n.changeLanguage(resolveEffectiveLanguage(state.settings.language));
  }, [i18n, state.settings.language, state.settings.theme]);

  useEffect(() => {
    if (!loaded || !node) return;
    void getCurrentWindow()
      .setTitle(node.title)
      .catch(() => {});
  }, [loaded, node?.title]);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      void persistState(stateRef.current).catch((e) => reportErrorToUser("persist", e));
    }, 500);
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [loaded, state]);

  const updateNode = useCallback((updated: LogNode) => {
    setState((current) => ({
      ...current,
      nodes: current.nodes.map((item) => (item.id === updated.id ? updated : item))
    }));
    void emitLogNodeUpdated(updated);
  }, []);

  const saveNode = useCallback(async () => {
    const snap = stateRef.current;
    const log = snap.nodes.find((item) => item.id === logId);
    if (!log || log.kind !== "log") return;

    const doc = log.tiptapJson ?? { type: "doc", content: [] };
    const markdown = tiptapToMarkdown(doc);
    const savedNode = { ...log, tiptapJson: doc, markdown, updatedAt: new Date().toISOString() };
    const saveId = beginActivity("save", savedNode.title);
    let paths: { markdownPath: string; jsonPath: string };
    try {
      paths = await persistLogFiles(snap.settings, snap.nodes, savedNode);
    } catch (e) {
      endActivity(saveId, e instanceof Error ? e.message : String(e));
      reportErrorToUser("writeLog", e, { severity: "toast" });
      throw e;
    }
    endActivity(saveId);

    const nextNodes = snap.nodes.map((item) => (item.id === savedNode.id ? { ...savedNode, ...paths } : item));
    let chunks: LogChunk[] = [];
    if (hasEmbeddingConfig(snap.settings)) {
      try {
        chunks = await rag.current.syncFromNodes(nextNodes, snap.settings);
      } catch (e) {
        reportErrorToUser("index", e, { logId: savedNode.id, severity: "toast" });
      }
    }

    setState((current) => ({
      ...current,
      nodes: nextNodes,
      indexStatus: chunks.length
        ? [
            ...current.indexStatus.filter((item) => item.logId !== savedNode.id),
            {
              logId: savedNode.id,
              indexedAt: new Date().toISOString(),
              chunkCount: chunks.filter((chunk) => chunk.logId === savedNode.id).length,
              status: "indexed" as const
            }
          ]
        : current.indexStatus
    }));
    void emitLogNodeUpdated({ ...savedNode, ...paths });
    reportSuccessNotice(t("saveDoneTitle"), t("saveDoneSummary", { title: savedNode.title }));
  }, [logId, t]);

  if (!loaded) return null;

  return (
    <div className="log-window-shell">
      <DesktopTitleBar title={node?.title} />
      {missing || !node ? (
        <div className="log-window-empty">
          <p>{t("logWindowMissing")}</p>
        </div>
      ) : (
        <EditorPane
          node={node}
          preview={preview}
          shortcuts={state.settings.shortcuts}
          onPreviewToggle={() => setPreview((value) => !value)}
          onChange={updateNode}
          onSave={saveNode}
          onConfirm={confirm}
        />
      )}
      <ConfirmDialog options={options} onClose={settle} />
    </div>
  );
}
