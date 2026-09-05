import {
  BuildPromptParams,
  L1ContextItem,
  L2ChapterSummary,
  L4RAGPair,
  LLMCompletionFn,
} from "./types";
import { ElectronSqliteFtsCorpus, IFtsCorpus } from "./ftsCorpus";

export class TranslationMemory {
  private l1Queue: L1ContextItem[] = [];
  private readonly maxL1Size = 3;

  private l2Summaries: L2ChapterSummary[] = [];
  private l3Glossary: Map<string, string> = new Map();
  private ftsCorpus: IFtsCorpus;

  constructor(customCorpus?: IFtsCorpus) {
    this.ftsCorpus = customCorpus || new ElectronSqliteFtsCorpus();
  }

  // --- L1: Local Sliding Window ---
  addL1(source: string, target: string) {
    if (!source?.trim() || !target?.trim()) return;
    this.l1Queue.push({ source: source.trim(), target: target.trim() });
    if (this.l1Queue.length > this.maxL1Size) {
      this.l1Queue.shift();
    }
  }

  getL1Context(): L1ContextItem[] {
    return [...this.l1Queue];
  }

  clearL1() {
    this.l1Queue = [];
  }

  // --- L2: Chapter State Summary ---
  async generateAndStoreL2(
    chapterIndex: number,
    title: string,
    chapterContent: string,
    llmFn: LLMCompletionFn
  ): Promise<string> {
    // Truncate chapter excerpt if too long for summary step
    const sampleText = chapterContent.slice(0, 3000);
    const summaryPrompt = `Provide a concise 2-3 sentence plot summary and key character status for this book chapter.
Chapter Title: ${title}
Content snippet:
${sampleText}

Output strictly the summary text:`;

    try {
      const summary = await llmFn(summaryPrompt, 300);
      const cleanSummary = summary.trim();
      this.l2Summaries.push({
        chapterIndex,
        title,
        summary: cleanSummary,
      });
      return cleanSummary;
    } catch (e) {
      console.warn("L2 summary generation failed:", e);
      return "";
    }
  }

  getLatestL2Summary(): string {
    if (this.l2Summaries.length === 0) return "";
    return this.l2Summaries[this.l2Summaries.length - 1].summary;
  }

  setLatestL2Summary(summary: string) {
    this.l2Summaries.push({
      chapterIndex: this.l2Summaries.length,
      title: "",
      summary,
    });
  }

  getL2Summaries(): L2ChapterSummary[] {
    return [...this.l2Summaries];
  }

  setL2Summaries(summaries: L2ChapterSummary[]) {
    this.l2Summaries = [...summaries];
  }

  // --- L3: Global Terminology & Entity Dictionary ---
  async extractAndMergeL3(
    sourceContent: string,
    targetContent: string,
    llmFn: LLMCompletionFn
  ): Promise<void> {
    const sampleSource = sourceContent.slice(0, 2000);
    const sampleTarget = targetContent.slice(0, 2000);

    const extractionPrompt = `Extract up to 8 important proper nouns, character names, places, and recurring worldbuilding terms with their translations from this bilingual text snippet.
Source:
${sampleSource}

Target:
${sampleTarget}

Output format strictly line by line:
- Source Term: Translated Term`;

    try {
      const result = await llmFn(extractionPrompt, 300);
      const lines = result.split("\n");
      for (const line of lines) {
        const match = line.match(/^[-*•]?\s*([^:]+)\s*[:：]\s*(.+)$/);
        if (match) {
          const original = match[1].trim();
          const translated = match[2].trim();
          if (original && translated && original.length < 50 && translated.length < 50) {
            this.l3Glossary.set(original, translated);
          }
        }
      }
    } catch (e) {
      console.warn("L3 entity extraction failed:", e);
    }
  }

  getL3Glossary(): Map<string, string> {
    return new Map(this.l3Glossary);
  }

  setL3Term(term: string, translation: string) {
    this.l3Glossary.set(term, translation);
  }

  setL3Glossary(glossary: Record<string, string> | Map<string, string>) {
    if (glossary instanceof Map) {
      this.l3Glossary = new Map(glossary);
    } else {
      this.l3Glossary = new Map(Object.entries(glossary));
    }
  }

  // --- L4: Historical Translation Corpus RAG ---
  async recordTranslationPairs(
    bookKey: string,
    pairs: { source: string; target: string }[]
  ): Promise<void> {
    await this.ftsCorpus.recordPairs(bookKey, pairs);
  }

  async queryL4RAG(
    bookKey: string,
    queryText: string,
    topK: number = 3
  ): Promise<L4RAGPair[]> {
    return await this.ftsCorpus.querySimilar(bookKey, queryText, topK);
  }

  // --- Centralized Prompt Builder ---
  async buildPrompt(params: BuildPromptParams): Promise<string> {
    const {
      bookKey,
      systemPrompt,
      sourceLanguage,
      targetLanguage,
      chunkTexts,
    } = params;

    const sections: string[] = [];

    // 1. System Prompt & Core Rules
    sections.push(`[Translation Instructions & Persona]
${systemPrompt}
Translate the content from ${sourceLanguage} to ${targetLanguage}.
Maintain literary tone, natural fluency, and narrative consistency.`);

    // 2. L3 Global Knowledge Base
    if (this.l3Glossary.size > 0) {
      const terms: string[] = [];
      // Include up to 20 most relevant or all glossary terms
      this.l3Glossary.forEach((trans, orig) => {
        terms.push(`- ${orig}: ${trans}`);
      });
      sections.push(
        `[L3: Global Terminology & Entities / 全书术语与实体对照表]\n${terms.slice(0, 25).join("\n")}`
      );
    }

    // 3. L2 Chapter State Summary
    const l2Summary = this.getLatestL2Summary();
    if (l2Summary) {
      sections.push(
        `[L2: Chapter State & Plot Continuity / 前情剧情提要]\n${l2Summary}`
      );
    }

    // 4. L4 Historical Translation Corpus RAG
    const querySample = chunkTexts.join(" ");
    const l4Pairs = await this.queryL4RAG(bookKey, querySample, 3);
    if (l4Pairs.length > 0) {
      const pairsText = l4Pairs
        .map((p) => `- "${p.sourceText}" => "${p.targetText}"`)
        .join("\n");
      sections.push(
        `[L4: Historical Translation Corpus / 历史相似译文参考]\n${pairsText}`
      );
    }

    // 5. L1 Local Sliding Window
    const l1Context = this.getL1Context();
    if (l1Context.length > 0) {
      const l1Text = l1Context
        .map((c) => `- "${c.source}" => "${c.target}"`)
        .join("\n");
      sections.push(
        `[L1: Immediate Preceding Context / 前文最近译文]\n${l1Text}`
      );
    }

    // 6. Current Chunk to Translate
    const chunkXml = chunkTexts
      .map((text, idx) => `<p id="${idx}">${text}</p>`)
      .join("\n");

    sections.push(`[Current Chunk to Translate]
Translate each paragraph into ${targetLanguage}.
You MUST preserve the exact <p id="...">...</p> XML structure.
Do NOT output conversational filler, preamble, or markdown code fences outside the chunk tags.

<chunk>
${chunkXml}
</chunk>`);

    return sections.join("\n\n");
  }
}
