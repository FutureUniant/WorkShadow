import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LogNode } from "../types";

export const LOG_NODE_UPDATED_EVENT = "workshadow:log-node-updated";

export interface LogNodeUpdatedPayload {
  node: LogNode;
  source: string;
}

export async function emitLogNodeUpdated(node: LogNode) {
  const source = getCurrentWindow().label;
  await emit(LOG_NODE_UPDATED_EVENT, { node, source } satisfies LogNodeUpdatedPayload);
}

export async function listenLogNodeUpdated(onNode: (node: LogNode) => void) {
  const selfLabel = getCurrentWindow().label;
  return listen<LogNodeUpdatedPayload>(LOG_NODE_UPDATED_EVENT, (event) => {
    if (event.payload.source === selfLabel) return;
    onNode(event.payload.node);
  });
}
