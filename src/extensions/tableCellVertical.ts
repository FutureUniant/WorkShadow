import { mergeAttributes } from "@tiptap/core";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

function parseAlign(element: HTMLElement) {
  const styleAlign = (element.style.textAlign || "").trim().toLowerCase();
  const attrAlign = (element.getAttribute("align") || "").trim().toLowerCase();
  const align = styleAlign || attrAlign;
  if (align === "left" || align === "right" || align === "center") return align;
  return null;
}

function parseVerticalAlign(element: HTMLElement) {
  const v = (element.style.verticalAlign || "").trim().toLowerCase();
  if (v === "top" || v === "middle" || v === "bottom") return v;
  return null;
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function parseBackgroundColor(element: HTMLElement) {
  const raw = (element.style.backgroundColor || element.getAttribute("bgcolor") || "").trim();
  if (!raw) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  const rgb = raw.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const rgba = raw.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/i);
  if (rgba) return rgbToHex(Number(rgba[1]), Number(rgba[2]), Number(rgba[3]));
  return null;
}

/** 单元格样式统一写入 DOM，避免多个 attribute 的 style 在序列化/复制时互相覆盖 */
function buildCellPresentation(attrs: Record<string, unknown>) {
  const styleParts: string[] = [];
  const align = attrs.align as string | null | undefined;
  if (align) styleParts.push(`text-align: ${align}`);
  const valign = attrs.verticalAlign as string | null | undefined;
  if (valign) styleParts.push(`vertical-align: ${valign}`);
  const bg = attrs.backgroundColor as string | null | undefined;
  if (bg) styleParts.push(`background-color: ${bg}`);

  const result: Record<string, string> = {};
  if (styleParts.length) result.style = styleParts.join("; ");
  if (bg) result.bgcolor = bg;
  return result;
}

const verticalAlignAttr = {
  default: null as string | null,
  parseHTML: parseVerticalAlign,
  renderHTML: () => ({})
};

const backgroundColorAttr = {
  default: null as string | null,
  parseHTML: parseBackgroundColor,
  renderHTML: () => ({})
};

const alignAttr = {
  default: null as string | null,
  parseHTML: parseAlign,
  renderHTML: () => ({})
};

function extendTableCellNode(
  Base: typeof TableCell | typeof TableHeader,
  tag: "td" | "th"
) {
  return Base.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        align: alignAttr,
        verticalAlign: verticalAlignAttr,
        backgroundColor: backgroundColorAttr
      };
    },
    renderHTML({ HTMLAttributes, node }) {
      const presentation = buildCellPresentation(node.attrs);
      const { style: _style, bgcolor: _bgcolor, ...rest } = HTMLAttributes as Record<string, string>;
      return [tag, mergeAttributes(this.options.HTMLAttributes, rest, presentation), 0];
    }
  });
}

export const TableCellVertical = extendTableCellNode(TableCell, "td");
export const TableHeaderVertical = extendTableCellNode(TableHeader, "th");
