import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ClipboardList, FileText, Folder, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { DocumentGenerationPref, LogNode, MemoryEntry } from "../types";
import {
  DOC_PREF_LOG_SUMMARY,
  getLogSummaryPref,
  upsertDocumentPref
} from "../services/documentPrefs";
import type { ReportStylePreferences } from "../services/insightsReports";
import type { LogQaRetrievedExcerpt, LogQaSource } from "../services/logQa";
import { reportErrorToUser } from "../services/errorReporting";
import { collectLogIdsInSubtree, getChildrenSorted, getPathTitle, listLogNodesByUpdatedDesc } from "../services/tree";
import { WorkspaceMarkdown } from "./WorkspaceMarkdown";

export type WorkspaceTab = "summary" | "ask" | "memory";
export type WorkspaceAskPhase = "idle" | "retrieving" | "answering";
type LogCheckState = "checked" | "indeterminate" | "unchecked";

interface Props {
  open: boolean;
  onClose: () => void;
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  /** 引导 tour 时强制切换的标签 */
  tourTab?: WorkspaceTab | null;
  /** 引导进行中禁止关闭抽屉 */
  lockClose?: boolean;
  activeLogId: string | null;
  memoryEntries: MemoryEntry[];
  onMemoryChange: (next: MemoryEntry[]) => void;
  documentGenerationPrefs: DocumentGenerationPref[];
  onDocumentGenerationPrefsChange: (next: DocumentGenerationPref[]) => void;
  nodes: LogNode[];
  reportOut: string;
  reportBusy: boolean;
  reportInputError: string | null;
  onRunSummary: (logIds: string[], preferences: ReportStylePreferences) => void;
  askQuestion: string;
  askAnswer: string;
  askSources: LogQaSource[];
  askExcerpts: LogQaRetrievedExcerpt[];
  askPhase: WorkspaceAskPhase;
  onAskQuestionChange: (question: string) => void;
  onRunAsk: (question: string) => void;
  onOpenLog?: (logId: string) => void;
}

function getLogCheckState(nodes: LogNode[], nodeId: string, selectedLogIds: string[]): LogCheckState {
  const subtreeLogIds = collectLogIdsInSubtree(nodes, nodeId);
  if (!subtreeLogIds.length) return "unchecked";
  const selectedCount = subtreeLogIds.filter((id) => selectedLogIds.includes(id)).length;
  if (selectedCount === 0) return "unchecked";
  if (selectedCount === subtreeLogIds.length) return "checked";
  return "indeterminate";
}

function LogPickCheckbox({
  checkState,
  disabled,
  onToggle
}: {
  checkState: LogCheckState;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (el) el.indeterminate = checkState === "indeterminate";
  }, [checkState]);
  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checkState === "checked"}
      disabled={disabled}
      onChange={onToggle}
    />
  );
}

export function WorkspaceDrawer({
  open,
  onClose,
  tab,
  onTabChange,
  tourTab = null,
  lockClose = false,
  activeLogId,
  memoryEntries,
  onMemoryChange,
  documentGenerationPrefs,
  onDocumentGenerationPrefsChange,
  nodes,
  reportOut,
  reportBusy,
  reportInputError,
  onRunSummary,
  askQuestion,
  askAnswer,
  askSources,
  askExcerpts,
  askPhase,
  onAskQuestionChange,
  onRunAsk,
  onOpenLog
}: Props) {
  const { t } = useTranslation();
  const activeTab = tourTab ?? tab;
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [logPickExpandedIds, setLogPickExpandedIds] = useState<string[]>([]);
  const reportOutRef = useRef<HTMLDivElement>(null);
  const askAnswerRef = useRef<HTMLDivElement>(null);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState({ title: "", body: "" });

  const sortedMemoryEntries = useMemo(
    () => [...memoryEntries].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [memoryEntries]
  );
  const { focus, style } = getLogSummaryPref(documentGenerationPrefs);

  const logNodes = useMemo(() => listLogNodesByUpdatedDesc(nodes), [nodes]);

  const logPickBranchIds = useMemo(
    () => nodes.filter((n) => nodes.some((c) => c.parentId === n.id)).map((n) => n.id),
    [nodes]
  );

  useEffect(() => {
    if (!open) return;
    setLogPickExpandedIds(logPickBranchIds.length ? [...logPickBranchIds] : []);
  }, [open, logPickBranchIds]);

  useEffect(() => {
    if (!open || !activeLogId) return;
    const node = nodes.find((n) => n.id === activeLogId);
    if (node?.kind !== "log") return;
    setSelectedLogIds((prev) => (prev.length ? prev : [activeLogId]));
  }, [open, activeLogId, nodes]);

  useEffect(() => {
    if (activeTab !== "memory") setEditingMemoryId(null);
  }, [activeTab]);

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

  function toggleLogPickExpanded(id: string) {
    setLogPickExpandedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleLogSubtree(id: string) {
    const subtreeLogIds = collectLogIdsInSubtree(nodes, id);
    if (!subtreeLogIds.length) return;
    setSelectedLogIds((prev) => {
      const allSelected = subtreeLogIds.every((logId) => prev.includes(logId));
      if (allSelected) return prev.filter((x) => !subtreeLogIds.includes(x));
      return [...new Set([...prev, ...subtreeLogIds])];
    });
  }

  function renderLogPickTree(parentId: string | null, depth: number) {
    return getChildrenSorted(nodes, parentId).map((node) => {
      const children = getChildrenSorted(nodes, node.id);
      const hasChildren = children.length > 0;
      const expanded = logPickExpandedIds.includes(node.id);
      const checkState = getLogCheckState(nodes, node.id, selectedLogIds);
      const subtreeLogIds = collectLogIdsInSubtree(nodes, node.id);
      const selectable = subtreeLogIds.length > 0;
      return (
        <div key={node.id}>
          <div className="workspace-log-pick__tree-row" style={{ paddingLeft: 8 + depth * 16 }}>
            <button
              type="button"
              className="icon-button workspace-log-pick__chevron"
              onClick={() => toggleLogPickExpanded(node.id)}
              aria-label="toggle"
              disabled={!hasChildren}
            >
              {hasChildren ? (
                expanded ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )
              ) : (
                <span className="spacer" />
              )}
            </button>
            <label className={`workspace-log-pick__item workspace-log-pick__tree-item${checkState === "checked" ? " is-checked" : ""}`}>
              <LogPickCheckbox
                checkState={checkState}
                disabled={!selectable}
                onToggle={() => toggleLogSubtree(node.id)}
              />
              {hasChildren ? (
                <Folder size={16} className="workspace-log-pick__icon" aria-hidden />
              ) : (
                <FileText size={16} className="workspace-log-pick__icon" aria-hidden />
              )}
              <span className="workspace-log-pick__title">{node.title}</span>
            </label>
          </div>
          {hasChildren && expanded ? renderLogPickTree(node.id, depth + 1) : null}
        </div>
      );
    });
  }

  function selectAllLogs() {
    setSelectedLogIds(logNodes.map((n) => n.id));
  }

  function clearLogSelection() {
    setSelectedLogIds([]);
  }

  function runSummary() {
    if (!selectedLogIds.length) return;
    onRunSummary(selectedLogIds, { focus, style });
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

  function runAsk() {
    const q = askQuestion.trim();
    if (!q || askBusy) return;
    onRunAsk(q);
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
    <div
      className="workspace-drawer-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !lockClose && onClose()}
    >
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
          <button
            type="button"
            className="icon-button workspace-drawer__close"
            disabled={lockClose}
            onClick={() => {
              if (!lockClose) onClose();
            }}
            aria-label={t("close")}
          >
            <X size={18} />
          </button>
        </header>
        <div className="workspace-drawer__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "summary"}
            className={`workspace-drawer__tab${activeTab === "summary" ? " is-active" : ""}`}
            onClick={() => onTabChange("summary")}
          >
            {t("workspaceTabSummary")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ask"}
            className={`workspace-drawer__tab${activeTab === "ask" ? " is-active" : ""}`}
            onClick={() => onTabChange("ask")}
          >
            {t("workspaceTabAsk")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "memory"}
            className={`workspace-drawer__tab${activeTab === "memory" ? " is-active" : ""}`}
            onClick={() => onTabChange("memory")}
          >
            {t("workspaceTabMemory")}
          </button>
        </div>
        <div className="workspace-drawer__body">
          {activeTab === "memory" ? (
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
          ) : activeTab === "ask" ? (
            <div className="workspace-ask workspace-panel-card">
              <p className="muted workspace-report__lead">{t("workspaceAskHint")}</p>
              <label className="workspace-report__label workspace-report__label--block">
                <span className="workspace-report__label-text">{t("workspaceAskQuestion")}</span>
                <textarea
                  className="workspace-field workspace-ask__question"
                  rows={4}
                  value={askQuestion}
                  onChange={(e) => onAskQuestionChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.shiftKey) return;
                    e.preventDefault();
                    runAsk();
                  }}
                  placeholder={t("workspaceAskPlaceholder")}
                  aria-label={t("workspaceAskQuestion")}
                />
              </label>
              <button type="button" className="primary workspace-report__run" onClick={runAsk} disabled={!canAsk}>
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
                    <WorkspaceMarkdown source={askAnswer} streaming={askPhase === "answering"} />
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
                  <button type="button" className="workspace-soft-button workspace-log-pick__action" onClick={selectAllLogs} disabled={!logNodes.length}>
                    {t("workspaceSummarySelectAll")}
                  </button>
                  <button type="button" className="workspace-soft-button workspace-log-pick__action" onClick={clearLogSelection} disabled={!selectedLogIds.length}>
                    {t("workspaceSummaryClear")}
                  </button>
                </div>
                {nodes.length ? (
                  <div className="workspace-log-pick__list workspace-log-pick__list--tree" aria-label={t("workspaceSummaryLogs")}>
                    {renderLogPickTree(null, 0)}
                  </div>
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
              <button type="button" className="primary workspace-report__run" onClick={runSummary} disabled={!canGenerate}>
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
                  <WorkspaceMarkdown source={reportOut} streaming={reportBusy} />
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