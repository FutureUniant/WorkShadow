import { describe, expect, it } from "vitest";
import {
  compareByUpdatedAtDesc,
  createNode,
  compareByCreatedAtAsc,
  collectDescendantLogIds,
  getChildrenSorted,
  listAllLogIds,
  listLogNodesByUpdatedDesc,
  parentIdForNewChild,
  parentIdForNewSibling,
  nodeHasChildLogs,
  normalizeSelectionToRoots,
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

describe("collectDescendantLogIds", () => {
  const nodes: LogNode[] = [
    { id: "folder", parentId: null, title: "F", kind: "folder", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "parent", parentId: null, title: "P", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "child", parentId: "parent", title: "C", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" },
    { id: "leaf", parentId: "folder", title: "L", kind: "log", createdAt: "", updatedAt: "", tiptapJson: {}, markdown: "" }
  ];

  it("includes self and descendant logs for a branch log", () => {
    expect(collectDescendantLogIds(nodes, "parent")).toEqual(["parent", "child"]);
  });

  it("collects only logs under a folder", () => {
    expect(collectDescendantLogIds(nodes, "folder")).toEqual(["leaf"]);
  });

  it("listAllLogIds returns every log node", () => {
    expect(listAllLogIds(nodes).sort()).toEqual(["child", "leaf", "parent"]);
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
