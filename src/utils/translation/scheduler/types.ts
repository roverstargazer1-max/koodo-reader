import { TranslationTaskConfig } from "../types";

export type TranslationStatus =
  | "idle"
  | "running"
  | "paused"
  | "paused_error"
  | "completed"
  | "cancelled";

export interface TranslationProgress {
  bookKey: string;
  currentChapterIndex: number;
  totalChapters: number;
  currentChapterTitle: string;
  currentChunkIndex: number;
  totalChunks: number;
  completedChunks: number;
  translatedWords: number;
  percentage: number;
  timeRemainingSec: number;
  status: TranslationStatus;
  errorMessage?: string;
}

export interface PersistedTranslationState {
  bookKey: string;
  config: TranslationTaskConfig;
  currentChapterIndex: number;
  currentChunkIndex: number;
  completedChunkIds: string[];
  translations: Record<string, string>; // nodeId -> translated text
  l1Queue: Array<{ source: string; target: string }>;
  l2Summaries: Array<{ chapterIndex: number; title: string; summary: string }>;
  l3Glossary: Record<string, string>;
  translatedWords: number;
  totalChunks: number;
  completedChunks: number;
  status: TranslationStatus;
  updatedAt: number;
}
