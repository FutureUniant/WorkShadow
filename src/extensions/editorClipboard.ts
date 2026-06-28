import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

const DEFAULT_HIGHLIGHT_BG = "#fef08a";

/** 从元素解析文字/单元格底纹颜色 */
export function parseElementBackgroundColor(element: HTMLElement): string | null {
  const styleAttr = element.getAttribute("style") ?? "";
  const styleMatch = /background(?:-color)?:\s*([^;]+)/i.exec(styleAttr);
  if (styleMatch) {
    const value = styleMatch[1].trim();
    if (value && value !== "transparent") return value;
  }
  const dataColor = element.getAttribute("data-color")?.trim();
  if (dataColor) return dataColor;
  const inlineBg = element.style.backgroundColor?.trim();
  if (inlineBg && inlineBg !== "transparent") return inlineBg;
  return null;
}

/** 表格单元格底纹：style + bgcolor，兼容 Word/Excel */
export function enrichTableCellBackgrounds(root: HTMLElement) {
  root.querySelectorAll("td, th").forEach((cell) => {
    const el = cell as HTMLElement;
    const bg = parseElementBackgroundColor(el);
    if (!bg) return;
    el.style.backgroundColor = bg;
    if (!el.getAttribute("bgcolor")) {
      el.setAttribute("bgcolor", bg);
    }
  });
}

/**
 * 文字高亮底纹：Office 对 <mark> 支持差，复制时转为带 background-color 的 <span>。
 */
export function enrichTextHighlightBackgrounds(root: HTMLElement) {
  root.querySelectorAll("mark").forEach((node) => {
    const mark = node as HTMLElement;
    const bg = parseElementBackgroundColor(mark) ?? DEFAULT_HIGHLIGHT_BG;

    const span = document.createElement("span");
    span.setAttribute("style", `background-color: ${bg}`);
    while (mark.firstChild) {
      span.appendChild(mark.firstChild);
    }
    mark.replaceWith(span);
  });

  root.querySelectorAll("span[style]").forEach((node) => {
    const span = node as HTMLElement;
    const bg = parseElementBackgroundColor(span);
    if (!bg) return;
    span.style.backgroundColor = bg;
  });
}

export function enrichClipboardHtml(root: HTMLElement) {
  enrichTableCellBackgrounds(root);
  enrichTextHighlightBackgrounds(root);
}

export const EditorClipboard = Extension.create({
  name: "editorClipboard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            copy: (view, event) => {
              const { state } = view;
              if (state.selection.empty || !event.clipboardData) return false;

              const slice = state.selection.content();
              const { dom, text } = view.serializeForClipboard(slice);
              enrichClipboardHtml(dom);

              event.preventDefault();
              event.clipboardData.setData("text/html", dom.innerHTML);
              event.clipboardData.setData("text/plain", text);
              return true;
            }
          }
        }
      })
    ];
  }
});
