import { describe, expect, it, vi } from "vitest";
import { testEmbeddingConfig } from "./modelTest";

describe("testEmbeddingConfig", () => {
  it("uses the passed draft config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(8).fill(0) }] })
    });
    vi.stubGlobal("fetch", fetchMock);

    const draft = {
      provider: "openaiCompatible" as const,
      baseUrl: "https://draft.example/v1",
      apiKey: "draft-key",
      model: "embed-model"
    };

    const dim = await testEmbeddingConfig(draft);

    expect(dim).toBe("8");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://draft.example/v1/embeddings",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer draft-key"
        }),
        body: JSON.stringify({
          model: "embed-model",
          input: ["Connectivity test"]
        })
      })
    );
  });
});
