import { readSystemClipboardText, writeSystemClipboardText } from "./systemClipboard";

export type TextEditCommand = "copy" | "copyPlainText" | "cut" | "paste" | "selectAll";

function isInputElement(el: HTMLElement): el is HTMLInputElement {
  return el.tagName === "INPUT";
}

function isTextAreaElement(el: HTMLElement): el is HTMLTextAreaElement {
  return el.tagName === "TEXTAREA";
}

function isTextField(el: HTMLElement | null | undefined): el is HTMLInputElement | HTMLTextAreaElement {
  return Boolean(el && (isInputElement(el) || isTextAreaElement(el)));
}

export function findEditableTarget(from: HTMLElement): HTMLElement | null {
  if (isInputElement(from)) {
    const type = (from.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox" || type === "radio" || type === "button" || type === "submit" || type === "file") {
      return null;
    }
    return from;
  }
  if (isTextAreaElement(from)) return from;
  return from.closest("[contenteditable='true']") as HTMLElement | null;
}

export function isEditableReadOnly(el: HTMLElement): boolean {
  if (isTextField(el)) {
    return el.readOnly || el.disabled;
  }
  return false;
}

export function hasTextSelection(editable?: HTMLElement | null): boolean {
  if (editable && isTextField(editable)) {
    const start = editable.selectionStart ?? 0;
    const end = editable.selectionEnd ?? 0;
    return start !== end;
  }
  if (typeof window === "undefined") return false;
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().length > 0);
}

export function hasSelectableContent(editable?: HTMLElement | null, from?: HTMLElement): boolean {
  if (editable && isTextField(editable)) {
    return editable.value.length > 0;
  }
  if (editable?.isContentEditable) {
    return (editable.textContent ?? "").length > 0;
  }
  if (from) {
    const container = findTextContainer(from);
    if (container) return (container.textContent ?? "").length > 0;
  }
  return hasTextSelection();
}

export function shouldOfferTextContextMenu(target: HTMLElement): boolean {
  if (
    target.closest(
      "[data-no-text-context-menu], .desktop-titlebar, .menu-popover, [data-tree-menu-popover], .text-context-menu"
    )
  ) {
    return false;
  }
  const editable = findEditableTarget(target);
  if (editable) return true;
  return hasTextSelection();
}

function findTextContainer(from: HTMLElement): HTMLElement | null {
  return from.closest(
    ".ProseMirror, .workspace-markdown-out, .workspace-ask__excerpt-text, pre, textarea, input"
  ) as HTMLElement | null;
}

function focusTarget(editable: HTMLElement | null, from: HTMLElement) {
  const el = editable ?? findEditableTarget(from);
  if (el) el.focus({ preventScroll: true });
}

async function copyPlainTextViaClipboard(): Promise<boolean> {
  const text = window.getSelection()?.toString() ?? "";
  if (!text) return false;
  if (await writeSystemClipboardText(text)) return true;
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

async function copyViaClipboard(): Promise<boolean> {
  return copyPlainTextViaClipboard();
}

function insertPlainTextAtTarget(target: HTMLElement, text: string): boolean {
  if (!text) return false;
  if (isTextField(target)) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + text + target.value.slice(end);
    target.value = next;
    const caret = start + text.length;
    target.selectionStart = caret;
    target.selectionEnd = caret;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (target.isContentEditable) {
    return document.execCommand("insertText", false, text);
  }
  return false;
}

async function pasteViaSystemClipboard(target: HTMLElement): Promise<boolean> {
  const text = await readSystemClipboardText();
  if (text) return insertPlainTextAtTarget(target, text);
  return false;
}

function selectAllInContainer(from: HTMLElement) {
  const container = findTextContainer(from);
  if (!container) return;
  const range = document.createRange();
  range.selectNodeContents(container);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

export async function runTextEditCommand(
  command: TextEditCommand,
  editable: HTMLElement | null,
  from: HTMLElement
): Promise<void> {
  focusTarget(editable, from);

  if (command === "selectAll") {
    if (editable && isTextField(editable)) {
      editable.select();
      return;
    }
    if (editable?.isContentEditable) {
      document.execCommand("selectAll");
      return;
    }
    selectAllInContainer(from);
    return;
  }

  const target = editable ?? findEditableTarget(from);
  if (!target && (command === "copy" || command === "copyPlainText")) {
    if (command === "copyPlainText") {
      await copyPlainTextViaClipboard();
    } else if (!document.execCommand("copy")) {
      await copyViaClipboard();
    }
    return;
  }
  if (!target && command !== "copy" && command !== "copyPlainText") return;

  if (command === "copyPlainText") {
    await copyPlainTextViaClipboard();
    return;
  }

  if (command === "copy") {
    if (!document.execCommand("copy")) await copyViaClipboard();
    return;
  }

  if (command === "cut") {
    if (!document.execCommand("cut")) {
      const text = window.getSelection()?.toString() ?? "";
      if (text && (await copyViaClipboard())) {
        if (target && isTextField(target)) {
          const start = target.selectionStart ?? 0;
          const end = target.selectionEnd ?? 0;
          target.value = target.value.slice(0, start) + target.value.slice(end);
          target.selectionStart = start;
          target.selectionEnd = start;
          target.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (target?.isContentEditable) {
          document.execCommand("delete");
        }
      }
    }
    return;
  }

  if (command === "paste") {
    if (!target) return;
    if (document.execCommand("paste")) return;
    await pasteViaSystemClipboard(target);
  }
}

export function getTextEditMenuState(editable: HTMLElement | null, from: HTMLElement) {
  const readOnly = editable ? isEditableReadOnly(editable) : true;
  const hasSelection = hasTextSelection(editable);
  const hasContent = hasSelectableContent(editable, from);
  const isEditable = Boolean(editable);

  return {
    canCopy: hasSelection,
    canCopyPlainText: hasSelection,
    canCut: isEditable && !readOnly && hasSelection,
    canPaste: isEditable && !readOnly,
    canSelectAll: hasContent
  };
}
