import type { Content, Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";

/** 载入外部内容后清空 undo/redo，避免 Ctrl+Z 退到其它日志或初始空文档 */
export function resetEditorUndoHistory(editor: Editor) {
  const { state } = editor.view;
  editor.view.updateState(
    EditorState.create({
      doc: state.doc,
      schema: state.schema,
      plugins: state.plugins,
      selection: state.selection
    })
  );
}

export interface LoadEditorDocumentOptions {
  emitUpdate?: boolean;
  contentType?: "markdown" | "html" | "json";
}

/**
 * 载入持久化/外部内容：不写入 undo 栈，并清空已有 undo/redo。
 * 已关闭程序再打开的日志只能在本会话内撤销编辑，不能 undo 到加载前的空文档。
 */
export function loadEditorDocument(editor: Editor, content: Content | string, options?: LoadEditorDocumentOptions) {
  const emitUpdate = options?.emitUpdate ?? false;
  const setContentOptions: Record<string, unknown> = { emitUpdate };
  if (options?.contentType) setContentOptions.contentType = options.contentType;

  editor
    .chain()
    .setMeta("addToHistory", false)
    .setContent(content, setContentOptions as Parameters<Editor["commands"]["setContent"]>[1])
    .run();

  resetEditorUndoHistory(editor);
}
