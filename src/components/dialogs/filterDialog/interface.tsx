import BookModel from "../../../models/Book";
import { FilterConfig } from "../../../utils/filterUtil";

export interface FilterDialogProps {
  books: BookModel[];
  filterConfig: FilterConfig;
  isFilterDisplay: boolean;
  isCollapsed: boolean;
  handleFilterDisplay: (isDisplay: boolean) => void;
  handleFilterConfig: (config: FilterConfig) => void;
  t: (key: string) => string;
}

export interface FilterDialogState {
  authorSearchKeyword: string;
  posX: number;
  posY: number;
  isDragging: boolean;
  fallbackBooks?: any[];
}
