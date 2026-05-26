import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

const verticalAlignAttr = {
  default: null as string | null,
  parseHTML: (element: HTMLElement) => {
    const v = (element.style.verticalAlign || "").trim().toLowerCase();
    if (v === "top" || v === "middle" || v === "bottom") return v;
    return null;
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const v = attributes.verticalAlign as string | null | undefined;
    if (!v) return {};
    return { style: `vertical-align: ${v}` };
  }
};

const backgroundColorAttr = {
  default: null as string | null,
  parseHTML: (element: HTMLElement) => {
    const bg = (element.style.backgroundColor || "").trim();
    return bg || null;
  },
  renderHTML: (attributes: Record<string, unknown>) => {
    const bg = attributes.backgroundColor as string | null | undefined;
    if (!bg) return {};
    return { style: `background-color: ${bg}` };
  }
};

export const TableCellVertical = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      verticalAlign: verticalAlignAttr,
      backgroundColor: backgroundColorAttr
    };
  }
});

export const TableHeaderVertical = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      verticalAlign: verticalAlignAttr,
      backgroundColor: backgroundColorAttr
    };
  }
});
