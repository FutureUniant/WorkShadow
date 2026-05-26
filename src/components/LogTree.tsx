import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LogNode, ShortcutBinding } from "../types";
import { getChildrenSorted } from "../services/tree";
import { matchesShortcut } from "../services/shortcuts";

interface Props {
  nodes: LogNode[];
  activeId: string | null;
  expandedIds: string[];
  treeMenuCloseBinding: ShortcutBinding;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onAction: (action: "child" | "sibling" | "rename" | "move" | "duplicate" | "delete", node: LogNode) => void;
}

export function LogTree({ nodes, activeId, expandedIds, treeMenuCloseBinding, onSelect, onToggle, onAction }: Props) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const closeMenu = useCallback(() => setMenuOpenId(null), []);

  useEffect(() => {
    if (menuOpenId == null) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("[data-tree-menu-anchor]");
      const anchorId = anchor?.getAttribute("data-tree-menu-anchor");
      if (anchorId !== menuOpenId) closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuOpenId, closeMenu]);

  useEffect(() => {
    if (menuOpenId == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (matchesShortcut(event, treeMenuCloseBinding)) closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpenId, closeMenu, treeMenuCloseBinding]);

  const handleAction = useCallback(
    (action: Parameters<Props["onAction"]>[0], node: LogNode) => {
      closeMenu();
      onAction(action, node);
    },
    [closeMenu, onAction]
  );

  return <div className="tree">{renderLevel(null, 0)}</div>;

  function renderLevel(parentId: string | null, depth: number) {
    return getChildrenSorted(nodes, parentId).map((node) => {
      const children = getChildrenSorted(nodes, node.id);
      const expanded = expandedIds.includes(node.id);
      return (
        <TreeNode
          key={node.id}
          node={node}
          depth={depth}
          active={activeId === node.id}
          hasChildren={children.length > 0}
          expanded={expanded}
          menuOpen={menuOpenId === node.id}
          onMenuToggle={() => setMenuOpenId((current) => (current === node.id ? null : node.id))}
          onSelect={onSelect}
          onToggle={onToggle}
          onAction={handleAction}
        >
          {expanded ? renderLevel(node.id, depth + 1) : null}
        </TreeNode>
      );
    });
  }
}

interface TreeNodeProps extends Omit<Props, "nodes" | "activeId" | "expandedIds" | "onAction" | "treeMenuCloseBinding"> {
  node: LogNode;
  depth: number;
  active: boolean;
  hasChildren: boolean;
  expanded: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onAction: Props["onAction"];
  children: React.ReactNode;
}

function TreeNode({
  node,
  depth,
  active,
  hasChildren,
  expanded,
  menuOpen,
  onMenuToggle,
  onSelect,
  onToggle,
  onAction,
  children
}: TreeNodeProps) {
  const { t } = useTranslation();
  return (
    <div>
      <div
        className={`tree-row ${active ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        draggable
        onDragStart={(event) => event.dataTransfer.setData("text/plain", node.id)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const draggedId = event.dataTransfer.getData("text/plain");
          if (draggedId && draggedId !== node.id) {
            window.dispatchEvent(new CustomEvent("workshadow:move-node", { detail: { nodeId: draggedId, parentId: node.id } }));
          }
        }}
      >
        <button type="button" className="icon-button" onClick={() => onToggle(node.id)} aria-label="toggle">
          {hasChildren ? expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <span className="spacer" />}
        </button>
        <button type="button" className="tree-label" onClick={() => onSelect(node.id)} title={node.title}>
          {hasChildren ? <Folder size={16} /> : <FileText size={16} />}
          <span title={node.title}>{node.title}</span>
        </button>
        <div className="tree-menu-anchor" data-tree-menu-anchor={node.id}>
          <button
            type="button"
            className="icon-button tree-menu-trigger"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="menu"
            onClick={(event) => {
              event.stopPropagation();
              onMenuToggle();
            }}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen ? (
            <div className="menu-popover" role="menu">
              <button type="button" role="menuitem" onClick={() => onAction("child", node)}>
                {t("newChild")}
              </button>
              <button type="button" role="menuitem" onClick={() => onAction("sibling", node)}>
                {t("newSibling")}
              </button>
              <button type="button" role="menuitem" onClick={() => onAction("rename", node)}>
                {t("rename")}
              </button>
              <button type="button" role="menuitem" onClick={() => onAction("move", node)}>
                {t("move")}
              </button>
              <button type="button" role="menuitem" onClick={() => onAction("duplicate", node)}>
                {t("duplicate")}
              </button>
              <button type="button" role="menuitem" className="danger-text" onClick={() => onAction("delete", node)}>
                {t("delete")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
