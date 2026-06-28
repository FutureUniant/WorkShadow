import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { normalizePickedPath } from "./pickDirectory";
import { isTauriRuntime } from "./storage";

/** 与后端一致的 .ws 导出/导入勾选 */
export type DataBundleExportOptions = {
  logs: boolean;
  memory: boolean;
  generalSettings: boolean;
  modelConfig: boolean;
  shortcuts: boolean;
  workspacePersonal: boolean;
};

export const defaultDataBundleExportOptions: DataBundleExportOptions = {
  logs: true,
  memory: true,
  generalSettings: true,
  modelConfig: false,
  shortcuts: true,
  workspacePersonal: true
};

export type DataBundleExportResult = {
  path: string;
  fileCount: number;
  byteSize: number;
};

export type DataBundleImportResult = {
  fileCount: number;
  nodesTotal: number;
  nodesImported: number;
  lanceChunksMerged: number;
};

function defaultExportName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `workshadow-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.ws`;
}

export function anyDataBundleOptionSelected(options: DataBundleExportOptions): boolean {
  return (
    options.logs ||
    options.memory ||
    options.generalSettings ||
    options.modelConfig ||
    options.shortcuts ||
    options.workspacePersonal
  );
}

export async function pickExportWsPath(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const path = await save({
    filters: [{ name: "WorkShadow Data", extensions: ["ws"] }],
    defaultPath: defaultExportName()
  });
  if (!path) return null;
  const raw = Array.isArray(path) ? path[0] : path;
  return raw ? normalizePickedPath(raw) : null;
}

export async function pickImportWsPath(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const selected = await open({
    multiple: false,
    filters: [{ name: "WorkShadow Data", extensions: ["ws"] }],
    title: "WorkShadow"
  });
  if (selected === null) return null;
  const raw = Array.isArray(selected) ? (selected[0] ?? null) : selected;
  return raw ? normalizePickedPath(raw) : null;
}

export async function exportDataBundle(
  destPath: string,
  options: DataBundleExportOptions
): Promise<DataBundleExportResult> {
  return invoke<DataBundleExportResult>("export_data_bundle", { destPath, options });
}

export async function importDataBundle(sourcePath: string): Promise<DataBundleImportResult> {
  return invoke<DataBundleImportResult>("import_data_bundle", { sourcePath });
}
