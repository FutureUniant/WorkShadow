type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function textWithMarks(node: TiptapNode): string {
  let value = node.text ?? "";
  const marks = [...(node.marks ?? [])];
  const textStyleMark = marks.find((m) => m.type === "textStyle");
  const linkMark = marks.find((m) => m.type === "link");
  const rest = marks.filter((m) => m.type !== "textStyle" && m.type !== "link");

  for (const mark of rest) {
    if (mark.type === "bold") value = `**${value}**`;
    if (mark.type === "italic") value = `*${value}*`;
    if (mark.type === "code") value = `\`${value}\``;
    if (mark.type === "strike") value = `~~${value}~~`;
    if (mark.type === "underline") value = `<u>${value}</u>`;
    if (mark.type === "highlight") {
      const color = mark.attrs?.color as string | undefined;
      value = color ? `<mark style="background-color:${color}">${value}</mark>` : `<mark>${value}</mark>`;
    }
    if (mark.type === "subscript") value = `<sub>${value}</sub>`;
    if (mark.type === "superscript") value = `<sup>${value}</sup>`;
  }

  if (textStyleMark?.attrs) {
    const attrs = textStyleMark.attrs;
    const styles: string[] = [];
    const color = attrs.color as string | undefined;
    const fontFamily = attrs.fontFamily as string | undefined;
    if (color) styles.push(`color:${String(color)}`);
    if (fontFamily) {
      const escaped = String(fontFamily).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      styles.push(`font-family:'${escaped}'`);
    }
    if (styles.length) value = `<span style="${styles.join(";")}">${value}</span>`;
  }

  if (linkMark?.attrs) {
    value = `[${value}](${String(linkMark.attrs.href ?? "")})`;
  }
  return value;
}

function renderInline(content?: TiptapNode[]) {
  return (content ?? []).map(renderNode).join("");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mediaAnnotation(attrs: Record<string, unknown> | undefined, fallback: string) {
  const annotation = String(attrs?.aiAnnotation ?? fallback);
  return ` <!-- AI注释: ${annotation} -->`;
}

export function tiptapToMarkdown(doc: unknown): string {
  const root = doc as TiptapNode;
  return (root.content ?? [])
    .map(renderNode)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function buildTableCellAttrString(attrs: Record<string, unknown> | undefined): string {
  const styleParts: string[] = [];
  const align = attrs?.align as string | undefined;
  if (align) styleParts.push(`text-align:${align}`);
  const valign = attrs?.verticalAlign as string | undefined;
  if (valign) styleParts.push(`vertical-align:${valign}`);
  const bg = attrs?.backgroundColor as string | undefined;
  if (bg) styleParts.push(`background-color:${bg}`);
  let result = "";
  if (styleParts.length) result += ` style="${escapeAttr(styleParts.join(";"))}"`;
  if (bg) result += ` bgcolor="${escapeAttr(bg)}"`;
  return result;
}

function renderTableAsHtml(node: TiptapNode): string {
  const rows = (node.content ?? [])
    .filter((row) => row.type === "tableRow")
    .map((row) => {
      const cells = (row.content ?? [])
        .map((cell) => {
          if (cell.type !== "tableCell" && cell.type !== "tableHeader") return "";
          const tag = cell.type === "tableHeader" ? "th" : "td";
          const attrs = buildTableCellAttrString(cell.attrs);
          const inner = renderExportInline(cell.content);
          return `<${tag}${attrs}>${inner}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<table>\n${rows}\n</table>`;
}

function renderExportInline(content?: TiptapNode[]) {
  return (content ?? []).map(renderExportNode).join("");
}

function renderExportNode(node: TiptapNode): string {
  switch (node.type) {
    case "text":
      return textWithMarks(node);
    case "paragraph": {
      const inner = renderExportInline(node.content);
      const align = String(node.attrs?.textAlign ?? "left");
      if (align && align !== "left" && inner) {
        return `<p style="text-align:${align}">${inner}</p>`;
      }
      return inner;
    }
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const hashes = "#".repeat(level);
      const inner = renderExportInline(node.content);
      const align = String(node.attrs?.textAlign ?? "left");
      if (align && align !== "left" && inner) {
        return `<div style="text-align:${align}">${hashes} ${inner}</div>`;
      }
      return `${hashes} ${inner}`;
    }
    case "bulletList":
      return (node.content ?? []).map((item) => `- ${renderExportInline(item.content)}`).join("\n");
    case "orderedList":
      return (node.content ?? []).map((item, index) => `${index + 1}. ${renderExportInline(item.content)}`).join("\n");
    case "taskList":
      return (node.content ?? [])
        .map((item) => {
          if (item.type !== "taskItem") return renderExportNode(item);
          const checked = Boolean(item.attrs?.checked);
          const box = checked ? "[x]" : "[ ]";
          return `- ${box} ${renderExportInline(item.content)}`;
        })
        .join("\n");
    case "taskItem":
      return renderExportInline(node.content);
    case "listItem":
      return renderExportInline(node.content);
    case "blockquote":
      return renderExportInline(node.content)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock":
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${renderExportInline(node.content)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "inlineMath": {
      const latex = String(node.attrs?.latex ?? "").trim();
      return latex ? `$${latex}$` : "";
    }
    case "blockMath": {
      const latex = String(node.attrs?.latex ?? "").trim();
      return latex ? `\n$$\n${latex}\n$$\n` : "";
    }
    case "image":
      return "";
    case "video": {
      const src = String(node.attrs?.src ?? "");
      const embedSrc = node.attrs?.embedSrc as string | null | undefined;
      const caption = String(node.attrs?.caption ?? "").trim();
      const width = node.attrs?.width as string | null | undefined;
      const wrapStyle = width ? `max-width:100%;width:${escapeAttr(width)}` : "max-width:100%";
      const cap = caption ? `<div class="ws-media-caption">${escapeHtml(caption)}</div>` : "";
      if (embedSrc) {
        const iframe = `<iframe data-workshadow-video="1" data-page-url="${escapeAttr(src)}" src="${escapeAttr(embedSrc)}" allowfullscreen="true" frameborder="0" style="width:100%;max-width:none;aspect-ratio:16/9;height:auto;border:0;border-radius:12px;background:#000;display:block;box-sizing:border-box;"></iframe>`;
        const inner = `<div class="ws-media-video-inner">${iframe}</div>`;
        return `<div class="ws-media-wrap ws-media-wrap--video" data-ws-lightbox="1" style="${wrapStyle}">${inner}${cap}</div>${mediaAnnotation(node.attrs, "嵌入网页视频")}`;
      }
      const video = `<video src="${escapeAttr(src)}" controls playsinline style="width:100%;max-width:none;height:auto;border-radius:12px;display:block;box-sizing:border-box;"></video>`;
      const inner = `<div class="ws-media-video-inner">${video}</div>`;
      return `<div class="ws-media-wrap ws-media-wrap--video" data-ws-lightbox="1" style="${wrapStyle}">${inner}${cap}</div>${mediaAnnotation(node.attrs, "待生成视频解析结果")}`;
    }
    case "table":
      return renderTableAsHtml(node);
    default:
      return renderExportInline(node.content);
  }
}

/** 开发工具：导出 Markdown；图片跳过，表格以 HTML 保留 */
export function tiptapToExportMarkdown(doc: unknown): string {
  const root = doc as TiptapNode;
  return (root.content ?? [])
    .map(renderExportNode)
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function cellPlainText(content?: TiptapNode[]): string {
  return (content ?? [])
    .map((child) => renderNode(child).replace(/\s+/g, " ").trim())
    .join(" ")
    .replace(/\|/g, "\\|")
    .trim();
}

function renderNode(node: TiptapNode): string {
  switch (node.type) {
    case "text":
      return textWithMarks(node);
    case "paragraph": {
      const inner = renderInline(node.content);
      const align = String(node.attrs?.textAlign ?? "left");
      if (align && align !== "left" && inner) {
        return `<p style="text-align:${align}">${inner}</p>`;
      }
      return inner;
    }
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const hashes = "#".repeat(level);
      const inner = renderInline(node.content);
      const align = String(node.attrs?.textAlign ?? "left");
      if (align && align !== "left" && inner) {
        return `<div style="text-align:${align}">${hashes} ${inner}</div>`;
      }
      return `${hashes} ${inner}`;
    }
    case "bulletList":
      return (node.content ?? []).map((item) => `- ${renderInline(item.content)}`).join("\n");
    case "orderedList":
      return (node.content ?? []).map((item, index) => `${index + 1}. ${renderInline(item.content)}`).join("\n");
    case "taskList":
      return (node.content ?? [])
        .map((item) => {
          if (item.type !== "taskItem") return renderNode(item);
          const checked = Boolean(item.attrs?.checked);
          const box = checked ? "[x]" : "[ ]";
          return `- ${box} ${renderInline(item.content)}`;
        })
        .join("\n");
    case "taskItem":
      return renderInline(node.content);
    case "listItem":
      return renderInline(node.content);
    case "blockquote":
      return renderInline(node.content)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock":
      return `\`\`\`${String(node.attrs?.language ?? "")}\n${renderInline(node.content)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "inlineMath": {
      const latex = String(node.attrs?.latex ?? "").trim();
      return latex ? `$${latex}$` : "";
    }
    case "blockMath": {
      const latex = String(node.attrs?.latex ?? "").trim();
      return latex ? `\n$$\n${latex}\n$$\n` : "";
    }
    case "image": {
      const src = String(node.attrs?.src ?? "");
      const caption = String(node.attrs?.caption ?? "").trim();
      const width = node.attrs?.width as string | null | undefined;
      const wrapStyle = width ? `max-width:100%;width:${escapeAttr(width)}` : "max-width:100%";
      const innerImg = `<img src="${escapeAttr(src)}" alt="" style="display:block;width:100%;height:auto;border-radius:12px;vertical-align:bottom;" />`;
      const img = `<div class="ws-media-image-inner">${innerImg}</div>`;
      const cap = caption ? `<div class="ws-media-caption">${escapeHtml(caption)}</div>` : "";
      return `<div class="ws-media-wrap ws-media-wrap--image" data-ws-lightbox="1" style="${wrapStyle}">${img}${cap}</div>${mediaAnnotation(node.attrs, "待生成图片解析结果")}`;
    }
    case "video": {
      const src = String(node.attrs?.src ?? "");
      const embedSrc = node.attrs?.embedSrc as string | null | undefined;
      const caption = String(node.attrs?.caption ?? "").trim();
      const width = node.attrs?.width as string | null | undefined;
      const wrapStyle = width ? `max-width:100%;width:${escapeAttr(width)}` : "max-width:100%";
      const cap = caption ? `<div class="ws-media-caption">${escapeHtml(caption)}</div>` : "";
      if (embedSrc) {
        const iframe = `<iframe data-workshadow-video="1" data-page-url="${escapeAttr(src)}" src="${escapeAttr(embedSrc)}" allowfullscreen="true" frameborder="0" style="width:100%;max-width:none;aspect-ratio:16/9;height:auto;border:0;border-radius:12px;background:#000;display:block;box-sizing:border-box;"></iframe>`;
        const inner = `<div class="ws-media-video-inner">${iframe}</div>`;
        return `<div class="ws-media-wrap ws-media-wrap--video" data-ws-lightbox="1" style="${wrapStyle}">${inner}${cap}</div>${mediaAnnotation(node.attrs, "嵌入网页视频")}`;
      }
      const video = `<video src="${escapeAttr(src)}" controls playsinline style="width:100%;max-width:none;height:auto;border-radius:12px;display:block;box-sizing:border-box;"></video>`;
      const inner = `<div class="ws-media-video-inner">${video}</div>`;
      return `<div class="ws-media-wrap ws-media-wrap--video" data-ws-lightbox="1" style="${wrapStyle}">${inner}${cap}</div>${mediaAnnotation(node.attrs, "待生成视频解析结果")}`;
    }
    case "table": {
      const rows = node.content ?? [];
      const lines: string[] = [];
      rows.forEach((row, rowIndex) => {
        if (row.type !== "tableRow") return;
        const cells = (row.content ?? []).map((cell) => {
          if (cell.type === "tableCell" || cell.type === "tableHeader") {
            return cellPlainText(cell.content) || " ";
          }
          return " ";
        });
        lines.push(`| ${cells.join(" | ")} |`);
        if (rowIndex === 0) {
          lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
        }
      });
      return lines.join("\n");
    }
    default:
      return renderInline(node.content);
  }
}

/** 与分块算法绑定；变更分块逻辑时请递增，以便索引侧失效旧缓存语义 */
export const MARKDOWN_CHUNK_HASH_VERSION = 2;

const MAX_CHUNK_CHARS = 3600;
const TARGET_SLICE = 2200;

/** 快速稳定哈希（FNV-1a 32-bit），用于 log / chunk 级增量与版本盐 */
export function fnv1aHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function hashMarkdownForIndex(markdown: string): string {
  return fnv1aHash(`${MARKDOWN_CHUNK_HASH_VERSION}\0${markdown}`);
}

/**
 * 将 Markdown 切成检索块（先于 LogChunk 包装）。
 * 生产索引走 tiptapChunks.ts（tiptapJson）；本函数仅用于单测与算法对照，勿在 rag 管线中调用。
 * - 优先在 ATX 标题行（#..######）前断开；
 * - 大块按空行、再按长度上限切片，避免单块过大。
 */
export function splitMarkdownToBlocks(markdown: string): string[] {
  const raw = markdown.trim();
  if (!raw) return [];

  const major = raw.split(/\n(?=#{1,6}[ \t])/);
  const pieces: string[] = [];

  const pushSlice = (chunk: string) => {
    const t = chunk.trim();
    if (t) pieces.push(t);
  };

  const splitOversized = (block: string) => {
    if (block.length <= MAX_CHUNK_CHARS) {
      pushSlice(block);
      return;
    }
    const paras = block.split(/\n{2,}/);
    let acc = "";
    for (const p of paras) {
      const part = p.trim();
      if (!part) continue;
      if (acc.length + part.length + 2 <= TARGET_SLICE) {
        acc = acc ? `${acc}\n\n${part}` : part;
      } else {
        if (acc) pushSlice(acc);
        if (part.length <= MAX_CHUNK_CHARS) {
          acc = part;
        } else {
          hardSlice(part);
          acc = "";
        }
      }
    }
    if (acc) {
      if (acc.length <= MAX_CHUNK_CHARS) pushSlice(acc);
      else hardSlice(acc);
    }
  };

  const hardSlice = (text: string) => {
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + MAX_CHUNK_CHARS, text.length);
      if (end < text.length) {
        const slice = text.slice(start, end);
        const breakAt = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf("。"), slice.lastIndexOf("！"), slice.lastIndexOf("？"));
        if (breakAt > TARGET_SLICE / 2) end = start + breakAt + 1;
      }
      pushSlice(text.slice(start, end));
      start = end;
    }
  };

  for (const m of major) {
    const block = m.trim();
    if (!block) continue;
    splitOversized(block);
  }

  return pieces;
}

export function splitMarkdownIntoChunks(markdown: string, logId: string, parentPath: string): Array<{
  id: string;
  logId: string;
  text: string;
  timestamp: string;
  parentPath: string;
  position: number;
}> {
  const blocks = splitMarkdownToBlocks(markdown);
  const timestamp = new Date().toISOString();
  return blocks.map((text, position) => ({
    id: `${logId}:${position}`,
    logId,
    text,
    timestamp,
    parentPath,
    position
  }));
}
