import { mergeAttributes } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";

/** 高亮底色统一写入 mark 的 style，复制到 Word/Excel 时更可靠 */
export const HighlightColor = Highlight.extend({
  addOptions() {
    return {
      multicolor: true,
      HTMLAttributes: {}
    };
  },
  addAttributes() {
    return {
      color: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-color") || element.style.backgroundColor || null,
        renderHTML: () => ({})
      }
    };
  },
  renderHTML({ HTMLAttributes, mark }) {
    const color = mark.attrs.color as string | null | undefined;
    const { style: _style, ...rest } = HTMLAttributes as Record<string, string>;
    const attrs: Record<string, string> = { ...rest };
    if (color) {
      attrs["data-color"] = color;
      attrs.style = `background-color: ${color}`;
    }
    return ["mark", mergeAttributes(this.options.HTMLAttributes, attrs), 0];
  }
});
