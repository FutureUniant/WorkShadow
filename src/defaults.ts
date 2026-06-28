import { defaultShortcutMap } from "./services/shortcuts";
import type { AppSettings, AppState, LogNode } from "./types";

const now = new Date().toISOString();

/** 空文档：仅一个空段落，由编辑器 Placeholder 提示，不落默认正文 */
export const emptyDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [] }]
};

export const defaultSettings: AppSettings = {
  language: "system",
  theme: "light",
  logDirectory: "",
  tempDirectory: "",
  mediaStrategy: "reference",
  llm: { provider: "openaiCompatible", baseUrl: "", apiKey: "", model: "" },
  llmProfiles: {},
  vlm: { provider: "openaiCompatible", baseUrl: "", apiKey: "", model: "" },
  embedding: { provider: "openaiCompatible", baseUrl: "", apiKey: "", model: "" },
  embeddingProfiles: {},
  searchResultOrder: "combined",
  semanticMinSimilarity: 0.55,
  shortcuts: { ...defaultShortcutMap }
};

export const defaultNodes: LogNode[] = [
  {
    id: "root-work",
    parentId: null,
    title: "工作",
    kind: "log",
    createdAt: now,
    updatedAt: now,
    tiptapJson: emptyDoc,
    markdown: ""
  },
  {
    id: "demo-log",
    parentId: "root-work",
    title: "第一篇日志",
    kind: "log",
    createdAt: now,
    updatedAt: now,
    tiptapJson: emptyDoc,
    markdown: ""
  }
];

export const defaultState: AppState = {
  settings: defaultSettings,
  nodes: defaultNodes,
  expandedNodeIds: ["root-work"],
  indexStatus: [],
  memoryEntries: [],
  documentGenerationPrefs: []
};
