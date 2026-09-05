import { BookTranslator } from "../bookTranslator";
import { TranslationTaskConfig } from "../../types";
import { TaskStorage, InMemoryTaskStorage } from "../taskStorage";
import {
  TextEncoder as NodeTextEncoder,
  TextDecoder as NodeTextDecoder,
} from "util";

const SafeTextEncoder =
  typeof TextEncoder !== "undefined" ? TextEncoder : NodeTextEncoder;
const SafeTextDecoder =
  typeof TextDecoder !== "undefined" ? TextDecoder : NodeTextDecoder;

describe("BookTranslator Scheduler & State Machine", () => {
  let sampleConfig: TranslationTaskConfig;
  let sampleTxt: string;
  let mockStorage: InMemoryTaskStorage;

  beforeEach(() => {
    mockStorage = new InMemoryTaskStorage();
    sampleConfig = {
      bookKey: "test_book_1",
      originalTitle: "Adventures of Alice",
      targetTitle: "爱丽丝历险记",
      format: "txt",
      sourceLanguage: "en",
      targetLanguage: "zh",
      layoutMode: "pure",
      systemPrompt: "You are a professional literary translator.",
      modelConfig: {
        key: "test_model",
        displayName: "Test AI",
        modelId: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1",
        apiKey: "test-key",
        providerId: "openai",
      },
    };

    sampleTxt = `Chapter 1: The Rabbit Hole
Alice was beginning to get very tired of sitting by her sister on the bank.
Suddenly a White Rabbit with pink eyes ran close by her.

Chapter 2: The Pool of Tears
Curiouser and curiouser cried Alice.
She was now opening out like the largest telescope that ever was.`;
  });

  it("translates book serial chunk-by-chunk and emits progress", async () => {
    const progressUpdates: number[] = [];

    // Mock LLM responding with XML chunks
    const mockLlm = jest.fn().mockImplementation(async (prompt: string) => {
      // Return matching <p id="X">
      const matches = Array.from(prompt.matchAll(/<p id="(\d+)">([^<]+)<\/p>/g));
      if (matches.length > 0) {
        const pTags = matches
          .map((m) => `<p id="${m[1]}">[中文译: ${m[2]}]</p>`)
          .join("\n");
        return `<chunk>\n${pTags}\n</chunk>`;
      }
      return "Summary / terms mock";
    });

    const translator = new BookTranslator({
      config: sampleConfig,
      sourceBuffer: new SafeTextEncoder().encode(sampleTxt).buffer as ArrayBuffer,
      storage: mockStorage,
      llmCaller: mockLlm,
      retryDelays: [1, 2, 4], // Fast for tests
    });

    translator.onProgress((p) => {
      progressUpdates.push(p.percentage);
    });

    const resultBuffer = await translator.start();

    expect(resultBuffer).toBeDefined();
    expect(resultBuffer.byteLength).toBeGreaterThan(0);
    expect(translator.getStatus()).toBe("completed");
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[progressUpdates.length - 1]).toBe(100);

    const resultText = new SafeTextDecoder("utf-8").decode(resultBuffer);
    expect(resultText).toContain("[中文译:");
  });

  it("retries with exponential backoff on HTTP 429/503 and pauses on retry exhaustion", async () => {
    let callCount = 0;
    const mockFailingLlm = jest.fn().mockImplementation(async (prompt: string) => {
      callCount++;
      const error: any = new Error("Rate limit exceeded");
      error.status = 429;
      throw error;
    });

    const translator = new BookTranslator({
      config: sampleConfig,
      sourceBuffer: new SafeTextEncoder().encode(sampleTxt).buffer as ArrayBuffer,
      storage: mockStorage,
      llmCaller: mockFailingLlm,
      retryDelays: [1, 2, 4], // ms
    });

    await expect(translator.start()).rejects.toThrow("Rate limit exceeded");

    // 1 initial call + 3 retries = 4 attempts total
    expect(callCount).toBe(4);
    expect(translator.getStatus()).toBe("paused_error");

    // Check that state was safely persisted into storage
    const saved = await mockStorage.getTask(sampleConfig.bookKey);
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe("paused_error");
  });

  it("supports pausing and resuming without duplicate chunk translations", async () => {
    let callCount = 0;
    const mockLlm = jest.fn().mockImplementation(async (prompt: string) => {
      callCount++;
      const matches = Array.from(prompt.matchAll(/<p id="(\d+)">([^<]+)<\/p>/g));
      const pTags = matches
        .map((m) => `<p id="${m[1]}">[译文_${callCount}: ${m[2]}]</p>`)
        .join("\n");
      return `<chunk>\n${pTags}\n</chunk>`;
    });

    const translator = new BookTranslator({
      config: sampleConfig,
      sourceBuffer: new SafeTextEncoder().encode(sampleTxt).buffer as ArrayBuffer,
      storage: mockStorage,
      llmCaller: mockLlm,
      retryDelays: [1, 2, 4],
    });

    // Pause after first chunk
    let paused = false;
    translator.onProgress((p) => {
      if (!paused && p.completedChunks >= 1) {
        paused = true;
        translator.pause();
      }
    });

    try {
      await translator.start();
    } catch {
      // Expected pause
    }

    expect(translator.getStatus()).toBe("paused");
    const callsBeforeResume = callCount;
    expect(callsBeforeResume).toBeGreaterThanOrEqual(1);

    // Now resume translator from saved storage
    const resumedTranslator = new BookTranslator({
      config: sampleConfig,
      sourceBuffer: new SafeTextEncoder().encode(sampleTxt).buffer as ArrayBuffer,
      storage: mockStorage,
      llmCaller: mockLlm,
      retryDelays: [1, 2, 4],
    });

    const finalBuffer = await resumedTranslator.resume();
    expect(resumedTranslator.getStatus()).toBe("completed");

    // Resumed translator must have made further calls to finish the remaining chunks
    expect(callCount).toBeGreaterThan(callsBeforeResume);

    const finalText = new SafeTextDecoder("utf-8").decode(finalBuffer);
    expect(finalText).toContain("[译文_");
  });

  it("cleans up storage upon cancellation", async () => {
    const translator = new BookTranslator({
      config: sampleConfig,
      sourceBuffer: new SafeTextEncoder().encode(sampleTxt).buffer as ArrayBuffer,
      storage: mockStorage,
      llmCaller: jest.fn().mockResolvedValue("<chunk><p id='0'>text</p></chunk>"),
      retryDelays: [1, 2, 4],
    });

    await translator.cancel();
    expect(translator.getStatus()).toBe("cancelled");
    const task = await mockStorage.getTask(sampleConfig.bookKey);
    expect(task).toBeNull();
  });

  it("broadcasts running progress immediately upon resume()", async () => {
    // Seed storage with an existing paused task
    await mockStorage.saveTask({
      bookKey: sampleConfig.bookKey,
      config: sampleConfig,
      currentChapterIndex: 0,
      currentChunkIndex: 0,
      completedChunkIds: [],
      translations: {},
      l1Queue: [],
      l2Summaries: [],
      l3Glossary: {},
      translatedWords: 0,
      totalChunks: 2,
      completedChunks: 0,
      status: "paused_error",
      updatedAt: Date.now(),
    });

    const progressList: any[] = [];
    const mockLlm = jest.fn().mockResolvedValue("<chunk><p id='0'>译文</p></chunk>");

    const translator = new BookTranslator({
      config: sampleConfig,
      sourceBuffer: new SafeTextEncoder().encode(sampleTxt).buffer as ArrayBuffer,
      storage: mockStorage,
      llmCaller: mockLlm,
      retryDelays: [1, 2, 4],
    });

    translator.onProgress((p) => {
      progressList.push({ ...p });
    });

    await translator.resume();

    // The first progress emitted should be 'running' with no error message
    expect(progressList.length).toBeGreaterThan(0);
    expect(progressList[0].status).toBe("running");
    expect(progressList[0].errorMessage).toBeUndefined();
  });

  it("broadcasts retry countdown progress messages during retries", async () => {
    const errorMessages: string[] = [];
    const mockFailingLlm = jest.fn().mockImplementation(async () => {
      throw new Error("Temporary network timeout");
    });

    const translator = new BookTranslator({
      config: sampleConfig,
      sourceBuffer: new SafeTextEncoder().encode(sampleTxt).buffer as ArrayBuffer,
      storage: mockStorage,
      llmCaller: mockFailingLlm,
      retryDelays: [10, 20, 30],
    });

    translator.onProgress((p) => {
      if (p.errorMessage) {
        errorMessages.push(p.errorMessage);
      }
    });

    await expect(translator.start()).rejects.toThrow();

    // Check that retry progress messages were sent
    expect(
      errorMessages.some((msg) => msg.includes("重试"))
    ).toBe(true);
    // Final error message should be recorded
    expect(
      errorMessages[errorMessages.length - 1]
    ).toContain("Temporary network timeout");
  });
});
