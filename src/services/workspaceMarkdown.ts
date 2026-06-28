/** 工作台 LLM Markdown 展示前规范化，补齐模型常漏掉的 Markdown 结构边界 */

const CODE_FENCE_RE = /^(```+|~~~+)/;

function isStructuralLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (CODE_FENCE_RE.test(t)) return true;
  if (/^#{1,6}(\s|$)/.test(t)) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return true;
  if (/^>\s/.test(t)) return true;
  if (/^[-*+]\s+/.test(t)) return true;
  if (/^\d+\.\s+/.test(t)) return true;
  if (/^\|.+\|/.test(t) || /^\|[-:| ]+\|/.test(t)) return true;
  return false;
}

function joinProseLines(parts: string[]): string {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const prev = result;
    const next = parts[i];
    const needsSpace = /[A-Za-z0-9]$/.test(prev) && /^[A-Za-z0-9]/.test(next);
    result += (needsSpace ? " " : "") + next;
  }
  return result;
}

function repairMarkdownSyntax(text: string): string {
  return (
    text
      // 标题常被模型输出成“##一”或紧贴上一句：补空格与块级换行。
      .replace(/([\p{Script=Han}A-Za-z0-9。！？；;：:）)\]】》%`])[ \t]*(#{1,6})[ \t]*(?=[\p{Script=Han}A-Za-z0-9])/gu, "$1\n\n$2 ")
      .replace(/(^|\n)(#{1,6})(?=[^\s#])/g, "$1$2 ")
      // 有些标题后直接接“1.”，会导致整行都变成标题文本。
      .replace(/(^|\n)(#{1,6}\s+[^\n]*?)(?=\d+\.\s*(?:\*\*|[\p{Script=Han}]))/gu, "$1$2\n\n")
      // 有序列表常被输出成“1.**标题**”或紧贴上一句。
      .replace(/([\p{Script=Han}A-Za-z0-9。！？；;：:）)\]】》%`])[ \t]*(\d+\.)(?=[ \t]*(?:\*\*|[\p{Script=Han}]))/gu, "$1\n\n$2")
      .replace(/(^|\n)(\s*)(\d+\.)(?=\S)/g, "$1$2$3 ")
      // 无序列表常被输出成“**标题**- 内容”或“-内容”。
      .replace(/(\*\*[^*\n]+?\*\*)\s*-\s*(?=\S)/g, "$1\n- ")
      .replace(/([\p{Script=Han}A-Za-z0-9。！？；;：:）)\]】》%`])[ \t]*-[ \t]*(?=\S)/gu, "$1\n- ")
      .replace(/(^|\n)(\s*)([-*+])(?=\S)/g, "$1$2$3 ")
      .replace(/\n{3,}/g, "\n\n")
  );
}

function normalizeProseBlock(block: string): string {
  const lines = block.split("\n");
  if (lines.length <= 1) return block;
  if (lines.some((line) => isStructuralLine(line))) return block;
  return joinProseLines(lines.map((l) => l.trim()).filter(Boolean));
}

type Segment = { kind: "code" | "text"; content: string };

function splitByCodeFences(text: string): Segment[] {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  let buf: string[] = [];
  let inFence = false;
  let fenceChar = "";

  const flush = (kind: "code" | "text") => {
    if (!buf.length) return;
    const content = buf.join("\n");
    const last = segments[segments.length - 1];
    if (last?.kind === kind) last.content += "\n" + content;
    else segments.push({ kind, content });
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const open = trimmed.match(CODE_FENCE_RE);
    if (open) {
      if (!inFence) {
        flush("text");
        inFence = true;
        fenceChar = open[1][0];
        buf.push(line);
      } else if (fenceChar && trimmed.startsWith(fenceChar)) {
        buf.push(line);
        inFence = false;
        fenceChar = "";
        flush("code");
      } else {
        buf.push(line);
      }
      continue;
    }
    buf.push(line);
  }
  flush(inFence ? "code" : "text");
  return segments;
}

function normalizeProseMarkdown(text: string): string {
  const repaired = repairMarkdownSyntax(text);
  const blocks = repaired
    .split(/\n\n/)
    .map((b) => b.trimEnd())
    .filter((b) => b !== "");

  return blocks.map((b) => normalizeProseBlock(b)).join("\n\n");
}

/** 合并段内硬换行、修复常见结构标记；保留标题、列表、表格与代码块结构 */
export function normalizeWorkspaceMarkdown(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  return splitByCodeFences(text)
    .map((seg) => (seg.kind === "code" ? seg.content : normalizeProseMarkdown(seg.content)))
    .join("\n")
    .trimEnd();
}
