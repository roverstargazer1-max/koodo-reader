export type TranslationLayoutMode = "pure" | "bilingual";

export interface TranslatableTextNode {
  id: string; // Unique index or path identifier in chapter
  originalText: string;
  translatedText?: string;
  isHeading?: boolean;
}

export interface ParsedChapter {
  index: number;
  id: string; // file path in epub or chapter identifier
  title: string;
  href?: string;
  nodes: TranslatableTextNode[];
  rawContent?: any; // DOM Document or raw string for reconstruction
}

export interface BookChunk {
  chapterIndex: number;
  chunkIndex: number;
  nodeIds: string[];
  texts: string[];
  tokenCount: number;
}

export interface TranslationModelOption {
  key: string;
  displayName: string;
  modelId: string;
  endpoint: string;
  apiKey: string;
  providerId: string;
}

export interface TranslationTaskConfig {
  bookKey: string;
  originalTitle: string;
  targetTitle: string;
  format: "epub" | "txt";
  sourceLanguage: string;
  targetLanguage: string;
  layoutMode: TranslationLayoutMode;
  systemPrompt: string;
  modelConfig: TranslationModelOption;
}
