import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";

export const ImageCaption = Image.extend({
  name: "image",
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: ""
      },
      width: {
        default: null as string | null,
        parseHTML: (el) => (el instanceof HTMLElement ? el.getAttribute("data-width") : null),
        renderHTML: (attrs) => {
          const w = attrs.width as string | null | undefined;
          if (!w) return {};
          return { "data-width": w };
        }
      }
    };
  },
  addNodeView() {
    return ({ node: initialNode, editor, getPos }) => {
      const wrap = document.createElement("div");
      wrap.className = "ws-media-wrap ws-media-wrap--image";
      wrap.setAttribute("data-ws-lightbox", "1");

      const inner = document.createElement("div");
      inner.className = "ws-media-image-inner";

      const img = document.createElement("img");
      img.draggable = false;
      img.alt = "";

      const handle = document.createElement("div");
      handle.className = "ws-media-resize-handle";
      handle.contentEditable = "false";

      const caption = document.createElement("div");
      caption.className = "ws-media-caption";

      inner.appendChild(img);
      inner.appendChild(handle);
      wrap.appendChild(inner);
      wrap.appendChild(caption);

      let activeMove: ((e: MouseEvent) => void) | null = null;
      let activeUp: (() => void) | null = null;

      function sync(n: typeof initialNode) {
        img.src = String(n.attrs.src ?? "");
        img.style.display = "block";
        img.style.width = "100%";
        img.style.height = "auto";
        img.style.maxWidth = "100%";
        img.style.boxSizing = "border-box";
        inner.style.display = "block";
        inner.style.width = "100%";
        inner.style.boxSizing = "border-box";
        const cap = String(n.attrs.caption ?? "").trim();
        caption.textContent = cap;
        caption.style.display = cap ? "block" : "none";
        const w = n.attrs.width as string | null | undefined;
        wrap.style.maxWidth = "100%";
        wrap.style.width = w ?? "";
      }

      sync(initialNode);

      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos !== undefined) {
          editor.chain().focus().setNodeSelection(pos).run();
        }

        const prose =
          (editor.view.dom as HTMLElement).closest(".rich-editor")?.querySelector(".ProseMirror") ??
          (editor.view.dom as HTMLElement);
        const proseMax = prose.getBoundingClientRect().width || 480;
        const dragStartX = e.clientX;
        const dragStartW = wrap.getBoundingClientRect().width;

        const moveHandler = (me: MouseEvent) => {
          const delta = me.clientX - dragStartX;
          const next = Math.min(proseMax, Math.max(80, dragStartW + delta));
          wrap.style.width = `${next}px`;
          inner.style.width = "100%";
        };

        const upHandler = () => {
          document.removeEventListener("mousemove", moveHandler);
          document.removeEventListener("mouseup", upHandler);
          activeMove = null;
          activeUp = null;

          const p = typeof getPos === "function" ? getPos() : undefined;
          if (p === undefined) return;

          const wPx = Math.min(wrap.getBoundingClientRect().width, proseMax);
          const pct = Math.min(100, Math.max(12, (wPx / proseMax) * 100));
          const rounded = Math.round(pct * 10) / 10;

          const cur = editor.state.doc.nodeAt(p);
          if (!cur || cur.type.name !== "image") return;

          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(p, undefined, {
              ...cur.attrs,
              width: `${rounded}%`
            })
          );
        };

        activeMove = moveHandler;
        activeUp = upHandler;
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
      });

      return {
        dom: wrap,
        update: (updated) => {
          if (updated.type.name !== "image") return false;
          sync(updated);
          return true;
        },
        destroy: () => {
          if (activeMove) document.removeEventListener("mousemove", activeMove);
          if (activeUp) document.removeEventListener("mouseup", activeUp);
        }
      };
    };
  },
  parseHTML() {
    return [
      {
        tag: "div.ws-media-wrap--image",
        priority: 65,
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const imgEl = element.querySelector("img");
          const src = imgEl?.getAttribute("src");
          if (!src) return false;
          const cap = element.querySelector(".ws-media-caption");
          const w = element.getAttribute("data-width");
          return { src, caption: cap?.textContent?.trim() ?? "", width: w || null };
        }
      },
      { tag: "img[src]" }
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const cap = String(node.attrs.caption ?? "").trim();
    const width = node.attrs.width as string | null | undefined;
    const wrapStyle = width ? `max-width:100%;width:${width}` : "max-width:100%";
    const img = [
      "img",
      mergeAttributes(HTMLAttributes, {
        alt: "",
        draggable: false,
        style: "display:block;width:100%;height:auto;border-radius:12px;vertical-align:bottom;"
      })
    ];
    return [
      "div",
      {
        class: "ws-media-wrap ws-media-wrap--image",
        "data-ws-lightbox": "1",
        style: wrapStyle
      },
      ["div", { class: "ws-media-image-inner" }, img],
      ...(cap ? [["div", { class: "ws-media-caption" }, cap]] as const : [])
    ];
  }
});
