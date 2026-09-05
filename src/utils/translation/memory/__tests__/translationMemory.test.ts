import { TranslationMemory } from "../translationMemory";
import { InMemoryFtsCorpus } from "../ftsCorpus";

describe("TranslationMemory - Four-Tier Architecture", () => {
  let memory: TranslationMemory;

  beforeEach(() => {
    memory = new TranslationMemory(new InMemoryFtsCorpus());
  });

  describe("L1 Local Sliding Window", () => {
    it("maintains a FIFO queue of maximum 3 recent translated items", () => {
      memory.addL1("Line 1", "第一行");
      memory.addL1("Line 2", "第二行");
      memory.addL1("Line 3", "第三行");

      let l1 = memory.getL1Context();
      expect(l1.length).toBe(3);
      expect(l1[0].target).toBe("第一行");
      expect(l1[2].target).toBe("第三行");

      // Push 4th item, oldest should be evicted
      memory.addL1("Line 4", "第四行");
      l1 = memory.getL1Context();
      expect(l1.length).toBe(3);
      expect(l1[0].target).toBe("第二行");
      expect(l1[2].target).toBe("第四行");
    });

    it("resets L1 upon new chapter initiation", () => {
      memory.addL1("Line 1", "第一行");
      expect(memory.getL1Context().length).toBe(1);
      memory.clearL1();
      expect(memory.getL1Context().length).toBe(0);
    });
  });

  describe("L2 Chapter State Summary", () => {
    it("generates and stores chapter plot summary via LLM completion", async () => {
      const mockLlm = jest.fn().mockResolvedValue("Protagonist Alice reaches the dark forest.");

      const summary = await memory.generateAndStoreL2(
        0,
        "Chapter 1: The Forest",
        "Alice walked for hours through the dense woods...",
        mockLlm
      );

      expect(mockLlm).toHaveBeenCalledTimes(1);
      expect(summary).toBe("Protagonist Alice reaches the dark forest.");
      expect(memory.getLatestL2Summary()).toBe("Protagonist Alice reaches the dark forest.");
    });
  });

  describe("L3 Global Knowledge Base & Deduplication", () => {
    it("merges and deduplicates terms extracted from chapters", async () => {
      const mockLlm = jest.fn().mockResolvedValue(`
- Alice: 爱丽丝
- Eldoria: 艾尔多利亚
- Shadow Blade: 暗影之刃
      `);

      await memory.extractAndMergeL3(
        "Chapter 1 source text",
        "Chapter 1 translated text",
        mockLlm
      );

      let glossary = memory.getL3Glossary();
      expect(glossary.get("Alice")).toBe("爱丽丝");
      expect(glossary.get("Eldoria")).toBe("艾尔多利亚");

      // Second chapter adds a new term and keeps existing term without duplicate
      const mockLlm2 = jest.fn().mockResolvedValue(`
- Alice: 爱丽丝
- Bob: 鲍勃
      `);

      await memory.extractAndMergeL3(
        "Chapter 2 source text",
        "Chapter 2 translated text",
        mockLlm2
      );

      glossary = memory.getL3Glossary();
      expect(glossary.size).toBe(4);
      expect(glossary.get("Bob")).toBe("鲍勃");
      expect(glossary.get("Alice")).toBe("爱丽丝");
    });
  });

  describe("L4 Historical Translation Corpus RAG", () => {
    it("indexes translated pairs and retrieves matching pairs by keyword similarity", async () => {
      const bookKey = "book_123";
      await memory.recordTranslationPairs(bookKey, [
        { source: "The ancient sword gleamed in the moonlight.", target: "古剑在月光下闪烁。" },
        { source: "Alice drew her weapon cautiously.", target: "爱丽丝谨慎地拔出了武器。" },
        { source: "The stars shone brightly tonight.", target: "今晚群星璀璨。" },
      ]);

      const matches = await memory.queryL4RAG(bookKey, "Alice weapon", 2);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].targetText).toBe("爱丽丝谨慎地拔出了武器。");
    });
  });

  describe("Prompt Assembly", () => {
    it("combines system prompt, L3 glossary, L2 summary, L4 RAG pairs, and L1 context in order", async () => {
      memory.addL1("Prior source", "前序译文");
      memory.setLatestL2Summary("Alice entered the dungeon.");
      memory.setL3Term("Alice", "爱丽丝");

      await memory.recordTranslationPairs("book_123", [
        { source: "The door opened silently.", target: "门悄无声息地开了。" },
      ]);

      const prompt = await memory.buildPrompt({
        bookKey: "book_123",
        systemPrompt: "You are a professional literary translator.",
        sourceLanguage: "en",
        targetLanguage: "zh",
        chunkTexts: ["Alice reached for the handle.", "The door opened silently."],
      });

      expect(prompt).toContain("You are a professional literary translator.");
      expect(prompt).toContain("Alice: 爱丽丝");
      expect(prompt).toContain("Alice entered the dungeon.");
      expect(prompt).toContain("前序译文");
      expect(prompt).toContain("Alice reached for the handle.");
      expect(prompt).toContain("<chunk>");
    });
  });
});
