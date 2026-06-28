import {
  extractChatCompletionDeltaFromSseLine,
  extractChatCompletionErrorFromSseLine
} from "./chatCompletionParse";

export async function readChatCompletionStream(
  response: Response,
  onDelta: (delta: string) => void
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("LLM stream response has no body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const error = extractChatCompletionErrorFromSseLine(line);
      if (error) throw new Error(error);
      const delta = extractChatCompletionDeltaFromSseLine(line);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }
  if (buffer.trim()) {
    const error = extractChatCompletionErrorFromSseLine(buffer);
    if (error) throw new Error(error);
    const delta = extractChatCompletionDeltaFromSseLine(buffer);
    if (delta) {
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}
