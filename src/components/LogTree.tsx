import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, FileText, Folder, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LogNode, ShortcutBinding } from "../types";
import { getChildrenSorted } from "../services/tree";
import { matchesShortcut } from "../services/shortcuts";
import { HoverTip } from "./HoverTip";

const MENU_MIN_WIDTH = 160;
const MENU_EDGE_PADDING = 8;
const MENU_TRIGGER_GAP = 4;

interface Props {
  nodes: LogNode[];
  activeId: string | null;
  expandedIds: string[];
  treeMenuCloseBinding: ShortcutBinding;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onOpenInWindow?: (node: LogNode) => void;
  onAction: (action: "child" | "sibling" | "rename" | "move" | "duplicate" | "delete", node: LogNode) => void;
}

export function LogTree({ nodes, activeId, expandedIds, treeMenuCloseBinding, onSelect, onToggle, onOpenInWindow, onAction }: Props) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const closeMenu = useCallback(() => setMenuOpenId(null), []);

  useEffect(() => {
    if (menuOpenId == null) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("[data-tree-menu-anchor]");
      const anchorId = anchor?.getAttribute("data-tree-menu-anchor");
      const popover = target.closest("[data-tree-menu-popover]");
      const popoverId = popover?.getAttribute("data-tree-menu-popover");
      if (anchorId !== menuOpenId && popoverId !== menuOpenId) closeMenu();
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
          nodes={nodes}
          node={node}
          depth={depth}
          active={activeId === node.id}
          hasChildren={children.length > 0}
          expanded={expanded}
          menuOpen={menuOpenId === node.id}
          onMenuToggle={() => setMenuOpenId((current) => (current === node.id ? null : node.id))}
          onSelect={onSelect}
          onToggle={onToggle}
          onOpenInWindow={onOpenInWindow}
          onAction={handleAction}
        >
          {expanded ? renderLevel(node.id, depth + 1) : null}
        </TreeNode>
      );
    });
  }
}

interface TreeNodeProps extends Omit<Props, "activeId" | "expandedIds" | "onAction" | "treeMenuCloseBinding"> {
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
  nodes,
  node,
  depth,
  active,
  hasChildren,
  expanded,
  menuOpen,
  onMenuToggle,
  onSelect,
  onToggle,
  onOpenInWindow,
  onAction,
  children
}: TreeNodeProps) {
  const { t } = useTranslation();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  const dragStartedRef = useRef(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [dropTarget, setDropTarget] = useState(false);

  const updateMenuPosition = useCallback(() => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuPopoverRef.current?.offsetHeight ?? 260;
    const maxLeft = window.innerWidth - MENU_MIN_WIDTH - MENU_EDGE_PADDING;
    const left = Math.max(MENU_EDGE_PADDING, Math.min(rect.right - MENU_MIN_WIDTH, maxLeft));
    const bottomTop = rect.bottom + MENU_TRIGGER_GAP;
    const top =
      bottomTop + menuHeight <= window.innerHeight - MENU_EDGE_PADDING
        ? bottomTop
        : Math.max(MENU_EDGE_PADDING, rect.top - MENU_TRIGGER_GAP - menuHeight);
    setMenuPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [menuOpen, updateMenuPosition]);

  return (
    <div>
      <div
        className={`tree-row ${active ? "active" : ""} ${dropTarget ? "tree-row--drop-target" : ""}`}
        style={{ paddingLeft: 8 + depth * 18 }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDropTarget(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropTarget(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropTarget(false);
          const draggedId = event.dataTransfer.getData("text/plain");
          if (!draggedId || draggedId === node.id) return;
          const dragged = nodes.find((item) => item.id === draggedId);
          if (dragged && dragged.parentId === node.parentId) {
            window.dispatchEvent(
              new CustomEvent("workshadow:reorder-node", { detail: { movingId: draggedId, targetId: node.id } })
            );
            return;
          }
          window.dispatchEvent(new CustomEvent("workshadow:move-node", { detail: { nodeId: draggedId, parentId: node.id } }));
        }}
      >
        <button
          type="button"
          className="icon-button"
          draggable={false}
          onClick={() => onToggle(node.id)}
          aria-label="toggle"
        >
          {hasChildren ? expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <span className="spacer" />}
        </button>
        <button
          type="button"
          className="tree-label"
          draggable
          onDragStart={(event) => {
            dragStartedRef.current = true;
            event.dataTransfer.setData("text/plain", node.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            window.setTimeout(() => {
              dragStartedRef.current = false;
            }, 0);
          }}
          onClick={() => {
            if (dragStartedRef.current) return;
            onSelect(node.id);
          }}
          onDoubleClick={() => {
            if (node.kind === "log") onOpenInWindow?.(node);
          }}
        >
          {hasChildren ? <Folder size={16} /> : <FileText size={16} />}
          <HoverTip label={node.title} className="tree-label-text">
            {node.title}
          </HoverTip>
        </button>
        <div className="tree-menu-anchor" data-tree-menu-anchor={node.id}>
          <button
            ref={menuTriggerRef}
            type="button"
            className="icon-button tree-menu-trigger"
            draggable={false}
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
          {menuOpen
            ? createPortal(
                <div
                  ref={menuPopoverRef}
                  className="menu-popover menu-popover--portal"
                  data-tree-menu-popover={node.id}
                  role="menu"
                  style={{
                    top: menuPos?.top ?? -9999,
                    left: menuPos?.left ?? -9999,
                    visibility: menuPos ? "visible" : "hidden"
                  }}
                >
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
                </div>,
                document.body
              )
            : null}
        </div>
      </div>
      {children}
    </div>
  );
}
