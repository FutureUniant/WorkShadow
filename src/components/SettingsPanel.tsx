import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ArrowLeft, Bug, Cpu, Database, Info, Keyboard, SlidersHorizontal } from "lucide-react";
import { DataSettingsPanel } from "./DataSettingsPanel";
import { DeveloperSettingsPanel } from "./DeveloperSettingsPanel";
import { useTranslation } from "react-i18next";
import aboutIcon from "../assets/logo.png";
import wechatAdminQr from "../../docs/wechat.jpg";
import wechatPublicQr from "../../docs/wechat_public.jpg";
import pkg from "../../package.json";
import type {
  AppSettings,
  ConfirmOptions,
  ModelConfig,
  SearchResultOrder,
  ShortcutBinding
} from "../types";
import {
  bindingFromKeyboardEvent,
  defaultShortcutMap,
  formatShortcutLabel,
  formatShortcutParts,
  isValidGlobalNewLogShortcut,
  isValidNewLogShortcut,
  type ShortcutActionId
} from "../services/shortcuts";
import { reportErrorToUser, reportSuccessNotice } from "../services/errorReporting";
import { testLlmConfig } from "../services/modelTest";
import { EmbeddingModelFields } from "./EmbeddingModelFields";
import { pickDirectory } from "../services/pickDirectory";
import { isTauriRuntime } from "../services/storage";
import { SettingsSelect } from "./SettingsSelect";

type SettingsMajor = "general" | "models" | "shortcuts" | "data" | "about" | "developer";

interface Props {
  open: boolean;
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onBack: () => void | Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  embeddingFlushRef: MutableRefObject<(() => Promise<void>) | null>;
  onEmbeddingCommit: (embedding: ModelConfig, options: { needsVectorRebuild: boolean }) => void;
  onBeforeDataTransfer: () => Promise<void>;
  onDataImported: () => Promise<void>;
}

function PathDirectoryField({
  label,
  value,
  pickTitle,
  onChangePath
}: {
  label: string;
  value: string;
  pickTitle: string;
  onChangePath: (path: string) => void;
}) {
  const { t } = useTranslation();
  const canPick = isTauriRuntime();

  async function handlePick() {
    if (!canPick) return;
    try {
      const path = await pickDirectory({ defaultPath: value, title: pickTitle });
      if (path) onChangePath(path);
    } catch (e) {
      reportErrorToUser("persist", e, { severity: "toast" });
    }
  }

  return (
    <>
      <div className="settings-field">
        <span className="settings-field-label">{label}</span>
        <div className="settings-path-row">
          <span className="settings-path-value" title={value}>
            {value || "-"}
          </span>
          <button
            type="button"
            className="ghost settings-path-change"
            disabled={!canPick}
            title={canPick ? pickTitle : t("pathPickerDesktopOnly")}
            onClick={() => void handlePick()}
          >
            {t("changePath")}
          </button>
        </div>
      </div>
    </>
  );
}

const ABOUT_EMAIL = "feiyangtech@qq.com";

const SHORTCUT_ROWS: { id: ShortcutActionId; labelKey: string }[] = [
  { id: "newLog", labelKey: "shortcutActionNewLog" },
  { id: "globalNewLog", labelKey: "shortcutActionGlobalNewLog" },
  { id: "lightboxClose", labelKey: "shortcutActionLightboxClose" },
  { id: "lightboxPrev", labelKey: "shortcutActionLightboxPrev" },
  { id: "lightboxNext", labelKey: "shortcutActionLightboxNext" },
  { id: "treeMenuClose", labelKey: "shortcutActionTreeMenuClose" }
];

export function SettingsPanel({
  open,
  settings,
  onChange,
  onBack,
  confirm,
  embeddingFlushRef,
  onEmbeddingCommit,
  onBeforeDataTransfer,
  onDataImported
}: Props) {
  const { t } = useTranslation();
  const [major, setMajor] = useState<SettingsMajor>("general");
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!open || recording === null) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setRecording(null);
        setBindError(null);
        return;
      }
      const next = bindingFromKeyboardEvent(event);
      if (!next) return;
      if (recording === "newLog" && !isValidNewLogShortcut(next)) {
        setBindError(t("shortcutErrNeedModifier"));
        return;
      }
      if (recording === "globalNewLog" && !isValidGlobalNewLogShortcut(next)) {
        setBindError(t("shortcutErrGlobalNeedModifier"));
        return;
      }
      setBindError(null);
      const current = settingsRef.current;
      onChange({
        ...current,
        shortcuts: { ...current.shortcuts, [recording]: next }
      });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, recording, onChange, t]);

  if (!open) return null;

  const navItems: { id: SettingsMajor; label: string; icon: typeof SlidersHorizontal }[] = [
    { id: "general", label: t("settingsCategoryGeneral"), icon: SlidersHorizontal },
    { id: "models", label: t("settingsCategoryModels"), icon: Cpu },
    { id: "shortcuts", label: t("settingsCategoryShortcuts"), icon: Keyboard },
    { id: "data", label: t("settingsCategoryData"), icon: Database },
    ...(import.meta.env.DEV
      ? [{ id: "developer" as const, label: t("settingsCategoryDeveloper"), icon: Bug }]
      : []),
    { id: "about", label: t("settingsCategoryAbout"), icon: Info }
  ];

  function resetShortcut(id: ShortcutActionId) {
    onChange({
      ...settings,
      shortcuts: { ...settings.shortcuts, [id]: { ...defaultShortcutMap[id] } }
    });
    setBindError(null);
  }

  return (
    <div className="settings-screen">
      <header className="settings-screen-header">
        <button type="button" className="settings-back ghost" onClick={onBack}>
          <ArrowLeft size={18} />
          {t("back")}
        </button>
        <h1 className="settings-screen-title">{t("settings")}</h1>
      </header>
      <div className="settings-screen-main">
        <nav className="settings-nav" aria-label={t("settingsNavAria")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = major === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => setMajor(item.id)}
              >
                <Icon size={18} aria-hidden />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="settings-content">
          {major === "general" ? (
            <>
              <section className="settings-group" aria-labelledby="settings-group-appearance">
                <h2 id="settings-group-appearance" className="settings-group-title">
                  {t("settingsSubAppearance")}
                </h2>
                <div className="settings-field">
                  <span className="settings-field-label" id="settings-language-label">
                    {t("language")}
                  </span>
                  <SettingsSelect
                    aria-labelledby="settings-language-label"
                    value={settings.language}
                    options={[
                      { value: "system", label: "System" },
                      { value: "zh", label: "中文" },
                      { value: "en", label: "English" }
                    ]}
                    onChange={(language) => onChange({ ...settings, language: language as AppSettings["language"] })}
                  />
                </div>
                <div className="settings-field">
                  <span className="settings-field-label" id="settings-theme-label">
                    {t("settingsTheme")}
                  </span>
                  <SettingsSelect
                    aria-labelledby="settings-theme-label"
                    value={settings.theme}
                    options={[
                      { value: "light", label: t("light") },
                      { value: "dark", label: t("dark") }
                    ]}
                    onChange={(theme) => onChange({ ...settings, theme: theme as AppSettings["theme"] })}
                  />
                </div>
              </section>
              <section className="settings-group" aria-labelledby="settings-group-search">
                <h2 id="settings-group-search" className="settings-group-title">
                  {t("settingsSubSearch")}
                </h2>
                <div className="settings-field">
                  <span className="settings-field-label" id="settings-search-order-label">
                    {t("searchResultOrder")}
                  </span>
                  <SettingsSelect
                    aria-labelledby="settings-search-order-label"
                    value={settings.searchResultOrder}
                    options={[
                      { value: "combined", label: t("searchResultOrderCombined") },
                      { value: "semanticFirst", label: t("searchResultOrderSemanticFirst") },
                      { value: "keywordFirst", label: t("searchResultOrderKeywordFirst") }
                    ]}
                    onChange={(searchResultOrder) =>
                      onChange({ ...settings, searchResultOrder: searchResultOrder as SearchResultOrder })
                    }
                  />
                </div>
                <p className="settings-field-hint muted">{t("searchResultOrderHint")}</p>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="settings-semantic-min-similarity">
                    {t("semanticMinSimilarity")}
                  </label>
                  <input
                    id="settings-semantic-min-similarity"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(settings.semanticMinSimilarity * 100)}
                    onChange={(e) =>
                      onChange({
                        ...settings,
                        semanticMinSimilarity: Number(e.target.value) / 100
                      })
                    }
                  />
                  <p className="settings-field-hint muted">
                    {settings.semanticMinSimilarity <= 0
                      ? t("semanticMinSimilarityOff")
                      : t("semanticMinSimilarityValue", {
                          percent: Math.round(settings.semanticMinSimilarity * 100)
                        })}
                  </p>
                </div>
              </section>
              <section className="settings-group" aria-labelledby="settings-group-paths">
                <h2 id="settings-group-paths" className="settings-group-title">
                  {t("settingsSubPaths")}
                </h2>
                <PathDirectoryField
                  label={t("logDirectory")}
                  value={settings.logDirectory}
                  pickTitle={t("pickLogDirectoryTitle")}
                  onChangePath={(logDirectory) => onChange({ ...settings, logDirectory })}
                />
                <PathDirectoryField
                  label={t("tempDirectory")}
                  value={settings.tempDirectory}
                  pickTitle={t("pickTempDirectoryTitle")}
                  onChangePath={(tempDirectory) => onChange({ ...settings, tempDirectory })}
                />
                <div className="settings-field">
                  <span className="settings-field-label" id="settings-media-strategy-label">
                    {t("mediaStrategy")}
                  </span>
                  <SettingsSelect
                    aria-labelledby="settings-media-strategy-label"
                    value={settings.mediaStrategy}
                    options={[
                      { value: "reference", label: t("mediaStrategyReference") },
                      { value: "embed", label: t("mediaStrategyEmbed") }
                    ]}
                    onChange={(mediaStrategy) =>
                      onChange({ ...settings, mediaStrategy: mediaStrategy as AppSettings["mediaStrategy"] })
                    }
                  />
                </div>
              </section>
            </>
          ) : null}
          {major === "data" ? (
            <DataSettingsPanel confirm={confirm} onBeforeTransfer={onBeforeDataTransfer} onImported={onDataImported} />
          ) : null}
          {major === "developer" && import.meta.env.DEV ? <DeveloperSettingsPanel /> : null}
          {major === "models" ? (
            <>
              <section className="settings-group" aria-labelledby="settings-group-llm">
                <h2 id="settings-group-llm" className="settings-group-title">
                  {t("llmConfig")}
                </h2>
                <ModelFields value={settings.llm} onChange={(llm) => onChange({ ...settings, llm })} />
              </section>
              <section className="settings-group" aria-labelledby="settings-group-embedding">
                <h2 id="settings-group-embedding" className="settings-group-title">
                  {t("embeddingConfig")}
                </h2>
                <EmbeddingModelFields
                  committed={settings.embedding}
                  confirm={confirm}
                  onRegisterFlush={(flush) => {
                    embeddingFlushRef.current = flush;
                  }}
                  onCommit={(embedding, options) => onEmbeddingCommit(embedding, options)}
                />
              </section>
            </>
          ) : null}
          {major === "shortcuts" ? (
            <section className="settings-group settings-shortcuts-section" aria-labelledby="settings-group-shortcuts">
              <h2 id="settings-group-shortcuts" className="settings-group-title">
                {t("settingsCategoryShortcuts")}
              </h2>
              {bindError ? <p className="settings-bind-error" role="alert">{bindError}</p> : null}
              <ul className="settings-shortcut-rows">
                {SHORTCUT_ROWS.map((row) => (
                  <ShortcutRowView
                    key={row.id}
                    label={t(row.labelKey)}
                    binding={settings.shortcuts[row.id]}
                    recording={recording === row.id}
                    displayTitle={formatShortcutLabel(settings.shortcuts[row.id])}
                    onToggleRecord={() => {
                      setBindError(null);
                      setRecording((cur) => (cur === row.id ? null : row.id));
                    }}
                    onReset={() => resetShortcut(row.id)}
                    recordLabel={t("shortcutRecord")}
                    recordingLabel={t("shortcutRecording")}
                    resetLabel={t("shortcutResetDefault")}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {major === "about" ? (
            <section className="settings-group settings-about" aria-labelledby="settings-group-about">
              <div className="settings-about-hero">
                <img className="settings-about-icon" src={aboutIcon} width={120} height={120} alt="" />
                <h2 id="settings-group-about" className="settings-about-name">
                  WorkShadow
                </h2>
                <p className="settings-about-tagline muted">{t("settingsAboutTagline")}</p>
                <p className="settings-about-version">{t("settingsAboutVersion", { version: pkg.version })}</p>
              </div>
              <h3 className="settings-about-section-title">{t("settingsAboutWhyTitle")}</h3>
              <p className="settings-about-body">
                {t("settingsAboutWhyBody")}
                {"\n\n"}
                {t("settingsAboutClosing")}
              </p>
              <h3 className="settings-about-section-title">{t("settingsAboutContact")}</h3>
              <p className="settings-about-body muted">{t("settingsContactIntro")}</p>
              <div className="settings-contact-qr-grid">
                <figure className="settings-contact-qr-card">
                  <img src={wechatAdminQr} width={168} height={168} alt={t("settingsContactWechatAdminAlt")} />
                  <figcaption className="settings-contact-qr-label">{t("settingsContactWechatAdmin")}</figcaption>
                  <p className="settings-contact-qr-hint muted">{t("settingsContactWechatAdminHint")}</p>
                </figure>
                <figure className="settings-contact-qr-card">
                  <img src={wechatPublicQr} width={168} height={168} alt={t("settingsContactWechatPublicAlt")} />
                  <figcaption className="settings-contact-qr-label">{t("settingsContactWechatPublic")}</figcaption>
                  <p className="settings-contact-qr-hint muted">{t("settingsContactWechatPublicHint")}</p>
                </figure>
              </div>
              <h4 className="settings-contact-email-title">{t("settingsContactEmail")}</h4>
              <p className="settings-about-body">
                <button
                  type="button"
                  className="settings-about-mail"
                  onClick={() => {
                    void navigator.clipboard.writeText(ABOUT_EMAIL).then(
                      () => reportSuccessNotice(t("settingsAboutEmailCopiedTitle"), t("settingsAboutEmailCopiedSummary")),
                      () => reportErrorToUser("persist", new Error("clipboard write failed"), { severity: "toast" })
                    );
                  }}
                >
                  {ABOUT_EMAIL}
                </button>
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ShortcutRowView({
  label,
  binding,
  recording,
  displayTitle,
  onToggleRecord,
  onReset,
  recordLabel,
  recordingLabel,
  resetLabel
}: {
  label: string;
  binding: ShortcutBinding;
  recording: boolean;
  displayTitle: string;
  onToggleRecord: () => void;
  onReset: () => void;
  recordLabel: string;
  recordingLabel: string;
  resetLabel: string;
}) {
  const parts = formatShortcutParts(binding);
  return (
    <li className={`settings-shortcut-row${recording ? " is-recording" : ""}`}>
      <div className="settings-shortcut-row-main">
        <span className="settings-shortcut-row-label">{label}</span>
        <span className="settings-kbd-chips" title={displayTitle} aria-label={displayTitle}>
          {parts.map((part, i) => (
            <kbd key={`${part}-${i}`}>{part}</kbd>
          ))}
        </span>
      </div>
      <div className="settings-shortcut-row-actions">
        <button type="button" className={`ghost small${recording ? " settings-record-active" : ""}`} onClick={onToggleRecord}>
          {recording ? recordingLabel : recordLabel}
        </button>
        <button type="button" className="ghost small" onClick={onReset}>
          {resetLabel}
        </button>
      </div>
    </li>
  );
}

type ModelTestState = { status: "idle" } | { status: "running" } | { status: "ok"; message: string } | { status: "fail"; message: string };

function ModelFields({ value, onChange }: { value: ModelConfig; onChange: (value: ModelConfig) => void }) {
  const { t } = useTranslation();
  const [test, setTest] = useState<ModelTestState>({ status: "idle" });

  async function runTest() {
    setTest({ status: "running" });
    try {
      await testLlmConfig(value);
      setTest({ status: "ok", message: t("modelTestSuccessLlm") });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setTest({ status: "fail", message: t("modelTestFailed", { message }) });
    }
  }

  return (
    <div className="settings-model-block">
      <label className="settings-field">
        <span className="settings-field-label">{t("baseUrl")}</span>
        <input value={value.baseUrl} onChange={(event) => onChange({ ...value, baseUrl: event.target.value })} />
      </label>
      <label className="settings-field">
        <span className="settings-field-label">{t("apiKey")}</span>
        <input type="password" value={value.apiKey} onChange={(event) => onChange({ ...value, apiKey: event.target.value })} />
      </label>
      <label className="settings-field">
        <span className="settings-field-label">{t("modelName")}</span>
        <input value={value.model} onChange={(event) => onChange({ ...value, model: event.target.value })} />
      </label>
      <div className="settings-model-test">
        <button
          type="button"
          className="settings-model-test-btn small"
          disabled={test.status === "running"}
          onClick={() => void runTest()}
        >
          {test.status === "running" ? t("modelTestRunning") : t("modelTestConnection")}
        </button>
        {test.status === "ok" ? <p className="settings-model-test-msg settings-model-test-msg--ok">{test.message}</p> : null}
        {test.status === "fail" ? <p className="settings-model-test-msg settings-model-test-msg--fail">{test.message}</p> : null}
      </div>
    </div>
  );
}
