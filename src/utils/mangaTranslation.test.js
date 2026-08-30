jest.mock("./request/common", () => ({ aiRequest: jest.fn() }));
jest.mock("../assets/lib/kookit-extra-browser.min", () => ({
  CommonTool: {
    getDisableThinkingParams: jest.fn(() => ({})),
  },
  ConfigService: {
    getReaderConfig: jest.fn(),
    getObjectConfig: jest.fn(),
  },
  KookitConfig: {
    DefaultPrompts: {
      aiTranslate: "Translate {text} from {from} to {to}.",
    },
  },
}));

const {
  clearMangaTranslationCache,
  translateMangaText,
  translateMangaRegions,
} = require("./mangaTranslation");
const { aiRequest } = require("./request/common");
const {
  ConfigService,
} = require("../assets/lib/kookit-extra-browser.min");

const regions = [
  {
    id: "region-a",
    bbox: { x: 0, y: 0, width: 10, height: 10, space: "image-pixel" },
    sourceText: "こんにちは",
  },
  {
    id: "region-b",
    bbox: { x: 20, y: 0, width: 10, height: 10, space: "image-pixel" },
    sourceText: "さようなら",
  },
];

describe("translateMangaRegions", () => {
  beforeEach(() => {
    clearMangaTranslationCache();
    aiRequest.mockReset();
    jest.spyOn(ConfigService, "getReaderConfig").mockImplementation((key) => {
      const values = {
        aiTranslateModel: "model-key",
        mangaTranslateModel: "",
        transSource: "Japanese",
        transTarget: "Chinese",
        aiTranslatePrompt: "Translate {text} from {from} to {to}.",
      };
      return values[key] || "";
    });
    jest.spyOn(ConfigService, "getObjectConfig").mockReturnValue({
      config: {
        endpoint: "https://provider.example/v1/",
        modelId: "test-model",
        apiKey: "test-key",
        providerId: "custom",
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns an empty page without requiring a configured model", async () => {
    await expect(translateMangaRegions([])).resolves.toEqual([]);
    expect(aiRequest).not.toHaveBeenCalled();
  });

  it("uses the existing OpenAI-compatible model and parses batch JSON", async () => {
    aiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: "```json\n{\"region-a\":\"你好\",\"region-b\":\"再见\"}\n```",
            },
          },
        ],
      }),
    });

    const translated = await translateMangaRegions(regions);

    expect(aiRequest).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      "POST",
      expect.objectContaining({ Authorization: "Bearer test-key" }),
      expect.stringContaining('"model":"test-model"')
    );
    expect(translated.map((region) => region.translatedText)).toEqual([
      "你好",
      "再见",
    ]);
  });

  it("uses the optional Manga model override without duplicating provider config", async () => {
    jest.spyOn(ConfigService, "getReaderConfig").mockImplementation((key) => {
      const values = {
        aiTranslateModel: "text-model-key",
        mangaTranslateModel: "manga-model-key",
        transSource: "Japanese",
        transTarget: "Chinese",
        aiTranslatePrompt: "Translate {text} from {from} to {to}.",
      };
      return values[key] || "";
    });
    jest.spyOn(ConfigService, "getObjectConfig").mockImplementation((key) => ({
      config:
        key === "manga-model-key"
          ? {
              endpoint: "https://manga-provider.example/v1",
              modelId: "manga-model",
              apiKey: "manga-key",
              providerId: "custom",
            }
          : {
              endpoint: "https://text-provider.example/v1",
              modelId: "text-model",
              apiKey: "text-key",
              providerId: "custom",
            },
    }));
    aiRequest.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      body: JSON.stringify({
        choices: [{ message: { content: "漫画译文" } }],
      }),
    });

    await expect(translateMangaText("こんにちは")).resolves.toBe("漫画译文");
    expect(aiRequest).toHaveBeenCalledWith(
      "https://manga-provider.example/v1/chat/completions",
      "POST",
      expect.objectContaining({ Authorization: "Bearer manga-key" }),
      expect.stringContaining('"model":"manga-model"')
    );
  });

  it("falls back to independent requests when the provider ignores batch JSON", async () => {
    aiRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        body: JSON.stringify({ choices: [{ message: { content: "not JSON" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        body: JSON.stringify({ choices: [{ message: { content: "你好" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        body: JSON.stringify({ choices: [{ message: { content: "再见" } }] }),
      });

    const translated = await translateMangaRegions(regions);

    expect(aiRequest).toHaveBeenCalledTimes(3);
    expect(translated.map((region) => region.translatedText)).toEqual([
      "你好",
      "再见",
    ]);
  });
});
