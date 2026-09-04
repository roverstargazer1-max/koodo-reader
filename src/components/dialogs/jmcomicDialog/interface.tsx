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

export interface JmUserProfile {
  uid: string;
  username: string;
  fname?: string;
  email?: string;
  photo?: string;
  coin?: number;
  album_favorites?: number;
  album_favorites_max?: number;
  level_name?: string;
  level?: number;
  exp?: number;
  nextLevelExp?: number;
  expPercent?: number;
}

export interface JmFavoriteFolder {
  id: string;
  name: string;
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
  handleFetchBooks?: () => void;
  books?: any[];
  t: TFunction;
}

export interface JmCategoryOption {
  id: string;
  nameKey: string;
}

export const JM_CATEGORIES: JmCategoryOption[] = [
  { id: "0", nameKey: "All Categories" },
  { id: "doujin", nameKey: "Doujinshi" },
  { id: "hanman", nameKey: "Korean Manga" },
  { id: "single", nameKey: "Tankobon" },
  { id: "short", nameKey: "Short Stories" },
  { id: "3D", nameKey: "3D Manga" },
  { id: "doujin_cosplay", nameKey: "Cosplay" },
  { id: "another", nameKey: "Other Manga" },
  { id: "meiman", nameKey: "Western Comics" },
];

export const JM_PRESET_TAGS: string[] = [
  "全彩",
  "无修正",
  "纯爱",
  "NTR",
  "人妻",
  "调教",
  "巨乳",
  "萝莉",
  "御姐",
  "校园",
  "汉化",
  "后宫",
  "黑丝",
  "女仆",
  "短篇",
  "JK",
];

export type JmTagFilterState = "include" | "exclude";

export interface JmcomicDialogState {
  currentTab: "search" | "rank" | "favorites" | "downloads" | "settings";
  
  // Category & Tag filter state
  searchCategory: string;
  rankCategory: string;
  tagFilterMap: Record<string, JmTagFilterState>;
  recentTags: string[];

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

  // Favorites state
  currentUser: JmUserProfile | null;
  savedAuth: { username: string; password?: string; remember: boolean } | null;
  cookies: Record<string, string> | null;
  isLoggingIn: boolean;
  loginUsernameInput: string;
  loginPasswordInput: string;
  loginRememberInput: boolean;
  loginErrorMsg: string;

  favoriteFolders: JmFavoriteFolder[];
  activeFolderId: string;
  favoriteOrder: "mr" | "mv" | "mp" | "tf";
  favoritePage: number;
  favoriteTotalPages: number;
  favoriteTotalCount: number;
  favoriteResults: JmAlbumItem[];
  isFavoritesLoading: boolean;

  // Batch Selection state in Favorites
  isBatchMode: boolean;
  selectedBatchIds: string[];

  // Detail Modal state
  selectedAlbumId: string | null;
  selectedAlbumDetail: JmAlbumDetailData | null;
  selectedChapterIds: string[];
  isLoadingDetail: boolean;
  isFavoritedDetail: boolean;
  isTogglingFavorite: boolean;

  // Download state
  downloadTasks: Record<string, JmDownloadTask>;
  downloadQueue: string[];
  isQueueRunning: boolean;

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
    runtimeMode?: "bundled-sidecar" | "custom-python" | "project-venv" | string;
    expectedJmcomicVersion?: string;
    runtimeAvailable?: boolean;
    isChecking?: boolean;
    isInstalling?: boolean;
    message?: string;
    installLogs?: string;
  };
}
