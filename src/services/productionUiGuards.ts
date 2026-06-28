import { shouldOfferTextContextMenu } from "./textContextMenu";

/** Vite 开发服务器 */
export function isDeveloperBuild(): boolean {
  return import.meta.env.DEV;
}

/** 发版模式下拦截打开 DevTools 的快捷键 */
export function shouldBlockDevToolsShortcut(event: KeyboardEvent): boolean {
  if (isDeveloperBuild()) return false;

  const key = event.key;
  if (key === "F12") return true;

  const lower = key.length === 1 ? key.toLowerCase() : key;

  if ((event.ctrlKey || event.metaKey) && event.shiftKey && (lower === "i" || lower === "j" || lower === "c")) {
    return true;
  }

  if (event.metaKey && event.altKey && (lower === "i" || lower === "j" || lower === "c")) {
    return true;
  }

  if ((event.ctrlKey || event.metaKey) && lower === "u") {
    return true;
  }

  return false;
}

/** 发版模式：是否拦截 WebView 默认右键菜单（含「检查」等） */
export function shouldBlockContextMenu(event: MouseEvent): boolean {
  if (isDeveloperBuild()) return false;

  const target = event.target;
  if (!target || typeof (target as Element).closest !== "function") return true;
  const el = target as Element;

  // 文本区域由 TextContextMenu 处理，仍拦截原生菜单以防「检查元素」
  if (shouldOfferTextContextMenu(el as HTMLElement)) return true;

  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (sel && !sel.isCollapsed && sel.toString().length > 0) return false;

  const field = el.closest("textarea, input:not([type=checkbox]):not([type=radio]), select") as
    | HTMLTextAreaElement
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  if (field && !field.disabled) {
    if (field instanceof HTMLSelectElement) return false;
    if (!field.readOnly) return false;
  }

  return true;
}

export function installProductionUiGuards() {
  if (isDeveloperBuild()) return;

  window.addEventListener(
    "keydown",
    (event) => {
      if (shouldBlockDevToolsShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );

  window.addEventListener(
    "contextmenu",
    (event) => {
      if (shouldBlockContextMenu(event)) {
        event.preventDefault();
      }
    },
    true
  );
}
