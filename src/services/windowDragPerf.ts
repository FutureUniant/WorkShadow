import { isTauriRuntime } from "./storage";

const DRAGGING_CLASS = "window-dragging";

/** 拖动自定义标题栏时暂时降低 WebView 绘制开销，减轻卡顿 */
export function installWindowDragPerf() {
  if (typeof document === "undefined" || !isTauriRuntime()) return;

  let dragging = false;

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove(DRAGGING_CLASS);
  };

  document.addEventListener(
    "mousedown",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-tauri-drag-region]")) return;
      dragging = true;
      document.body.classList.add(DRAGGING_CLASS);
    },
    true
  );

  window.addEventListener("mouseup", endDrag, true);
  window.addEventListener("blur", endDrag);
}
