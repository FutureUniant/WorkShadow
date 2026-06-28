import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConfirmOptions } from "../types";
import {
  anyDataBundleOptionSelected,
  defaultDataBundleExportOptions,
  exportDataBundle,
  importDataBundle,
  pickExportWsPath,
  pickImportWsPath,
  type DataBundleExportOptions
} from "../services/dataBundle";
import { reportErrorToUser, reportSuccessNotice } from "../services/errorReporting";
import { isTauriRuntime } from "../services/storage";

interface Props {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onBeforeTransfer: () => Promise<void>;
  onImported: () => Promise<void>;
}

type SectionKey = keyof DataBundleExportOptions;

const EXPORT_SECTION_KEYS: SectionKey[] = [
  "logs",
  "memory",
  "workspacePersonal",
  "generalSettings",
  "modelConfig",
  "shortcuts"
];

const EXPORT_SECTION_I18N: Record<SectionKey, string> = {
  logs: "settingsDataSectionLogs",
  memory: "settingsDataSectionMemory",
  workspacePersonal: "settingsDataSectionWorkspacePersonal",
  generalSettings: "settingsDataSectionGeneral",
  modelConfig: "settingsDataSectionModels",
  shortcuts: "settingsDataSectionShortcuts"
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function DataSettingsPanel({ confirm, onBeforeTransfer, onImported }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [exportOptions, setExportOptions] = useState<DataBundleExportOptions>(() => ({
    ...defaultDataBundleExportOptions
  }));
  const desktop = isTauriRuntime();

  function toggleExportOption(key: SectionKey) {
    setExportOptions((cur) => ({ ...cur, [key]: !cur[key] }));
  }

  async function handleExport() {
    if (!desktop || busy) return;
    if (!anyDataBundleOptionSelected(exportOptions)) {
      reportErrorToUser("persist", new Error(t("settingsDataExportNoneSelected")), { severity: "toast" });
      return;
    }
    const dest = await pickExportWsPath();
    if (!dest) return;
    setBusy("export");
    try {
      await onBeforeTransfer();
      const result = await exportDataBundle(dest, exportOptions);
      reportSuccessNotice(
        t("settingsDataExportDoneTitle"),
        t("settingsDataExportDoneSummary", {
          count: result.fileCount,
          size: formatBytes(result.byteSize)
        })
      );
    } catch (e) {
      reportErrorToUser("persist", e, { severity: "toast" });
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    if (!desktop || busy) return;
    const source = await pickImportWsPath();
    if (!source) return;
    const ok = await confirm({
      title: t("settingsDataImportConfirmTitle"),
      message: t("settingsDataImportConfirmMessage")
    });
    if (!ok) return;
    setBusy("import");
    try {
      await onBeforeTransfer();
      const result = await importDataBundle(source);
      await onImported();
      reportSuccessNotice(
        t("settingsDataImportDoneTitle"),
        t("settingsDataImportDoneSummary", {
          added: result.nodesImported,
          total: result.nodesTotal,
          files: result.fileCount
        })
      );
    } catch (e) {
      reportErrorToUser("loadState", e, { severity: "toast" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="settings-group" aria-labelledby="settings-group-data-export">
        <h2 id="settings-group-data-export" className="settings-group-title">
          {t("settingsDataExportTitle")}
        </h2>
        <p className="settings-field-hint muted">{t("settingsDataExportHint")}</p>
        <div className="settings-data-sections" role="group" aria-labelledby="settings-data-export-choose">
          <p id="settings-data-export-choose" className="settings-data-sections-label">
            {t("settingsDataExportChoose")}
          </p>
          <ul className="settings-data-section-list">
            {EXPORT_SECTION_KEYS.map((key) => (
              <li key={key}>
                <label className="settings-data-section-row">
                  <input
                    type="checkbox"
                    checked={exportOptions[key]}
                    disabled={!desktop || busy !== null}
                    onChange={() => toggleExportOption(key)}
                  />
                  <span className="settings-data-section-text-wrap">
                    <span className="settings-data-section-text">{t(EXPORT_SECTION_I18N[key])}</span>
                    {key === "modelConfig" && exportOptions.modelConfig ? (
                      <span className="settings-data-section-inline-hint">{t("settingsDataModelConfigWarning")}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="settings-data-actions">
          <button
            type="button"
            className="primary"
            disabled={!desktop || busy !== null || !anyDataBundleOptionSelected(exportOptions)}
            title={desktop ? undefined : t("pathPickerDesktopOnly")}
            onClick={() => void handleExport()}
          >
            {busy === "export" ? t("settingsDataExportBusy") : t("settingsDataExportButton")}
          </button>
        </div>
      </section>
      <section className="settings-group" aria-labelledby="settings-group-data-import">
        <h2 id="settings-group-data-import" className="settings-group-title">
          {t("settingsDataImportTitle")}
        </h2>
        <p className="settings-field-hint muted">{t("settingsDataImportHint")}</p>
        <div className="settings-data-actions">
          <button
            type="button"
            className="ghost settings-data-import-btn"
            disabled={!desktop || busy !== null}
            title={desktop ? undefined : t("pathPickerDesktopOnly")}
            onClick={() => void handleImport()}
          >
            {busy === "import" ? t("settingsDataImportBusy") : t("settingsDataImportButton")}
          </button>
        </div>
      </section>
    </>
  );
}
