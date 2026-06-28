import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  findEditableTarget,
  getTextEditMenuState,
  runTextEditCommand,
  shouldOfferTextContextMenu,
  type TextEditCommand
} from "../services/textContextMenu";

const MENU_WIDTH = 168;
const MENU_ESTIMATED_HEIGHT = 188;
const VIEWPORT_PAD = 8;

interface MenuState {
  x: number;
  y: number;
  target: HTMLElement;
  editable: HTMLElement | null;
}

function clampMenuPosition(x: number, y: number, menuHeight: number) {
  let left = x;
  let top = y;
  if (left + MENU_WIDTH > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, window.innerWidth - MENU_WIDTH - VIEWPORT_PAD);
  }
  if (top + menuHeight > window.innerHeight - VIEWPORT_PAD) {
    top = Math.max(VIEWPORT_PAD, y - menuHeight);
  }
  return { left, top };
}

export function TextContextMenu() {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const close = useCallback(() => {
    setMenu(null);
    setPosition(null);
  }, []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !shouldOfferTextContextMenu(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const editable = findEditableTarget(target);
      setMenu({ x: event.clientX, y: event.clientY, target, editable });
    };

    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const el = event.target as HTMLElement | null;
      if (el?.closest(".text-context-menu")) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onScroll = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu, close]);

  useLayoutEffect(() => {
    if (!menu) return;
    const update = () => {
      const height = menuRef.current?.offsetHeight ?? MENU_ESTIMATED_HEIGHT;
      setPosition(clampMenuPosition(menu.x, menu.y, height));
    };
    update();
    const raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [menu]);

  if (!menu) return null;

  const menuState = getTextEditMenuState(menu.editable, menu.target);
  const coords = position ?? clampMenuPosition(menu.x, menu.y, MENU_ESTIMATED_HEIGHT);

  const items: { command: TextEditCommand; label: string; disabled: boolean }[] = [
    { command: "copy", label: t("contextMenuCopy"), disabled: !menuState.canCopy },
    { command: "copyPlainText", label: t("contextMenuCopyPlainText"), disabled: !menuState.canCopyPlainText },
    { command: "cut", label: t("contextMenuCut"), disabled: !menuState.canCut },
    { command: "paste", label: t("contextMenuPaste"), disabled: !menuState.canPaste },
    { command: "selectAll", label: t("contextMenuSelectAll"), disabled: !menuState.canSelectAll }
  ];

  return createPortal(
    <div
      ref={menuRef}
      className="menu-popover menu-popover--portal text-context-menu"
      role="menu"
      style={{ left: coords.left, top: coords.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.command}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            void runTextEditCommand(item.command, menu.editable, menu.target);
            close();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
