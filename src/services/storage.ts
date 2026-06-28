import { invoke } from "@tauri-apps/api/core";
import { defaultSettings, defaultState, emptyDoc } from "../defaults";
import type { AppSettings, AppState, LogNode, MemoryEntry, SearchResultOrder } from "../types";
import { normalizeDocumentGenerationPrefs } from "./documentPrefs";
import { appLog } from "./appLogger";
import { normalizeLoadedIndexStatus, reportErrorToUser } from "./errorReporting";
import { normalizeModelConfig, normalizeModelProfiles } from "./modelProfiles";
import { mergeShortcutMap } from "./shortcuts";
import { getNodePath, repairOrphanParentIds } from "./tree";

function normalizeSearchResultOrder(raw: unknown): SearchResultOrder {
  if (raw === "semanticFirst" || raw === "keywordFirst" || raw === "combined") return raw;
  return "combined";
}

function normalizeSemanticMinSimilarity(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return defaultSettings.semanticMinSimilarity;
  return Math.min(1, Math.max(0, raw));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeLoadedSettings(raw: unknown): AppSettings {
  const s = isPlainObject(raw) ? (raw as Partial<AppSettings>) : {};
  const llm = normalizeModelConfig(s.llm);
  const embedding = normalizeModelConfig(s.embedding);
  return {
    ...defaultSettings,
    ...s,
    language: s.language === "zh" || s.language === "en" || s.language === "system" ? s.language : defaultSettings.language,
    theme: s.theme === "light" || s.theme === "dark" ? s.theme : defaultSettings.theme,
    mediaStrategy: s.mediaStrategy === "embed" || s.mediaStrategy === "reference" ? s.mediaStrategy : defaultSettings.mediaStrategy,
    logDirectory: typeof s.logDirectory === "string" ? s.logDirectory : defaultSettings.logDirectory,
    tempDirectory: typeof s.tempDirectory === "string" ? s.tempDirectory : defaultSettings.tempDirectory,
    llm,
    llmProfiles: normalizeModelProfiles(s.llmProfiles, llm),
    vlm: normalizeModelConfig(s.vlm),
    embedding,
    embeddingProfiles: normalizeModelProfiles(s.embeddingProfiles, embedding),
    searchResultOrder: normalizeSearchResultOrder(s.searchResultOrder),
    semanticMinSimilarity: normalizeSemanticMinSimilarity(s.semanticMinSimilarity),
    shortcuts: mergeShortcutMap(s.shortcuts)
  };
}

const STORAGE_KEY = "workshadow.state";
let lastLoadUsedFallback = false;

export function didLastLoadUseFallback() {
  return lastLoadUsedFallback;
}

export function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function normalizeMemoryEntries(raw: unknown): MemoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MemoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const title = typeof r.title === "string" ? r.title : "";
    const body = typeof r.body === "string" ? r.body : "";
    const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString();
    if (!id) continue;
    out.push({ id, title, body, updatedAt });
  }
  return out;
}

function cloneEmptyDoc() {
  return JSON.parse(JSON.stringify(emptyDoc));
}

function normalizeTiptapDoc(raw: unknown) {
  if (isPlainObject(raw) && raw.type === "doc" && Array.isArray(raw.content)) return raw;
  return cloneEmptyDoc();
}

function normalizeNodes(raw: unknown): { nodes: LogNode[]; recovered: boolean; reason?: string } {
  if (!Array.isArray(raw)) {
    return { nodes: repairOrphanParentIds(defaultState.nodes), recovered: true, reason: "saved nodes is not an array" };
  }

  const nodes: LogNode[] = [];
  const seen = new Set<string>();
  let recovered = false;
  for (const [index, row] of raw.entries()) {
    if (!isPlainObject(row)) {
      recovered = true;
      continue;
    }
    const id = typeof row.id === "string" && row.id.trim() ? row.id : "";
    if (!id || seen.has(id)) {
      recovered = true;
      continue;
    }
    seen.add(id);
    const kind = row.kind === "folder" || row.kind === "log" ? row.kind : "log";
    if (row.kind !== kind) recovered = true;
    nodes.push({
      id,
      parentId: typeof row.parentId === "string" ? row.parentId : null,
      title: typeof row.title === "string" && row.title.trim() ? row.title : `日志 ${index + 1}`,
      kind,
      sortOrder: typeof row.sortOrder === "number" && Number.isFinite(row.sortOrder) ? row.sortOrder : undefined,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
      tiptapJson: normalizeTiptapDoc(row.tiptapJson),
      markdown: typeof row.markdown === "string" ? row.markdown : "",
      markdownPath: typeof row.markdownPath === "string" ? row.markdownPath : undefined,
      jsonPath: typeof row.jsonPath === "string" ? row.jsonPath : undefined
    });
    if (normalizeTiptapDoc(row.tiptapJson) !== row.tiptapJson) recovered = true;
  }

  if (nodes.length === 0) {
    return { nodes: repairOrphanParentIds(defaultState.nodes), recovered: true, reason: "saved nodes is empty or invalid" };
  }
  return { nodes: repairOrphanParentIds(nodes), recovered, reason: recovered ? "some saved nodes were invalid and ignored" : undefined };
}

function normalizeStringArray(raw: unknown, fallback: string[] = []) {
  if (!Array.isArray(raw)) return fallback;
  return raw.filter((item): item is string => typeof item === "string");
}

function createDefaultLoadedState(): AppState {
  return {
    ...defaultState,
    settings: mergeLoadedSettings(undefined),
    nodes: repairOrphanParentIds(defaultState.nodes),
    indexStatus: [],
    memoryEntries: [],
    documentGenerationPrefs: []
  };
}

function normalizeLoadedState(raw: unknown): { state: AppState; recovered: boolean; reason?: string } {
  if (!isPlainObject(raw)) {
    return { state: createDefaultLoadedState(), recovered: true, reason: "saved app state is not an object" };
  }
  const nodes = normalizeNodes(raw.nodes);
  return {
    state: {
      ...defaultState,
      ...raw,
      settings: mergeLoadedSettings(raw.settings),
      nodes: nodes.nodes,
      expandedNodeIds: normalizeStringArray(raw.expandedNodeIds, defaultState.expandedNodeIds),
      indexStatus: normalizeLoadedIndexStatus(raw.indexStatus),
      memoryEntries: normalizeMemoryEntries(raw.memoryEntries),
      documentGenerationPrefs: normalizeDocumentGenerationPrefs(raw.documentGenerationPrefs)
    } as AppState,
    recovered: nodes.recovered,
    reason: nodes.reason
  };
}

export async function loadState(): Promise<AppState> {
  lastLoadUsedFallback = false;
  if (isTauriRuntime()) {
    try {
      const raw = await invoke<unknown>("load_app_state");
      const { state: merged, recovered, reason } = normalizeLoadedState(raw);
      if (recovered) {
        lastLoadUsedFallback = true;
        reportErrorToUser("loadState", reason ?? "saved data was partially invalid");
      }
      void appLog("info", "storage", "loadState ok", { nodes: merged.nodes.length, tauri: true });
      return merged;
    } catch (e) {
      lastLoadUsedFallback = true;
      reportErrorToUser("loadState", e);
      return createDefaultLoadedState();
    }
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      ...defaultState,
      settings: mergeLoadedSettings(undefined),
      nodes: repairOrphanParentIds(defaultState.nodes),
      indexStatus: [],
      memoryEntries: [],
      documentGenerationPrefs: []
    };
  }
  try {
    const { state, recovered, reason } = normalizeLoadedState(JSON.parse(raw));
    if (recovered) {
      lastLoadUsedFallback = true;
      reportErrorToUser("loadState", reason ?? "saved data was partially invalid", { severity: "toast" });
    }
    return state;
  } catch (e) {
    lastLoadUsedFallback = true;
    reportErrorToUser("loadState", e, { severity: "toast" });
    return createDefaultLoadedState();
  }
}

export async function persistState(state: AppState) {
  if (isTauriRuntime()) {
    await invoke("save_app_state", { state });
    void appLog("debug", "storage", "persistState ok", { nodes: state.nodes.length });
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    reportErrorToUser("persist", e);
    throw e;
  }
}

export async function persistLogFiles(settings: AppSettings, nodes: LogNode[], node: LogNode) {
  const relativePath = buildRelativePath(nodes, node.id);
  if (isTauriRuntime()) {
    try {
      return await invoke<{ markdownPath: string; jsonPath: string }>("write_log_files", {
        settings,
        node,
        relativePath
      });
    } catch (e) {
      reportErrorToUser("writeLog", e, { logId: node.id });
      throw e;
    }
  }
  return {
    markdownPath: `${settings.logDirectory || "logs"}/${relativePath}.md`,
    jsonPath: `${settings.logDirectory || "logs"}/${relativePath}.tiptap.json`
  };
}

function buildRelativePath(nodes: LogNode[], nodeId: string) {
  return getNodePath(nodes, nodeId)
    .map((node) => sanitizePathSegment(node.title))
    .join("/");
}

function sanitizePathSegment(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim() || "untitled";
}
