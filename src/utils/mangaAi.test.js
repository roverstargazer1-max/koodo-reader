const {
  analyzeMangaPage,
  cancelMangaAiRequest,
  getMangaAiStatusMessage,
  ocrMangaRegion,
} = require("./mangaAi");

const invoke = jest.fn();

describe("Manga AI renderer client", () => {
  beforeEach(() => {
    invoke.mockReset();
    window.electronAPI = { invoke };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  it("preserves an explicit OCR request id for later cancellation", async () => {
    invoke.mockResolvedValue({
      contractVersion: "1",
      requestId: "ocr-request",
      sourceText: "text",
      engine: "manga-ocr",
      imageSize: [20, 10],
      crop: { x: 0, y: 0, width: 20, height: 10, coordinateSpace: "image-pixel" },
    });

    await ocrMangaRegion(
      {
        imageDataUrl: "data:image/png;base64,AA==",
        crop: { x: 0, y: 0, width: 20, height: 10, coordinateSpace: "image-pixel" },
        transferCrop: { x: 0, y: 0, width: 20, height: 10, coordinateSpace: "image-pixel" },
        imageSize: { width: 20, height: 10 },
        viewportRect: { left: 0, top: 0, width: 20, height: 10 },
      },
      "Japanese",
      "ocr-request"
    );

    expect(invoke).toHaveBeenCalledWith(
      "manga-ai-ocr-region",
      expect.objectContaining({ requestId: "ocr-request" })
    );
  });

  it("uses the caller request id for page analysis and invokes cancellation", async () => {
    invoke
      .mockResolvedValueOnce({
        contractVersion: "1",
        requestId: "page-request",
        pageId: "page-1",
        imageSize: { width: 20, height: 10 },
        regions: [],
        detector: "manga-translator",
        ocrEngine: "manga-ocr",
      })
      .mockResolvedValueOnce({ requestId: "page-request", cancelled: true });

    await analyzeMangaPage(
      {
        imageDataUrl: "data:image/png;base64,AA==",
        imageSize: { width: 20, height: 10 },
        renderedImage: document.createElement("img"),
        viewportRect: { left: 0, top: 0, width: 20, height: 10 },
      },
      { pageId: "page-1", requestId: "page-request" }
    );
    await expect(cancelMangaAiRequest("page-request")).resolves.toBe(true);

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "manga-ai-analyze-page",
      expect.objectContaining({ requestId: "page-request" })
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "manga-ai-cancel-request",
      { requestId: "page-request" }
    );
  });

  it("renders runtime diagnostics without exposing sidecar internals", () => {
    expect(
      getMangaAiStatusMessage({
        running: false,
        port: null,
        runtime: "project-venv",
        error: null,
      })
    ).toBe("Project Manga AI runtime detected");
    expect(
      getMangaAiStatusMessage({
        running: false,
        port: null,
        runtime: null,
        error: "Manga AI executable was not found",
        errorCode: "sidecar_runtime_missing",
      })
    ).toBe("Manga AI runtime is missing. Run the setup script and retry.");
    expect(
      getMangaAiStatusMessage({
        running: false,
        port: null,
        runtime: "packaged-executable",
        error: "Manga AI sidecar does not support Contract v1",
        errorCode: "sidecar_contract_mismatch",
      })
    ).toBe("Manga AI runtime is incompatible with this Koodo build. Update Koodo and Manga AI together.");
  });
});
