import { InspectSharePackageResult } from "../../../utils/file/shareUtil";

export interface ImportShareDialogProps {
  isOpenImportShareDialog: boolean;
  importShareData: {
    filePath: string;
    inspected?: InspectSharePackageResult;
  } | null;
  handleImportShareDialog: (isOpen: boolean, data?: any) => void;
  handleFetchBooks: () => void;
  handleFetchNotes: () => void;
  handleFetchBookmarks: () => void;
  handleMode: (mode: string) => void;
  handleShelf: (shelf: string) => void;
  t: (key: string) => string;
}

export interface ImportShareDialogState {
  isLoading: boolean;
  isImporting: boolean;
  progress: number;
  inspectResult: InspectSharePackageResult | null;
  error: string | null;
}
