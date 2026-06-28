import { Component, useCallback, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityStatusBar } from "./ActivityStatusBar";
import {
  buildDiagnostics,
  formatUnknownError,
  registerErrorReportingSink,
  type ErrorContext,
  type ErrorSinkPayload
} from "../services/errorReporting";

const ERR_KEYS: Record<ErrorContext, { title: string; summary: string }> = {
  persist: { title: "errorReportTitlePersist", summary: "errorReportSummaryPersist" },
  writeLog: { title: "errorReportTitleWriteLog", summary: "errorReportSummaryWriteLog" },
  loadState: { title: "errorReportTitleLoadState", summary: "errorReportSummaryLoadState" },
  vlm: { title: "errorReportTitleVlm", summary: "errorReportSummaryVlm" },
  index: { title: "errorReportTitleIndex", summary: "errorReportSummaryIndex" },
  search: { title: "errorReportTitleSearch", summary: "errorReportSummarySearch" },
  searchNotice: { title: "searchKeywordOnlyTitle", summary: "searchKeywordOnlySummary" },
  globalShortcut: { title: "errorReportTitleGlobalShortcut", summary: "errorReportSummaryGlobalShortcut" },
  report: { title: "errorReportTitleReport", summary: "errorReportSummaryReport" },
  render: { title: "errorReportTitleRender", summary: "errorReportSummaryRender" }
};

interface RenderErrorBoundaryProps {
  children: ReactNode;
  labels: {
    title: string;
    summary: string;
    copy: string;
    reload: string;
  };
}

interface RenderErrorBoundaryState {
  error: string | null;
  diagnostics: string;
}

class RenderErrorBoundary extends Component<RenderErrorBoundaryProps, RenderErrorBoundaryState> {
  state: RenderErrorBoundaryState = { error: null, diagnostics: "" };

  static getDerivedStateFromError(error: unknown): Partial<RenderErrorBoundaryState> {
    return { error: formatUnknownError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const raw = formatUnknownError(error);
    const diagnostics = `${buildDiagnostics("render", raw)}\ncomponentStack:\n${info.componentStack}`;
    this.setState({ diagnostics });
  }

  async copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(this.state.diagnostics || this.state.error || "");
    } catch {
      /* ignore */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { labels } = this.props;
    return (
      <div className="render-error-screen" role="alert">
        <section className="render-error-card">
          <h1>{labels.title}</h1>
          <p>{labels.summary}</p>
          <div className="render-error-card__actions">
            <button type="button" className="ghost" onClick={() => void this.copyDiagnostics()}>
              {labels.copy}
            </button>
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              {labels.reload}
            </button>
          </div>
        </section>
      </div>
    );
  }
}

interface ToastItem {
  id: string;
  kind: "error" | "success";
  context?: ErrorContext;
  detail?: string;
  title?: string;
  summary?: string;
}

export function ErrorReportingSurface({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [toastExpanded, setToastExpanded] = useState<Record<string, boolean>>({});
  const [alertPayload, setAlertPayload] = useState<ErrorSinkPayload | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const timers = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const tid = timers.current.get(id);
    if (tid) window.clearTimeout(tid);
    timers.current.delete(id);
    setToasts((list) => list.filter((item) => item.id !== id));
    setToastExpanded((ex) => {
      const next = { ...ex };
      delete next[id];
      return next;
    });
  }, []);

  const pushToast = useCallback(
    (payload: ErrorSinkPayload) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const isSuccess = payload.severity === "success";
      setToasts((list) => [
        ...list,
        isSuccess
          ? { id, kind: "success", title: payload.noticeTitle ?? "", summary: payload.noticeSummary ?? "" }
          : { id, kind: "error", context: payload.context, detail: payload.detail }
      ]);
      const tid = window.setTimeout(() => dismissToast(id), isSuccess ? 3500 : 9000);
      timers.current.set(id, tid);
    },
    [dismissToast]
  );

  useLayoutEffect(() => {
    registerErrorReportingSink((payload) => {
      if (payload.severity === "modal" || payload.severity === "warning") {
        setDetailOpen(false);
        setAlertPayload(payload);
        return;
      }
      pushToast(payload);
    });
    return () => {
      registerErrorReportingSink(null);
      timers.current.forEach((tid) => window.clearTimeout(tid));
      timers.current.clear();
    };
  }, [pushToast]);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 忽略：无权限时静默 */
    }
  }, []);

  const isWarningModal = alertPayload?.severity === "warning";

  return (
    <>
      <RenderErrorBoundary
        labels={{
          title: t("errorReportTitleRender"),
          summary: t("errorReportSummaryRender"),
          copy: t("copyDiagnostics"),
          reload: t("reloadApp")
        }}
      >
        {children}
      </RenderErrorBoundary>
      <ActivityStatusBar />
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => {
          if (item.kind === "success") {
            return (
              <div key={item.id} className="toast-item toast-item--success" role="status">
                <div className="toast-item__layout">
                  <span className="success-severity-dot" aria-hidden />
                  <div className="toast-item__main">
                    <div className="toast-item__head">
                      <strong className="toast-item__title">{item.title}</strong>
                      <button type="button" className="toast-item__close ghost small" onClick={() => dismissToast(item.id)} aria-label={t("toastDismiss")}>
                        ×
                      </button>
                    </div>
                    {item.summary ? <p className="toast-item__summary">{item.summary}</p> : null}
                  </div>
                </div>
              </div>
            );
          }
          const keys = ERR_KEYS[item.context!];
          return (
            <div key={item.id} className="toast-item" role="status">
              <div className="toast-item__layout">
                <span className="error-severity-dot" aria-hidden />
                <div className="toast-item__main">
                  <div className="toast-item__head">
                    <strong className="toast-item__title">{t(keys.title)}</strong>
                    <button type="button" className="toast-item__close ghost small" onClick={() => dismissToast(item.id)} aria-label={t("toastDismiss")}>
                      ×
                    </button>
                  </div>
                  <p className="toast-item__summary">{t(keys.summary)}</p>
                  <button
                    type="button"
                    className="toast-item__toggle ghost small"
                    onClick={() => setToastExpanded((ex) => ({ ...ex, [item.id]: !ex[item.id] }))}
                  >
                    {toastExpanded[item.id] ? t("toastHideDetail") : t("toastShowDetail")}
                  </button>
                  {toastExpanded[item.id] ? (
                    <>
                      <p className="toast-item__detail-label">{t("errorReportDetailCaption")}</p>
                      <pre className="toast-item__detail">{item.detail}</pre>
                    </>
                  ) : null}
                  <div className="toast-item__actions">
                    <button type="button" className="ghost small" onClick={() => void copyText(item.detail ?? "")}>
                      {t("copyDiagnostics")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {alertPayload ? (
        <div
          className={`modal-backdrop${isWarningModal ? " modal-backdrop--warning" : " modal-backdrop--error"}`}
        >
          <section
            className={`modal-card modal-card--wide error-report-modal${isWarningModal ? " error-report-modal--warning" : ""}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="error-report-title"
          >
            <div className="error-report-modal__header">
              <span className={isWarningModal ? "warning-severity-dot" : "error-severity-dot"} aria-hidden />
              <h2 id="error-report-title">{t(ERR_KEYS[alertPayload.context].title)}</h2>
            </div>
            <p className="error-report-modal__summary">
              {alertPayload.userMessage?.trim() ||
                (alertPayload.userMessageKey ? t(alertPayload.userMessageKey) : t(ERR_KEYS[alertPayload.context].summary))}
            </p>
            {alertPayload.userHintKey ? (
              <p className="error-report-modal__hint">{t(alertPayload.userHintKey)}</p>
            ) : null}
            {!isWarningModal ? (
              <>
                {!detailOpen ? <p className="error-report-modal__hint">{t("errorReportCollapsedHint")}</p> : null}
                <button type="button" className="ghost small error-report-modal__toggle" onClick={() => setDetailOpen((v) => !v)}>
                  {detailOpen ? t("toastHideDetail") : t("toastShowDetail")}
                </button>
                {detailOpen ? (
                  <>
                    <p className="error-report-modal__detail-label">{t("errorReportDetailCaption")}</p>
                    <pre className="error-report-modal__detail">{alertPayload.detail}</pre>
                  </>
                ) : null}
              </>
            ) : null}
            <footer className="error-report-modal__footer">
              {!isWarningModal ? (
                <button type="button" className="ghost" onClick={() => void copyText(alertPayload.diagnostics)}>
                  {t("copyDiagnostics")}
                </button>
              ) : null}
              {alertPayload.onRetry ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const fn = alertPayload.onRetry;
                    setAlertPayload(null);
                    fn?.();
                  }}
                >
                  {t("retry")}
                </button>
              ) : null}
              {alertPayload.actionLabelKey && alertPayload.onAction ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const fn = alertPayload.onAction;
                    setAlertPayload(null);
                    fn?.();
                  }}
                >
                  {t(alertPayload.actionLabelKey)}
                </button>
              ) : null}
              <button type="button" className="primary" onClick={() => setAlertPayload(null)}>
                {t("close")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
