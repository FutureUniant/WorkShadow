import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Color, FontFamily, TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor, useEditorState, type Content, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import CodeMark from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import { ImageCaption } from "../extensions/imageCaption";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Table, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Mathematics from "@tiptap/extension-mathematics";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Calendar,
  ChevronDown,
  Code,
  Film,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImageIcon,
  Italic,
  LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  PaintBucket,
  Pipette,
  Quote,
  Redo2,
  RotateCcw,
  Sigma,
  Smile,
  SquareMinus,
  Strikethrough,
  Subscript as SubIcon,
  Superscript as SupIcon,
  Table as TableIcon,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  XCircle,
  Underline as UnderlineIcon,
  Undo2,
  Save,
  Type
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { TableCellVertical, TableHeaderVertical } from "../extensions/tableCellVertical";
import { HighlightColor } from "../extensions/highlightColor";
import { EditorClipboard } from "../extensions/editorClipboard";
import { Video } from "../extensions/video";
import type { LogNode, ShortcutMap } from "../types";
import { matchesShortcut } from "../services/shortcuts";
import { resolveVideoEmbed } from "../services/videoEmbed";
import { collectLightboxItems, findLightboxIndex, type LightboxItem } from "../services/mediaGallery";
import { ensureKatexStyles } from "../services/katexStyle";
import { reportErrorToUser } from "../services/errorReporting";
import { loadEditorDocument } from "../services/editorHistory";
import { tiptapToMarkdown, tiptapToExportMarkdown } from "../services/markdown";
import { pickMarkdownFile } from "../services/pickMarkdownFile";
import { saveMarkdownFile } from "../services/saveMarkdownFile";
import { emptyDoc } from "../defaults";
import type { ConfirmOptions } from "../types";
import { isDeveloperBuild } from "../services/productionUiGuards";
import { LinkInsertDialog, type LinkDialogMode } from "./LinkInsertDialog";
import { MathInsertDialog, type MathInsertMode } from "./MathInsertDialog";
import { MediaInsertDialog } from "./MediaInsertDialog";
import { MediaLightbox } from "./MediaLightbox";
import { TextColorDialog } from "./TextColorDialog";

/** 默认 `excludes: '_'` 会禁止与其它标记（含 textStyle 字色）共存 */
const EditorCode = CodeMark.extend({ excludes: "" });
/** 默认 `marks: ''` 禁止代码块内任何行内标记，导致无法 setColor */
const EditorCodeBlock = CodeBlock.extend({ marks: "_" });

/** 正文默认字色（「清除颜色」与无标记时的展示） */
const DEFAULT_TEXT_COLOR = "#111827";
/** 高亮默认底色（「清除」与未指定色时的展示） */
const DEFAULT_HIGHLIGHT_COLOR = "#fef08a";

/** 文字颜色下拉：除默认黑外的常用色 */
const TEXT_COLOR_PRESETS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed"];
/** 高亮下拉：除默认黄外的常用色 */
const HIGHLIGHT_PRESETS = ["#fde047", "#f97316", "#4ade80", "#38bdf8", "#c084fc"];
/** 表格单元格默认底色（「清除」与无标记时的展示） */
const DEFAULT_TABLE_BG_COLOR = "#f3f4f6";
/** 表格底色下拉：除默认灰外的常用色 */
const TABLE_BG_PRESETS = ["#fef3c7", "#dbeafe", "#dcfce7", "#fce7f3", "#e5e7eb"];

const FONT_MENU_W = 268;
const FONT_MENU_H = 320;
const COLOR_MENU_W = 252;
const COLOR_MENU_H = 102;
const HIGHLIGHT_MENU_W = COLOR_MENU_W;
const HIGHLIGHT_MENU_H = COLOR_MENU_H;
const TABLE_BG_MENU_W = COLOR_MENU_W;
const TABLE_BG_MENU_H = COLOR_MENU_H;

function clampToolbarDropdown(rect: DOMRect, w: number, h: number) {
  const pad = 8;
  let top = rect.bottom + 6;
  if (top + h > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - 6 - h);
  }
  let left = rect.left;
  if (left + w > window.innerWidth - pad) {
    left = window.innerWidth - pad - w;
  }
  if (left < pad) left = pad;
  return { top, left };
}

function isHexColor(s: string) {
  return /^#[0-9a-fA-F]{6}$/.test(s.trim());
}

const FONT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: "", labelKey: "toolbarFontDefault" },
  { value: 'Inter, "Segoe UI", system-ui, sans-serif', labelKey: "toolbarFontUI" },
  { value: 'Georgia, "Times New Roman", Times, serif', labelKey: "toolbarFontSerif" },
  { value: 'ui-monospace, "Cascadia Code", Consolas, monospace', labelKey: "toolbarFontMono" },
  { value: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif', labelKey: "toolbarFontCjkSans" },
  { value: '"KaiTi", "STKaiti", serif', labelKey: "toolbarFontCjkKai" }
];

const EMOJI_POPOVER_W = 228;
const EMOJI_POPOVER_H = 200;

const TABLE_PICKER_MAX = 10;
const TABLE_PICKER_W = 240;
const TABLE_PICKER_H = 280;

/** 编辑停止后多久再同步 tiptapJson + markdown 到父 state（避免每键 getJSON / 重渲染） */
const CONTENT_SYNC_DEBOUNCE_MS = 400;

function clampTablePickerPosition(rect: DOMRect) {
  const pad = 8;
  let top = rect.bottom + 6;
  if (top + TABLE_PICKER_H > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - 6 - TABLE_PICKER_H);
  }
  let left = rect.left;
  if (left + TABLE_PICKER_W > window.innerWidth - pad) {
    left = window.innerWidth - pad - TABLE_PICKER_W;
  }
  if (left < pad) left = pad;
  return { top, left };
}

function clampEmojiPopoverPosition(rect: DOMRect) {
  const pad = 8;
  let top = rect.bottom + 6;
  if (top + EMOJI_POPOVER_H > window.innerHeight - pad) {
    top = Math.max(pad, rect.top - 6 - EMOJI_POPOVER_H);
  }
  let left = rect.left;
  if (left + EMOJI_POPOVER_W > window.innerWidth - pad) {
    left = window.innerWidth - pad - EMOJI_POPOVER_W;
  }
  if (left < pad) left = pad;
  return { top, left };
}

const EMOJI_PRESETS = [
  "😀",
  "😊",
  "👍",
  "🙏",
  "✅",
  "❌",
  "⭐",
  "🔥",
  "💡",
  "📝",
  "⏰",
  "📌",
  "🎯",
  "💻",
  "📎",
  "❤️",
  "🎉",
  "🤔",
  "👀",
  "🚀"
];

function formatDocumentUpdatedAt(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

interface Props {
  node: LogNode | null;
  preview: boolean;
  shortcuts: ShortcutMap;
  onPreviewToggle: () => void;
  onChange: (node: LogNode) => void;
  onSave: () => void | Promise<void>;
  onConfirm?: (options: ConfirmOptions) => Promise<boolean>;
  activityBar?: ReactNode;
}

function ToolBtn({
  title,
  onClick,
  active,
  disabled,
  className,
  children
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={["tool", active ? "active" : "", className ?? ""].filter(Boolean).join(" ")}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function EditorPane({
  node,
  preview,
  shortcuts,
  onPreviewToggle,
  onChange,
  onSave,
  onConfirm,
  activityBar
}: Props) {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    void ensureKatexStyles();
  }, []);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiPos, setEmojiPos] = useState<{ top: number; left: number } | null>(null);
  const emojiAnchorRef = useRef<HTMLDivElement>(null);
  const emojiPopoverRef = useRef<HTMLDivElement>(null);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tablePickerHover, setTablePickerHover] = useState({ r: 3, c: 3 });
  const [tablePickerPos, setTablePickerPos] = useState<{ top: number; left: number } | null>(null);
  const tableAnchorRef = useRef<HTMLDivElement>(null);
  const tablePopoverRef = useRef<HTMLDivElement>(null);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [fontMenuPos, setFontMenuPos] = useState<{ top: number; left: number } | null>(null);
  const fontAnchorRef = useRef<HTMLDivElement>(null);
  const fontMenuRef = useRef<HTMLDivElement>(null);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [colorMenuPos, setColorMenuPos] = useState<{ top: number; left: number } | null>(null);
  const colorAnchorRef = useRef<HTMLDivElement>(null);
  const colorMenuRef = useRef<HTMLDivElement>(null);
  const [colorDialogOpen, setColorDialogOpen] = useState(false);
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false);
  const [highlightMenuPos, setHighlightMenuPos] = useState<{ top: number; left: number } | null>(null);
  const highlightAnchorRef = useRef<HTMLDivElement>(null);
  const highlightMenuRef = useRef<HTMLDivElement>(null);
  const [highlightDialogOpen, setHighlightDialogOpen] = useState(false);
  const [tableBgMenuOpen, setTableBgMenuOpen] = useState(false);
  const [tableBgMenuPos, setTableBgMenuPos] = useState<{ top: number; left: number } | null>(null);
  const tableBgAnchorRef = useRef<HTMLDivElement>(null);
  const tableBgMenuRef = useRef<HTMLDivElement>(null);
  const [tableBgDialogOpen, setTableBgDialogOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [mediaKind, setMediaKind] = useState<"image" | "video" | null>(null);
  const [mathDialog, setMathDialog] = useState<{
    open: boolean;
    editPos: number | null;
    initialKind: MathInsertMode;
    initialLatex: string;
  }>({
    open: false,
    editPos: null,
    initialKind: "inline",
    initialLatex: ""
  });
  const lastInsertKindRef = useRef<MathInsertMode>("inline");
  const mathClickRef = useRef<(kind: MathInsertMode, pos: number, latex: string) => void>(() => {});
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const editorMainRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<ReturnType<typeof useEditor>>(null);

  const nodeRef = useRef(node);
  const onChangeRef = useRef(onChange);
  nodeRef.current = node;
  onChangeRef.current = onChange;

  const composingRef = useRef(false);
  const contentDirtyRef = useRef(false);
  const applyingExternalContentRef = useRef(false);
  const contentSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearContentSyncTimer = useCallback(() => {
    if (contentSyncTimerRef.current) {
      clearTimeout(contentSyncTimerRef.current);
      contentSyncTimerRef.current = null;
    }
  }, []);

  const flushContentSync = useCallback(() => {
    clearContentSyncTimer();
    const currentNode = nodeRef.current;
    const activeEditor = editorInstanceRef.current;
    if (!currentNode || !activeEditor || !contentDirtyRef.current) return;
    contentDirtyRef.current = false;
    const json = activeEditor.getJSON();
    onChangeRef.current({
      ...currentNode,
      tiptapJson: json,
      markdown: tiptapToMarkdown(json),
      updatedAt: new Date().toISOString()
    });
  }, [clearContentSyncTimer]);

  const scheduleContentSync = useCallback(() => {
    clearContentSyncTimer();
    contentSyncTimerRef.current = setTimeout(() => {
      contentSyncTimerRef.current = null;
      flushContentSync();
    }, CONTENT_SYNC_DEBOUNCE_MS);
  }, [clearContentSyncTimer, flushContentSync]);

  const syncEditorContent = useCallback(
    (opts?: { markdownImmediate?: boolean }) => {
      if (!nodeRef.current) return;
      const activeEditor = editorInstanceRef.current;
      if (!activeEditor) return;
      if (opts?.markdownImmediate) {
        contentDirtyRef.current = false;
        clearContentSyncTimer();
        const json = activeEditor.getJSON();
        onChangeRef.current({
          ...nodeRef.current,
          tiptapJson: json,
          markdown: tiptapToMarkdown(json),
          updatedAt: new Date().toISOString()
        });
        return;
      }
      contentDirtyRef.current = true;
      scheduleContentSync();
    },
    [clearContentSyncTimer, scheduleContentSync]
  );

  const handleEditorUpdate = useCallback(
    (activeEditor: Editor) => {
      if (applyingExternalContentRef.current) return;
      if (!nodeRef.current) return;
      if (activeEditor.view.composing || composingRef.current) {
        contentDirtyRef.current = true;
        return;
      }
      contentDirtyRef.current = true;
      scheduleContentSync();
    },
    [scheduleContentSync]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        undoRedo: { depth: 100 },
        code: false,
        codeBlock: false,
        dropcursor: { width: 2, class: "workshadow-dropcursor" }
      }),
      EditorCode,
      EditorCodeBlock,
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      FontFamily.configure({ types: ["textStyle"] }),
      Underline,
      HighlightColor,
      Subscript,
      Superscript,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeaderVertical,
      TableCellVertical,
      EditorClipboard,
      TaskList,
      TaskItem.configure({ nested: false }),
      Mathematics.configure({
        katexOptions: {
          throwOnError: false,
          output: "html"
        },
        inlineOptions: {
          onClick: (node, pos) => {
            mathClickRef.current("inline", pos, String((node.attrs as { latex?: string }).latex ?? ""));
          }
        },
        blockOptions: {
          onClick: (node, pos) => {
            mathClickRef.current("block", pos, String((node.attrs as { latex?: string }).latex ?? ""));
          }
        }
      }),
      ImageCaption.configure({ inline: false, allowBase64: true }),
      Video,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: t("editorPlaceholder") }),
      Markdown.configure({
        markedOptions: { gfm: true }
      })
    ],
    content: emptyDoc,
    immediatelyRender: false,
    onUpdate: ({ editor: activeEditor }) => {
      handleEditorUpdate(activeEditor);
    }
  });

  editorInstanceRef.current = editor ?? null;

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onCompositionStart = () => {
      composingRef.current = true;
    };
    const onCompositionEnd = () => {
      composingRef.current = false;
      if (!nodeRef.current) return;
      contentDirtyRef.current = true;
      flushContentSync();
    };
    dom.addEventListener("compositionstart", onCompositionStart);
    dom.addEventListener("compositionend", onCompositionEnd);
    return () => {
      dom.removeEventListener("compositionstart", onCompositionStart);
      dom.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [editor, flushContentSync]);

  useLayoutEffect(() => {
    const snapshotNode = node;
    return () => {
      clearContentSyncTimer();
      const activeEditor = editorInstanceRef.current;
      if (!snapshotNode || !activeEditor || !contentDirtyRef.current) return;
      contentDirtyRef.current = false;
      const json = activeEditor.getJSON();
      onChangeRef.current({
        ...snapshotNode,
        tiptapJson: json,
        markdown: tiptapToMarkdown(json),
        updatedAt: new Date().toISOString()
      });
    };
  }, [node?.id, clearContentSyncTimer]);

  mathClickRef.current = (kind, pos, latex) => {
    setMathDialog({
      open: true,
      editPos: pos,
      initialKind: kind,
      initialLatex: latex
    });
  };

  useEffect(() => {
    if (preview) setTitleEditing(false);
  }, [preview]);

  useEffect(() => {
    if (!node) return;
    setTitleDraft(node.title);
    setTitleEditing(false);
  }, [node?.id]);

  useLayoutEffect(() => {
    if (!editor || !node) return;
    clearContentSyncTimer();
    contentDirtyRef.current = false;
    applyingExternalContentRef.current = true;
    try {
      loadEditorDocument(editor, node.tiptapJson as Content);
    } finally {
      applyingExternalContentRef.current = false;
    }
  }, [editor, node?.id, clearContentSyncTimer]);

  const linkDialogMode: LinkDialogMode = useMemo(() => {
    if (!editor || !linkOpen) return "urlOnly";
    return !editor.state.selection.empty || editor.isActive("link") ? "urlOnly" : "textAndUrl";
  }, [editor, linkOpen]);

  const linkInitialHref = useMemo(() => {
    if (!editor || !linkOpen) return "";
    if (editor.isActive("link")) return String((editor.getAttributes("link") as { href?: string }).href ?? "");
    return "";
  }, [editor, linkOpen]);

  useEffect(() => {
    if (!editor) return;
    if (
      linkOpen ||
      mediaKind !== null ||
      mathDialog.open ||
      tablePickerOpen ||
      fontMenuOpen ||
      colorMenuOpen ||
      colorDialogOpen ||
      highlightMenuOpen ||
      highlightDialogOpen ||
      tableBgMenuOpen ||
      tableBgDialogOpen
    ) {
      editor.commands.blur();
    }
  }, [
    editor,
    linkOpen,
    mediaKind,
    mathDialog.open,
    tablePickerOpen,
    fontMenuOpen,
    colorMenuOpen,
    colorDialogOpen,
    highlightMenuOpen,
    highlightDialogOpen,
    tableBgMenuOpen,
    tableBgDialogOpen
  ]);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onDbl = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const wrap = el.closest(".ws-media-wrap");
      if (!wrap) return;
      const items = collectLightboxItems(editor);
      if (!items.length) return;
      const img = wrap.querySelector("img");
      const iframe = wrap.querySelector("iframe[data-workshadow-video='1']");
      const vidEl = wrap.querySelector("video");
      let idx = -1;
      if (img?.src) idx = findLightboxIndex(items, { type: "image", src: img.currentSrc || img.src });
      else if (iframe?.getAttribute("src")) {
        idx = findLightboxIndex(items, {
          type: "video",
          src: iframe.getAttribute("data-page-url") || "",
          embedSrc: iframe.getAttribute("src")
        });
      } else if (vidEl?.src) idx = findLightboxIndex(items, { type: "video", src: vidEl.currentSrc || vidEl.src });
      if (idx < 0) return;
      e.preventDefault();
      setLightbox({ items, index: idx });
    };
    dom.addEventListener("dblclick", onDbl);
    return () => dom.removeEventListener("dblclick", onDbl);
  }, [editor]);

  useLayoutEffect(() => {
    if (!emojiOpen) {
      setEmojiPos(null);
      return;
    }
    const anchor = emojiAnchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      setEmojiPos(clampEmojiPopoverPosition(rect));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [emojiOpen]);

  useLayoutEffect(() => {
    if (!tablePickerOpen) {
      setTablePickerPos(null);
      return;
    }
    const anchor = tableAnchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      setTablePickerPos(clampTablePickerPosition(rect));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [tablePickerOpen]);

  useLayoutEffect(() => {
    if (!fontMenuOpen) {
      setFontMenuPos(null);
      return;
    }
    const anchor = fontAnchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      setFontMenuPos(clampToolbarDropdown(rect, FONT_MENU_W, FONT_MENU_H));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [fontMenuOpen]);

  useLayoutEffect(() => {
    if (!colorMenuOpen) {
      setColorMenuPos(null);
      return;
    }
    const anchor = colorAnchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      setColorMenuPos(clampToolbarDropdown(rect, COLOR_MENU_W, COLOR_MENU_H));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [colorMenuOpen]);

  useLayoutEffect(() => {
    if (!highlightMenuOpen) {
      setHighlightMenuPos(null);
      return;
    }
    const anchor = highlightAnchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      setHighlightMenuPos(clampToolbarDropdown(rect, HIGHLIGHT_MENU_W, HIGHLIGHT_MENU_H));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [highlightMenuOpen]);

  useLayoutEffect(() => {
    if (!tableBgMenuOpen) {
      setTableBgMenuPos(null);
      return;
    }
    const anchor = tableBgAnchorRef.current;
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      setTableBgMenuPos(clampToolbarDropdown(rect, TABLE_BG_MENU_W, TABLE_BG_MENU_H));
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [tableBgMenuOpen]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const t = event.target as Node;
      if (emojiAnchorRef.current?.contains(t) || emojiPopoverRef.current?.contains(t)) return;
      setEmojiOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [emojiOpen]);

  useEffect(() => {
    if (!tablePickerOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const t = event.target as Node;
      if (tableAnchorRef.current?.contains(t) || tablePopoverRef.current?.contains(t)) return;
      setTablePickerOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [tablePickerOpen]);

  useEffect(() => {
    if (!fontMenuOpen && !colorMenuOpen && !highlightMenuOpen && !tableBgMenuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (fontMenuOpen && (fontAnchorRef.current?.contains(target) || fontMenuRef.current?.contains(target))) return;
      if (
        colorMenuOpen &&
        (colorAnchorRef.current?.contains(target) || colorMenuRef.current?.contains(target))
      )
        return;
      if (
        highlightMenuOpen &&
        (highlightAnchorRef.current?.contains(target) || highlightMenuRef.current?.contains(target))
      )
        return;
      if (
        tableBgMenuOpen &&
        (tableBgAnchorRef.current?.contains(target) || tableBgMenuRef.current?.contains(target))
      )
        return;
      setFontMenuOpen(false);
      setColorMenuOpen(false);
      setHighlightMenuOpen(false);
      setTableBgMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [fontMenuOpen, colorMenuOpen, highlightMenuOpen, tableBgMenuOpen]);

  const styleAttrs = useEditorState({
    editor,
    selector: (snap) => {
      const ed = snap.editor;
      if (!ed) return { color: "", fontFamily: "" };
      const attrs = ed.getAttributes("textStyle") as { color?: string; fontFamily?: string };
      return {
        color: attrs.color ?? "",
        fontFamily: attrs.fontFamily ?? ""
      };
    }
  });

  const highlightAttrs = useEditorState({
    editor,
    selector: (snap) => {
      const ed = snap.editor;
      if (!ed) return { color: "" };
      const attrs = ed.getAttributes("highlight") as { color?: string };
      return { color: attrs.color ?? "" };
    }
  });

  const effectiveTextColor =
    styleAttrs?.color && isHexColor(styleAttrs.color) ? styleAttrs.color : DEFAULT_TEXT_COLOR;
  const effectiveHighlightColor =
    highlightAttrs?.color && isHexColor(highlightAttrs.color)
      ? highlightAttrs.color
      : DEFAULT_HIGHLIGHT_COLOR;

  const textColorNorm = (styleAttrs?.color ?? "").trim().toLowerCase();
  const textClearSelected = !textColorNorm || textColorNorm === DEFAULT_TEXT_COLOR.toLowerCase();

  const hlColorNorm = (highlightAttrs?.color ?? "").trim().toLowerCase();
  const hlOn = !!editor?.isActive("highlight");
  const hlClearSelected =
    hlOn &&
    (!hlColorNorm ||
      !isHexColor(highlightAttrs?.color ?? "") ||
      hlColorNorm === DEFAULT_HIGHLIGHT_COLOR.toLowerCase());

  const tableUi = useEditorState({
    editor,
    selector: (snap) => {
      const ed = snap.editor;
      if (!ed) {
        return {
          inTable: false,
          canMerge: false,
          canSplit: false,
          cellAlign: null as string | null,
          cellVerticalAlign: null as string | null,
          cellBackgroundColor: null as string | null
        };
      }
      const inTable = ed.isActive("table");
      let cellAlign: string | null = null;
      let cellVerticalAlign: string | null = null;
      let cellBackgroundColor: string | null = null;
      if (inTable) {
        if (ed.isActive("tableHeader")) {
          const a = ed.getAttributes("tableHeader") as {
            align?: string | null;
            verticalAlign?: string | null;
            backgroundColor?: string | null;
          };
          cellAlign = a.align ?? null;
          cellVerticalAlign = a.verticalAlign ?? null;
          cellBackgroundColor = a.backgroundColor ?? null;
        } else if (ed.isActive("tableCell")) {
          const a = ed.getAttributes("tableCell") as {
            align?: string | null;
            verticalAlign?: string | null;
            backgroundColor?: string | null;
          };
          cellAlign = a.align ?? null;
          cellVerticalAlign = a.verticalAlign ?? null;
          cellBackgroundColor = a.backgroundColor ?? null;
        }
      }
      return {
        inTable,
        canMerge: ed.can().mergeCells?.() ?? false,
        canSplit: ed.can().splitCell?.() ?? false,
        cellAlign,
        cellVerticalAlign,
        cellBackgroundColor
      };
    }
  });

  const effectiveTableBgColor =
    tableUi?.cellBackgroundColor && isHexColor(tableUi.cellBackgroundColor)
      ? tableUi.cellBackgroundColor
      : DEFAULT_TABLE_BG_COLOR;
  const tableBgColorNorm = (tableUi?.cellBackgroundColor ?? "").trim().toLowerCase();
  const tableBgClearSelected = !tableBgColorNorm || tableBgColorNorm === DEFAULT_TABLE_BG_COLOR.toLowerCase();

  const logScrollRef = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    if (!node?.id || !editorMainRef.current) return;
    if (!preview && !editor) return;
    const main = editorMainRef.current;
    const scrollEl = main.querySelector(".rich-editor") as HTMLElement | null;
    if (!scrollEl) return;

    const key = `${node.id}:${preview ? "md" : "rich"}`;
    const saved = logScrollRef.current[key];

    const applyScroll = () => {
      scrollEl.scrollTop = saved !== undefined ? saved : 0;
    };
    applyScroll();
    if (preview) {
      requestAnimationFrame(() => {
        requestAnimationFrame(applyScroll);
      });
    }

    const onScroll = () => {
      logScrollRef.current[key] = scrollEl.scrollTop;
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
    };
  }, [node?.id, preview, editor]);

  const handleSave = useCallback(async () => {
    if (!editor || !node) return;
    if (saveBusy) return;
    setSaveBusy(true);
    try {
      flushSync(() => {
        flushContentSync();
      });
      await Promise.resolve(onSave());
    } catch {
      /* 错误已由保存管线通过 reportErrorToUser 提示 */
    } finally {
      setSaveBusy(false);
    }
  }, [editor, node, saveBusy, onSave, flushContentSync]);

  useEffect(() => {
    if (!editor || preview || !node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyS" || !(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement;
      if (!el || !editor.view.dom.contains(el)) return;
      e.preventDefault();
      void handleSave();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, preview, node, handleSave]);

  if (!node) {
    return <main className="editor-empty">{t("editorSelectHint")}</main>;
  }

  const chain = () => editor?.chain().focus();

  function insertDate() {
    const text = new Date().toLocaleString(navigator.language, { dateStyle: "medium", timeStyle: "short" });
    chain()?.insertContent(text).run();
  }

  async function handleImportMarkdown() {
    if (!node || node.kind !== "log" || !editor || importBusy || !onConfirm) return;

    const picked = await pickMarkdownFile();
    if (!picked) return;

    if (!picked.text.trim()) return;

    if (!editor.isEmpty) {
      const ok = await onConfirm({
        title: t("importMarkdownReplaceTitle"),
        message: t("importMarkdownReplaceMessage")
      });
      if (!ok) return;
    }

    setImportBusy(true);
    try {
      if (preview) onPreviewToggle();
      loadEditorDocument(editor, picked.text, { contentType: "markdown", emitUpdate: true });
      syncEditorContent({ markdownImmediate: true });
    } catch (e) {
      reportErrorToUser("persist", e);
    } finally {
      setImportBusy(false);
    }
  }

  const canImportMarkdown = node?.kind === "log" && Boolean(editor) && !importBusy;

  async function handleExportMarkdown() {
    if (!node || node.kind !== "log" || !editor || exportBusy) return;

    setExportBusy(true);
    try {
      flushContentSync();
      const markdown = tiptapToExportMarkdown(editor.getJSON());
      const title = (node.title.trim() || "export").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80);
      await saveMarkdownFile(markdown, `${title}.md`);
    } catch (e) {
      reportErrorToUser("persist", e);
    } finally {
      setExportBusy(false);
    }
  }

  const canExportMarkdown = isDeveloperBuild() && node?.kind === "log" && Boolean(editor) && !exportBusy;

  return (
    <>
      <main className={preview ? "editor-shell editor-shell--preview" : "editor-shell"}>
      <header className="toolbar">
        <div className="toolbar-top">
          <div className="toolbar-rows">
            <div className="toolbar-row toolbar-row-scroll">
              <div className="toolbar-group">
                <ToolBtn title={t("toolbarUndo")} onClick={() => chain()?.undo().run()} disabled={!editor?.can().undo()}>
                  <Undo2 size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarRedo")} onClick={() => chain()?.redo().run()} disabled={!editor?.can().redo()}>
                  <Redo2 size={16} />
                </ToolBtn>
              </div>
              <span className="toolbar-sep" aria-hidden />
              <div className="toolbar-group">
                <ToolBtn title={t("toolbarBold")} active={editor?.isActive("bold")} onClick={() => chain()?.toggleBold().run()}>
                  <Bold size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarItalic")} active={editor?.isActive("italic")} onClick={() => chain()?.toggleItalic().run()}>
                  <Italic size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarUnderline")} active={editor?.isActive("underline")} onClick={() => chain()?.toggleUnderline().run()}>
                  <UnderlineIcon size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarStrike")} active={editor?.isActive("strike")} onClick={() => chain()?.toggleStrike().run()}>
                  <Strikethrough size={16} />
                </ToolBtn>
              </div>
              <span className="toolbar-sep" aria-hidden />
              <div className="toolbar-font-color-tour">
                <div ref={fontAnchorRef} className="toolbar-inline-anchor">
                  <ToolBtn
                    title={t("toolbarFontFamily")}
                    active={fontMenuOpen}
                    onClick={() => {
                      setColorDialogOpen(false);
                      setHighlightDialogOpen(false);
                      setHighlightMenuOpen(false);
                      setFontMenuOpen((open) => !open);
                      setColorMenuOpen(false);
                    }}
                  >
                    <Type size={16} />
                  </ToolBtn>
                </div>
                <div ref={colorAnchorRef} className="toolbar-inline-anchor">
                <div
                  className={["toolbar-font-color-split", "tool", colorMenuOpen || colorDialogOpen ? "active" : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="toolbar-font-color-split__apply"
                    title={t("toolbarTextColorApply")}
                    aria-label={t("toolbarTextColorApply")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setColorDialogOpen(false);
                      setColorMenuOpen(false);
                      setHighlightDialogOpen(false);
                      setHighlightMenuOpen(false);
                      chain()?.setColor(effectiveTextColor).run();
                    }}
                  >
                    <span className="toolbar-font-color-trigger__core">
                      <span className="toolbar-font-color-trigger__a" aria-hidden>
                        A
                      </span>
                      <span
                        className="toolbar-font-color-trigger__bar"
                        style={{ backgroundColor: effectiveTextColor }}
                        aria-hidden
                      />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="toolbar-font-color-split__menu"
                    title={t("toolbarTextColorOpenPalette")}
                    aria-label={t("toolbarTextColorOpenPalette")}
                    aria-expanded={colorMenuOpen}
                    aria-haspopup="listbox"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setColorDialogOpen(false);
                      setHighlightDialogOpen(false);
                      setHighlightMenuOpen(false);
                      setColorMenuOpen((open) => !open);
                      setFontMenuOpen(false);
                    }}
                  >
                    <ChevronDown size={14} strokeWidth={2} aria-hidden />
                  </button>
                </div>
                </div>
                <div ref={highlightAnchorRef} className="toolbar-inline-anchor">
                  <div
                    className={[
                      "toolbar-font-color-split",
                      "toolbar-font-color-split--marker",
                      "tool",
                      highlightMenuOpen || highlightDialogOpen || editor?.isActive("highlight") ? "active" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className="toolbar-font-color-split__apply"
                      title={t("toolbarHighlightApply")}
                      aria-label={t("toolbarHighlightApply")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setHighlightDialogOpen(false);
                        setHighlightMenuOpen(false);
                        setFontMenuOpen(false);
                        setColorMenuOpen(false);
                        setColorDialogOpen(false);
                        chain()?.toggleHighlight({ color: effectiveHighlightColor }).run();
                      }}
                    >
                      <span className="toolbar-font-color-trigger__core">
                        <Highlighter className="toolbar-font-color-trigger__marker-icon" size={15} strokeWidth={2} aria-hidden />
                        <span
                          className="toolbar-font-color-trigger__bar"
                          style={{ backgroundColor: effectiveHighlightColor }}
                          aria-hidden
                        />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="toolbar-font-color-split__menu"
                      title={t("toolbarHighlightOpenPalette")}
                      aria-label={t("toolbarHighlightOpenPalette")}
                      aria-expanded={highlightMenuOpen}
                      aria-haspopup="listbox"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setHighlightDialogOpen(false);
                        setHighlightMenuOpen((open) => !open);
                        setFontMenuOpen(false);
                        setColorMenuOpen(false);
                        setColorDialogOpen(false);
                      }}
                    >
                      <ChevronDown size={14} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                </div>
              </div>
              <span className="toolbar-sep" aria-hidden />
              <div className="toolbar-group">
                <ToolBtn title={t("toolbarCode")} active={editor?.isActive("code")} onClick={() => chain()?.toggleCode().run()}>
                  <Code size={15} />
                </ToolBtn>
                <ToolBtn title={t("toolbarSuperscript")} active={editor?.isActive("superscript")} onClick={() => chain()?.toggleSuperscript().run()}>
                  <SupIcon size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarSubscript")} active={editor?.isActive("subscript")} onClick={() => chain()?.toggleSubscript().run()}>
                  <SubIcon size={16} />
                </ToolBtn>
              </div>
            </div>

            <div className="toolbar-row toolbar-row-scroll">
              <div className="toolbar-group">
                <ToolBtn title={t("toolbarHeading1")} active={editor?.isActive("heading", { level: 1 })} onClick={() => chain()?.toggleHeading({ level: 1 }).run()}>
                  <Heading1 size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarHeading2")} active={editor?.isActive("heading", { level: 2 })} onClick={() => chain()?.toggleHeading({ level: 2 }).run()}>
                  <Heading2 size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarHeading3")} active={editor?.isActive("heading", { level: 3 })} onClick={() => chain()?.toggleHeading({ level: 3 }).run()}>
                  <Heading3 size={16} />
                </ToolBtn>
              </div>
              <span className="toolbar-sep" aria-hidden />
              <div className="toolbar-group">
                <ToolBtn title={t("toolbarAlignLeft")} active={editor?.isActive({ textAlign: "left" })} onClick={() => chain()?.setTextAlign("left").run()}>
                  <AlignLeft size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarAlignCenter")} active={editor?.isActive({ textAlign: "center" })} onClick={() => chain()?.setTextAlign("center").run()}>
                  <AlignCenter size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarAlignRight")} active={editor?.isActive({ textAlign: "right" })} onClick={() => chain()?.setTextAlign("right").run()}>
                  <AlignRight size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarAlignJustify")} active={editor?.isActive({ textAlign: "justify" })} onClick={() => chain()?.setTextAlign("justify").run()}>
                  <AlignJustify size={16} />
                </ToolBtn>
              </div>
              <span className="toolbar-sep" aria-hidden />
              <div className="toolbar-group">
                <ToolBtn title={t("toolbarBulletList")} active={editor?.isActive("bulletList")} onClick={() => chain()?.toggleBulletList().run()}>
                  <List size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarOrderedList")} active={editor?.isActive("orderedList")} onClick={() => chain()?.toggleOrderedList().run()}>
                  <ListOrdered size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTaskList")} active={editor?.isActive("taskList")} onClick={() => chain()?.toggleTaskList().run()}>
                  <ListChecks size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarBlockquote")} active={editor?.isActive("blockquote")} onClick={() => chain()?.toggleBlockquote().run()}>
                  <Quote size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarCodeBlock")} active={editor?.isActive("codeBlock")} onClick={() => chain()?.toggleCodeBlock().run()}>
                  <span className="toolbar-icon-text">{"{ }"}</span>
                </ToolBtn>
                <ToolBtn title={t("toolbarHr")} onClick={() => chain()?.setHorizontalRule().run()}>
                  <Minus size={16} />
                </ToolBtn>
              </div>
              <span className="toolbar-sep" aria-hidden />
              <div className="toolbar-group">
                <ToolBtn title={t("toolbarLink")} active={editor?.isActive("link")} onClick={() => setLinkOpen(true)}>
                  <LinkIcon size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarImage")} onClick={() => setMediaKind("image")}>
                  <ImageIcon size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarVideo")} onClick={() => setMediaKind("video")}>
                  <Film size={16} />
                </ToolBtn>
                <div className="toolbar-inline-anchor" ref={emojiAnchorRef}>
                  <ToolBtn
                    title={t("toolbarEmoji")}
                    active={emojiOpen}
                    onClick={() => {
                      setTablePickerOpen(false);
                      setFontMenuOpen(false);
                      setColorMenuOpen(false);
                      setColorDialogOpen(false);
                      setHighlightMenuOpen(false);
                      setHighlightDialogOpen(false);
                      setEmojiOpen((v) => !v);
                    }}
                  >
                    <Smile size={16} />
                  </ToolBtn>
                </div>
                <ToolBtn title={t("toolbarInsertDate")} onClick={insertDate}>
                  <Calendar size={16} />
                </ToolBtn>
                <ToolBtn
                  title={t("toolbarMath")}
                  active={mathDialog.open}
                  onClick={() =>
                    setMathDialog({
                      open: true,
                      editPos: null,
                      initialKind: lastInsertKindRef.current,
                      initialLatex: ""
                    })
                  }
                >
                  <Sigma size={16} />
                </ToolBtn>
                <ToolBtn
                  title={node.kind === "log" ? t("toolbarImportMarkdown") : t("importMarkdownFolderHint")}
                  disabled={!canImportMarkdown}
                  className="tool--md-import"
                  onClick={() => void handleImportMarkdown()}
                >
                  <span className="toolbar-md-import-icon" aria-hidden>
                    <span className="toolbar-md-import-icon__label">MD</span>
                  </span>
                </ToolBtn>
              </div>
            </div>

            <div className="toolbar-row toolbar-row-scroll">
              <div className="toolbar-group">
                <div className="toolbar-inline-anchor" ref={tableAnchorRef}>
                  <ToolBtn
                    title={t("toolbarTable")}
                    active={tablePickerOpen}
                    onClick={() => {
                      setEmojiOpen(false);
                      setFontMenuOpen(false);
                      setColorMenuOpen(false);
                      setColorDialogOpen(false);
                      setHighlightMenuOpen(false);
                      setHighlightDialogOpen(false);
                      setTableBgMenuOpen(false);
                      setTableBgDialogOpen(false);
                      setTablePickerOpen((v) => {
                        const next = !v;
                        if (next) setTablePickerHover({ r: 3, c: 3 });
                        return next;
                      });
                    }}
                  >
                    <TableIcon size={16} />
                  </ToolBtn>
                </div>
                <span className="toolbar-sep" aria-hidden />
                <ToolBtn title={t("toolbarTableAddColBefore")} onClick={() => chain()?.addColumnBefore().run()} disabled={!editor?.can().addColumnBefore()}>
                  <BetweenHorizontalStart size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableAddColAfter")} onClick={() => chain()?.addColumnAfter().run()} disabled={!editor?.can().addColumnAfter()}>
                  <BetweenHorizontalEnd size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableDelCol")} onClick={() => chain()?.deleteColumn().run()} disabled={!editor?.can().deleteColumn()}>
                  <Trash2 size={15} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableAddRowBefore")} onClick={() => chain()?.addRowBefore().run()} disabled={!editor?.can().addRowBefore()}>
                  <BetweenVerticalStart size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableAddRowAfter")} onClick={() => chain()?.addRowAfter().run()} disabled={!editor?.can().addRowAfter()}>
                  <BetweenVerticalEnd size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableDelRow")} onClick={() => chain()?.deleteRow().run()} disabled={!editor?.can().deleteRow()}>
                  <SquareMinus size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableMerge")} onClick={() => chain()?.mergeCells().run()} disabled={!tableUi?.canMerge}>
                  <TableCellsMerge size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableSplit")} onClick={() => chain()?.splitCell().run()} disabled={!tableUi?.canSplit}>
                  <TableCellsSplit size={16} />
                </ToolBtn>
                <span className="toolbar-sep" aria-hidden />
                <ToolBtn
                  title={t("toolbarTableCellAlignLeft")}
                  active={!!tableUi?.inTable && tableUi.cellAlign === "left"}
                  onClick={() => chain()?.setCellAttribute("align", "left").run()}
                  disabled={!tableUi?.inTable}
                >
                  <AlignLeft size={16} />
                </ToolBtn>
                <ToolBtn
                  title={t("toolbarTableCellAlignCenter")}
                  active={!!tableUi?.inTable && tableUi.cellAlign === "center"}
                  onClick={() => chain()?.setCellAttribute("align", "center").run()}
                  disabled={!tableUi?.inTable}
                >
                  <AlignCenter size={16} />
                </ToolBtn>
                <ToolBtn
                  title={t("toolbarTableCellAlignRight")}
                  active={!!tableUi?.inTable && tableUi.cellAlign === "right"}
                  onClick={() => chain()?.setCellAttribute("align", "right").run()}
                  disabled={!tableUi?.inTable}
                >
                  <AlignRight size={16} />
                </ToolBtn>
                <ToolBtn title={t("toolbarTableClearAlign")} onClick={() => chain()?.setCellAttribute("align", null).run()} disabled={!tableUi?.inTable}>
                  <RotateCcw size={16} />
                </ToolBtn>
                <span className="toolbar-sep" aria-hidden />
                <ToolBtn
                  title={t("toolbarTableCellValignTop")}
                  active={!!tableUi?.inTable && tableUi.cellVerticalAlign === "top"}
                  onClick={() => chain()?.setCellAttribute("verticalAlign", "top").run()}
                  disabled={!tableUi?.inTable}
                >
                  <AlignVerticalJustifyStart size={16} />
                </ToolBtn>
                <ToolBtn
                  title={t("toolbarTableCellValignMiddle")}
                  active={!!tableUi?.inTable && tableUi.cellVerticalAlign === "middle"}
                  onClick={() => chain()?.setCellAttribute("verticalAlign", "middle").run()}
                  disabled={!tableUi?.inTable}
                >
                  <AlignVerticalJustifyCenter size={16} />
                </ToolBtn>
                <ToolBtn
                  title={t("toolbarTableCellValignBottom")}
                  active={!!tableUi?.inTable && tableUi.cellVerticalAlign === "bottom"}
                  onClick={() => chain()?.setCellAttribute("verticalAlign", "bottom").run()}
                  disabled={!tableUi?.inTable}
                >
                  <AlignVerticalJustifyEnd size={16} />
                </ToolBtn>
                <ToolBtn
                  title={t("toolbarTableClearValign")}
                  onClick={() => chain()?.setCellAttribute("verticalAlign", null).run()}
                  disabled={!tableUi?.inTable}
                >
                  <RotateCcw size={16} />
                </ToolBtn>
                <span className="toolbar-sep" aria-hidden />
                <div ref={tableBgAnchorRef} className="toolbar-inline-anchor">
                  <div
                    className={[
                      "toolbar-font-color-split",
                      "toolbar-font-color-split--table-bg",
                      "tool",
                      tableBgMenuOpen || tableBgDialogOpen ? "active" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className="toolbar-font-color-split__apply"
                      title={t("toolbarTableBgApply")}
                      aria-label={t("toolbarTableBgApply")}
                      disabled={!tableUi?.inTable}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setTableBgDialogOpen(false);
                        setTableBgMenuOpen(false);
                        chain()?.setCellAttribute("backgroundColor", effectiveTableBgColor).run();
                      }}
                    >
                      <span className="toolbar-font-color-trigger__core">
                        <PaintBucket className="toolbar-font-color-trigger__marker-icon" size={15} strokeWidth={2} aria-hidden />
                        <span
                          className="toolbar-font-color-trigger__bar"
                          style={{ backgroundColor: effectiveTableBgColor }}
                          aria-hidden
                        />
                      </span>
                    </button>
                    <button
                      type="button"
                      className="toolbar-font-color-split__menu"
                      title={t("toolbarTableBgOpenPalette")}
                      aria-label={t("toolbarTableBgOpenPalette")}
                      aria-expanded={tableBgMenuOpen}
                      aria-haspopup="listbox"
                      disabled={!tableUi?.inTable}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setTableBgDialogOpen(false);
                        setEmojiOpen(false);
                        setFontMenuOpen(false);
                        setColorMenuOpen(false);
                        setColorDialogOpen(false);
                        setHighlightMenuOpen(false);
                        setHighlightDialogOpen(false);
                        setTableBgMenuOpen((open) => !open);
                      }}
                    >
                      <ChevronDown size={14} strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                </div>
                <span className="toolbar-sep" aria-hidden />
                <ToolBtn title={t("toolbarTableDelete")} onClick={() => chain()?.deleteTable().run()} disabled={!editor?.can().deleteTable()}>
                  <XCircle size={16} />
                </ToolBtn>
              </div>
            </div>
          </div>
          <div className="toolbar-actions">
            {isDeveloperBuild() ? (
              <button
                type="button"
                className="ghost tool--md-export"
                title={node.kind === "log" ? t("toolbarExportMarkdown") : t("exportMarkdownFolderHint")}
                disabled={!canExportMarkdown}
                onClick={() => void handleExportMarkdown()}
              >
                <span className="toolbar-md-export-icon" aria-hidden>
                  <span className="toolbar-md-export-icon__label">MD</span>
                  <span className="toolbar-md-export-icon__arrow">↓</span>
                </span>
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={onPreviewToggle}>
              {preview ? t("modeEdit") : t("modePreview")}
            </button>
            <button
              type="button"
              className="primary"
              title={t("saveTooltip")}
              disabled={saveBusy}
              onClick={() => void handleSave()}
            >
              <Save size={16} />
              {saveBusy ? t("saveInProgress") : t("save")}
            </button>
          </div>
        </div>
      </header>
      <section className="document-title">
        {preview ? (
          <span className="document-title-display document-title-display--readonly">{node.title}</span>
        ) : !titleEditing ? (
          <button type="button" className="document-title-display" onClick={() => setTitleEditing(true)}>
            {node.title}
          </button>
        ) : (
          <input
            className="document-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const next = titleDraft.trim() || node.title;
              setTitleEditing(false);
              if (next !== node.title) {
                onChange({ ...node, title: next, updatedAt: new Date().toISOString() });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setTitleDraft(node.title);
                setTitleEditing(false);
              }
            }}
            autoFocus
          />
        )}
      </section>
      <div className="editor-main" ref={editorMainRef}>
        {preview ? (
          <div className="rich-editor rich-editor--static-html">
            <div className="ProseMirror" dangerouslySetInnerHTML={{ __html: editor?.getHTML() ?? "" }} />
          </div>
        ) : (
          <div className="editor-rich-wrap">
            <EditorContent editor={editor} className="rich-editor" />
          </div>
        )}
        <footer className="document-status-foot" title={node.updatedAt}>
          <div className="document-status-foot__row">
            {activityBar}
            <span className="document-updated-foot__label">{t("documentLastEditedLabel")}</span>
            <time className="document-updated-foot__time" dateTime={node.updatedAt}>
              {formatDocumentUpdatedAt(node.updatedAt, i18n.language)}
            </time>
          </div>
        </footer>
      </div>
      </main>
      {emojiOpen && emojiPos
        ? createPortal(
            <div
              ref={emojiPopoverRef}
              className="toolbar-emoji-popover toolbar-emoji-popover--portal"
              style={{ top: emojiPos.top, left: emojiPos.left }}
              role="listbox"
            >
              {EMOJI_PRESETS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className="toolbar-emoji-cell"
                  onClick={() => {
                    chain()?.insertContent(em).run();
                    setEmojiOpen(false);
                  }}
                >
                  {em}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
      {tablePickerOpen && tablePickerPos
        ? createPortal(
            <div
              ref={tablePopoverRef}
              className="toolbar-table-popover toolbar-table-popover--portal"
              style={{ top: tablePickerPos.top, left: tablePickerPos.left }}
              role="dialog"
              aria-label={t("toolbarTable")}
              onMouseLeave={() => setTablePickerHover({ r: 3, c: 3 })}
            >
              <p className="toolbar-table-popover__hint">{t("toolbarTablePickerHint")}</p>
              <div className="toolbar-table-popover__size" aria-live="polite">
                {tablePickerHover.r > 0 && tablePickerHover.c > 0
                  ? `${tablePickerHover.r} × ${tablePickerHover.c}`
                  : t("toolbarTablePickerPlaceholder")}
              </div>
              <div
                className="toolbar-table-picker"
                role="grid"
                aria-rowcount={TABLE_PICKER_MAX}
                aria-colcount={TABLE_PICKER_MAX}
              >
                {Array.from({ length: TABLE_PICKER_MAX * TABLE_PICKER_MAX }, (_, i) => {
                  const r = Math.floor(i / TABLE_PICKER_MAX) + 1;
                  const c = (i % TABLE_PICKER_MAX) + 1;
                  const active = r <= tablePickerHover.r && c <= tablePickerHover.c;
                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      className={["toolbar-table-picker-cell", active ? "toolbar-table-picker-cell--active" : ""].filter(Boolean).join(" ")}
                      aria-label={`${r}×${c}`}
                      onMouseEnter={() => setTablePickerHover({ r, c })}
                      onClick={() => {
                        chain()?.insertTable({ rows: r, cols: c, withHeaderRow: true }).run();
                        setTablePickerOpen(false);
                      }}
                    />
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
      {fontMenuOpen && fontMenuPos
        ? createPortal(
            <div
              ref={fontMenuRef}
              className="toolbar-dropdown-popover toolbar-dropdown-popover--portal"
              style={{ top: fontMenuPos.top, left: fontMenuPos.left, width: FONT_MENU_W, maxHeight: FONT_MENU_H }}
              role="listbox"
              aria-label={t("toolbarFontFamily")}
            >
              {FONT_OPTIONS.map((opt) => {
                const current = styleAttrs?.fontFamily ?? "";
                const selected = opt.value === "" ? current === "" : opt.value === current;
                return (
                  <button
                    key={`${opt.labelKey}-${opt.value || "default"}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={["toolbar-dropdown-item", selected ? "toolbar-dropdown-item--active" : ""].filter(Boolean).join(" ")}
                    style={opt.value ? { fontFamily: opt.value } : undefined}
                    onClick={() => {
                      if (opt.value === "") chain()?.unsetFontFamily().run();
                      else chain()?.setFontFamily(opt.value).run();
                      setFontMenuOpen(false);
                    }}
                  >
                    {t(opt.labelKey)}
                  </button>
                );
              })}
              {styleAttrs?.fontFamily && !FONT_OPTIONS.some((o) => o.value === styleAttrs.fontFamily) ? (
                <button
                  key="font-custom-active"
                  type="button"
                  role="option"
                  aria-selected
                  className="toolbar-dropdown-item toolbar-dropdown-item--active"
                  style={{ fontFamily: styleAttrs.fontFamily }}
                  onClick={() => setFontMenuOpen(false)}
                >
                  {t("toolbarFontCustom")}
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
      {colorMenuOpen && colorMenuPos
        ? createPortal(
            <div
              ref={colorMenuRef}
              className="toolbar-color-palette-popover toolbar-dropdown-popover--portal"
              style={{ top: colorMenuPos.top, left: colorMenuPos.left, width: COLOR_MENU_W }}
              role="listbox"
              aria-label={t("toolbarTextColor")}
            >
              <div className="toolbar-color-palette-popover__row1" role="presentation">
                <button
                  type="button"
                  className={[
                    "toolbar-color-palette-swatch",
                    "toolbar-color-palette-swatch--reset",
                    textClearSelected ? "toolbar-color-palette-swatch--active" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ backgroundColor: DEFAULT_TEXT_COLOR }}
                  aria-label={t("toolbarColorClear")}
                  title={t("toolbarColorClear")}
                  onClick={() => {
                    chain()?.setColor(DEFAULT_TEXT_COLOR).run();
                    setColorMenuOpen(false);
                  }}
                />
                {TEXT_COLOR_PRESETS.map((presetHex) => {
                  const selected =
                    !!textColorNorm && textColorNorm === presetHex.toLowerCase() && !textClearSelected;
                  return (
                    <button
                      key={presetHex}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={presetHex}
                      className={["toolbar-color-palette-swatch", selected ? "toolbar-color-palette-swatch--active" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ backgroundColor: presetHex }}
                      onClick={() => {
                        chain()?.setColor(presetHex).run();
                        setColorMenuOpen(false);
                      }}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                className="toolbar-color-palette-popover__row2"
                onClick={() => {
                  setColorMenuOpen(false);
                  setColorDialogOpen(true);
                }}
              >
                <Pipette size={16} strokeWidth={2} className="toolbar-color-palette-popover__row2-icon" aria-hidden />
                <span>{t("toolbarTextColorCustom")}</span>
              </button>
            </div>,
            document.body
          )
        : null}
      {highlightMenuOpen && highlightMenuPos
        ? createPortal(
            <div
              ref={highlightMenuRef}
              className="toolbar-color-palette-popover toolbar-color-palette-popover--highlight toolbar-dropdown-popover--portal"
              style={{ top: highlightMenuPos.top, left: highlightMenuPos.left, width: HIGHLIGHT_MENU_W }}
              role="listbox"
              aria-label={t("toolbarHighlight")}
            >
              <div className="toolbar-color-palette-popover__row1" role="presentation">
                <button
                  type="button"
                  className={[
                    "toolbar-color-palette-swatch",
                    "toolbar-color-palette-swatch--reset",
                    hlClearSelected ? "toolbar-color-palette-swatch--active" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ backgroundColor: DEFAULT_HIGHLIGHT_COLOR }}
                  aria-label={t("toolbarHighlightColorClear")}
                  title={t("toolbarHighlightColorClear")}
                  onClick={() => {
                    chain()?.setHighlight({ color: DEFAULT_HIGHLIGHT_COLOR }).run();
                    setHighlightMenuOpen(false);
                  }}
                />
                {HIGHLIGHT_PRESETS.map((presetHex) => {
                  const selected = hlOn && hlColorNorm === presetHex.toLowerCase() && !hlClearSelected;
                  return (
                    <button
                      key={presetHex}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={presetHex}
                      className={["toolbar-color-palette-swatch", selected ? "toolbar-color-palette-swatch--active" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ backgroundColor: presetHex }}
                      onClick={() => {
                        chain()?.setHighlight({ color: presetHex }).run();
                        setHighlightMenuOpen(false);
                      }}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                className="toolbar-color-palette-popover__row2"
                onClick={() => {
                  setHighlightMenuOpen(false);
                  setHighlightDialogOpen(true);
                }}
              >
                <Pipette size={16} strokeWidth={2} className="toolbar-color-palette-popover__row2-icon" aria-hidden />
                <span>{t("toolbarHighlightColorCustom")}</span>
              </button>
            </div>,
            document.body
          )
        : null}
      {tableBgMenuOpen && tableBgMenuPos
        ? createPortal(
            <div
              ref={tableBgMenuRef}
              className="toolbar-color-palette-popover toolbar-color-palette-popover--table-bg toolbar-dropdown-popover--portal"
              style={{ top: tableBgMenuPos.top, left: tableBgMenuPos.left, width: TABLE_BG_MENU_W }}
              role="listbox"
              aria-label={t("toolbarTableBg")}
            >
              <div className="toolbar-color-palette-popover__row1" role="presentation">
                <button
                  type="button"
                  className={[
                    "toolbar-color-palette-swatch",
                    "toolbar-color-palette-swatch--reset",
                    tableBgClearSelected ? "toolbar-color-palette-swatch--active" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ backgroundColor: DEFAULT_TABLE_BG_COLOR }}
                  aria-label={t("toolbarTableBgClear")}
                  title={t("toolbarTableBgClear")}
                  onClick={() => {
                    chain()?.setCellAttribute("backgroundColor", null).run();
                    setTableBgMenuOpen(false);
                  }}
                />
                {TABLE_BG_PRESETS.map((presetHex) => {
                  const selected =
                    !!tableBgColorNorm && tableBgColorNorm === presetHex.toLowerCase() && !tableBgClearSelected;
                  return (
                    <button
                      key={presetHex}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      title={presetHex}
                      className={["toolbar-color-palette-swatch", selected ? "toolbar-color-palette-swatch--active" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ backgroundColor: presetHex }}
                      onClick={() => {
                        chain()?.setCellAttribute("backgroundColor", presetHex).run();
                        setTableBgMenuOpen(false);
                      }}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                className="toolbar-color-palette-popover__row2"
                onClick={() => {
                  setTableBgMenuOpen(false);
                  setTableBgDialogOpen(true);
                }}
              >
                <Pipette size={16} strokeWidth={2} className="toolbar-color-palette-popover__row2-icon" aria-hidden />
                <span>{t("toolbarTableBgCustom")}</span>
              </button>
            </div>,
            document.body
          )
        : null}
      <TextColorDialog
        open={tableBgDialogOpen}
        initialHex={
          tableUi?.cellBackgroundColor && isHexColor(tableUi.cellBackgroundColor)
            ? tableUi.cellBackgroundColor
            : DEFAULT_TABLE_BG_COLOR
        }
        titleKey="dialogTableBgColorTitle"
        headerId="table-bg-color-dialog-title"
        onClose={() => setTableBgDialogOpen(false)}
        onConfirm={(hex) => {
          chain()?.setCellAttribute("backgroundColor", hex).run();
        }}
      />
      <TextColorDialog
        open={colorDialogOpen}
        initialHex={styleAttrs?.color && isHexColor(styleAttrs.color) ? styleAttrs.color : DEFAULT_TEXT_COLOR}
        onClose={() => setColorDialogOpen(false)}
        onConfirm={(hex) => {
          chain()?.setColor(hex).run();
        }}
      />
      <TextColorDialog
        open={highlightDialogOpen}
        initialHex={
          highlightAttrs?.color && isHexColor(highlightAttrs.color) ? highlightAttrs.color : DEFAULT_HIGHLIGHT_COLOR
        }
        titleKey="dialogHighlightColorTitle"
        headerId="highlight-color-dialog-title"
        variant="highlight"
        onClose={() => setHighlightDialogOpen(false)}
        onConfirm={(hex) => {
          chain()?.setHighlight({ color: hex }).run();
        }}
      />
      <LinkInsertDialog
        open={linkOpen}
        mode={linkDialogMode}
        initialHref={linkInitialHref}
        onClose={() => setLinkOpen(false)}
        onConfirm={({ href, linkText }) => {
          if (!editor) return;
          if (linkDialogMode === "urlOnly") {
            if (editor.isActive("link")) editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            else editor.chain().focus().setLink({ href }).run();
          } else {
            const text = (linkText || "").trim() || href;
            editor.chain().focus().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).run();
          }
          setLinkOpen(false);
        }}
      />
      <MediaInsertDialog
        kind={mediaKind === "video" ? "video" : "image"}
        open={mediaKind !== null}
        onClose={() => setMediaKind(null)}
        onConfirm={(src, cap, k) => {
          if (k === "image") chain()?.insertContent({ type: "image", attrs: { src, caption: cap, alt: "" } }).run();
          else {
            const { embedSrc } = resolveVideoEmbed(src);
            chain()
              ?.insertContent({
                type: "video",
                attrs: { src, embedSrc: embedSrc ?? null, caption: cap }
              })
              .run();
          }
          setMediaKind(null);
        }}
      />
      <MathInsertDialog
        open={mathDialog.open}
        initialKind={mathDialog.initialKind}
        initialLatex={mathDialog.initialLatex}
        isEdit={mathDialog.editPos !== null}
        onClose={() => setMathDialog((d) => ({ ...d, open: false }))}
        onSubmit={(latex, kind) => {
          if (!editor) return;
          const { editPos, initialKind } = mathDialog;
          if (editPos !== null) {
            if (initialKind === "inline") {
              editor.chain().focus().updateInlineMath({ latex, pos: editPos }).run();
            } else {
              editor.chain().focus().updateBlockMath({ latex, pos: editPos }).run();
            }
          } else {
            if (kind === "inline") editor.chain().focus().insertInlineMath({ latex }).run();
            else editor.chain().focus().insertBlockMath({ latex }).run();
            lastInsertKindRef.current = kind;
          }
          setMathDialog((d) => ({ ...d, open: false }));
        }}
      />
      <MediaLightbox
        open={lightbox !== null}
        items={lightbox?.items ?? []}
        index={lightbox?.index ?? 0}
        shortcuts={shortcuts}
        onClose={() => setLightbox(null)}
        onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : null))}
      />
    </>
  );
}
