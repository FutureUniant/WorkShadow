import { describe, expect, it } from "vitest";
import type { LogChunk, LogNode } from "../types";
import {
  buildSearchSnippet,
  groupSearchResultsByLog,
  mergeChunksPreservingStableIds,
  mergeSearchHitsByOrder,
  WorkshadowRag
} from "./rag";

describe("buildSearchSnippet", () => {
  it("highlights matched keyword with surrounding context", () => {
    const parts = buildSearchSnippet("前面内容 alpha beta gamma 后面内容", "beta", 40);
    const text = parts.map((p) => p.text).join("");
    expect(text).toContain("beta");
    expect(parts.some((p) => p.emphasis === "keyword" && p.text === "beta")).toBe(true);
  });

  it("highlights multiple query terms in one snippet", () => {
    const parts = buildSearchSnippet("项目 alpha 进展 beta 完成", "alpha beta", 80);
    expect(parts.some((p) => p.emphasis === "keyword" && p.text === "alpha")).toBe(true);
    expect(parts.some((p) => p.emphasis === "keyword" && p.text === "beta")).toBe(true);
  });

  it("vector hit keeps semantic highlights when keyword scorer would also match", () => {
    const chunk = (id: string, text: string): LogChunk => ({
      id,
      logId: "log1",
      text,
      timestamp: "t",
      parentPath: "Root",
      position: 0,
      score: 0.01
    });
    const semanticIds = new Set(["log1:0"]);
    const grouped = groupSearchResultsByLog(
      [
        {
          chunk: chunk("log1:0", `${"日常记录。".repeat(60)}本周完成数据库迁移与上线验收。${"备注。".repeat(40)}`),
          score: 0.02,
          matchKind: "semantic"
        }
      ],
      "上线验收",
      { semanticChunkIds: semanticIds }
    );
    expect(grouped[0]?.hits[0]?.matchKind).toBe("semantic");
    expect(
      grouped[0]?.hits[0]?.summaryParts.some(
        (p) => p.emphasis === "semantic-region" || p.emphasis === "semantic-term"
      )
    ).toBe(true);
    const joined = grouped[0]?.hits[0]?.summaryParts.map((p) => p.text).join("") ?? "";
    expect(joined).toContain("验收");
  });

  it("semantic snippet uses region style when query words are not in text", () => {
    const filler = "无关记录。".repeat(80);
    const text = `${filler}本周完成数据库迁移与上线验收。${filler}`;
    const parts = buildSearchSnippet(text, "产品路线图规划", 100, { semantic: true });
    const joined = parts.map((p) => p.text).join("");
    expect(parts.some((p) => p.emphasis === "semantic-region")).toBe(true);
    expect(joined).toContain("迁移");
    expect(joined.startsWith("无关")).toBe(false);
  });

  it("semantic snippet uses term style when query words appear in text", () => {
    const parts = buildSearchSnippet("本周完成数据库迁移与上线验收", "上线验收", 80, { semantic: true });
    expect(parts.some((p) => p.emphasis === "semantic-term" && p.text.includes("验收"))).toBe(true);
  });
});

describe("groupSearchResultsByLog", () => {
  const chunk = (id: string, logId: string, text: string, score: number): LogChunk => ({
    id,
    logId,
    text,
    timestamp: "t",
    parentPath: "Root / Log",
    position: 0,
    score
  });

  it("merges multiple chunk hits under one log", () => {
    const grouped = groupSearchResultsByLog(
      [
        { chunk: chunk("a:0", "a", "first alpha hit", 2), score: 2 },
        { chunk: chunk("a:1", "a", "second beta hit", 1.5), score: 1.5 },
        { chunk: chunk("b:0", "b", "other log", 3), score: 3 }
      ],
      "alpha beta"
    );
    expect(grouped).toHaveLength(2);
    const logA = grouped.find((g) => g.logId === "a");
    expect(logA?.matchCount).toBe(2);
    expect(logA?.hits).toHaveLength(2);
    expect(grouped[0].logId).toBe("b");
  });
});

describe("mergeChunksPreservingStableIds", () => {
  const base = (text: string, pos: number, id: string): LogChunk => ({
    id,
    logId: "L",
    text,
    timestamp: "t0",
    parentPath: "Old",
    position: pos
  });

  it("reuses ids for unchanged blocks in order", () => {
    const oldChunks = [base("A", 0, "L:0"), base("B", 1, "L:1"), base("C", 2, "L:2")];
    const newBlocks = ["A", "B", "X", "C"];
    const merged = mergeChunksPreservingStableIds(oldChunks, newBlocks, "L", "New", "t1");
    expect(merged.map((m) => m.text)).toEqual(["A", "B", "X", "C"]);
    expect(merged[0].id).toBe("L:0");
    expect(merged[1].id).toBe("L:1");
    expect(merged[2].id).toBe("L:2");
    expect(merged[3].id).toBe("L:3");
    expect(merged.every((m) => m.parentPath === "New")).toBe(true);
  });
});

describe("mergeSearchHitsByOrder", () => {
  const hit = (id: string, score: number) => ({
    chunk: { id, logId: "L", text: id, timestamp: "", parentPath: "", position: 0 },
    score
  });

  it("combined prefers semantic list when present", () => {
    const sem = [hit("s1", 2)];
    const kw = [hit("k1", 3)];
    expect(mergeSearchHitsByOrder(sem, kw, "combined").map((h) => h.chunk.id)).toEqual(["s1", "k1"]);
  });

  it("semanticFirst appends keyword-only hits", () => {
    const sem = [hit("s1", 2)];
    const kw = [hit("s1", 2), hit("k1", 1)];
    expect(mergeSearchHitsByOrder(sem, kw, "semanticFirst").map((h) => h.chunk.id)).toEqual(["s1", "k1"]);
  });
});

describe("WorkshadowRag syncFromNodes", () => {
  const doc = (text: string) => ({
    type: "doc",
    content: text.split(/\n\n+/).map((part) => ({ type: "paragraph", content: [{ type: "text", text: part }] }))
  });

  const log = (id: string, title: string, md: string, parentId: string | null = null): LogNode => ({
    id,
    parentId,
    title,
    kind: "log",
    createdAt: "c",
    updatedAt: "u",
    tiptapJson: doc(md),
    markdown: md
  });

  const settings = {
    language: "zh" as const,
    theme: "light" as const,
    logDirectory: "",
    tempDirectory: "",
    mediaStrategy: "embed" as const,
    llm: { baseUrl: "", apiKey: "", model: "" },
    vlm: { baseUrl: "", apiKey: "", model: "" },
    embedding: { baseUrl: "", apiKey: "", model: "" },
    searchResultOrder: "combined" as const,
    semanticMinSimilarity: 0.55,
    shortcuts: {
      newLog: { code: "KeyN", mod: "ctrlOrMeta" as const, shift: false, alt: false },
      globalNewLog: { code: "KeyN", mod: "ctrlOrMeta" as const, shift: true, alt: false },
      lightboxClose: { code: "Escape", mod: "none" as const, shift: false, alt: false },
      lightboxPrev: { code: "ArrowLeft", mod: "none" as const, shift: false, alt: false },
      lightboxNext: { code: "ArrowRight", mod: "none" as const, shift: false, alt: false },
      treeMenuClose: { code: "Escape", mod: "none" as const, shift: false, alt: false }
    }
  };

  it("path-only change updates parentPath without growing chunk count", async () => {
    const rag = new WorkshadowRag();
    const a = log("a", "Root", "hello\n\nworld", null);
    const b = log("b", "Child", "x", "a");
    await rag.index([a, b], settings);
    const afterPath = [a, { ...b, title: "Renamed" }];
    await rag.syncFromNodes(afterPath, settings);
    const results = await rag.searchDocuments("x", afterPath, settings);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].hits[0].chunk.parentPath).toContain("Renamed");
  });

  it("search ranks keyword-heavy chunk", async () => {
    const rag = new WorkshadowRag();
    const n = log("n1", "T", "alpha beta gamma delta", null);
    await rag.index([n], settings);
    const results = await rag.searchDocuments("beta gamma", [n], settings);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].hits[0].summaryParts.map((p) => p.text).join("")).toContain("beta");
  });

  it("indexes folder nodes so their markdown is searchable", async () => {
    const rag = new WorkshadowRag();
    const folder: LogNode = {
      id: "f1",
      parentId: null,
      title: "分组甲",
      kind: "folder",
      createdAt: "c",
      updatedAt: "u",
      tiptapJson: doc("folder-only-keyword-xyz 说明文字"),
      markdown: "folder-only-keyword-xyz 说明文字"
    };
    await rag.index([folder], settings);
    const results = await rag.searchDocuments("folder-only-keyword-xyz", [folder], settings);
    expect(results.some((r) => r.logId === "f1")).toBe(true);
  });
});
