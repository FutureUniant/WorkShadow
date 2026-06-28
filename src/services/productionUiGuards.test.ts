import { describe, expect, it, vi } from "vitest";
import { shouldBlockContextMenu, shouldBlockDevToolsShortcut } from "./productionUiGuards";

function keyEvent(init: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  return init as KeyboardEvent;
}

describe("shouldBlockDevToolsShortcut", () => {
  it("blocks F12 in production mode", () => {
    vi.stubEnv("DEV", false);
    expect(shouldBlockDevToolsShortcut(keyEvent({ key: "F12" }))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("does not block F12 in dev mode", () => {
    vi.stubEnv("DEV", true);
    expect(shouldBlockDevToolsShortcut(keyEvent({ key: "F12" }))).toBe(false);
    vi.unstubAllEnvs();
  });

  it("blocks Ctrl+Shift+I in production mode", () => {
    vi.stubEnv("DEV", false);
    expect(shouldBlockDevToolsShortcut(keyEvent({ key: "I", ctrlKey: true, shiftKey: true }))).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("shouldBlockContextMenu", () => {
  function ctxEvent(target: { closest: (selector: string) => Element | null }): MouseEvent {
    return { target } as unknown as MouseEvent;
  }

  it("blocks empty-area menu in production mode", () => {
    vi.stubEnv("DEV", false);
    expect(shouldBlockContextMenu(ctxEvent({ closest: () => null }))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("blocks text context targets so custom menu replaces native menu", () => {
    vi.stubEnv("DEV", false);
    const target = {
      closest: (selector: string) => {
        if (selector.includes("data-no-text-context-menu")) return null;
        if (selector.includes("contenteditable")) return target as unknown as Element;
        return null;
      }
    };
    Object.defineProperty(target, "isContentEditable", { value: true });
    expect(shouldBlockContextMenu(ctxEvent(target as { closest: (selector: string) => Element | null }))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("does not block in dev mode", () => {
    vi.stubEnv("DEV", true);
    expect(shouldBlockContextMenu(ctxEvent({ closest: () => null }))).toBe(false);
    vi.unstubAllEnvs();
  });
});
