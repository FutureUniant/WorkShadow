import { v4 as uuid } from "uuid";
import { emptyDoc } from "../defaults";
import { tiptapToMarkdown } from "./markdown";
import type { LogNode, NodeKind } from "../types";

export function createNode(parentId: string | null, kind: NodeKind, title?: string): LogNode {
  const now = new Date().toISOString();
  const resolvedTitle = title ?? (kind === "folder" ? "新分组" : "新日志");
  return {
    id: uuid(),
    parentId,
    title: resolvedTitle,
    kind,
    createdAt: now,
    updatedAt: now,
    tiptapJson: emptyDoc,
    markdown: tiptapToMarkdown(emptyDoc)
  };
}

export function getChildren(nodes: LogNode[], parentId: string | null) {
  return nodes.filter((node) => node.parentId === parentId);
}

/** 在侧栏「新建日志」等场景：与当前选中节点同级（同 parentId） */
export function parentIdForNewSibling(nodes: LogNode[], activeId: string | null): string | null {
  if (!activeId) return null;
  return nodes.find((n) => n.id === activeId)?.parentId ?? null;
}

/** 全局「新建子日志」等场景：作为当前选中节点的子节点 */
export function parentIdForNewChild(nodes: LogNode[], activeId: string | null): string | null {
  if (!activeId) return null;
  return nodes.find((n) => n.id === activeId)?.id ?? null;
}

/** 按最后更新时间降序（无效时间视为最早） */
export function compareByUpdatedAtDesc(a: LogNode, b: LogNode): number {
  const ta = Date.parse(a.updatedAt);
  const tb = Date.parse(b.updatedAt);
  const na = Number.isFinite(ta) ? ta : 0;
  const nb = Number.isFinite(tb) ? tb : 0;
  if (nb !== na) return nb - na;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/** 按创建时间升序（无效时间视为最晚；同时间按标题）— 侧栏树同级固定顺序 */
export function compareByCreatedAtAsc(a: LogNode, b: LogNode): number {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  const na = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
  const nb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/** 侧栏树：同级按创建时间从早到晚 */
export function getChildrenSorted(nodes: LogNode[], parentId: string | null): LogNode[] {
  return getChildren(nodes, parentId).sort(compareByCreatedAtAsc);
}

/** 全部日志节点，按最后更新时间由近及远 */
export function listLogNodesByUpdatedDesc(nodes: LogNode[]): LogNode[] {
  return nodes.filter((n) => n.kind === "log").sort(compareByUpdatedAtDesc);
}

/** 全部 kind=log 的节点 id */
export function listAllLogIds(nodes: LogNode[]): string[] {
  return nodes.filter((n) => n.kind === "log").map((n) => n.id);
}

/** 收集某节点子树中所有 kind=log 的节点 id（含自身若为 log） */
export function collectDescendantLogIds(nodes: LogNode[], nodeId: string): string[] {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const ids: string[] = node.kind === "log" ? [node.id] : [];
  for (const child of getChildren(nodes, node.id)) {
    ids.push(...collectDescendantLogIds(nodes, child.id));
  }
  return ids;
}

/** 侧栏等 UI：有子节点时用文件夹图标；节点本身仍是日志，可写总述 */
export function nodeHasChildLogs(nodes: LogNode[], nodeId: string): boolean {
  return getChildren(nodes, nodeId).length > 0;
}

export function getDescendantIds(nodes: LogNode[], id: string): string[] {
  const children = nodes.filter((node) => node.parentId === id);
  return children.flatMap((child) => [child.id, ...getDescendantIds(nodes, child.id)]);
}

export function getNodePath(nodes: LogNode[], nodeId: string): LogNode[] {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return [];
  return [...(node.parentId ? getNodePath(nodes, node.parentId) : []), node];
}

export function getPathTitle(nodes: LogNode[], nodeId: string) {
  return getNodePath(nodes, nodeId)
    .map((node) => node.title)
    .join("/");
}

export function wouldCreateCycle(nodes: LogNode[], nodeId: string, newParentId: string | null) {
  if (!newParentId) return false;
  return nodeId === newParentId || getDescendantIds(nodes, nodeId).includes(newParentId);
}

/** 父节点 id 已不存在时挂到根，避免侧栏「丢节点」但编辑器仍引用孤儿 */
export function repairOrphanParentIds(nodes: LogNode[]): LogNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes.map((n) => {
    if (n.parentId != null && !ids.has(n.parentId)) {
      return { ...n, parentId: null };
    }
    return n;
  });
}

/**
 * 批量勾选时若同时选中了祖先与后代，只保留「最上层」被选中的节点（移动/删除子树一次即可）。
 */
export function normalizeSelectionToRoots(nodes: LogNode[], ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let p: string | null | undefined = nodes.find((n) => n.id === id)?.parentId;
    while (p) {
      if (set.has(p)) return false;
      p = nodes.find((n) => n.id === p)?.parentId ?? null;
    }
    return true;
  });
}

export function duplicateNode(nodes: LogNode[], id: string, parentId?: string | null): LogNode | null {
  const source = nodes.find((node) => node.id === id);
  if (!source) return null;
  const now = new Date().toISOString();
  return {
    ...source,
    id: uuid(),
    parentId: parentId === undefined ? source.parentId : parentId,
    title: `${source.title} 副本`,
    createdAt: now,
    updatedAt: now
  };
}
