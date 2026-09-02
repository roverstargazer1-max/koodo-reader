import { TFunction } from "i18next";

export interface JmAlbumItem {
  id: string;
  title: string;
  author: string;
  tags: string[];
  cover: string;
  page_count: number;
  pub_date: string;
}

export interface JmChapterItem {
  id: string;
  index: number;
  title: string;
}

export interface JmAlbumDetailData {
  id: string;
  title: string;
  author: string;
  authors: string[];
  tags: string[];
  description: string;
  pub_date: string;
  update_date: string;
  page_count: number;
  cover: string;
  chapters: JmChapterItem[];
}

export interface JmDownloadTask {
  albumId: string;
  title: string;
  author: string;
  coverUrl: string;
  status: "pending" | "downloading" | "packaging" | "completed" | "failed" | "cancelled";
  percent: number;
  currentPhotoTitle?: string;
  currentPhotoIndex?: number;
  totalPhotos?: number;
  errorMsg?: string;
  createdFiles?: { path: string; name: string; size: number }[];
  imported?: boolean;
}

export interface JmcomicConfig {
  pythonPath?: string;
  proxy?: string;
  domain?: string;
  threads?: number;
  outputDir?: string;
  combineCbz?: boolean;
  autoImport?: boolean;
}

export interface JmcomicDialogProps {
  handleJmcomicDialog: (isOpen: boolean) => void;
  importBookFunc: (file: any) => Promise<void>;
  t: TFunction;
}

export interface JmcomicDialogState {
  currentTab: "search" | "rank" | "downloads" | "settings";
  // Search state
  searchQuery: string;
  searchOrder: "mr" | "mv" | "mp" | "tf";
  searchPage: number;
  searchTotalPages: number;
  searchTotalCount: number;
  searchResults: JmAlbumItem[];
  isSearching: boolean;

  // Rank state
  rankTime: "t" | "w" | "m" | "a";
  rankOrder: "mv" | "tf";
  rankPage: number;
  rankTotalPages: number;
  rankResults: JmAlbumItem[];
  isRanking: boolean;

  // Detail Modal state
  selectedAlbumId: string | null;
  selectedAlbumDetail: JmAlbumDetailData | null;
  selectedChapterIds: string[];
  isLoadingDetail: boolean;

  // Download state
  downloadTasks: Record<string, JmDownloadTask>;

  // Settings state
  config: JmcomicConfig;
  availableDomains: string[];
  envStatus: {
    checked: boolean;
    hasPython: boolean;
    hasJmcomic: boolean;
    pythonVersion?: string;
    jmcomicVersion?: string;
    pythonPath?: string;
    isChecking?: boolean;
    isInstalling?: boolean;
    message?: string;
    installLogs?: string;
  };
}

