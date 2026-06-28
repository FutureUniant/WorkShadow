import { describe, expect, it } from "vitest";
import {
  compareByUpdatedAtDesc,
  createNode,
  compareByCreatedAtAsc,
  compareBySiblingOrder,
  collectLogIdsInSubtree,
  getChildrenSorted,
  listLogNodesByUpdatedDesc,
  parentIdForNewChild,
  parentIdForNewSibling,
  nodeHasChildLogs,
  normalizeSelectionToRoots,
  reorderNodeBefore,
  repairOrphanParentIds
} from "./tree";
import type { LogNode } from "../types";

describe("createNode", () => {
  it("creates a log under parent", () => {
    const n = createNode("p1", "log");
    expect(n.kind).toBe("log");
    expect(n.parentId).toBe("p1");
  });
});

describe("nodeHasChildLogs", () => {
  const nodes: LogNode[] = [
    { id: "a", parentId: null, title: "A", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "b", parentId: "a", title: "B", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" }
  ];

  it("is true when node has children", () => {
    expect(nodeHasChildLogs(nodes, "a")).toBe(true);
    expect(nodeHasChildLogs(nodes, "b")).toBe(false);
  });
});

describe("collectLogIdsInSubtree", () => {
  const nodes: LogNode[] = [
    { id: "a", parentId: null, title: "A", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "b", parentId: "a", title: "B", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "f", parentId: null, title: "F", kind: "folder", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "c", parentId: "f", title: "C", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" }
  ];

  it("includes self and descendant logs", () => {
    expect(collectLogIdsInSubtree(nodes, "a")).toEqual(["a", "b"]);
  });

  it("collects logs under folders", () => {
    expect(collectLogIdsInSubtree(nodes, "f")).toEqual(["c"]);
  });
});

describe("normalizeSelectionToRoots", () => {
  const nodes: LogNode[] = [
    { id: "a", parentId: null, title: "A", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "b", parentId: "a", title: "B", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "c", parentId: "b", title: "C", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" }
  ];

  it("drops descendants when ancestor is selected", () => {
    expect(normalizeSelectionToRoots(nodes, ["a", "b"])).toEqual(["a"]);
  });
});

describe("repairOrphanParentIds", () => {
  it("reattaches to root when parent missing", () => {
    const nodes: LogNode[] = [
      { id: "x", parentId: "missing", title: "X", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" }
    ];
    const fixed = repairOrphanParentIds(nodes);
    expect(fixed[0].parentId).toBeNull();
  });
});

describe("sort by updatedAt", () => {
  const nodes: LogNode[] = [
    { id: "old", parentId: null, title: "Old", kind: "log", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", tiptapJson: {}, markdown: "" },
    { id: "new", parentId: null, title: "New", kind: "log", createdAt: "2026-05-19T12:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", tiptapJson: {}, markdown: "" }
  ];

  it("listLogNodesByUpdatedDesc orders by updatedAt not createdAt", () => {
    expect(listLogNodesByUpdatedDesc(nodes).map((n) => n.id)).toEqual(["old", "new"]);
  });
});

describe("new log parent resolution", () => {
  const nodes: LogNode[] = [
    { id: "root", parentId: null, title: "R", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "child", parentId: "root", title: "C", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" }
  ];

  it("parentIdForNewSibling uses active node's parent", () => {
    expect(parentIdForNewSibling(nodes, "child")).toBe("root");
    expect(parentIdForNewSibling(nodes, "root")).toBeNull();
    expect(parentIdForNewSibling(nodes, null)).toBeNull();
  });

  it("parentIdForNewChild uses active node as parent", () => {
    expect(parentIdForNewChild(nodes, "child")).toBe("child");
    expect(parentIdForNewChild(nodes, "root")).toBe("root");
  });
});

describe("tree sibling order by createdAt", () => {
  const nodes: LogNode[] = [
    { id: "b", parentId: null, title: "B", kind: "log", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", tiptapJson: {}, markdown: "" },
    { id: "a", parentId: null, title: "A", kind: "log", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", tiptapJson: {}, markdown: "" },
    { id: "c", parentId: null, title: "C", kind: "folder", createdAt: "2022-06-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", tiptapJson: {}, markdown: "" }
  ];

  it("getChildrenSorted orders siblings by createdAt ascending", () => {
    expect(getChildrenSorted(nodes, null).map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("compareByCreatedAtAsc sorts ascending", () => {
    expect(compareByCreatedAtAsc(nodes[1], nodes[0])).toBeLessThan(0);
  });
});

describe("manual sibling order", () => {
  const nodes: LogNode[] = [
    { id: "a", parentId: null, title: "A", kind: "log", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "b", parentId: null, title: "B", kind: "log", createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "c", parentId: null, title: "C", kind: "log", createdAt: "2022-01-01T00:00:00.000Z", updatedAt: "", tiptapJson: {}, markdown: "", sortOrder: 0 }
  ];

  it("compareBySiblingOrder prefers sortOrder", () => {
    expect(compareBySiblingOrder(nodes[2], nodes[0])).toBeLessThan(0);
  });

  it("reorderNodeBefore moves node ahead of target", () => {
    const next = reorderNodeBefore(nodes, "b", "a");
    expect(getChildrenSorted(next, null).map((n) => n.id)).toEqual(["c", "b", "a"]);
  });

  it("reorderNodeBefore ignores different parents", () => {
    const withChild: LogNode[] = [
      ...nodes,
      { id: "x", parentId: "a", title: "X", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" }
    ];
    expect(reorderNodeBefore(withChild, "b", "x")).toBe(withChild);
  });
});
