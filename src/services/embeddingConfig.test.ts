import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

const mockT = ((k: string) => k) as TFunction;
import { commitEmbeddingConfigChange, embeddingConfigEqual, isEmbeddingConfigComplete } from "./embeddingConfig";

vi.mock("./modelTest", () => ({
  testEmbeddingConfig: vi.fn().mockResolvedValue("1536")
}));

describe("embeddingConfig", () => {
  it("detects complete config", () => {
    expect(isEmbeddingConfigComplete({ baseUrl: "https://x", apiKey: "k", model: "m" })).toBe(true);
    expect(isEmbeddingConfigComplete({ baseUrl: "", apiKey: "k", model: "m" })).toBe(false);
  });

  it("skips unchanged commit", async () => {
    const cfg = { baseUrl: "https://x", apiKey: "k", model: "m" };
    const result = await commitEmbeddingConfigChange({
      previous: cfg,
      next: { ...cfg },
      confirm: vi.fn(),
      t: mockT
    });
    expect(result).toEqual({ applied: false, reason: "unchanged" });
  });

  it("requires confirm when model name changes with prior full config", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const prev = { baseUrl: "https://x", apiKey: "k", model: "old" };
    const next = { baseUrl: "https://x", apiKey: "k", model: "new" };
    const result = await commitEmbeddingConfigChange({
      previous: prev,
      next,
      confirm,
      t: mockT
    });
    expect(confirm).toHaveBeenCalled();
    expect(result).toEqual({ applied: false, reason: "cancelled" });
  });

  it("applies url change without rebuild flag when model unchanged", async () => {
    const prev = { baseUrl: "https://a", apiKey: "k", model: "m" };
    const next = { baseUrl: "https://b", apiKey: "k", model: "m" };
    const result = await commitEmbeddingConfigChange({
      previous: prev,
      next,
      confirm: vi.fn(),
      t: mockT
    });
    expect(result).toEqual({ applied: true, needsVectorRebuild: false });
  });

  it("flags vector rebuild after confirmed model change", async () => {
    const prev = { baseUrl: "https://x", apiKey: "k", model: "old" };
    const next = { baseUrl: "https://x", apiKey: "k", model: "new" };
    const result = await commitEmbeddingConfigChange({
      previous: prev,
      next,
      confirm: vi.fn().mockResolvedValue(true),
      t: mockT
    });
    expect(result).toEqual({ applied: true, needsVectorRebuild: true });
  });

  it("equal ignores surrounding whitespace", () => {
    expect(
      embeddingConfigEqual(
        { baseUrl: " https://x ", apiKey: "k", model: "m" },
        { baseUrl: "https://x", apiKey: "k", model: "m" }
      )
    ).toBe(true);
  });
});
