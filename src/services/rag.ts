import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, LogChunk, LogNode, SearchResult, SearchResultOrder, SearchSnippetPart } from "../types";
import { beginActivity, endActivity } from "./activityHub";
import { AsyncSerialQueue } from "./asyncSerialQueue";
import { isDevVerboseApiLogging } from "./apiTrace";
import { reportErrorToUser } from "./errorReporting";
import { isTauriRuntime } from "./storage";
import { hashTiptapChunk, hashTiptapDocument, splitTiptapIntoChunks, splitTiptapToBlocks } from "./tiptapChunks";
import { getPathTitle } from "./tree";

export interface KnowledgeTreeProvider {
  build(nodes: LogNode[], chunks: LogChunk[]): Promise<void>;
  search(query: string): Promise<SearchResult[]>;
}

export class DeferredKnowledgeTree implements KnowledgeTreeProvider {
  async build() {
    return Promise.resolve();
  }

  async search() {
    return [];
  }
}

type LogIndexMeta = {
  contentHash: string;
  parentPath: string;
};

type IndexedChunk = LogChunk & {
  contentHash?: string;
};

type NativeRagSearchResult = {
  chunk: LogChunk;
  summary: string;
};

export function hasEmbeddingConfig(settings: AppSettings) {
  return Boolean(settings.embedding.baseUrl.trim() && settings.embedding.apiKey.trim() && settings.embedding.model.trim());
}

export type ScoredHit = {
  chunk: LogChunk;
  node?: LogNode;
  score: number;
  matchKind?: "semantic" | "keyword";
};

/** 按设置合并向量检索与关键词检索的命中列表（去重 chunk id） */
export function mergeSearchHitsByOrder(
  semantic: ScoredHit[],
  keyword: ScoredHit[],
  order: SearchResultOrder
): ScoredHit[] {
  const key = (h: ScoredHit) => h.chunk.id;
  if (order === "combined") {
    const seen = new Set(semantic.map(key));
    return [...semantic, ...keyword.filter((h) => !seen.has(key(h)))];
  }
  if (order === "semanticFirst") {
    const seen = new Set(semantic.map(key));
    return [...semantic, ...keyword.filter((h) => !seen.has(key(h)))];
  }
  const seen = new Set(keyword.map(key));
  return [...keyword, ...semantic.filter((h) => !seen.has(key(h)))];
}

/** 基于块文本 LCS 尽量复用旧 chunk（稳定 id），仅新增/删除/变更块重建 */
export function mergeChunksPreservingStableIds(
  oldChunks: LogChunk[],
  newBlocks: string[],
  logId: string,
  parentPath: string,
  timestamp: string
): LogChunk[] {
  const sortedOld = [...oldChunks].sort((a, b) => a.position - b.position);
  const oldTexts = sortedOld.map((c) => c.text);
  const n = oldTexts.length;
  const m = newBlocks.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldTexts[i - 1] === newBlocks[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const temp: LogChunk[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTexts[i - 1] === newBlocks[j - 1]) {
      const base = sortedOld[i - 1];
      temp.push({
        ...base,
        text: newBlocks[j - 1],
        parentPath,
        timestamp
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({
        id: `${logId}:pending`,
        logId,
        text: newBlocks[j - 1],
        timestamp,
        parentPath,
        position: j - 1
      });
      j--;
    } else {
      i--;
    }
  }
  return temp.reverse().map((chunk, position) => ({
    ...chunk,
    id: `${logId}:${position}`,
    position
  }));
}

function tokenizeQuery(raw: string): string[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const parts = q.split(/[\s\u3000]+/).filter(Boolean);
  const out = new Set<string>();
  for (const p of parts) {
    out.add(p);
    if (p.length > 24) out.add(p.slice(0, 24));
  }
  const cjkRun = q.replace(/[\s\u3000]+/g, "");
  if (cjkRun.length >= 2 && /[\u4e00-\u9fff]/.test(cjkRun)) {
    for (let i = 0; i < cjkRun.length - 1; i++) {
      out.add(cjkRun.slice(i, i + 2));
    }
  }
  return [...out];
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + Math.max(1, needle.length);
  }
  return count;
}

/** 词项命中 + 词频对数（无全局 IDF 的轻量 BM25 风格） */
function keywordScore(haystackLower: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    const tf = countOccurrences(haystackLower, term);
    if (tf > 0) {
      const lenBoost = term.length >= 2 ? 1.15 : 1;
      score += lenBoost * (1 + Math.log(1 + tf));
    }
  }
  return score;
}

function bigrams(s: string): Map<string, number> {
  const map = new Map<string, number>();
  const t = s.length > 2800 ? s.slice(0, 2800) : s;
  for (let i = 0; i < t.length - 1; i++) {
    const bg = t.slice(i, i + 2);
    map.set(bg, (map.get(bg) ?? 0) + 1);
  }
  return map;
}

/** 字符级：二元组集合的加权 Jaccard（对中文/混合查询更稳） */
function charBigramScore(queryLower: string, textLower: string): number {
  const qa = bigrams(queryLower.replace(/\s+/g, ""));
  const tb = bigrams(textLower.replace(/\s+/g, ""));
  if (qa.size === 0) return 0;
  let interW = 0;
  let unionW = 0;
  const keys = new Set([...qa.keys(), ...tb.keys()]);
  for (const k of keys) {
    const a = qa.get(k) ?? 0;
    const b = tb.get(k) ?? 0;
    interW += Math.min(a, b);
    unionW += Math.max(a, b);
  }
  if (unionW === 0) return 0;
  return interW / unionW;
}

/** 子串级：最长公共子序列长度 / 归一化（短查询补充） */
function normalizedLcsScore(queryLower: string, textLower: string): number {
  const a = queryLower.slice(0, 64);
  const b = textLower.length > 1200 ? textLower.slice(0, 1200) : textLower;
  if (!a.length || !b.length) return 0;
  const n = a.length;
  const m = b.length;
  let prev = new Uint16Array(m + 1);
  let cur = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) cur[j] = prev[j - 1] + 1;
      else cur[j] = Math.max(prev[j], cur[j - 1]);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
    cur.fill(0);
  }
  const lcs = prev[m];
  return lcs / Math.max(n, 8);
}

function hybridChunkScore(chunkText: string, parentPath: string, queryNorm: string, terms: string[]): number {
  const hay = `${chunkText}\n${parentPath}`.toLowerCase();
  const kw = keywordScore(hay, terms);
  const bg = charBigramScore(queryNorm, hay);
  const lcs = normalizedLcsScore(queryNorm, hay);
  return kw * 0.62 + bg * 2.4 + lcs * 0.85;
}

export class WorkshadowRag {
  private chunks: IndexedChunk[] = [];
  private readonly knowledgeTree: KnowledgeTreeProvider;
  private readonly logMeta = new Map<string, LogIndexMeta>();
  private readonly opQueue = new AsyncSerialQueue();
  private indexReady = false;

  constructor(knowledgeTree: KnowledgeTreeProvider = new DeferredKnowledgeTree()) {
    this.knowledgeTree = knowledgeTree;
  }

  async configureFlowRag(settings: AppSettings) {
    return Promise.resolve(settings);
  }

  /**
   * 全量重建（启动、强制刷新）；会清空增量元数据。
   */
  async index(nodes: LogNode[], settings: AppSettings, options?: { activityKind?: "index" | "vectorRebuild" | "embedding" }): Promise<LogChunk[]> {
    const kind = options?.activityKind ?? "index";
    return this.opQueue.enqueue(async () => {
      const id = beginActivity(kind);
      try {
        const chunks = await this.syncFromNodesInner(nodes, settings, { forceFull: true });
        endActivity(id);
        return chunks;
      } catch (e) {
        endActivity(id, e instanceof Error ? e.message : String(e));
        throw e;
      }
    });
  }

  /**
   * 与当前树同步：分块与哈希均以内存中的 `node.tiptapJson` 为准（非磁盘 .md / .tiptap.json）；
   * 按文档哈希跳过未改节点；仅路径变更时只更新 parentPath；正文变更时在块级用 LCS 复用未变块。
   */
  async syncFromNodes(
    nodes: LogNode[],
    settings: AppSettings,
    options?: { forceFull?: boolean; reembedAllVectors?: boolean; activityKind?: "index" | "vectorRebuild" | "embedding" }
  ): Promise<LogChunk[]> {
    return this.opQueue.enqueue(async () => {
      const id = beginActivity(options?.activityKind ?? "index");
      try {
        const chunks = await this.syncFromNodesInner(nodes, settings, options);
        endActivity(id);
        return chunks;
      } catch (e) {
        endActivity(id, e instanceof Error ? e.message : String(e));
        throw e;
      }
    });
  }

  /** 先同步索引再搜索，与启动时的全量 index 串行，避免首次回车搜不到结果。 */
  async searchDocuments(
    query: string,
    nodes: LogNode[],
    settings: AppSettings,
    options?: { onKeywordFallbackNotice?: () => void }
  ): Promise<SearchResult[]> {
    return this.opQueue.enqueue(async () => {
      const id = beginActivity("search", query.slice(0, 48));
      try {
        await this.syncFromNodesInner(nodes, settings);
        const results = await this.searchInner(query, nodes, settings, options);
        endActivity(id);
        return results;
      } catch (e) {
        endActivity(id, e instanceof Error ? e.message : String(e));
        throw e;
      }
    });
  }

  private async syncFromNodesInner(
    nodes: LogNode[],
    settings: AppSettings,
    options?: { forceFull?: boolean; reembedAllVectors?: boolean }
  ): Promise<LogChunk[]> {
    await this.configureFlowRag(settings);
    /** 日志与分组节点均可写正文，均需参与检索（仅排除未来可能扩展的其它 kind） */
    const indexableNodes = nodes.filter((n) => n.kind === "log" || n.kind === "folder");
    const activeIndexedIds = new Set(indexableNodes.map((n) => n.id));

    if (options?.forceFull || !this.indexReady) {
      this.indexReady = true;
      this.logMeta.clear();
      this.chunks = [];
      const now = new Date().toISOString();
      for (const node of indexableNodes) {
        const path = getPathTitle(nodes, node.id);
        const h = hashTiptapDocument(node.tiptapJson);
        const list = splitTiptapIntoChunks(node, path, now);
        this.chunks.push(...list.map((c) => ({ ...c, timestamp: c.timestamp || now })));
        this.logMeta.set(node.id, { contentHash: h, parentPath: path });
      }
      await this.knowledgeTree.build(nodes, this.chunks);
      await this.syncNativeIndex(settings, activeIndexedIds, {
        forceFull: Boolean(options?.forceFull),
        reembedAllVectors: Boolean(options?.reembedAllVectors)
      });
      return this.chunks;
    }

    this.chunks = this.chunks.filter((c) => activeIndexedIds.has(c.logId));
    for (const id of [...this.logMeta.keys()]) {
      if (!activeIndexedIds.has(id)) this.logMeta.delete(id);
    }

    const now = new Date().toISOString();
    for (const node of indexableNodes) {
      const path = getPathTitle(nodes, node.id);
      const h = hashTiptapDocument(node.tiptapJson);
      const prev = this.logMeta.get(node.id);

      if (!prev) {
        const list = splitTiptapIntoChunks(node, path, now);
        this.chunks.push(...list.map((c) => ({ ...c, timestamp: c.timestamp || now })));
        this.logMeta.set(node.id, { contentHash: h, parentPath: path });
        continue;
      }

      if (prev.contentHash === h && prev.parentPath === path) continue;

      if (prev.contentHash === h && prev.parentPath !== path) {
        this.chunks = this.chunks.map((c) => (c.logId === node.id ? { ...c, parentPath: path } : c));
        this.logMeta.set(node.id, { contentHash: h, parentPath: path });
        continue;
      }

      const oldChunks = this.chunks.filter((c) => c.logId === node.id);
      this.chunks = this.chunks.filter((c) => c.logId !== node.id);
      const newBlocks = splitTiptapToBlocks(node.tiptapJson);
      const merged =
        oldChunks.length && newBlocks.length
          ? mergeChunksPreservingStableIds(oldChunks, newBlocks, node.id, path, now)
          : splitTiptapIntoChunks(node, path, now).map((c) => ({ ...c, timestamp: now }));
      this.chunks.push(...merged.map((chunk) => ({ ...chunk, contentHash: hashTiptapChunk(chunk.text) })));
      this.logMeta.set(node.id, { contentHash: h, parentPath: path });
    }

    await this.knowledgeTree.build(nodes, this.chunks);
    await this.syncNativeIndex(settings, activeIndexedIds, {
      forceFull: Boolean(options?.forceFull),
      reembedAllVectors: Boolean(options?.reembedAllVectors)
    });
    return this.chunks;
  }

  private async syncNativeIndex(
    settings: AppSettings,
    activeIndexedIds: Set<string>,
    options: { forceFull: boolean; reembedAllVectors: boolean }
  ) {
    if (!isTauriRuntime() || !hasEmbeddingConfig(settings)) return;
    await invoke("rag_sync_index", {
      request: {
        settings,
        chunks: this.chunks.map((chunk) => ({
          id: chunk.id,
          logId: chunk.logId,
          text: chunk.text,
          timestamp: chunk.timestamp,
          parentPath: chunk.parentPath,
          position: chunk.position,
          contentHash: chunk.contentHash ?? hashTiptapChunk(chunk.text)
        })),
        activeLogIds: [...activeIndexedIds],
        forceFull: options.forceFull,
        reembedAllVectors: options.reembedAllVectors,
        devVerboseLogging: isDevVerboseApiLogging()
      }
    });
  }

  private async searchInner(
    query: string,
    nodes: LogNode[],
    settings: AppSettings,
    options?: { onKeywordFallbackNotice?: () => void }
  ): Promise<SearchResult[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const terms = tokenizeQuery(normalized);
    const semanticAvailable = isTauriRuntime() && hasEmbeddingConfig(settings);
    const order = settings.searchResultOrder ?? "combined";

    let semanticFlat: ScoredHit[] = [];
    if (semanticAvailable) {
      try {
        const nativeResults = await invoke<NativeRagSearchResult[]>("rag_search", {
          request: { settings, query, limit: 36, devVerboseLogging: isDevVerboseApiLogging() }
        });
        semanticFlat = nativeResults.map((result) =>
          toScoredHit(result.chunk, nodes, result.chunk.score ?? 0, undefined, "semantic")
        );
      } catch (error) {
        reportErrorToUser("search", error, { severity: "toast" });
      }
    } else if (options?.onKeywordFallbackNotice) {
      options.onKeywordFallbackNotice();
    }

    const keywordResults = this.chunks
      .map((chunk) => {
        const score = hybridChunkScore(chunk.text, chunk.parentPath, normalized, terms);
        return { ...chunk, score };
      })
      .filter((chunk) => (chunk.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 36);

    const treeResults = await this.knowledgeTree.search(query);
    const keywordFlat: ScoredHit[] = [
      ...keywordResults.map((chunk) => toScoredHit(chunk, nodes, chunk.score ?? 0, undefined, "keyword")),
      ...treeResults.flatMap((legacy) =>
        legacy.hits.map((hit) => ({
          chunk: hit.chunk,
          node: legacy.node,
          score: legacy.score,
          matchKind: "keyword" as const
        }))
      )
    ];

    /** 向量命中的 chunk 始终用语义摘要（勿被本地模糊关键词分覆盖为 keyword） */
    const semanticChunkIds = new Set(semanticFlat.map((h) => h.chunk.id));
    const flat = mergeSearchHitsByOrder(semanticFlat, keywordFlat, order).map((h) => ({
      ...h,
      matchKind: semanticChunkIds.has(h.chunk.id) ? ("semantic" as const) : ("keyword" as const)
    }));
    return groupSearchResultsByLog(flat, query, { semanticChunkIds });
  }
}

export const SEARCH_MAX_LOGS = 12;
export const SEARCH_MAX_SNIPPETS_PER_LOG = 3;

function toScoredHit(
  chunk: LogChunk,
  nodes: LogNode[],
  score: number,
  node?: LogNode,
  matchKind?: ScoredHit["matchKind"]
): ScoredHit {
  return {
    chunk,
    node: node ?? nodes.find((item) => item.id === chunk.logId),
    score,
    matchKind
  };
}

/** 将分块级命中按 logId 聚合，每篇日志保留若干条摘要行 */
export function groupSearchResultsByLog(
  hits: ScoredHit[],
  query: string,
  options?: { maxLogs?: number; maxSnippetsPerLog?: number; semanticChunkIds?: Set<string> }
): SearchResult[] {
  const isSemanticHit = (hit: ScoredHit) =>
    options?.semanticChunkIds?.has(hit.chunk.id) ?? hit.matchKind === "semantic";
  const maxLogs = options?.maxLogs ?? SEARCH_MAX_LOGS;
  const maxSnippets = options?.maxSnippetsPerLog ?? SEARCH_MAX_SNIPPETS_PER_LOG;
  const byLog = new Map<string, ScoredHit[]>();

  for (const hit of hits) {
    const list = byLog.get(hit.chunk.logId) ?? [];
    if (!list.some((item) => item.chunk.id === hit.chunk.id)) {
      list.push(hit);
      byLog.set(hit.chunk.logId, list);
    }
  }

  const snippetLen = (hitCount: number) => (hitCount > 1 ? 140 : 180);

  const grouped = [...byLog.entries()].map(([logId, logHits]) => {
    const sorted = [...logHits].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, maxSnippets);
    const best = top[0];
    const len = snippetLen(top.length);
    return {
      logId,
      node: best.node,
      parentPath: best.chunk.parentPath,
      score: Math.max(...sorted.map((h) => h.score)),
      matchCount: sorted.length,
      hits: top.map((h) => {
        const semantic = isSemanticHit(h);
        return {
          chunk: h.chunk,
          matchKind: semantic ? ("semantic" as const) : ("keyword" as const),
          summaryParts: buildSearchSnippet(h.chunk.text, query, len, { semantic })
        };
      })
    } satisfies SearchResult;
  });

  grouped.sort((a, b) => b.score - a.score);
  return grouped.slice(0, maxLogs);
}

function mergeHighlightRanges(ranges: { start: number; end: number }[]) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

function findTermHighlightRanges(lower: string, terms: string[]) {
  const ranges: { start: number; end: number }[] = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    while (from <= lower.length - term.length) {
      const idx = lower.indexOf(term, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + term.length });
      from = idx + 1;
    }
  }
  return mergeHighlightRanges(ranges);
}

function partsFromHighlightRanges(
  text: string,
  highlights: { start: number; end: number }[],
  maxLen: number
): SearchSnippetPart[] {
  if (highlights.length === 0) return [];

  const context = 22;
  const parts: SearchSnippetPart[] = [];
  const lead = Math.max(0, highlights[0].start - context);
  if (lead > 0) parts.push({ text: "…" });
  if (highlights[0].start > lead) {
    parts.push({ text: text.slice(lead, highlights[0].start) });
  }

  for (let i = 0; i < highlights.length; i++) {
    const h = highlights[i];
    parts.push({ text: text.slice(h.start, h.end), highlight: true });
    const next = highlights[i + 1];
    if (!next) continue;
    const gapStart = h.end;
    const gapEnd = next.start;
    const gap = text.slice(gapStart, gapEnd);
    if (!gap) continue;
    const maxGap = Math.max(8, Math.floor(maxLen / (highlights.length + 2)));
    const shown =
      gap.length <= maxGap ? gap : gap.length <= maxGap + 4 ? gap : `…${gap.slice(-maxGap)}…`;
    parts.push({ text: shown });
  }

  const tailStart = highlights[highlights.length - 1].end;
  const tailEnd = Math.min(text.length, tailStart + context);
  if (tailEnd > tailStart) {
    parts.push({ text: text.slice(tailStart, tailEnd) + (tailEnd < text.length ? "…" : "") });
  }

  let joined = parts.map((p) => p.text).join("");
  while (joined.length > maxLen + 2 && parts.length > 1) {
    const dropIdx = parts.findIndex((p, idx) => idx > 0 && idx < parts.length - 1 && !p.highlight);
    if (dropIdx === -1) break;
    parts.splice(dropIdx, 1);
    joined = parts.map((p) => p.text).join("");
  }
  return parts.filter((part) => part.text.length > 0);
}

export type BuildSearchSnippetOptions = {
  /** 向量语义命中：在 chunk 内找最相关片段并高亮与查询重叠的用语 */
  semantic?: boolean;
};

/** 在匹配位置附近截取摘要，并高亮查询词项；语义命中时按相关片段居中展示 */
export function buildSearchSnippet(
  raw: string,
  query: string,
  maxLen = 180,
  options?: BuildSearchSnippetOptions
): SearchSnippetPart[] {
  const text = stripMarkupForSearchPreview(raw, 10_000);
  const q = query.trim();
  if (!text) return [];
  if (!q) {
    const preview = text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
    return [{ text: preview }];
  }

  if (options?.semantic) {
    return buildSemanticSearchSnippet(text, q, maxLen);
  }

  return buildKeywordSearchSnippet(text, q, maxLen);
}

function buildKeywordSearchSnippet(text: string, q: string, maxLen: number): SearchSnippetPart[] {
  const lower = text.toLowerCase();
  const terms = tokenizeQuery(q.toLowerCase()).sort((a, b) => b.length - a.length);
  const merged = findTermHighlightRanges(lower, terms);

  if (merged.length === 0) {
    const preview = text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
    return [{ text: preview }];
  }

  return tagKeywordTermParts(snippetFromHighlightRanges(text, merged, maxLen));
}

function tagKeywordTermParts(parts: SearchSnippetPart[]): SearchSnippetPart[] {
  return parts.map((part) =>
    part.highlight ? { text: part.text, emphasis: "keyword" as const } : { text: part.text }
  );
}

/** 正文是否包含查询短语或分词后的字面词（不含仅二元组模糊重叠） */
export function chunkHasLiteralQueryMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const qLower = query.trim().toLowerCase();
  if (!qLower) return false;
  const terms = tokenizeQuery(qLower);
  return (
    findQueryPhraseRanges(lower, qLower).length > 0 || findTermHighlightRanges(lower, terms).length > 0
  );
}

/** 语义命中：无字面词时整块相关片段；有字面词时加粗这些词 */
function buildSemanticSearchSnippet(text: string, q: string, maxLen: number): SearchSnippetPart[] {
  if (!chunkHasLiteralQueryMatch(text, q)) {
    return buildSemanticRegionSnippet(text, q, maxLen);
  }

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const terms = tokenizeQuery(qLower).sort((a, b) => b.length - a.length);
  const merged = mergeHighlightRanges([
    ...findQueryPhraseRanges(lower, qLower),
    ...findTermHighlightRanges(lower, terms)
  ]);
  if (merged.length === 0) {
    return buildSemanticRegionSnippet(text, q, maxLen);
  }
  return tagSemanticTermParts(snippetFromHighlightRanges(text, merged, maxLen));
}

/** 无语面关键词：展示与查询最相关的 chunk 窗口，整块使用语义区域样式 */
function buildSemanticRegionSnippet(text: string, q: string, maxLen: number): SearchSnippetPart[] {
  const center = findBestExcerptCenter(text, q);
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, center - half);
  let end = Math.min(text.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);
  const excerpt = text.slice(start, end).trim();
  if (!excerpt) return [{ text: text.length <= maxLen ? text : `${text.slice(0, maxLen)}…` }];

  const parts: SearchSnippetPart[] = [];
  if (start > 0) parts.push({ text: "…" });
  parts.push({ text: excerpt, emphasis: "semantic-region" });
  if (end < text.length) parts.push({ text: "…" });
  return parts;
}

function tagSemanticTermParts(parts: SearchSnippetPart[]): SearchSnippetPart[] {
  return parts.map((part) =>
    part.highlight ? { text: part.text, emphasis: "semantic-term" as const } : { text: part.text }
  );
}

function findQueryPhraseRanges(lower: string, queryLower: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const q = queryLower.trim();
  if (q.length < 2) return ranges;
  let from = 0;
  while (from <= lower.length - q.length) {
    const idx = lower.indexOf(q, from);
    if (idx === -1) break;
    ranges.push({ start: idx, end: idx + q.length });
    from = idx + 1;
  }
  const words = q.split(/[\s\u3000]+/).filter((w) => w.length >= 2);
  for (const word of words) {
    let wFrom = 0;
    while (wFrom <= lower.length - word.length) {
      const idx = lower.indexOf(word, wFrom);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + word.length });
      wFrom = idx + 1;
    }
  }
  return mergeHighlightRanges(ranges);
}

function findQueryBigramRanges(lower: string, queryLower: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const compact = queryLower.replace(/[\s\u3000]+/g, "");
  if (compact.length < 2) return ranges;
  const seen = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) {
    const bg = compact.slice(i, i + 2);
    if (seen.has(bg) || !/[\u4e00-\u9fff\w]/.test(bg)) continue;
    seen.add(bg);
    let from = 0;
    while (from <= lower.length - 2) {
      const idx = lower.indexOf(bg, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + 2 });
      from = idx + 1;
    }
  }
  return mergeHighlightRanges(ranges);
}

function findBestExcerptCenter(text: string, query: string): number {
  const q = query.trim().toLowerCase();
  const hay = text.toLowerCase();
  if (!q || !hay) return Math.floor(text.length / 2);
  const terms = tokenizeQuery(q);
  const windowSize = Math.min(Math.max(maxLenForQuery(q), 80), hay.length);
  const step = Math.max(6, Math.floor(windowSize / 5));
  let bestScore = -1;
  let bestCenter = Math.floor(windowSize / 2);
  for (let start = 0; start < hay.length; start += step) {
    const slice = hay.slice(start, Math.min(hay.length, start + windowSize));
    const score = hybridChunkScore(slice, "", q, terms);
    if (score > bestScore) {
      bestScore = score;
      bestCenter = start + Math.floor(slice.length / 2);
    }
  }
  return bestCenter;
}

function maxLenForQuery(q: string): number {
  return Math.min(160, Math.max(64, q.length * 4));
}

function snippetFromHighlightRanges(
  text: string,
  merged: { start: number; end: number }[],
  maxLen: number,
  bounds?: { windowStart: number; windowEnd: number }
): SearchSnippetPart[] {
  if (merged.length === 0) {
    const preview = text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
    return [{ text: preview }];
  }

  if (bounds) {
    return partsInWindow(text, merged, bounds.windowStart, bounds.windowEnd);
  }

  const span = merged[merged.length - 1].end - merged[0].start;
  if (span <= maxLen) {
    return partsFromHighlightRanges(text, merged, maxLen);
  }

  const radius = Math.max(16, Math.floor(maxLen / 3));
  let start = Math.max(0, merged[0].start - radius);
  let end = Math.min(text.length, merged[merged.length - 1].end + radius);
  if (end - start > maxLen) end = Math.min(text.length, start + maxLen);
  return partsInWindow(text, merged, start, end);
}

function partsInWindow(
  text: string,
  merged: { start: number; end: number }[],
  start: number,
  end: number
): SearchSnippetPart[] {
  const clipped = merged
    .map((r) => ({ start: Math.max(r.start, start), end: Math.min(r.end, end) }))
    .filter((r) => r.start < r.end);

  const parts: SearchSnippetPart[] = [];
  if (start > 0) parts.push({ text: "…" });
  let pos = start;
  for (const h of clipped) {
    if (h.start > pos) parts.push({ text: text.slice(pos, h.start) });
    parts.push({ text: text.slice(h.start, h.end), highlight: true });
    pos = h.end;
  }
  if (pos < end) parts.push({ text: text.slice(pos, end) });
  if (end < text.length) parts.push({ text: "…" });
  return parts.filter((part) => part.text.length > 0);
}

/** TipTap→Markdown 对部分样式输出内联 HTML；检索摘要改为纯文本避免侧栏出现标签碎片 */
export function stripMarkupForSearchPreview(raw: string, maxLen: number): string {
  const noTags = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return noTags.length <= maxLen ? noTags : `${noTags.slice(0, maxLen)}…`;
}

