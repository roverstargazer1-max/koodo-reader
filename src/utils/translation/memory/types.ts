export interface L1ContextItem {
  source: string;
  target: string;
}

export interface L2ChapterSummary {
  chapterIndex: number;
  title: string;
  summary: string;
}

export interface L4RAGPair {
  sourceText: string;
  targetText: string;
  score?: number;
}

export type LLMCompletionFn = (
  prompt: string,
  maxTokens?: number
) => Promise<string>;

export interface BuildPromptParams {
  bookKey: string;
  systemPrompt: string;
  sourceLanguage: string;
  targetLanguage: string;
  chunkTexts: string[];
}
