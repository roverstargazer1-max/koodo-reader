import BookModel from "../../../models/Book";

export interface ExportShareDialogProps {
  isOpenExportShareDialog: boolean;
  exportShareData: {
    books: BookModel[];
    shelfName: string | null;
  } | null;
  handleExportShareDialog: (isOpen: boolean, data?: any) => void;
  t: (key: string) => string;
}

export interface ExportShareDialogState {
  includeNotes: boolean;
  isExporting: boolean;
  progress: number;
}
