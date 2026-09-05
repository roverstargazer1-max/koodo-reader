import { TranslationProgress } from "../../utils/translation/scheduler/types";

export interface TranslationWidgetProps {
  onRestore?: () => void;
}

export interface TranslationWidgetState {
  progress: TranslationProgress | null;
  isVisible: boolean;
}
