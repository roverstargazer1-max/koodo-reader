import { TranslationTaskConfig, TranslatableTextNode } from "../types";
import {
  PersistedTranslationState,
  TranslationProgress,
  TranslationStatus,
} from "./types";
import { ITaskStorage, TaskStorage } from "./taskStorage";
import { EpubProcessor } from "../format/epubProcessor";
import { TxtProcessor } from "../format/txtProcessor";
import { ParsedEpubBook } from "../format/types";
import { ParsedTxtBook } from "../format/types";
import { TranslationMemory } from "../memory/translationMemory";

export interface BookTranslatorOptions {
  config: TranslationTaskConfig;
  sourceBuffer: ArrayBuffer;
  storage?: ITaskStorage;
  llmCaller?: (prompt: string, maxTokens?: number) => Promise<string>;
  retryDelays?: number[]; // Milliseconds, e.g. [2000, 4000, 8000]
}

interface PreparedChunk {
  id: string;
  chapterIndex: number;
  chunkIndex: number;
  nodes: TranslatableTextNode[];
  estimatedTokens: number;
}

export class BookTranslator {
  private config: TranslationTaskConfig;
  private sourceBuffer: ArrayBuffer;
  private storage: ITaskStorage;
  private llmCaller: (prompt: string, maxTokens?: number) => Promise<string>;
  private retryDelays: number[];

  private status: TranslationStatus = "idle";
  private isPaused = false;
  private isCancelled = false;

  private progressListeners: Array<(p: TranslationProgress) => void> = [];

  private memory: TranslationMemory;
  private parsedEpub?: ParsedEpubBook;
  private parsedTxt?: ParsedTxtBook;

  private chunks: PreparedChunk[] = [];
  private translations: Map<string, string> = new Map();
  private completedChunkIds: Set<string> = new Set();

  private currentChapterIndex = 0;
  private currentChunkIndex = 0;
  private translatedWords = 0;
  private startTime = 0;

  constructor(options: BookTranslatorOptions) {
    this.config = options.config;
    this.sourceBuffer = options.sourceBuffer;
    this.storage = options.storage || TaskStorage;
    this.retryDelays = options.retryDelays || [2000, 4000, 8000];
    this.memory = new TranslationMemory();

    if (options.llmCaller) {
      this.llmCaller = options.llmCaller;
    } else {
      this.llmCaller = this.createDefaultLlmCaller();
    }
  }

  onProgress(listener: (p: TranslationProgress) => void) {
    this.progressListeners.push(listener);
  }

  getStatus(): TranslationStatus {
    return this.status;
  }

  pause() {
    this.isPaused = true;
    this.status = "paused";
  }

  async cancel(): Promise<void> {
    this.isCancelled = true;
    this.status = "cancelled";
    await this.storage.deleteTask(this.config.bookKey);
    this.emitProgress();
  }

  async start(): Promise<ArrayBuffer> {
    this.isPaused = false;
    this.isCancelled = false;
    this.status = "running";
    this.startTime = Date.now();

    await this.prepareBookAndChunks();
    return await this.executeLoop();
  }

  async resume(): Promise<ArrayBuffer> {
    this.isPaused = false;
    this.isCancelled = false;
    this.status = "running";
    this.startTime = Date.now();

    await this.prepareBookAndChunks();

    // Restore state from storage
    const saved = await this.storage.getTask(this.config.bookKey);
    if (saved) {
      this.currentChapterIndex = saved.currentChapterIndex;
      this.currentChunkIndex = saved.currentChunkIndex;
      this.completedChunkIds = new Set(saved.completedChunkIds);
      this.translations = new Map(Object.entries(saved.translations));
      this.translatedWords = saved.translatedWords;

      // Restore memory state
      if (saved.l1Queue) {
        for (const item of saved.l1Queue) {
          this.memory.addL1(item.source, item.target);
        }
      }
      if (saved.l2Summaries) {
        this.memory.setL2Summaries(saved.l2Summaries);
      }
      if (saved.l3Glossary) {
        this.memory.setL3Glossary(saved.l3Glossary);
      }
    }

    // Immediately broadcast running status to update UI badge and clear old error
    this.emitProgress();

    return await this.executeLoop();
  }

  private async prepareBookAndChunks() {
    if (this.config.format === "epub") {
      this.parsedEpub = await EpubProcessor.parse(this.sourceBuffer);
    } else {
      this.parsedTxt = TxtProcessor.parse(this.sourceBuffer);
    }

    const chapters = this.parsedEpub
      ? this.parsedEpub.chapters
      : this.parsedTxt!.chapters;

    this.chunks = [];

    // Enforce 1000 - 4000 tokens per chunk
    for (let cIdx = 0; cIdx < chapters.length; cIdx++) {
      const chapter = chapters[cIdx];
      let currentChunkNodes: TranslatableTextNode[] = [];
      let currentChunkTokens = 0;
      let chunkIdxInChapter = 0;

      for (const node of chapter.nodes) {
        const text = node.originalText;
        const estTokens = this.estimateTokenCount(text);

        // If adding this node exceeds target upper budget (e.g. 3000 tokens)
        if (
          currentChunkTokens + estTokens > 3000 &&
          currentChunkNodes.length > 0
        ) {
          this.chunks.push({
            id: `c${cIdx}_chk${chunkIdxInChapter++}`,
            chapterIndex: cIdx,
            chunkIndex: this.chunks.length,
            nodes: currentChunkNodes,
            estimatedTokens: currentChunkTokens,
          });
          currentChunkNodes = [];
          currentChunkTokens = 0;
        }

        currentChunkNodes.push(node);
        currentChunkTokens += estTokens;
      }

      if (currentChunkNodes.length > 0) {
        this.chunks.push({
          id: `c${cIdx}_chk${chunkIdxInChapter++}`,
          chapterIndex: cIdx,
          chunkIndex: this.chunks.length,
          nodes: currentChunkNodes,
          estimatedTokens: currentChunkTokens,
        });
      }
    }
  }

  private async executeLoop(): Promise<ArrayBuffer> {
    const chapters = this.parsedEpub
      ? this.parsedEpub.chapters
      : this.parsedTxt!.chapters;

    for (let i = 0; i < this.chunks.length; i++) {
      if (this.isCancelled) {
        throw new Error("Translation task was cancelled");
      }
      if (this.isPaused) {
        await this.persistState();
        this.emitProgress();
        throw new Error("Translation paused by user");
      }

      const chunk = this.chunks[i];
      this.currentChapterIndex = chunk.chapterIndex;
      this.currentChunkIndex = i;

      // Skip already translated chunk on resume
      if (this.completedChunkIds.has(chunk.id)) {
        continue;
      }

      // Check if entering a new chapter -> reset L1 sliding window
      if (
        i > 0 &&
        this.chunks[i - 1].chapterIndex !== chunk.chapterIndex
      ) {
        const prevChapIdx = this.chunks[i - 1].chapterIndex;
        await this.onChapterCompleted(prevChapIdx);
        this.memory.clearL1();
      }

      // Translate chunk with retry logic
      await this.translateChunkWithRetry(chunk);

      this.completedChunkIds.add(chunk.id);
      await this.persistState();
      this.emitProgress();
    }

    // Final chapter summary and entities
    if (chapters.length > 0) {
      await this.onChapterCompleted(chapters.length - 1);
    }

    // Reconstruct book binary
    let reconstructedBuffer: ArrayBuffer;
    if (this.config.format === "epub" && this.parsedEpub) {
      reconstructedBuffer = await EpubProcessor.reconstruct(
        this.parsedEpub,
        this.translations,
        this.config.layoutMode,
        this.config.targetTitle,
        this.config.targetLanguage
      );
    } else if (this.parsedTxt) {
      reconstructedBuffer = TxtProcessor.reconstruct(
        this.parsedTxt,
        this.translations,
        this.config.layoutMode
      );
    } else {
      throw new Error("Missing parsed book structure for reconstruction");
    }

    this.status = "completed";
    await this.storage.deleteTask(this.config.bookKey);
    this.emitProgress();

    return reconstructedBuffer;
  }

  private async translateChunkWithRetry(chunk: PreparedChunk): Promise<void> {
    const prompt = await this.memory.buildPrompt({
      bookKey: this.config.bookKey,
      systemPrompt: this.config.systemPrompt,
      sourceLanguage: this.config.sourceLanguage,
      targetLanguage: this.config.targetLanguage,
      chunkTexts: chunk.nodes.map((n) => n.originalText),
    });

    let attempt = 0;
    while (true) {
      try {
        const responseText = await this.llmCaller(prompt, 4000);
        this.parseChunkResponse(chunk, responseText);
        return;
      } catch (err: any) {
        attempt++;
        if (attempt <= this.retryDelays.length) {
          const delay = this.retryDelays[attempt - 1];
          console.warn(
            `Chunk translation failed (attempt ${attempt}/${this.retryDelays.length}). Retrying in ${delay}ms...`,
            err
          );
          const delaySec = Math.max(1, Math.round(delay / 1000));
          this.emitProgress(
            `请求异常 (${err.message?.slice(0, 80) || "服务暂不可用"})，${delaySec} 秒后进行第 ${attempt} 次重试...`
          );
          await this.sleep(delay);
        } else {
          // Retries exhausted: safely pause and notify
          this.status = "paused_error";
          await this.persistState();
          this.emitProgress(err.message || "Max retries exhausted");
          throw err;
        }
      }
    }
  }

  private parseChunkResponse(chunk: PreparedChunk, responseText: string) {
    const pTagMatches = Array.from(
      responseText.matchAll(/<p\s+id="(\d+)">([\s\S]*?)<\/p>/gi)
    );

    const pairsToRecord: Array<{ source: string; target: string }> = [];

    if (pTagMatches.length > 0) {
      for (const match of pTagMatches) {
        const idx = parseInt(match[1], 10);
        const translated = match[2]?.trim() || "";
        if (idx >= 0 && idx < chunk.nodes.length) {
          const node = chunk.nodes[idx];
          this.translations.set(node.id, translated);
          this.memory.addL1(node.originalText, translated);
          pairsToRecord.push({
            source: node.originalText,
            target: translated,
          });
          this.translatedWords += node.originalText.length;
        }
      }
    } else {
      // Fallback: line-by-line if XML tags missing
      const cleanLines = responseText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("<") && !l.endsWith(">"));

      for (let i = 0; i < chunk.nodes.length; i++) {
        const node = chunk.nodes[i];
        const translated = cleanLines[i] || node.originalText;
        this.translations.set(node.id, translated);
        this.memory.addL1(node.originalText, translated);
        pairsToRecord.push({
          source: node.originalText,
          target: translated,
        });
        this.translatedWords += node.originalText.length;
      }
    }

    if (pairsToRecord.length > 0) {
      this.memory.recordTranslationPairs(this.config.bookKey, pairsToRecord);
    }
  }

  private async onChapterCompleted(chapterIndex: number) {
    const chapters = this.parsedEpub
      ? this.parsedEpub.chapters
      : this.parsedTxt!.chapters;

    const chapter = chapters[chapterIndex];
    if (!chapter) return;

    const sourceContent = chapter.nodes.map((n) => n.originalText).join("\n");
    const targetContent = chapter.nodes
      .map((n) => this.translations.get(n.id) || "")
      .join("\n");

    // L2 summary extraction
    await this.memory.generateAndStoreL2(
      chapterIndex,
      chapter.title,
      sourceContent,
      this.llmCaller
    );

    // L3 terminology extraction
    await this.memory.extractAndMergeL3(
      sourceContent,
      targetContent,
      this.llmCaller
    );
  }

  private async persistState(): Promise<void> {
    const glossaryObj: Record<string, string> = {};
    this.memory.getL3Glossary().forEach((v, k) => {
      glossaryObj[k] = v;
    });

    const transObj: Record<string, string> = {};
    this.translations.forEach((v, k) => {
      transObj[k] = v;
    });

    const state: PersistedTranslationState = {
      bookKey: this.config.bookKey,
      config: this.config,
      currentChapterIndex: this.currentChapterIndex,
      currentChunkIndex: this.currentChunkIndex,
      completedChunkIds: Array.from(this.completedChunkIds),
      translations: transObj,
      l1Queue: this.memory.getL1Context(),
      l2Summaries: this.memory.getL2Summaries(),
      l3Glossary: glossaryObj,
      translatedWords: this.translatedWords,
      totalChunks: this.chunks.length,
      completedChunks: this.completedChunkIds.size,
      status: this.status,
      updatedAt: Date.now(),
    };

    await this.storage.saveTask(state);
  }

  private emitProgress(errorMessage?: string) {
    const totalChunks = this.chunks.length || 1;
    const completed = this.completedChunkIds.size;
    const percentage = Math.min(
      100,
      Math.round((completed / totalChunks) * 100)
    );

    const elapsedMs = Date.now() - (this.startTime || Date.now());
    let timeRemainingSec = 0;
    if (completed > 0 && completed < totalChunks) {
      const msPerChunk = elapsedMs / completed;
      timeRemainingSec = Math.round(
        (msPerChunk * (totalChunks - completed)) / 1000
      );
    }

    const chapters = this.parsedEpub
      ? this.parsedEpub.chapters
      : this.parsedTxt
      ? this.parsedTxt.chapters
      : [];

    const currentTitle =
      chapters[this.currentChapterIndex]?.title ||
      `Chapter ${this.currentChapterIndex + 1}`;

    const progress: TranslationProgress = {
      bookKey: this.config.bookKey,
      currentChapterIndex: this.currentChapterIndex,
      totalChapters: chapters.length,
      currentChapterTitle: currentTitle,
      currentChunkIndex: this.currentChunkIndex,
      totalChunks,
      completedChunks: completed,
      translatedWords: this.translatedWords,
      percentage,
      timeRemainingSec,
      status: this.status,
      errorMessage,
    };

    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }

  private estimateTokenCount(text: string): number {
    const cjkChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const nonCjkLen = text.length - cjkChars;
    return Math.ceil(nonCjkLen / 4) + cjkChars;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createDefaultLlmCaller(): (
    prompt: string,
    maxTokens?: number
  ) => Promise<string> {
    const { endpoint, modelId, apiKey } = this.config.modelConfig;
    return async (prompt: string, maxTokens: number = 4000) => {
      const url = `${endpoint.replace(/\/+$/, "")}/chat/completions`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const err: any = new Error(
          `HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`
        );
        err.status = response.status;
        throw err;
      }

      const json = await response.json();
      return json.choices?.[0]?.message?.content || "";
    };
  }
}
