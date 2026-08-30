const { validateMangaAiHealth } = require("./mangaAiHealth");

describe("Manga AI sidecar health contract", () => {
  it("accepts Contract v1 sidecars with Region OCR", () => {
    expect(
      validateMangaAiHealth({
        contractVersion: "1",
        capabilities: ["ocrRegion", "analyzePage", "cancelRequest"],
      })
    ).toEqual({ ok: true });
  });

  it("rejects an incompatible contract version", () => {
    expect(
      validateMangaAiHealth({ contractVersion: "2", capabilities: ["ocrRegion"] })
    ).toEqual({
      ok: false,
      errorCode: "sidecar_contract_mismatch",
      error: "Manga AI sidecar does not support Contract v1",
    });
  });

  it("rejects a sidecar without Region OCR", () => {
    expect(
      validateMangaAiHealth({ contractVersion: "1", capabilities: ["analyzePage"] })
    ).toEqual({
      ok: false,
      errorCode: "sidecar_capability_missing",
      error: "Manga AI sidecar does not provide Region OCR",
    });
  });
});
