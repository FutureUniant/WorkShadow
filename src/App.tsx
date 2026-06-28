import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Moon, ScanSearch, Search, Settings, Sparkles, SquarePen, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import { BatchPanel } from "./components/BatchPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorPane } from "./components/EditorPane";
import { LogTree } from "./components/LogTree";
import { MoveTargetDialog } from "./components/MoveTargetDialog";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsPanel, type SettingsMajor } from "./components/SettingsPanel";
import { WorkspaceDrawer, type WorkspaceAskPhase, type WorkspaceTab } from "./components/WorkspaceDrawer";
import { defaultState } from "./defaults";
import { useConfirm } from "./hooks/useConfirm";
import { usePrompt } from "./hooks/usePrompt";
import { PromptDialog } from "./components/PromptDialog";
import { appLog } from "./services/appLogger";
import { initAppTimeZone } from "./services/dateTime";
import { formatUnknownError, reportErrorToUser, reportErrorWithRetry, reportSuccessNotice } from "./services/errorReporting";
import { applyGlobalNewLogShortcut, clearGlobalShortcuts } from "./services/globalShortcutRegistration";
import { tiptapToMarkdown } from "./services/markdown";
import { beginActivity, endActivity } from "./services/activityHub";
import { hasEmbeddingConfig, WorkshadowRag } from "./services/rag";
import {
  didLastLoadUseFallback,
  loadState,
  isTauriRuntime,
  persistLogFiles,
  persistState
} from "./services/storage";
import { normalizeDocumentGenerationPrefs } from "./services/documentPrefs";
import { logUserAction } from "./services/apiTrace";
import { upsertModelProfile } from "./services/modelProfiles";
import { isLocaleZhFromSettings, resolveEffectiveLanguage } from "./services/appLocale";
import { askLogsFromRag, type LogQaRetrievedExcerpt, type LogQaSource } from "./services/logQa";
import { generateLogSummary, type ReportStylePreferences } from "./services/insightsReports";
import { isLlmInputTooLongError } from "./services/llmInputLimits";
import { formatShortcutParts, matchesShortcut, shortcutBindingFingerprint } from "./services/shortcuts";
import {
  appendNodesToSiblingOrder,
  createNode,
  duplicateNode,
  getChildren,
  getDescendantIds,
  normalizeSelectionToRoots,
  parentIdForNewChild,
  parentIdForNewSibling,
  reorderNodeBefore,
  wouldCreateCycle
} from "./services/tree";
import type { AppState, LogChunk, LogNode, ModelConfig, SearchResult } from "./types";
import appLogoDark from "./assets/AppDark.png";
import appLogoLight from "./assets/AppLight.png";
import { applyBootSplashLogos, dismissBootSplash, persistBootTheme } from "./bootSplash";
import { openLogWindow } from "./services/logWindow";
import { listenLogNodeUpdated } from "./services/logWindowSync";

export default function App() {
  const { t, i18n } = useTranslation();
  const rag = useRef(new WorkshadowRag());
  const [state, setState] = useState<AppState>(defaultState);
  const [activeId, setActiveId] = useState<string | null>(defaultState.nodes[1]?.id ?? null);
  const [preview, setPreview] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialMajor, setSettingsInitialMajor] = useState<SettingsMajor | undefined>();
  const [batchOpen, setBatchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { options, confirm, settle } = useConfirm();
  const { options: promptOptions, prompt, settle: settlePrompt } = usePrompt();
  const [moveDialogNodeId, setMoveDialogNodeId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("summary");
  const [workspaceReport, setWorkspaceReport] = useState({
    out: "",
    busy: false,
    inputError: null as string | null
  });
  const [workspaceAskQuestion, setWorkspaceAskQuestion] = useState("");
  const [workspaceAsk, setWorkspaceAsk] = useState({
    answer: "",
    sources: [] as LogQaSource[],
    excerpts: [] as LogQaRetrievedExcerpt[],
    phase: "idle" as WorkspaceAskPhase
  });
  const activeIdRef = useRef(activeId);
  const stateRef = useRef(state);
  const workspaceOpenRef = useRef(workspaceOpen);
  const workspaceTabRef = useRef(workspaceTab);
  const keywordSearchNoticeShownRef = useRef(false);
  const embeddingFlushRef = useRef<(() => Promise<void>) | null>(null);
  const initialIndexStartedRef = useRef(false);
  const embeddingSyncInFlightRef = useRef(false);
  const skipNextPersistRef = useRef(false);
  activeIdRef.current = activeId;
  stateRef.current = state;
  workspaceOpenRef.current = workspaceOpen;
  workspaceTabRef.current = workspaceTab;

  const insertNewLog = useCallback((parentId: string | null) => {
    const node = createNode(parentId, "log", undefined, stateRef.current.nodes);
    const cur = stateRef.current;
    const nextNodes = [...cur.nodes, node];
    setState((current) => ({
      ...current,
      nodes: nextNodes,
      expandedNodeIds: parentId ? Array.from(new Set([...current.expandedNodeIds, parentId])) : current.expandedNodeIds
    }));
    setActiveId(node.id);
    void rag.current.syncFromNodes(nextNodes, cur.settings).catch((e) => reportErrorToUser("index", e));
  }, []);

  /** 全局快捷键：新建子日志 */
  const triggerNewChildLogFromRefs = useCallback(() => {
    const cur = stateRef.current;
    insertNewLog(parentIdForNewChild(cur.nodes, activeIdRef.current));
  }, [insertNewLog]);

  /** 侧栏按钮 / 应用内快捷键：新建同级日志 */
  const triggerNewSiblingLogFromRefs = useCallback(() => {
    const cur = stateRef.current;
    insertNewLog(parentIdForNewSibling(cur.nodes, activeIdRef.current));
  }, [insertNewLog]);

  const activeNode = useMemo(() => state.nodes.find((node) => node.id === activeId) ?? null, [activeId, state.nodes]);
  const appLogo = state.settings.theme === "dark" ? appLogoDark : appLogoLight;

  const globalNewLogShortcutKey = useMemo(() => shortcutBindingFingerprint(state.settings.shortcuts.globalNewLog), [
    state.settings.shortcuts.globalNewLog.alt,
    state.settings.shortcuts.globalNewLog.code,
    state.settings.shortcuts.globalNewLog.mod,
    state.settings.shortcuts.globalNewLog.shift
  ]);

  useEffect(() => {
    void (async () => {
      await initAppTimeZone();
      void appLog("info", "app", "WorkShadow UI starting", { dev: import.meta.env.DEV, tauri: isTauriRuntime() });
      const loadedState = await loadState();
      skipNextPersistRef.current = didLastLoadUseFallback();
      persistBootTheme(loadedState.settings.theme);
      applyBootSplashLogos();
      setState(loadedState);
      const roots = getChildren(loadedState.nodes, null);
      setActiveId(roots[0]?.id ?? loadedState.nodes[0]?.id ?? null);
      setLoaded(true);
      requestAnimationFrame(() => dismissBootSplash());
      void appLog("info", "app", "WorkShadow UI ready", { nodes: loadedState.nodes.length });
      if (initialIndexStartedRef.current) return;
      initialIndexStartedRef.current = true;
      void rag.current.syncFromNodes(loadedState.nodes, loadedState.settings).catch((e) => reportErrorToUser("index", e));
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
    persistBootTheme(state.settings.theme);
    applyBootSplashLogos();
    void i18n.changeLanguage(resolveEffectiveLanguage(state.settings.language));
  }, [i18n, state.settings.language, state.settings.theme]);

  useEffect(() => {
    if (!loaded || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listenLogNodeUpdated((node) => {
      setState((current) => ({
        ...current,
        nodes: current.nodes.map((item) => (item.id === node.id ? node : item))
      }));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      void appLog("warn", "storage", "Skipped first automatic persist after fallback load");
      return;
    }
    void persistState(stateRef.current).catch((e) =>
      reportErrorWithRetry("persist", e, () => {
        void persistState(stateRef.current).catch((e2) => reportErrorToUser("persist", e2));
      })
    );
  }, [loaded, state]);

  useEffect(() => {
    const onMove = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId: string; parentId: string }>).detail;
      moveNodes([detail.nodeId], detail.parentId);
    };
    const onReorder = (event: Event) => {
      const detail = (event as CustomEvent<{ movingId: string; targetId: string }>).detail;
      reorderActiveBeforeTarget(detail.movingId, detail.targetId);
    };
    window.addEventListener("workshadow:move-node", onMove);
    window.addEventListener("workshadow:reorder-node", onReorder);
    return () => {
      window.removeEventListener("workshadow:move-node", onMove);
      window.removeEventListener("workshadow:reorder-node", onReorder);
    };
  }, []);

  useEffect(() => {
    const h = () => {
      triggerNewChildLogFromRefs();
    };
    window.addEventListener("workshadow:global-new-log", h);
    return () => window.removeEventListener("workshadow:global-new-log", h);
  }, [triggerNewChildLogFromRefs]);

  useEffect(() => {
    if (!loaded || !isTauriRuntime()) return;
    void applyGlobalNewLogShortcut(state.settings.shortcuts.globalNewLog, () => {
      window.dispatchEvent(new CustomEvent("workshadow:global-new-log"));
    }).catch((e) => reportErrorToUser("globalShortcut", e));
    return () => {
      void clearGlobalShortcuts();
    };
  }, [loaded, globalNewLogShortcutKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (settingsOpen) return;
      if (!matchesShortcut(event, state.settings.shortcuts.newLog)) return;
      const el = event.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      triggerNewSiblingLogFromRefs();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, state.settings.shortcuts, triggerNewSiblingLogFromRefs]);

  function keywordFallbackNotice() {
    const snap = stateRef.current;
    if (keywordSearchNoticeShownRef.current || hasEmbeddingConfig(snap.settings)) return;
    keywordSearchNoticeShownRef.current = true;
    reportErrorToUser("searchNotice", new Error("keyword-only"));
  }

  const runWorkspaceSummary = useCallback(
    (logIds: string[], preferences: ReportStylePreferences) => {
      if (workspaceReport.busy) return;
      const snap = stateRef.current;
      setWorkspaceReport({ out: "", busy: true, inputError: null });
      void (async () => {
        try {
          await generateLogSummary(snap.settings, {
            logIds,
            nodes: snap.nodes,
            memory: snap.memoryEntries,
            localeZh: isLocaleZhFromSettings(snap.settings),
            preferences,
            onDelta: (delta) => setWorkspaceReport((prev) => ({ ...prev, out: prev.out + delta }))
          });
          if (!workspaceOpenRef.current || workspaceTabRef.current !== "summary") {
            reportSuccessNotice(t("workspaceSummaryDoneTitle"), t("workspaceSummaryDoneSummary"));
          }
        } catch (e) {
          if (isLlmInputTooLongError(e)) {
            setWorkspaceReport((prev) => ({ ...prev, inputError: t("workspaceSummaryInputTooLong") }));
          } else {
            setWorkspaceOpen(false);
            reportErrorToUser("report", e);
          }
        } finally {
          setWorkspaceReport((prev) => ({ ...prev, busy: false }));
        }
      })();
    },
    [t, workspaceReport.busy]
  );

  const runWorkspaceAsk = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q || workspaceAsk.phase !== "idle") return;
      const snap = stateRef.current;
      setWorkspaceAsk({ answer: "", sources: [], excerpts: [], phase: "retrieving" });
      void (async () => {
        try {
          await askLogsFromRag(rag.current, q, snap.nodes, snap.settings, {
            localeZh: isLocaleZhFromSettings(snap.settings),
            memory: snap.memoryEntries,
            onKeywordFallbackNotice: keywordFallbackNotice,
            onRetrieval: ({ sources, excerpts }) => {
              setWorkspaceAsk((prev) => ({ ...prev, sources, excerpts, phase: "answering" }));
            },
            onAnswerDelta: (delta) => {
              setWorkspaceAsk((prev) => ({ ...prev, answer: prev.answer + delta }));
            }
          });
          if (!workspaceOpenRef.current || workspaceTabRef.current !== "ask") {
            reportSuccessNotice(t("workspaceAskDoneTitle"), t("workspaceAskDoneSummary"));
          }
        } catch (e) {
          setWorkspaceOpen(false);
          reportErrorToUser("report", e);
        } finally {
          setWorkspaceAsk((prev) => ({ ...prev, phase: "idle" }));
        }
      })();
    },
    [t, workspaceAsk.phase]
  );

  return (
    <div className="app-root">
      {!settingsOpen ? (
        <a href="#main-content" className="skip-link">
          {t("skipToMain")}
        </a>
      ) : null}
      <DesktopTitleBar />
      {settingsOpen ? (
        <SettingsPanel
          open
          initialMajor={settingsInitialMajor}
          settings={state.settings}
          onChange={(settings) => setState((current) => ({ ...current, settings }))}
          onBack={async () => {
            await embeddingFlushRef.current?.();
            setSettingsOpen(false);
            setSettingsInitialMajor(undefined);
          }}
          confirm={confirm}
          embeddingFlushRef={embeddingFlushRef}
          onEmbeddingCommit={handleEmbeddingCommit}
          onBeforeDataTransfer={async () => {
            await embeddingFlushRef.current?.();
            await persistState(stateRef.current);
          }}
          onDataImported={async () => {
            const loaded = await loadState();
            setState(loaded);
            const roots = getChildren(loaded.nodes, null);
            setActiveId(roots[0]?.id ?? loaded.nodes[0]?.id ?? null);
            await rag.current.syncFromNodes(loaded.nodes, loaded.settings);
          }}
        />
      ) : (
      <div className="app" id="main-content" tabIndex={-1}>
      <aside className="sidebar">
        <header className="brand">
          <img className="brand-logo" src={appLogo} alt="" aria-label={t("appName")} width={180} height={40} decoding="async" />
          <div className="brand-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setSettingsInitialMajor(undefined);
                setSettingsOpen(true);
              }}
              aria-label={t("settings")}
            >
              <Settings size={18} />
            </button>
          </div>
        </header>
        <div className="sidebar-search-block">
          <div className={`search-box${searchFocused ? " is-focused" : ""}`}>
            <Search size={16} className="search-box__icon" aria-hidden />
            <input
              className="search-box__input"
              value={query}
              placeholder={searchFocused ? "" : t("searchPlaceholder")}
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                if (!value.trim()) setResults([]);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void runSearch();
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              aria-label={t("searchPlaceholder")}
              title={t("searchEnterHint")}
            />
            <button
              type="button"
              className="search-box__semantic"
              onClick={() => void runSearch()}
              title={t("semanticSearch")}
              aria-label={t("semanticSearch")}
            >
              <ScanSearch size={15} strokeWidth={2} aria-hidden />
              <span className="search-box__semantic-label">{t("semanticSearchShort")}</span>
            </button>
          </div>
          <button
            type="button"
            className="new-log-button"
            onClick={createRootLog}
            title={`${t("newLog")} — ${formatShortcutParts(state.settings.shortcuts.newLog).join(" ")}`}
          >
            <SquarePen size={18} strokeWidth={2} className="new-log-button__icon" aria-hidden />
            <span className="new-log-button__label">{t("newLog")}</span>
            <span className="new-log-button__kbd" aria-hidden>
              {formatShortcutParts(state.settings.shortcuts.newLog).map((part, i) => (
                <kbd key={`${i}-${part}`}>{part}</kbd>
              ))}
            </span>
          </button>
        </div>
        {results.length > 0 ? (
          <div className="sidebar-search-results-scroll">
            <SearchPanel results={results} onSelect={setActiveId} />
          </div>
        ) : null}
        <div
          className="sidebar-tree-scroll"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setActiveId(null);
          }}
        >
          <LogTree
            nodes={state.nodes}
            activeId={activeId}
            expandedIds={state.expandedNodeIds}
            treeMenuCloseBinding={state.settings.shortcuts.treeMenuClose}
            onSelect={setActiveId}
            onToggle={toggleExpanded}
            onOpenInWindow={(node) => void openLogWindow(node)}
            onAction={handleTreeAction}
          />
        </div>
        <footer className="sidebar-footer">
          <button className="ghost" onClick={() => setBatchOpen(true)}>{t("batch")}</button>
          <button
            type="button"
            className="icon-button sidebar-workspace-btn"
            onClick={() => setWorkspaceOpen(true)}
            title={t("workspaceTitle")}
            aria-label={t("workspaceTitle")}
          >
            <Sparkles size={18} strokeWidth={2} aria-hidden />
          </button>
          <button className="icon-button" onClick={toggleTheme} aria-label="theme">
            {state.settings.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </footer>
      </aside>
      <EditorPane
        node={activeNode}
        preview={preview}
        shortcuts={state.settings.shortcuts}
        onPreviewToggle={() => setPreview((value) => !value)}
        onChange={updateNode}
        onSave={saveActiveNode}
        onConfirm={confirm}
      />
      <BatchPanel open={batchOpen} nodes={state.nodes} onClose={() => setBatchOpen(false)} onMove={moveNodes} onDelete={deleteNodesWithConfirm} />
      <MoveTargetDialog
        open={moveDialogNodeId !== null}
        nodes={state.nodes}
        movingId={moveDialogNodeId ?? ""}
        onClose={() => setMoveDialogNodeId(null)}
        onConfirm={(parentId) => {
          if (!moveDialogNodeId) return;
          moveNodes([moveDialogNodeId], parentId);
          setMoveDialogNodeId(null);
        }}
      />
      <ConfirmDialog options={options} onClose={settle} />
      <PromptDialog options={promptOptions} onClose={settlePrompt} />
      </div>
      )}
      <WorkspaceDrawer
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        tab={workspaceTab}
        onTabChange={setWorkspaceTab}
        activeLogId={activeId}
        memoryEntries={state.memoryEntries}
        onMemoryChange={(next) => setState((s) => ({ ...s, memoryEntries: next }))}
        documentGenerationPrefs={state.documentGenerationPrefs}
        onDocumentGenerationPrefsChange={(next) => setState((s) => ({ ...s, documentGenerationPrefs: next }))}
        nodes={state.nodes}
        reportOut={workspaceReport.out}
        reportBusy={workspaceReport.busy}
        reportInputError={workspaceReport.inputError}
        onRunSummary={runWorkspaceSummary}
        askQuestion={workspaceAskQuestion}
        askAnswer={workspaceAsk.answer}
        askSources={workspaceAsk.sources}
        askExcerpts={workspaceAsk.excerpts}
        askPhase={workspaceAsk.phase}
        onAskQuestionChange={setWorkspaceAskQuestion}
        onRunAsk={runWorkspaceAsk}
        onOpenLog={(logId) => {
          setActiveId(logId);
          setWorkspaceOpen(false);
        }}
      />
    </div>
  );

  function toggleTheme() {
    setState((current) => ({
      ...current,
      settings: { ...current.settings, theme: current.settings.theme === "dark" ? "light" : "dark" }
    }));
  }

  function toggleExpanded(id: string) {
    setState((current) => ({
      ...current,
      expandedNodeIds: current.expandedNodeIds.includes(id)
        ? current.expandedNodeIds.filter((nodeId) => nodeId !== id)
        : [...current.expandedNodeIds, id]
    }));
  }

  function updateNode(node: LogNode) {
    setState((current) => ({ ...current, nodes: current.nodes.map((item) => (item.id === node.id ? node : item)) }));
  }

  function handleTreeAction(action: "child" | "sibling" | "rename" | "move" | "duplicate" | "delete", node: LogNode) {
    if (action === "child") addNode(node.id);
    if (action === "sibling") addNode(node.parentId);
    if (action === "rename") void renameNode(node);
    if (action === "move") setMoveDialogNodeId(node.id);
    if (action === "duplicate") duplicateSingleNode(node.id);
    if (action === "delete") void deleteNodesWithConfirm([node.id]);
  }

  function createRootLog() {
    triggerNewSiblingLogFromRefs();
  }

  function addNode(parentId: string | null) {
    insertNewLog(parentId);
  }

  async function renameNode(node: LogNode) {
    const title = await prompt({
      title: t("rename"),
      message: t("renamePromptHint"),
      defaultValue: node.title,
      placeholder: t("title")
    });
    if (!title?.trim()) return;
    const current = stateRef.current;
    const trimmed = title.trim();
    const updatedAt = new Date().toISOString();
    const nextNodes = current.nodes.map((n) => (n.id === node.id ? { ...n, title: trimmed, updatedAt } : n));
    setState((s) => ({ ...s, nodes: nextNodes }));
    void rag.current.syncFromNodes(nextNodes, current.settings).catch((e) => reportErrorToUser("index", e));
  }

  function duplicateSingleNode(id: string) {
    const current = stateRef.current;
    const copy = duplicateNode(current.nodes, id);
    if (!copy) return;
    const nextNodes = [...current.nodes, copy];
    setState((s) => ({ ...s, nodes: nextNodes }));
    void rag.current.syncFromNodes(nextNodes, current.settings).catch((e) => reportErrorToUser("index", e));
  }

  function reorderActiveBeforeTarget(movingId: string, targetId: string) {
    const current = stateRef.current;
    const nextNodes = reorderNodeBefore(current.nodes, movingId, targetId);
    if (nextNodes === current.nodes) return;
    setState((s) => ({ ...s, nodes: nextNodes }));
    void rag.current.syncFromNodes(nextNodes, current.settings).catch((e) => reportErrorToUser("index", e));
  }

  function moveNodes(ids: string[], parentId: string | null) {
    const current = stateRef.current;
    const roots = normalizeSelectionToRoots(current.nodes, ids);
    const moving = new Set(roots);
    const validIds = roots.filter((id) => !wouldCreateCycle(current.nodes, id, parentId) && !moving.has(parentId ?? ""));
    let nextNodes = current.nodes.map((node) =>
      validIds.includes(node.id) ? { ...node, parentId, updatedAt: new Date().toISOString() } : node
    );
    if (validIds.length > 0) {
      nextNodes = appendNodesToSiblingOrder(nextNodes, parentId, validIds);
    }
    setState((s) => ({ ...s, nodes: nextNodes }));
    void rag.current.syncFromNodes(nextNodes, current.settings).catch((e) => reportErrorToUser("index", e));
  }

  async function deleteNodesWithConfirm(ids: string[]) {
    const ok = await confirm({
      title: t("deleteTitle"),
      message: ids.length > 1 ? t("batchDeleteMessage") : t("deleteMessage"),
      danger: true
    });
    if (!ok) return;
    const current = stateRef.current;
    const roots = normalizeSelectionToRoots(current.nodes, ids);
    const deleteSet = new Set(roots.flatMap((id) => [id, ...getDescendantIds(current.nodes, id)]));
    const nextNodes = current.nodes.filter((node) => !deleteSet.has(node.id));
    if (activeId && deleteSet.has(activeId)) setActiveId(nextNodes[0]?.id ?? null);
    setState((s) => ({ ...s, nodes: nextNodes }));
    void rag.current.syncFromNodes(nextNodes, current.settings).catch((e) => reportErrorToUser("index", e));
  }

  async function handleEmbeddingCommit(
    embedding: ModelConfig,
    options: { needsVectorRebuild: boolean; forceReindex?: boolean }
  ) {
    if (embeddingSyncInFlightRef.current) return;
    embeddingSyncInFlightRef.current = true;
    const cur = stateRef.current;
    const embeddingProfiles = upsertModelProfile(cur.settings.embeddingProfiles, embedding);
    const nextSettings = { ...cur.settings, embedding, embeddingProfiles };
    setState((s) => ({ ...s, settings: nextSettings }));
    if (!hasEmbeddingConfig(nextSettings)) {
      embeddingSyncInFlightRef.current = false;
      return;
    }
    const reembedAll = Boolean(options.needsVectorRebuild || options.forceReindex);
    try {
      const chunks = await rag.current.syncFromNodes(cur.nodes, nextSettings, {
        reembedAllVectors: reembedAll,
        activityKind: reembedAll ? "vectorRebuild" : "embedding"
      });
      reportSuccessNotice(
        t("embeddingIndexDoneTitle"),
        t("embeddingIndexDoneSummary", { count: chunks.length, model: embedding.model.trim() })
      );
    } catch (e) {
      reportErrorToUser("index", e);
    } finally {
      embeddingSyncInFlightRef.current = false;
    }
  }

  async function saveActiveNode() {
    const id = activeIdRef.current;
    const snap = stateRef.current;
    const log = snap.nodes.find((n) => n.id === id);
    if (!log || log.kind !== "log") return;

    const doc = log.tiptapJson ?? { type: "doc", content: [] };
    const markdown = tiptapToMarkdown(doc);
    const jsonChanged = JSON.stringify(doc) !== JSON.stringify(log.tiptapJson);
    const mdChanged = markdown !== (log.markdown ?? "");
    const updatedAt = jsonChanged || mdChanged ? new Date().toISOString() : log.updatedAt;
    const savedNode = { ...log, tiptapJson: doc, markdown, updatedAt };
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
    const nextNodes = snap.nodes.map((node) => (node.id === savedNode.id ? { ...savedNode, ...paths } : node));
    let chunks: LogChunk[];
    try {
      chunks = await rag.current.syncFromNodes(nextNodes, snap.settings);
    } catch (e) {
      reportErrorToUser("index", e, { logId: savedNode.id, severity: "toast" });
      setState((current) => ({
        ...current,
        nodes: nextNodes,
        indexStatus: [
          ...current.indexStatus.filter((item) => item.logId !== savedNode.id),
          {
            logId: savedNode.id,
            indexedAt: new Date().toISOString(),
            chunkCount: 0,
            status: "failed",
            error: formatUnknownError(e)
          }
        ]
      }));
      throw e;
    }
    setState((current) => ({
      ...current,
      nodes: nextNodes,
      indexStatus: [
        ...current.indexStatus.filter((item) => item.logId !== savedNode.id),
        {
          logId: savedNode.id,
          indexedAt: new Date().toISOString(),
          chunkCount: chunks.filter((chunk) => chunk.logId === savedNode.id).length,
          status: "indexed"
        }
      ]
    }));
    reportSuccessNotice(t("saveDoneTitle"), t("saveDoneSummary", { title: savedNode.title }));
  }

  async function runSearch() {
    try {
      const trimmed = query.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      const snap = stateRef.current;
      const hits = await rag.current.searchDocuments(trimmed, snap.nodes, snap.settings, {
        onKeywordFallbackNotice: keywordFallbackNotice
      });
      setResults(hits);
      void logUserAction("search", "sidebar_search", { queryLength: trimmed.length, resultCount: hits.length });
    } catch (e) {
      reportErrorToUser("search", e);
      setResults([]);
    }
  }

}
