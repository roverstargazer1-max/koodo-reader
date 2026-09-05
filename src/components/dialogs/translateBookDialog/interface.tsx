import BookModel from "../../../models/Book";
import {
  TranslationLayoutMode,
  TranslationModelOption,
} from "../../../utils/translation/types";
import {
  PersistedTranslationState,
  TranslationProgress,
} from "../../../utils/translation/scheduler/types";

export interface TranslateBookDialogProps {
  currentBook: BookModel;
  isOpen: boolean;
  onClose: () => void;
  onRefreshBooks?: () => void;
  onOpenBook?: (book: BookModel) => void;
}

export interface TranslateBookDialogState {
  // Step: 'config' | 'progress' | 'resume_prompt'
  step: "config" | "progress" | "resume_prompt";
  sourceLanguage: string;
  targetLanguage: string;
  selectedModelKey: string;
  availableModels: TranslationModelOption[];
  layoutMode: TranslationLayoutMode;
  systemPrompt: string;
  isSaveDefaultPrompt: boolean;
  targetTitle: string;
  existingTask: PersistedTranslationState | null;
  progress: TranslationProgress | null;
  isCancelling: boolean;
  isResuming: boolean;
}
