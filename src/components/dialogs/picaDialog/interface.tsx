import { TFunction } from "i18next";

export interface PicaImageRef {
  fileServer: string;
  path: string;
  originalName?: string;
}

export interface PicaComicItem {
  id: string;
  title: string;
  author: string;
  categories: string[];
  tags: string[];
  thumb?: PicaImageRef;
  thumbUrl?: string;
  likesCount?: number;
  pagesCount?: number;
  epsCount?: number;
  finished?: boolean;
  updated_at?: string;
  chineseTeam?: string;
  viewsCount?: number;
}

export interface PicaCategoryItem {
  _id: string;
  title: string;
  thumb?: PicaImageRef;
  thumbUrl?: string;
  isWeb?: boolean;
  link?: string;
}

export interface PicaEpisodeItem {
  id: string;
  order: number;
  title: string;
  updated_at?: string;
}

export interface PicaComicDetailData {
  id: string;
  title: string;
  author: string;
  chineseTeam?: string;
  categories: string[];
  tags: string[];
  description: string;
  thumb?: PicaImageRef;
  thumbUrl?: string;
  likesCount?: number;
  viewsCount?: number;
  commentsCount?: number;
  pagesCount?: number;
  epsCount?: number;
  finished?: boolean;
  isFavourite?: boolean;
  updated_at?: string;
  created_at?: string;
  episodes: PicaEpisodeItem[];
}

export interface PicaUserProfile {
  id: string;
  email: string;
  name: string;
  title: string;
  level: number;
  exp: number;
  avatar?: PicaImageRef;
  avatarUrl?: string;
  birthday?: string;
  gender?: string;
  slogan?: string;
  character?: string;
  isPunched?: boolean;
}

export interface PicaDownloadTask {
  comicId: string;
  title: string;
  author: string;
  coverUrl: string;
  status: "pending" | "downloading" | "packaging" | "completed" | "failed" | "cancelled" | "paused";
  percent: number;
  currentEpTitle?: string;
  currentEpIndex?: number;
  totalEps?: number;
  currentPageIndex?: number;
  totalPages?: number;
  errorMsg?: string;
  createdFiles?: { path: string; name: string; size: number }[];
  imported?: boolean;
  selectedEpOrders?: number[];
  combineCbz?: boolean;
}

export interface PicaConfig {
  route: "route1" | "route2" | "route3";
  proxy?: string;
  quality: "original" | "high" | "medium" | "low";
  threads?: number;
  delayMs?: number;
  outputDir?: string;
  combineCbz?: boolean;
  autoImport?: boolean;
}

export interface PicaDialogProps {
  handlePicaDialog: (isOpen: boolean) => void;
  importBookFunc: (file: any) => Promise<void>;
  handleFetchBooks?: () => void;
  books?: any[];
  t: TFunction;
}

export interface PicaDialogState {
  currentTab: "search" | "explore" | "favorites" | "downloads" | "settings";

  // Search state
  searchQuery: string;
  searchSort: "ua" | "dd" | "da" | "ld" | "vd";
  searchCategory: string;
  searchTag: string;
  searchAuthor: string;
  searchPage: number;
  searchTotalPages: number;
  searchTotalCount: number;
  searchResults: PicaComicItem[];
  isSearching: boolean;

  // Explore & Categories & Rank state
  exploreSubTab: "categories" | "rank" | "random";
  categories: PicaCategoryItem[];
  isLoadingCategories: boolean;
  selectedCategory: string;
  categoryPage: number;
  categoryTotalPages: number;
  categoryResults: PicaComicItem[];
  isLoadingCategoryComics: boolean;

  rankTime: "H24" | "D7" | "D30";
  rankType: "VC" | "CA";
  rankResults: PicaComicItem[];
  isRanking: boolean;

  randomResults: PicaComicItem[];
  isRandomLoading: boolean;

  // Favorites state
  currentUser: PicaUserProfile | null;
  savedAuth: { username: string; password?: string; remember: boolean } | null;
  token: string | null;
  isLoggingIn: boolean;
  loginUsernameInput: string;
  loginPasswordInput: string;
  loginRememberInput: boolean;
  loginErrorMsg: string;

  favoriteSort: "dd" | "da" | "ld" | "vd";
  favoritePage: number;
  favoriteTotalPages: number;
  favoriteTotalCount: number;
  favoriteResults: PicaComicItem[];
  isFavoritesLoading: boolean;

  // Batch Selection state in Favorites
  isBatchMode: boolean;
  selectedBatchIds: string[];

  // Detail Drawer state
  selectedComicId: string | null;
  selectedComicDetail: PicaComicDetailData | null;
  selectedEpOrders: number[];
  isLoadingDetail: boolean;
  isFavoritedDetail: boolean;
  isTogglingFavorite: boolean;

  // Download state
  downloadTasks: Record<string, PicaDownloadTask>;
  downloadQueue: string[];
  isQueueRunning: boolean;

  // Settings state
  config: PicaConfig;
  routeSpeedTest: Record<string, number | "timeout" | "error" | "testing">;
}
