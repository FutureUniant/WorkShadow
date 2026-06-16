import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ClipboardList, FileText, Folder, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { AppSettings, DocumentGenerationPref, LogNode, MemoryEntry } from "../types";
import {
  DOC_PREF_LOG_SUMMARY,
  getLogSummaryPref,
  upsertDocumentPref
} from "../services/documentPrefs";
import { generateLogSummary } from "../services/insightsReports";
import type { AskLogsFromRagCallbacks, LogQaRetrievedExcerpt, LogQaSource } from "../services/logQa";
import { isLlmInputTooLongError } from "../services/llmInputLimits";
import { reportErrorToUser } from "../services/errorReporting";
import { isLocaleZhFromSettings } from "../services/appLocale";
import { collectDescendantLogIds, getChildrenSorted, listAllLogIds } from "../services/tree";
import { WorkspaceMarkdown } from "./WorkspaceMarkdown";

interface Props {
  open: boolean;
  onClose: () => void;
  activeLogId: string | null;
  memoryEntries: MemoryEntry[];
  onMemoryChange: (next: MemoryEntry[]) => void;
  documentGenerationPrefs: DocumentGenerationPref[];
  onDocumentGenerationPrefsChange: (next: DocumentGenerationPref[]) => void;
  nodes: LogNode[];
  settings: AppSettings;
  onAskLogs: (question: string, callbacks?: AskLogsFromRagCallbacks) => Promise<unknown>;
  onOpenLog?: (logId: string) => void;
}

type WorkspaceTab = "summary" | "ask" | "memory";

export function WorkspaceDrawer({
  open,
  onClose,
  activeLogId,
  memoryEntries,
  onMemoryChange,
  documentGenerationPrefs,
  onDocumentGenerationPrefsChange,
  nodes,
  settings,
  onAskLogs,
  onOpenLog
}: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<WorkspaceTab>("summary");
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [reportOut, setReportOut] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportInputError, setReportInputError] = useState<string | null>(null);
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askSources, setAskSources] = useState<LogQaSource[]>([]);
  const [askExcerpts, setAskExcerpts] = useState<LogQaRetrievedExcerpt[]>([]);
  const [askPhase, setAskPhase] = useState<"idle" | "retrieving" | "answering">("idle");
  const reportOutRef = useRef<HTMLDivElement>(null);
  const askAnswerRef = useRef<HTMLDivElement>(null);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState({ title: "", body: "" });
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  const localeZh = isLocaleZhFromSettings(settings);
  const sortedMemoryEntries = useMemo(
    () => [...memoryEntries].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [memoryEntries]
  );
  const { focus, style } = getLogSummaryPref(documentGenerationPrefs);

  const allLogIds = useMemo(() => listAllLogIds(nodes), [nodes]);
  const branchIds = useMemo(
    () => nodes.filter((n) => nodes.some((c) => c.parentId === n.id)).map((n) => n.id),
    [nodes]
  );

  useEffect(() => {
    if (!open) return;
    setExpandedIds(branchIds.length ? [...branchIds] : []);
  }, [open, branchIds]);

  useEffect(() => {
    if (!open || !activeLogId) return;
    const node = nodes.find((n) => n.id === activeLogId);
    if (node?.kind !== "log") return;
    setSelectedLogIds((prev) => (prev.length ? prev : [activeLogId]));
  }, [open, activeLogId, nodes]);

  useEffect(() => {
    if (tab !== "memory") setEditingMemoryId(null);
  }, [tab]);

  const askBusy = askPhase !== "idle";

  function scrollOutputToEnd(ref: React.RefObject<HTMLDivElement | null>) {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  useEffect(() => {
    if (reportBusy) scrollOutputToEnd(reportOutRef);
  }, [reportOut, reportBusy]);

  useEffect(() => {
    if (askPhase === "answering") scrollOutputToEnd(askAnswerRef);
  }, [askAnswer, askPhase]);

  if (!open) return null;

  function startEditMemory(entry: MemoryEntry) {
    setEditingMemoryId(entry.id);
    setMemoryDraft({ title: entry.title, body: entry.body });
  }

  function addMemory() {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m-${Date.now()}`;
    const entry: MemoryEntry = { id, title: "", body: "", updatedAt: new Date().toISOString() };
    onMemoryChange([entry, ...memoryEntries]);
    setEditingMemoryId(id);
    setMemoryDraft({ title: "", body: "" });
  }

  const canSaveMemory = Boolean(memoryDraft.title.trim() && memoryDraft.body.trim());

  function saveMemory() {
    if (!editingMemoryId || !canSaveMemory) return;
    const now = new Date().toISOString();
    onMemoryChange(
      memoryEntries.map((m) =>
        m.id === editingMemoryId ? { ...m, title: memoryDraft.title, body: memoryDraft.body, updatedAt: now } : m
      )
    );
    setEditingMemoryId(null);
  }

  function cancelMemoryEdit() {
    if (!editingMemoryId) return;
    const entry = memoryEntries.find((m) => m.id === editingMemoryId);
    if (entry && !entry.title.trim() && !entry.body.trim()) {
      onMemoryChange(memoryEntries.filter((m) => m.id !== editingMemoryId));
    }
    setEditingMemoryId(null);
  }

  function removeMemory(id: string) {
    onMemoryChange(memoryEntries.filter((m) => m.id !== id));
    if (editingMemoryId === id) setEditingMemoryId(null);
  }

  function toggleExpanded(id: string) {
    setExpandedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleLogTreeNode(id: string) {
    const descendantLogIds = collectDescendantLogIds(nodes, id);
    if (!descendantLogIds.length) return;
    const allSelected = descendantLogIds.every((logId) => selectedLogIds.includes(logId));
    setSelectedLogIds((prev) => {
      if (allSelected) {
        const remove = new Set(descendantLogIds);
        return prev.filter((x) => !remove.has(x));
      }
      return [...new Set([...prev, ...descendantLogIds])];
    });
  }

  function selectAllLogs() {
    setSelectedLogIds(allLogIds);
  }

  function clearLogSelection() {
    setSelectedLogIds([]);
  }

  function renderLogPickTree(parentId: string | null, depth: number): React.ReactNode {
    return getChildrenSorted(nodes, parentId).map((node) => {
      const children = getChildrenSorted(nodes, node.id);
      const hasChildren = children.length > 0;
      const expanded = expandedIds.includes(node.id);
      const descendantLogIds = collectDescendantLogIds(nodes, node.id);
      const checked =
        descendantLogIds.length > 0 && descendantLogIds.every((logId) => selectedLogIds.includes(logId));
      const indeterminate =
        !checked && descendantLogIds.some((logId) => selectedLogIds.includes(logId));
      const noLogs = descendantLogIds.length === 0;

      return (
        <li key={node.id} className="workspace-log-pick__tree-node">
          <div className="workspace-log-pick__tree-row" style={{ paddingLeft: depth * 16 }}>
            <button
              type="button"
              className="icon-button workspace-log-pick__chevron"
              onClick={() => toggleExpanded(node.id)}
              aria-label="toggle"
              disabled={!hasChildren}
            >
              {hasChildren ? (
                expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
              ) : (
                <span className="spacer" />
              )}
            </button>
            <label className={`workspace-log-pick__item${checked ? " is-checked" : ""}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={noLogs}
                ref={(el) => {
                  if (el) el.indeterminate = indeterminate;
                }}
                onChange={() => toggleLogTreeNode(node.id)}
              />
              {hasChildren ? (
                <Folder size={16} className="workspace-log-pick__icon" aria-hidden />
              ) : (
                <FileText size={16} className="workspace-log-pick__icon" aria-hidden />
              )}
              <span className="workspace-log-pick__item-text">
                <span className="workspace-log-pick__title">{node.title}</span>
              </span>
            </label>
          </div>
          {hasChildren && expanded ? (
            <ul className="workspace-log-pick__tree-children">{renderLogPickTree(node.id, depth + 1)}</ul>
          ) : null}
        </li>
      );
    });
  }

  async function runSummary() {
    if (!selectedLogIds.length) return;
    setReportBusy(true);
    setReportOut("");
    setReportInputError(null);
    try {
      await generateLogSummary(settings, {
        logIds: selectedLogIds,
        nodes,
        memory: memoryEntries,
        localeZh,
        preferences: { focus, style },
        onDelta: (delta) => setReportOut((prev) => prev + delta)
      });
    } catch (e) {
      if (isLlmInputTooLongError(e)) {
        setReportInputError(t("workspaceSummaryInputTooLong"));
      } else {
        reportErrorToUser("report", e);
      }
    } finally {
      setReportBusy(false);
    }
  }

  async function copyReport() {
    if (!reportOut) return;
    try {
      await navigator.clipboard.writeText(reportOut);
    } catch (e) {
      reportErrorToUser("report", e);
    }
  }

  function patchSummaryPref(patch: Partial<Pick<DocumentGenerationPref, "focus" | "style">>) {
    onDocumentGenerationPrefsChange(upsertDocumentPref(documentGenerationPrefs, DOC_PREF_LOG_SUMMARY, patch));
  }

  async function runAsk() {
    const q = askQuestion.trim();
    if (!q || askBusy) return;
    setAskPhase("retrieving");
    setAskAnswer("");
    setAskSources([]);
    setAskExcerpts([]);
    try {
      await onAskLogs(q, {
        onRetrieval: ({ sources, excerpts }) => {
          setAskSources(sources);
          setAskExcerpts(excerpts);
          setAskPhase("answering");
        },
        onAnswerDelta: (delta) => setAskAnswer((prev) => prev + delta)
      });
    } catch (e) {
      reportErrorToUser("report", e);
    } finally {
      setAskPhase("idle");
    }
  }

  async function copyAskAnswer() {
    if (!askAnswer) return;
    try {
      await navigator.clipboard.writeText(askAnswer);
    } catch (e) {
      reportErrorToUser("report", e);
    }
  }

  const canGenerate = selectedLogIds.length > 0 && !reportBusy;
  const canAsk = askQuestion.trim().length > 0 && !askBusy;

  const askRunLabel =
    askPhase === "retrieving"
      ? t("workspaceAskRetrieving")
      : askPhase === "answering"
        ? t("workspaceAskStreaming")
        : t("workspaceAskRun");

  const reportRunLabel =
    reportBusy && reportOut ? t("workspaceReportStreaming") : reportBusy ? t("workspaceReportBusy") : t("workspaceReportRun");

  return (
    <div className="workspace-drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="workspace-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-drawer-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="workspace-drawer__header">
          <h2 id="workspace-drawer-title" className="workspace-drawer__title">
            <span className="workspace-drawer__title-icon" aria-hidden>
              <Sparkles size={18} strokeWidth={2} />
            </span>
            {t("workspaceTitle")}
          </h2>
          <button type="button" className="icon-button workspace-drawer__close" onClick={onClose} aria-label={t("close")}>
            <X size={18} />
          </button>
        </header>
        <div className="workspace-drawer__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "summary"}
            className={`workspace-drawer__tab${tab === "summary" ? " is-active" : ""}`}
            onClick={() => setTab("summary")}
          >
            {t("workspaceTabSummary")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "ask"}
            className={`workspace-drawer__tab${tab === "ask" ? " is-active" : ""}`}
            onClick={() => setTab("ask")}
          >
            {t("workspaceTabAsk")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "memory"}
            className={`workspace-drawer__tab${tab === "memory" ? " is-active" : ""}`}
            onClick={() => setTab("memory")}
          >
            {t("workspaceTabMemory")}
          </button>
        </div>
        <div className="workspace-drawer__body">
          {tab === "memory" ? (
            <div className="workspace-memory workspace-panel-card">
              <p className="muted workspace-memory__hint">{t("workspaceMemoryHint")}</p>
              <button type="button" className="workspace-soft-button workspace-memory__add" onClick={addMemory}>
                {t("workspaceMemoryAdd")}
              </button>
              <ul className="workspace-memory__list">
                {sortedMemoryEntries.map((m) => {
                  const isEditing = editingMemoryId === m.id;
                  return (
                    <li key={m.id} className={`workspace-memory__item${isEditing ? " is-editing" : " is-view"}`}>
                      {isEditing ? (
                        <>
                          <label className="workspace-memory__field">
                            <span className="workspace-report__label-text">{t("workspaceMemoryTitleLabel")}</span>
                            <input
                              className="workspace-field workspace-memory__title"
                              value={memoryDraft.title}
                              onChange={(e) => setMemoryDraft((d) => ({ ...d, title: e.target.value }))}
                              placeholder={t("workspaceMemoryTitlePlaceholder")}
                              aria-label={t("workspaceMemoryTitleLabel")}
                            />
                          </label>
                          <label className="workspace-memory__field">
                            <span className="workspace-report__label-text">{t("workspaceMemoryBodyLabel")}</span>
                            <textarea
                              className="workspace-field workspace-memory__body"
                              value={memoryDraft.body}
                              onChange={(e) => setMemoryDraft((d) => ({ ...d, body: e.target.value }))}
                              rows={4}
                              placeholder={t("workspaceMemoryBodyPlaceholder")}
                              aria-label={t("workspaceMemoryBodyAria")}
                            />
                          </label>
                          <div className="workspace-memory__actions">
                            <button
                              type="button"
                              className="primary workspace-memory__save"
                              onClick={saveMemory}
                              disabled={!canSaveMemory}
                              title={!canSaveMemory ? t("workspaceMemorySaveRequired") : undefined}
                            >
                              {t("save")}
                            </button>
                            <button type="button" className="workspace-soft-button" onClick={cancelMemoryEdit}>
                              {t("cancel")}
                            </button>
                            <button
                              type="button"
                              className="workspace-icon-danger"
                              onClick={() => removeMemory(m.id)}
                              aria-label={t("delete")}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="workspace-memory__view">
                            <h3 className="workspace-memory__view-title">
                              {m.title.trim() || t("workspaceMemoryUntitled")}
                            </h3>
                            <p className={`workspace-memory__view-body${m.body.trim() ? "" : " is-empty"}`}>
                              {m.body.trim() || t("workspaceMemoryEmptyBody")}
                            </p>
                          </div>
                          <div className="workspace-memory__actions">
                            <button type="button" className="workspace-soft-button" onClick={() => startEditMemory(m)}>
                              <Pencil size={15} aria-hidden /> {t("workspaceMemoryEdit")}
                            </button>
                            <button
                              type="button"
                              className="workspace-icon-danger"
                              onClick={() => removeMemory(m.id)}
                              aria-label={t("delete")}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : tab === "ask" ? (
            <div className="workspace-ask workspace-panel-card">
              <p className="muted workspace-report__lead">{t("workspaceAskHint")}</p>
              <label className="workspace-report__label workspace-report__label--block">
                <span className="workspace-report__label-text">{t("workspaceAskQuestion")}</span>
                <textarea
                  className="workspace-field workspace-ask__question"
                  rows={4}
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.shiftKey) return;
                    e.preventDefault();
                    void runAsk();
                  }}
                  placeholder={t("workspaceAskPlaceholder")}
                  aria-label={t("workspaceAskQuestion")}
                />
              </label>
              <button type="button" className="primary workspace-report__run" onClick={() => void runAsk()} disabled={!canAsk}>
                {askRunLabel}
              </button>
              {askPhase === "retrieving" && !askExcerpts.length ? (
                <p className="muted workspace-ask__status">{t("workspaceAskRetrieving")}</p>
              ) : null}
              <div className="workspace-report__output">
                <label className="workspace-report__out-label">{t("workspaceAskAnswer")}</label>
                <div
                  ref={askAnswerRef}
                  className={`workspace-markdown-out workspace-report__output-box${askPhase === "answering" && askAnswer ? " is-streaming" : ""}`}
                  aria-live="polite"
                  aria-busy={askPhase === "answering"}
                >
                  {askAnswer ? (
                    <WorkspaceMarkdown source={askAnswer} />
                  ) : (
                    <p className="workspace-markdown-out__placeholder muted">
                      {askPhase === "answering" ? t("workspaceAskStreaming") : t("workspaceAskAnswerPlaceholder")}
                    </p>
                  )}
                </div>
                <button type="button" className="workspace-soft-button" onClick={() => void copyAskAnswer()} disabled={!askAnswer}>
                  <ClipboardList size={16} aria-hidden /> {t("workspaceAskCopy")}
                </button>
              </div>
              {askSources.length > 0 ? (
                <div className="workspace-ask__sources">
                  <p className="workspace-report__label-text">{t("workspaceAskSources")}</p>
                  <ul className="workspace-ask__source-list">
                    {askSources.map((src) => (
                      <li key={src.logId}>
                        {onOpenLog ? (
                          <button type="button" className="workspace-ask__source-link" onClick={() => onOpenLog(src.logId)}>
                            {src.title}
                          </button>
                        ) : (
                          <span>{src.title}</span>
                        )}
                        {src.parentPath && src.parentPath !== src.title ? (
                          <span className="workspace-log-pick__path muted"> · {src.parentPath}</span>
                        ) : null}
                        <span className="workspace-ask__source-meta muted">
                          {" "}
                          · {t("workspaceAskSourceHits", { count: src.matchCount })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : askPhase === "answering" && !askSources.length ? (
                <p className="muted workspace-ask__no-sources">{t("workspaceAskNoSources")}</p>
              ) : null}
              {askExcerpts.length > 0 ? (
                <div className="workspace-ask__excerpts" aria-live="polite">
                  <p className="workspace-report__label-text">{t("workspaceAskRetrieved")}</p>
                  <ul className="workspace-ask__excerpt-list">
                    {askExcerpts.map((ex, idx) => (
                      <li key={`${ex.logId}-${idx}`} className="workspace-ask__excerpt">
                        <div className="workspace-ask__excerpt-head">
                          {onOpenLog ? (
                            <button type="button" className="workspace-ask__source-link" onClick={() => onOpenLog(ex.logId)}>
                              {ex.title}
                            </button>
                          ) : (
                            <span className="workspace-ask__excerpt-title">{ex.title}</span>
                          )}
                          {ex.matchKind ? (
                            <span
                              className={`workspace-ask__match-badge${ex.matchKind === "semantic" ? " is-semantic" : " is-keyword"}`}
                            >
                              {ex.matchKind === "semantic" ? t("workspaceAskMatchSemantic") : t("workspaceAskMatchKeyword")}
                            </span>
                          ) : null}
                        </div>
                        {ex.parentPath && ex.parentPath !== ex.title ? (
                          <p className="workspace-ask__excerpt-path muted">{ex.parentPath}</p>
                        ) : null}
                        <pre className="workspace-ask__excerpt-text">{ex.text}</pre>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="workspace-report workspace-panel-card">
              <p className="muted workspace-report__lead">{t("workspaceReportHint")}</p>

              <div className="workspace-log-pick">
                <div className="workspace-log-pick__head">
                  <span className="workspace-report__label-text">{t("workspaceSummaryLogs")}</span>
                  <span className="workspace-log-pick__count muted">
                    {t("workspaceSummarySelectedCount", { count: selectedLogIds.length })}
                  </span>
                </div>
                <div className="workspace-log-pick__actions">
                  <button type="button" className="workspace-soft-button workspace-log-pick__action" onClick={selectAllLogs} disabled={!allLogIds.length}>
                    {t("workspaceSummarySelectAll")}
                  </button>
                  <button type="button" className="workspace-soft-button workspace-log-pick__action" onClick={clearLogSelection} disabled={!selectedLogIds.length}>
                    {t("workspaceSummaryClear")}
                  </button>
                </div>
                {allLogIds.length ? (
                  <ul className="workspace-log-pick__list workspace-log-pick__list--tree" aria-label={t("workspaceSummaryLogs")}>
                    {renderLogPickTree(null, 0)}
                  </ul>
                ) : (
                  <p className="muted workspace-log-pick__empty">{t("workspaceSummaryNoLogs")}</p>
                )}
              </div>

              <div className="workspace-report__prefs">
                <p className="workspace-report__prefs-hint muted">{t("workspaceReportPrefsHint")}</p>
                <label className="workspace-report__label workspace-report__label--block">
                  <span className="workspace-report__label-text">{t("workspaceReportFocus")}</span>
                  <textarea
                    className="workspace-field workspace-report__pref-area"
                    rows={3}
                    value={focus}
                    onChange={(e) => patchSummaryPref({ focus: e.target.value })}
                    placeholder={t("workspaceReportFocusPlaceholder")}
                  />
                </label>
                <label className="workspace-report__label workspace-report__label--block workspace-report__label--spaced">
                  <span className="workspace-report__label-text">{t("workspaceReportStyle")}</span>
                  <textarea
                    className="workspace-field workspace-report__pref-area"
                    rows={3}
                    value={style}
                    onChange={(e) => patchSummaryPref({ style: e.target.value })}
                    placeholder={t("workspaceReportStylePlaceholder")}
                  />
                </label>
              </div>

              {!canGenerate && !reportBusy && selectedLogIds.length === 0 ? (
                <p className="workspace-summary__need-logs muted">{t("workspaceSummaryNeedLogs")}</p>
              ) : null}

              {reportInputError ? (
                <p className="workspace-input-error" role="alert">
                  {reportInputError}
                </p>
              ) : null}
              <button type="button" className="primary workspace-report__run" onClick={() => void runSummary()} disabled={!canGenerate}>
                {reportRunLabel}
              </button>
              <div className="workspace-report__output">
              <label className="workspace-report__out-label">{t("workspaceReportOutput")}</label>
              <div
                ref={reportOutRef}
                className={`workspace-markdown-out workspace-report__output-box${reportBusy && reportOut ? " is-streaming" : ""}`}
                aria-live="polite"
                aria-busy={reportBusy}
              >
                {reportOut ? (
                  <WorkspaceMarkdown source={reportOut} />
                ) : (
                  <p className="workspace-markdown-out__placeholder muted">
                    {reportBusy ? t("workspaceReportBusy") : t("workspaceReportPlaceholder")}
                  </p>
                )}
              </div>
              <button type="button" className="workspace-soft-button" onClick={() => void copyReport()} disabled={!reportOut}>
                <ClipboardList size={16} aria-hidden /> {t("workspaceReportCopy")}
              </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}