import React from "react";
import "./picaDialog.css";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import {
  PicaComicItem,
  PicaCategoryItem,
  PicaComicDetailData,
  PicaConfig,
  PicaDialogProps,
  PicaDialogState,
  PicaDownloadTask,
  PicaUserProfile,
} from "./interface";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";

const getIpc = () => (window as any).electronAPI || (window as any).ipcRenderer;

const extractPayload = (arg1: any, arg2: any) => {
  if (arg2 !== undefined) return arg2;
  return arg1;
};

interface PicaPaginationProps {
  current: number;
  total: number;
  onPageChange: (p: number) => void;
  t: (key: string) => string;
}

const PicaPagination: React.FC<PicaPaginationProps> = ({
  current,
  total,
  onPageChange,
  t,
}) => {
  const [inputVal, setInputVal] = React.useState<string>(String(current));

  React.useEffect(() => {
    setInputVal(String(current));
  }, [current]);

  if (total <= 1) return null;

  const handleJump = (target?: number) => {
    let pageNum = target !== undefined ? target : parseInt(inputVal.trim(), 10);
    if (isNaN(pageNum)) {
      setInputVal(String(current));
      return;
    }
    const clamped = Math.max(1, Math.min(total, pageNum));
    if (clamped !== current) {
      onPageChange(clamped);
    }
    setInputVal(String(clamped));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleJump();
    }
  };

  const renderPageButtons = () => {
    const items: (number | string)[] = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) items.push(i);
    } else {
      if (current <= 4) {
        for (let i = 1; i <= 5; i++) items.push(i);
        items.push("...right");
        items.push(total);
      } else if (current >= total - 3) {
        items.push(1);
        items.push("...left");
        for (let i = total - 4; i <= total; i++) items.push(i);
      } else {
        items.push(1);
        items.push("...left");
        for (let i = current - 1; i <= current + 1; i++) items.push(i);
        items.push("...right");
        items.push(total);
      }
    }

    return items.map((item, idx) => {
      if (typeof item === "number") {
        return (
          <button
            key={`page-${item}`}
            className={`pica-pagination-btn ${item === current ? "active" : ""}`}
            onClick={() => {
              if (item !== current) onPageChange(item);
            }}
          >
            {item}
          </button>
        );
      } else if (item === "...left") {
        return (
          <span
            key={`ellipsis-left-${idx}`}
            className="pica-pagination-ellipsis"
            title={t("Previous Page")}
            onClick={() => handleJump(Math.max(1, current - 5))}
          >
            ...
          </span>
        );
      } else {
        return (
          <span
            key={`ellipsis-right-${idx}`}
            className="pica-pagination-ellipsis"
            title={t("Next Page")}
            onClick={() => handleJump(Math.min(total, current + 5))}
          >
            ...
          </span>
        );
      }
    });
  };

  return (
    <div className="pica-pagination">
      <button
        className="pica-pagination-btn"
        disabled={current <= 1}
        onClick={() => onPageChange(current - 1)}
        title={t("Previous Page")}
      >
        {t("Previous Page")}
      </button>

      {renderPageButtons()}

      <button
        className="pica-pagination-btn"
        disabled={current >= total}
        onClick={() => onPageChange(current + 1)}
        title={t("Next Page")}
      >
        {t("Next Page")}
      </button>

      <div className="pica-pagination-jump">
        <span>{t("Page")}</span>
        <input
          type="number"
          min={1}
          max={total}
          className="pica-pagination-input"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => handleJump()}
        />
        <span>/ {total}</span>
        <button
          className="pica-pagination-jump-btn"
          onClick={() => handleJump()}
          title={t("Confirm")}
        >
          {t("Confirm")}
        </button>
      </div>
    </div>
  );
};

class PicaDialog extends React.Component<PicaDialogProps, PicaDialogState> {
  private progressListener: any = null;
  private finishListener: any = null;
  private errorListener: any = null;

  constructor(props: PicaDialogProps) {
    super(props);

    const savedConfig = this.loadConfig();
    const savedTasks = this.loadTasks();
    const savedAuth = this.loadAuth();
    const savedUser = this.loadUser();
    const savedToken = ConfigService.getItem("picaToken") || null;

    this.state = {
      currentTab: "search",
      searchQuery: "",
      searchSort: "ua",
      searchCategory: "",
      searchTag: "",
      searchAuthor: "",
      searchPage: 1,
      searchTotalPages: 1,
      searchTotalCount: 0,
      searchResults: [],
      isSearching: false,

      exploreSubTab: "categories",
      categories: [],
      isLoadingCategories: false,
      selectedCategory: "",
      categoryPage: 1,
      categoryTotalPages: 1,
      categoryResults: [],
      isLoadingCategoryComics: false,

      rankTime: "H24",
      rankType: "VC",
      rankResults: [],
      isRanking: false,

      randomResults: [],
      isRandomLoading: false,

      currentUser: savedUser,
      savedAuth: savedAuth,
      token: savedToken,
      isLoggingIn: false,
      loginUsernameInput: savedAuth?.username || "",
      loginPasswordInput: savedAuth?.password || "",
      loginRememberInput: savedAuth?.remember !== false,
      loginErrorMsg: "",

      favoriteSort: "dd",
      favoritePage: 1,
      favoriteTotalPages: 1,
      favoriteTotalCount: 0,
      favoriteResults: [],
      isFavoritesLoading: false,

      isBatchMode: false,
      selectedBatchIds: [],

      selectedComicId: null,
      selectedComicDetail: null,
      selectedEpOrders: [],
      isLoadingDetail: false,
      isFavoritedDetail: false,
      isTogglingFavorite: false,

      downloadTasks: savedTasks,
      downloadQueue: [],
      isQueueRunning: false,

      config: savedConfig,
      routeSpeedTest: {},
    };
  }

  componentDidMount() {
    this.setupDownloadListeners();
    this.syncConfigToBackend();
    if (this.state.token) {
      this.fetchProfile();
    }
  }

  componentWillUnmount() {
    this.removeDownloadListeners();
  }

  loadConfig(): PicaConfig {
    try {
      const saved = ConfigService.getObjectConfig("picaConfig") || {};
      return {
        route: saved.route || "route1",
        proxy: saved.proxy || "",
        quality: saved.quality || "original",
        threads: saved.threads || 3,
        delayMs: saved.delayMs || 200,
        outputDir: saved.outputDir || "",
        combineCbz: saved.combineCbz !== false,
        autoImport: saved.autoImport !== false,
      };
    } catch {
      return {
        route: "route1",
        proxy: "",
        quality: "original",
        threads: 3,
        delayMs: 200,
        combineCbz: true,
        autoImport: true,
      };
    }
  }

  loadAuth(): { username: string; password?: string; remember: boolean } | null {
    try {
      return ConfigService.getObjectConfig("picaAuth") || null;
    } catch {
      return null;
    }
  }

  loadUser(): PicaUserProfile | null {
    try {
      return ConfigService.getObjectConfig("picaUser") || null;
    } catch {
      return null;
    }
  }

  loadTasks(): Record<string, PicaDownloadTask> {
    try {
      return ConfigService.getObjectConfig("picaDownloadTasks") || {};
    } catch {
      return {};
    }
  }

  saveTasks(tasks: Record<string, PicaDownloadTask>) {
    try {
      ConfigService.setObjectConfig("picaDownloadTasks", tasks);
    } catch (e) {
      console.error("Failed to persist pica download tasks:", e);
    }
  }

  saveConfig(config: PicaConfig) {
    try {
      ConfigService.setObjectConfig("picaConfig", config);
      this.syncConfigToBackend();
    } catch (e) {
      console.error("Failed to save pica config:", e);
    }
  }

  syncConfigToBackend() {
    const ipc = getIpc();
    if (ipc) {
      ipc.invoke("pica-update-config", {
        route: this.state.config.route,
        proxy: this.state.config.proxy,
        quality: this.state.config.quality,
        token: this.state.token,
      }).catch((err: any) => console.error("Sync pica config failed:", err));
    }
  }

  // --- Check if Comic is in Koodo Library ---
  isComicInLibrary = (comic: PicaComicItem | { id: string; title: string; author?: string }) => {
    if (!this.props.books || this.props.books.length === 0 || !comic || !comic.title) {
      return false;
    }
    const cleanPicaTitle = comic.title.trim().toLowerCase();
    const cleanPicaAuthor = (comic.author || "").trim().toLowerCase();

    return this.props.books.some((book: any) => {
      const bookName = (book.name || book.title || "").trim().toLowerCase();
      const bookAuthor = (book.author || "").trim().toLowerCase();

      if (bookName === cleanPicaTitle) return true;
      if (bookName.includes(cleanPicaTitle) || cleanPicaTitle.includes(bookName)) {
        if (cleanPicaAuthor && bookAuthor && (bookAuthor.includes(cleanPicaAuthor) || cleanPicaAuthor.includes(bookAuthor))) {
          return true;
        }
        if (cleanPicaTitle.length >= 4 && bookName.length >= 4) {
          return true;
        }
      }
      return false;
    });
  };

  // --- Auto-import downloaded CBZ file into Koodo Reader ---
  importBookFile = async (filePath: string, fileName: string) => {
    const ipc = getIpc();
    try {
      if (ipc) {
        const buffer = await ipc.invoke("file-command", {
          operation: "read",
          path: filePath,
        });
        if (buffer) {
          const arraybuffer = new Uint8Array(buffer).buffer;
          const blob = new Blob([arraybuffer], { type: "application/x-cbz" });
          const fileObj: any = new File([blob], fileName, {
            type: "application/x-cbz",
          });
          fileObj.path = filePath;

          if (typeof this.props.importBookFunc === "function") {
            await this.props.importBookFunc(fileObj);
          }
          if (typeof this.props.handleFetchBooks === "function") {
            this.props.handleFetchBooks();
          }
          return true;
        }
      }
    } catch (err) {
      console.error("Import pica CBZ failed:", filePath, err);
    }
    return false;
  };

  // --- Setup Download Listeners ---
  setupDownloadListeners() {
    const ipc = getIpc();
    if (ipc) {
      this.progressListener = (arg1: any, arg2: any) => {
        const data = extractPayload(arg1, arg2);
        if (!data) return;
        const { comicId, percent, currentEpTitle, currentEpIndex, totalEps, status } = data;
        this.setState((prev) => {
          const task = prev.downloadTasks[comicId] || {
            comicId,
            title: `Pica-${comicId}`,
            author: "",
            coverUrl: "",
            status: "downloading",
            percent: 0,
          };

          const newTasks = {
            ...prev.downloadTasks,
            [comicId]: {
              ...task,
              status: status || (percent >= 90 ? "packaging" : "downloading"),
              percent: percent !== undefined ? percent : task.percent,
              currentEpTitle,
              currentEpIndex,
              totalEps,
            },
          };
          this.saveTasks(newTasks);
          return { downloadTasks: newTasks };
        });
      };

      this.finishListener = async (arg1: any, arg2: any) => {
        const data = extractPayload(arg1, arg2);
        if (!data) return;
        const { comicId, files, title, author, coverUrl } = data;
        this.setState((prev) => {
          const task = prev.downloadTasks[comicId] || {
            comicId,
            title: title || `Pica-${comicId}`,
            author: author || "",
            coverUrl: coverUrl || "",
            status: "completed",
            percent: 100,
          };

          const newTasks = {
            ...prev.downloadTasks,
            [comicId]: {
              ...task,
              title: title || task.title,
              author: author || task.author,
              coverUrl: coverUrl || task.coverUrl,
              status: "completed" as const,
              percent: 100,
              createdFiles: files,
              imported: true,
            },
          };
          this.saveTasks(newTasks);
          return { downloadTasks: newTasks, isQueueRunning: false };
        }, () => {
          setTimeout(() => this.processNextInQueue(), 600);
        });

        toast.success(`${this.props.t("Download Completed")}: ${title || comicId}`);

        // Auto import into Koodo library
        if (this.state.config.autoImport && files && files.length > 0) {
          for (const item of files) {
            await this.importBookFile(item.path, item.name);
          }
          if (typeof this.props.handleFetchBooks === "function") {
            this.props.handleFetchBooks();
          }
        }
      };

      this.errorListener = (arg1: any, arg2: any) => {
        const data = extractPayload(arg1, arg2);
        if (!data) return;
        const { comicId, msg } = data;
        this.setState((prev) => {
          const task = prev.downloadTasks[comicId] || {
            comicId,
            title: `Pica-${comicId}`,
            author: "",
            coverUrl: "",
            status: "failed",
            percent: 0,
          };

          const newTasks = {
            ...prev.downloadTasks,
            [comicId]: {
              ...task,
              status: "failed" as const,
              errorMsg: msg,
            },
          };
          this.saveTasks(newTasks);
          return { downloadTasks: newTasks, isQueueRunning: false };
        }, () => {
          setTimeout(() => this.processNextInQueue(), 600);
        });
        toast.error(`${this.props.t("Download Failed")}: ${msg || ""}`);
      };

      ipc.on("pica-download-progress", this.progressListener);
      ipc.on("pica-download-finish", this.finishListener);
      ipc.on("pica-download-error", this.errorListener);
    }
  }

  removeDownloadListeners() {
    const ipc = getIpc();
    if (ipc) {
      if (this.progressListener) ipc.removeListener("pica-download-progress", this.progressListener);
      if (this.finishListener) ipc.removeListener("pica-download-finish", this.finishListener);
      if (this.errorListener) ipc.removeListener("pica-download-error", this.errorListener);
    }
  }

  // --- Auth Handlers ---
  handleLogin = async () => {
    const { loginUsernameInput, loginPasswordInput, loginRememberInput } = this.state;
    if (!loginUsernameInput.trim() || !loginPasswordInput.trim()) {
      this.setState({ loginErrorMsg: this.props.t("Please enter account and password") });
      return;
    }

    this.setState({ isLoggingIn: true, loginErrorMsg: "" });
    const ipc = getIpc();
    if (!ipc) {
      this.setState({ isLoggingIn: false, loginErrorMsg: "Electron IPC not available" });
      return;
    }

    try {
      const res = await ipc.invoke("pica-login", {
        username: loginUsernameInput.trim(),
        password: loginPasswordInput.trim(),
        remember: loginRememberInput,
        proxy: this.state.config.proxy,
        route: this.state.config.route,
      });

      if (res.code === 200 && res.data && res.data.token) {
        const token = res.data.token;
        ConfigService.setItem("picaToken", token);
        if (loginRememberInput) {
          ConfigService.setObjectConfig("picaAuth", {
            username: loginUsernameInput.trim(),
            password: loginPasswordInput.trim(),
            remember: true,
          });
        } else {
          ConfigService.setObjectConfig("picaAuth", null);
        }

        this.setState({ token, isLoggingIn: false }, () => {
          this.fetchProfile();
          this.fetchFavorites(1);
        });
        toast.success(this.props.t("Login successful"));
      } else {
        this.setState({
          isLoggingIn: false,
          loginErrorMsg: res.message || res.error || this.props.t("Invalid credentials"),
        });
      }
    } catch (err: any) {
      this.setState({
        isLoggingIn: false,
        loginErrorMsg: err.message || "Login request error",
      });
    }
  };

  handleLogout = () => {
    ConfigService.setItem("picaToken", "");
    ConfigService.setObjectConfig("picaUser", null);
    ConfigService.setObjectConfig("picaAuth", null);
    this.setState({
      token: null,
      currentUser: null,
      favoriteResults: [],
      favoriteTotalPages: 1,
      favoriteTotalCount: 0,
      loginPasswordInput: "",
    });
    toast.success(this.props.t("Signed out"));
  };

  fetchProfile = async () => {
    const ipc = getIpc();
    if (!ipc || !this.state.token) return;
    try {
      const res = await ipc.invoke("pica-get-profile", { token: this.state.token });
      if (res.code === 200 && res.data && res.data.user) {
        const user = res.data.user;
        ConfigService.setObjectConfig("picaUser", user);
        this.setState({ currentUser: user });
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    }
  };

  // --- Search Handler ---
  handleSearch = async (page = 1) => {
    const { searchQuery, searchSort, searchCategory } = this.state;
    if (!searchQuery.trim() && !searchCategory) return;

    this.setState({ isSearching: true, searchPage: page });
    const ipc = getIpc();
    if (!ipc) {
      this.setState({ isSearching: false });
      return;
    }

    try {
      const res = await ipc.invoke("pica-search", {
        keyword: searchQuery.trim(),
        sort: searchSort,
        categories: searchCategory ? [searchCategory] : [],
        page,
        token: this.state.token,
      });

      if (res.code === 200 && res.data && res.data.comics) {
        const comicsData = res.data.comics;
        const docs = (comicsData.docs || []).map((c: any) => ({
          ...c,
          id: c._id || c.id,
        }));
        this.setState({
          searchResults: docs,
          searchTotalPages: comicsData.pages || 1,
          searchTotalCount: comicsData.total || docs.length,
          isSearching: false,
        });
      } else {
        toast.error(res.message || this.props.t("Search failed"));
        this.setState({ isSearching: false });
      }
    } catch (err: any) {
      toast.error(err.message || "Search error");
      this.setState({ isSearching: false });
    }
  };

  // --- Explore & Categories & Leaderboard ---
  fetchCategories = async () => {
    this.setState({ isLoadingCategories: true });
    const ipc = getIpc();
    if (!ipc) return;
    try {
      const res = await ipc.invoke("pica-get-categories", { token: this.state.token });
      if (res.code === 200 && res.data && res.data.categories) {
        this.setState({
          categories: res.data.categories,
          isLoadingCategories: false,
        });
      } else {
        this.setState({ isLoadingCategories: false });
      }
    } catch {
      this.setState({ isLoadingCategories: false });
    }
  };

  fetchCategoryComics = async (categoryTitle: string, page = 1) => {
    this.setState({
      selectedCategory: categoryTitle,
      isLoadingCategoryComics: true,
      categoryPage: page,
    });
    const ipc = getIpc();
    if (!ipc) return;
    try {
      const res = await ipc.invoke("pica-get-comics", {
        category: categoryTitle,
        page,
        sort: "dd",
        token: this.state.token,
      });
      if (res.code === 200 && res.data && res.data.comics) {
        const comicsData = res.data.comics;
        const docs = (comicsData.docs || []).map((c: any) => ({
          ...c,
          id: c._id || c.id,
        }));
        this.setState({
          categoryResults: docs,
          categoryTotalPages: comicsData.pages || 1,
          isLoadingCategoryComics: false,
        });
      } else {
        this.setState({ isLoadingCategoryComics: false });
      }
    } catch {
      this.setState({ isLoadingCategoryComics: false });
    }
  };

  fetchLeaderboard = async () => {
    if (!this.state.token) {
      this.setState({ isRanking: false, rankResults: [] });
      return;
    }
    this.setState({ isRanking: true });
    const ipc = getIpc();
    if (!ipc) return;
    try {
      const res = await ipc.invoke("pica-get-leaderboard", {
        timeType: this.state.rankTime,
        categoryType: this.state.rankType,
        token: this.state.token,
      });
      if (res.code === 200 && res.data && res.data.comics) {
        const rawDocs = Array.isArray(res.data.comics) ? res.data.comics : res.data.comics.docs || [];
        const docs = rawDocs.map((c: any) => ({
          ...c,
          id: c._id || c.id,
        }));
        this.setState({
          rankResults: docs,
          isRanking: false,
        });
      } else {
        this.setState({ isRanking: false });
        if (res.message && res.message !== "success") {
          toast(res.message);
        }
      }
    } catch {
      this.setState({ isRanking: false });
    }
  };

  fetchRandom = async () => {
    this.setState({ isRandomLoading: true });
    const ipc = getIpc();
    if (!ipc) return;
    try {
      const res = await ipc.invoke("pica-get-random", { token: this.state.token });
      if (res.code === 200 && res.data && res.data.comics) {
        const rawDocs = Array.isArray(res.data.comics) ? res.data.comics : res.data.comics.docs || [];
        const docs = rawDocs.map((c: any) => ({
          ...c,
          id: c._id || c.id,
        }));
        this.setState({
          randomResults: docs,
          isRandomLoading: false,
        });
      } else {
        this.setState({ isRandomLoading: false });
      }
    } catch {
      this.setState({ isRandomLoading: false });
    }
  };

  // --- Favorites Handlers ---
  fetchFavorites = async (page = 1) => {
    if (!this.state.token) return;
    this.setState({ isFavoritesLoading: true, favoritePage: page });
    const ipc = getIpc();
    if (!ipc) return;
    try {
      const res = await ipc.invoke("pica-get-favorites", {
        page,
        sort: this.state.favoriteSort,
        token: this.state.token,
      });

      if (res.code === 200 && res.data && res.data.comics) {
        const comicsData = res.data.comics;
        const docs = (comicsData.docs || []).map((c: any) => ({
          ...c,
          id: c._id || c.id,
        }));
        this.setState({
          favoriteResults: docs,
          favoriteTotalPages: comicsData.pages || 1,
          favoriteTotalCount: comicsData.total || docs.length,
          isFavoritesLoading: false,
        });
      } else {
        this.setState({ isFavoritesLoading: false });
      }
    } catch {
      this.setState({ isFavoritesLoading: false });
    }
  };

  // --- Detail Drawer Handlers ---
  openComicDetail = async (comicId: string) => {
    this.setState({
      selectedComicId: comicId,
      isLoadingDetail: true,
      selectedComicDetail: null,
      selectedEpOrders: [],
    });

    const ipc = getIpc();
    if (!ipc) return;

    try {
      const [detailRes, epsRes] = await Promise.all([
        ipc.invoke("pica-get-detail", { comicId, token: this.state.token }),
        ipc.invoke("pica-get-episodes", { comicId, page: 1, token: this.state.token }),
      ]);

      if (detailRes.code === 200 && detailRes.data && detailRes.data.comic) {
        const comic = detailRes.data.comic;
        let epsList: any[] = [];
        if (epsRes.code === 200 && epsRes.data && epsRes.data.eps) {
          epsList = epsRes.data.eps.docs || [];
          epsList.sort((a, b) => a.order - b.order);
        }

        const detailData: PicaComicDetailData = {
          ...comic,
          id: comic._id || comic.id,
          episodes: epsList.map((ep) => ({
            ...ep,
            id: ep._id || ep.id,
          })),
        };

        const allOrders = detailData.episodes.map((ep) => ep.order);

        this.setState({
          selectedComicDetail: detailData,
          selectedEpOrders: allOrders,
          isFavoritedDetail: Boolean(comic.isFavourite),
          isLoadingDetail: false,
        });
      } else {
        toast.error(detailRes.message || "Failed to load comic details");
        this.setState({ isLoadingDetail: false });
      }
    } catch (err: any) {
      toast.error(err.message || "Error loading details");
      this.setState({ isLoadingDetail: false });
    }
  };

  closeComicDetail = () => {
    this.setState({
      selectedComicId: null,
      selectedComicDetail: null,
      selectedEpOrders: [],
    });
  };

  toggleFavoriteDetail = async () => {
    const { selectedComicId, isFavoritedDetail, token } = this.state;
    if (!selectedComicId) return;
    if (!token) {
      toast(this.props.t("Please login first"));
      return;
    }

    this.setState({ isTogglingFavorite: true });
    const ipc = getIpc();
    if (!ipc) return;

    try {
      const res = await ipc.invoke("pica-toggle-favorite", {
        comicId: selectedComicId,
        token,
      });

      if (res.code === 200) {
        const nextState = !isFavoritedDetail;
        this.setState({
          isFavoritedDetail: nextState,
          isTogglingFavorite: false,
        });
        toast.success(nextState ? this.props.t("Added to Favorites") : this.props.t("Removed from Favorites"));
        if (this.state.currentTab === "favorites") {
          this.fetchFavorites(this.state.favoritePage);
        }
      } else {
        toast.error(res.message || "Failed to toggle favorite");
        this.setState({ isTogglingFavorite: false });
      }
    } catch (err: any) {
      toast.error(err.message || "Network error");
      this.setState({ isTogglingFavorite: false });
    }
  };

  // --- Download Queue & Execution ---
  enqueueDownload = (
    comic: PicaComicItem | PicaComicDetailData,
    selectedEpOrders: number[] = [],
    combineCbz: boolean = true
  ) => {
    const comicId = comic.id || (comic as any)._id;
    const title = comic.title || `Pica-${comicId}`;
    const author = comic.author || "";
    const coverUrl = comic.thumbUrl || (comic.thumb ? (comic.thumb as any).fileServer : "");

    this.setState((prev) => {
      const newTask: PicaDownloadTask = {
        comicId,
        title,
        author,
        coverUrl,
        status: "pending",
        percent: 0,
        selectedEpOrders,
        combineCbz,
      };

      const newTasks = {
        ...prev.downloadTasks,
        [comicId]: newTask,
      };
      this.saveTasks(newTasks);

      const newQueue = prev.downloadQueue.includes(comicId)
        ? prev.downloadQueue
        : [...prev.downloadQueue, comicId];

      return {
        downloadTasks: newTasks,
        downloadQueue: newQueue,
      };
    }, () => {
      this.processNextInQueue();
    });

    toast.success(`${this.props.t("Download Started")}: ${title}`);
  };

  processNextInQueue = () => {
    if (this.state.isQueueRunning) return;

    const pendingId = this.state.downloadQueue.find((id) => {
      const task = this.state.downloadTasks[id];
      return task && (task.status === "pending" || task.status === "downloading");
    });

    if (!pendingId) {
      this.setState({ isQueueRunning: false });
      return;
    }

    const task = this.state.downloadTasks[pendingId];
    if (!task) return;

    this.setState({ isQueueRunning: true });
    const ipc = getIpc();
    if (ipc) {
      ipc.invoke("pica-download", {
        comicId: pendingId,
        selectedEpOrders: task.selectedEpOrders || [],
        combineCbz: task.combineCbz !== false,
        outputDir: this.state.config.outputDir || "",
        threads: this.state.config.threads || 3,
        delayMs: this.state.config.delayMs || 200,
        proxy: this.state.config.proxy || "",
        route: this.state.config.route || "route1",
        quality: this.state.config.quality || "original",
        token: this.state.token,
      }).then((res: any) => {
        if (res && res.code !== 0) {
          this.setState((prev) => {
            const updated = {
              ...prev.downloadTasks,
              [pendingId]: {
                ...task,
                status: "failed" as const,
                errorMsg: res.msg || "Failed to start download",
              },
            };
            this.saveTasks(updated);
            return { downloadTasks: updated, isQueueRunning: false };
          }, () => {
            this.processNextInQueue();
          });
        }
      }).catch((err: any) => {
        this.setState((prev) => {
          const updated = {
            ...prev.downloadTasks,
            [pendingId]: {
              ...task,
              status: "failed" as const,
              errorMsg: err.message,
            },
          };
          this.saveTasks(updated);
          return { downloadTasks: updated, isQueueRunning: false };
        }, () => {
          this.processNextInQueue();
        });
      });
    }
  };

  cancelDownload = async (comicId: string) => {
    const ipc = getIpc();
    if (ipc) {
      await ipc.invoke("pica-cancel-download", { comicId });
    }
    this.setState((prev) => {
      const task = prev.downloadTasks[comicId];
      if (!task) return null;
      const newTasks = {
        ...prev.downloadTasks,
        [comicId]: {
          ...task,
          status: "cancelled" as const,
        },
      };
      const newQueue = prev.downloadQueue.filter((id) => id !== comicId);
      this.saveTasks(newTasks);
      return { downloadTasks: newTasks, downloadQueue: newQueue, isQueueRunning: false };
    }, () => {
      this.processNextInQueue();
    });
    toast(this.props.t("Download Cancelled"));
  };

  retryDownload = (comicId: string) => {
    const task = this.state.downloadTasks[comicId];
    if (task) {
      this.enqueueDownload(
        { id: comicId, title: task.title, author: task.author, thumbUrl: task.coverUrl } as any,
        task.selectedEpOrders || [],
        task.combineCbz !== false
      );
    }
  };

  clearFinishedDownloads = () => {
    this.setState((prev) => {
      const newTasks: Record<string, PicaDownloadTask> = {};
      Object.entries(prev.downloadTasks).forEach(([id, task]) => {
        if (task.status !== "completed" && task.status !== "cancelled") {
          newTasks[id] = task;
        }
      });
      this.saveTasks(newTasks);
      return { downloadTasks: newTasks };
    });
    toast.success(this.props.t("Clear Finished"));
  };

  // --- Batch Selection in Favorites ---
  toggleBatchMode = () => {
    this.setState((prev) => ({
      isBatchMode: !prev.isBatchMode,
      selectedBatchIds: [],
    }));
  };

  toggleSelectBatchItem = (comicId: string) => {
    this.setState((prev) => {
      const exists = prev.selectedBatchIds.includes(comicId);
      return {
        selectedBatchIds: exists
          ? prev.selectedBatchIds.filter((id) => id !== comicId)
          : [...prev.selectedBatchIds, comicId],
      };
    });
  };

  selectAllOnPage = () => {
    const pageIds = this.state.favoriteResults.map((c) => c.id);
    this.setState({ selectedBatchIds: Array.from(new Set(pageIds)) });
  };

  selectAllUnimported = () => {
    const unimportedIds = this.state.favoriteResults
      .filter((c) => !this.isComicInLibrary(c))
      .map((c) => c.id);
    this.setState({ selectedBatchIds: unimportedIds });
  };

  clearBatchSelection = () => {
    this.setState({ selectedBatchIds: [] });
  };

  batchAddToQueue = () => {
    const { selectedBatchIds } = this.state;
    if (selectedBatchIds.length === 0) return;

    const allKnownComics = [
      ...this.state.searchResults,
      ...this.state.categoryResults,
      ...this.state.rankResults,
      ...this.state.randomResults,
      ...this.state.favoriteResults,
    ];

    let count = 0;
    selectedBatchIds.forEach((id) => {
      const comic = allKnownComics.find((c) => c.id === id);
      if (comic) {
        this.enqueueDownload(comic, [], true);
        count++;
      }
    });

    this.setState({
      isBatchMode: false,
      selectedBatchIds: [],
      currentTab: "downloads",
    });
    toast.success(`${count} ${this.props.t("Download started in background")}`);
  };

  renderBatchBar = (items: PicaComicItem[]) => {
    const { t } = this.props;
    const { isBatchMode, selectedBatchIds } = this.state;
    if (!isBatchMode || items.length === 0) return null;

    const allIds = items.map((c) => c.id);
    const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedBatchIds.includes(id));

    return (
      <div className="pica-batch-bar">
        <div className="pica-batch-bar-left">
          <span>
            {t("Selected")}: {selectedBatchIds.length}
          </span>
          <button
            className="pica-btn outline"
            style={{ padding: "3px 8px", fontSize: 12 }}
            onClick={() => {
              if (isAllSelected) {
                this.setState((prev) => ({
                  selectedBatchIds: prev.selectedBatchIds.filter((id) => !allIds.includes(id)),
                }));
              } else {
                this.setState((prev) => ({
                  selectedBatchIds: Array.from(new Set([...prev.selectedBatchIds, ...allIds])),
                }));
              }
            }}
          >
            {isAllSelected ? t("Deselect All") : t("Select All")}
          </button>
        </div>
        <div className="pica-batch-bar-right">
          <button
            className="pica-btn"
            style={{ padding: "4px 12px", fontSize: 12 }}
            disabled={selectedBatchIds.length === 0}
            onClick={this.batchAddToQueue}
          >
            📥 {t("Batch Download")} ({selectedBatchIds.length})
          </button>
          <button
            className="pica-btn secondary"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => this.setState({ isBatchMode: false, selectedBatchIds: [] })}
          >
            {t("Exit Batch Mode")}
          </button>
        </div>
      </div>
    );
  };

  // --- Speed Test Route ---
  testRoute = async (routeKey: string) => {
    this.setState((prev) => ({
      routeSpeedTest: { ...prev.routeSpeedTest, [routeKey]: "testing" },
    }));

    const ipc = getIpc();
    if (!ipc) return;

    try {
      const res = await ipc.invoke("pica-test-route", { route: routeKey });
      if (res && (res.success || res.code === 200)) {
        this.setState((prev) => ({
          routeSpeedTest: {
            ...prev.routeSpeedTest,
            [routeKey]: Number(res.latency ?? res.timeMs ?? 0),
          },
        }));
      } else {
        this.setState((prev) => ({
          routeSpeedTest: { ...prev.routeSpeedTest, [routeKey]: "error" },
        }));
      }
    } catch {
      this.setState((prev) => ({
        routeSpeedTest: { ...prev.routeSpeedTest, [routeKey]: "error" },
      }));
    }
  };

  // --- Render Comic Card ---
  renderComicCard = (comic: PicaComicItem) => {
    const { t } = this.props;
    const { isBatchMode, selectedBatchIds } = this.state;
    const inLibrary = this.isComicInLibrary(comic);
    const isSelected = selectedBatchIds.includes(comic.id);

    return (
      <div
        key={comic.id}
        className={`pica-comic-card ${isSelected ? "selected" : ""}`}
        onClick={() => {
          if (isBatchMode) {
            this.toggleSelectBatchItem(comic.id);
          } else {
            this.openComicDetail(comic.id);
          }
        }}
      >
        <div className="pica-card-cover-wrap">
          {comic.thumbUrl && (
            <img
              src={comic.thumbUrl}
              alt={comic.title}
              className="pica-card-cover"
              loading="lazy"
              onError={(e: any) => {
                e.target.style.display = "none";
              }}
            />
          )}
          {inLibrary && <div className="pica-badge-in-library">{t("In Library")}</div>}
          {comic.pagesCount ? (
            <div className="pica-badge-pages">{comic.pagesCount}P</div>
          ) : null}
          {isBatchMode && (
            <input
              type="checkbox"
              className="pica-card-checkbox"
              checked={isSelected}
              onChange={() => this.toggleSelectBatchItem(comic.id)}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
        <div className="pica-card-info">
          <div className="pica-card-title" title={comic.title}>
            {comic.title}
          </div>
          <div className="pica-card-author" title={comic.author}>
            {comic.author || t("Unknown Author")}
          </div>
          <div className="pica-card-meta">
            <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
              {comic.likesCount ? (
                <span className="pica-card-likes">
                  ❤️ {comic.likesCount}
                </span>
              ) : (
                <span>{comic.categories && comic.categories[0] ? comic.categories[0] : ""}</span>
              )}
            </div>
            <button
              className={`pica-card-download-btn ${inLibrary ? "downloaded" : ""}`}
              title={inLibrary ? t("Already in library") : t("Download full album")}
              onClick={(e) => {
                e.stopPropagation();
                this.enqueueDownload(comic, [], true);
              }}
            >
              {inLibrary ? `✓ ${t("Downloaded")}` : `📥 ${t("Download")}`}
            </button>
          </div>
        </div>
      </div>
    );
  };

  render() {
    const {
      currentTab,
      searchQuery,
      searchSort,
      searchResults,
      isSearching,
      searchPage,
      searchTotalPages,
      exploreSubTab,
      categories,
      isLoadingCategories,
      selectedCategory,
      categoryResults,
      categoryPage,
      categoryTotalPages,
      isLoadingCategoryComics,
      rankTime,
      rankType,
      rankResults,
      isRanking,
      randomResults,
      isRandomLoading,
      currentUser,
      token,
      loginUsernameInput,
      loginPasswordInput,
      loginRememberInput,
      loginErrorMsg,
      isLoggingIn,
      favoriteSort,
      favoritePage,
      favoriteTotalPages,
      favoriteResults,
      isFavoritesLoading,
      isBatchMode,
      selectedBatchIds,
      selectedComicDetail,
      selectedEpOrders,
      isLoadingDetail,
      isFavoritedDetail,
      isTogglingFavorite,
      downloadTasks,
      config,
      routeSpeedTest,
    } = this.state;
    const { t } = this.props;

    const activeDownloadsCount = Object.values(downloadTasks).filter(
      (task) =>
        task.status === "downloading" ||
        task.status === "packaging" ||
        task.status === "pending"
    ).length;

    return (
      <div className="pica-dialog-container" onClick={(e) => e.stopPropagation()}>
        {/* Header Tabs */}
        <div className="pica-header">
          <div className="pica-tabs">
            <button
              className={`pica-tab-btn ${currentTab === "search" ? "active" : ""}`}
              onClick={() => this.setState({ currentTab: "search", isBatchMode: false, selectedBatchIds: [] })}
            >
              <span className="icon-search"></span>
              {t("Search Comics")}
            </button>
            <button
              className={`pica-tab-btn ${currentTab === "explore" ? "active" : ""}`}
              onClick={() => {
                this.setState({ currentTab: "explore", isBatchMode: false, selectedBatchIds: [] }, () => {
                  if (categories.length === 0) this.fetchCategories();
                });
              }}
            >
              <span className="icon-discover"></span>
              {t("Explore & Categories")}
            </button>
            <button
              className={`pica-tab-btn ${currentTab === "favorites" ? "active" : ""}`}
              onClick={() => {
                this.setState({ currentTab: "favorites", isBatchMode: false, selectedBatchIds: [] }, () => {
                  if (token && favoriteResults.length === 0) this.fetchFavorites(1);
                });
              }}
            >
              <span className="icon-heart"></span>
              {t("Favorites")}
            </button>
            <button
              className={`pica-tab-btn ${currentTab === "downloads" ? "active" : ""}`}
              onClick={() => this.setState({ currentTab: "downloads", isBatchMode: false, selectedBatchIds: [] })}
            >
              <span className="icon-download"></span>
              {t("Download Tasks")}
              {activeDownloadsCount > 0 && (
                <span className="pica-badge">{activeDownloadsCount}</span>
              )}
            </button>
            <button
              className={`pica-tab-btn ${currentTab === "settings" ? "active" : ""}`}
              onClick={() => this.setState({ currentTab: "settings", isBatchMode: false, selectedBatchIds: [] })}
            >
              <span className="icon-setting"></span>
              {t("Settings")}
            </button>
          </div>
          <div
            className="pica-close-btn"
            onClick={() => this.props.handlePicaDialog(false)}
          >
            <span className="icon-close"></span>
          </div>
        </div>

        {/* Dialog Body */}
        <div className="pica-body">
          {/* TAB 1: Search */}
          {currentTab === "search" && (
            <div className="pica-search-view">
              <div className="pica-search-bar">
                <input
                  type="text"
                  className="pica-search-input"
                  placeholder={t("Search PicaComic by keyword, author, or category...")}
                  value={searchQuery}
                  onChange={(e) => this.setState({ searchQuery: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") this.handleSearch(1);
                  }}
                />
                <select
                  className="pica-select"
                  value={searchSort}
                  onChange={(e) => {
                    this.setState({ searchSort: e.target.value as any }, () => {
                      if (searchQuery.trim()) this.handleSearch(1);
                    });
                  }}
                >
                  <option value="ua">{t("Default")}</option>
                  <option value="dd">{t("Latest")}</option>
                  <option value="da">{t("Earliest")}</option>
                  <option value="ld">{t("Most Likes")}</option>
                  <option value="vd">{t("Most Views")}</option>
                </select>
                <button
                  className="pica-btn"
                  onClick={() => this.handleSearch(1)}
                  disabled={isSearching}
                >
                  <span className="icon-search"></span>
                  {isSearching ? t("Searching...") : t("Search")}
                </button>
              </div>

              {isSearching ? (
                <div style={{ textAlign: "center", padding: "60px", color: "#888" }}>
                  {t("Searching...")}
                </div>
              ) : searchResults.length > 0 ? (
                <>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                    <button
                      className={`pica-btn ${isBatchMode ? "secondary" : "outline"}`}
                      style={{ padding: "4px 10px", fontSize: 13 }}
                      onClick={this.toggleBatchMode}
                    >
                      {isBatchMode ? t("Exit Batch Mode") : t("Batch Management")}
                    </button>
                  </div>
                  {this.renderBatchBar(searchResults)}
                  <div className="pica-comic-grid">
                    {searchResults.map((c) => this.renderComicCard(c))}
                  </div>
                  <PicaPagination
                    current={searchPage}
                    total={searchTotalPages}
                    onPageChange={(p) => this.handleSearch(p)}
                    t={t}
                  />
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "60px", color: "#888" }}>
                  {t("Enter a keyword to start searching on PicaComic")}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Explore & Categories & Rank */}
          {currentTab === "explore" && (
            <div className="pica-explore-view">
              <div className="pica-subtab-bar">
                <div
                  className={`pica-subtab-item ${exploreSubTab === "categories" ? "active" : ""}`}
                  onClick={() => {
                    this.setState({ exploreSubTab: "categories" });
                    if (categories.length === 0) this.fetchCategories();
                  }}
                >
                  {t("Official Categories")}
                </div>
                <div
                  className={`pica-subtab-item ${exploreSubTab === "rank" ? "active" : ""}`}
                  onClick={() => {
                    this.setState({ exploreSubTab: "rank" }, () => this.fetchLeaderboard());
                  }}
                >
                  {t("Rankings")}
                </div>
                <div
                  className={`pica-subtab-item ${exploreSubTab === "random" ? "active" : ""}`}
                  onClick={() => {
                    this.setState({ exploreSubTab: "random" }, () => {
                      if (randomResults.length === 0) this.fetchRandom();
                    });
                  }}
                >
                  {t("Random Comics")}
                </div>
              </div>

              {/* Explore Sub-view: Categories */}
              {exploreSubTab === "categories" && (
                <div>
                  {selectedCategory ? (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <button
                            className="pica-btn secondary"
                            onClick={() => this.setState({ selectedCategory: "", categoryResults: [], isBatchMode: false, selectedBatchIds: [] })}
                          >
                            ← {t("Back to Categories")}
                          </button>
                          <h3 style={{ margin: 0 }}>{selectedCategory}</h3>
                        </div>
                        {categoryResults.length > 0 && (
                          <button
                            className={`pica-btn ${isBatchMode ? "secondary" : "outline"}`}
                            style={{ padding: "4px 10px", fontSize: 13 }}
                            onClick={this.toggleBatchMode}
                          >
                            {isBatchMode ? t("Exit Batch Mode") : t("Batch Management")}
                          </button>
                        )}
                      </div>
                      {this.renderBatchBar(categoryResults)}
                      {isLoadingCategoryComics ? (
                        <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                          {t("Loading...")}
                        </div>
                      ) : (
                        <>
                          <div className="pica-comic-grid">
                            {categoryResults.map((c) => this.renderComicCard(c))}
                          </div>
                          <PicaPagination
                            current={categoryPage}
                            total={categoryTotalPages}
                            onPageChange={(p) => this.fetchCategoryComics(selectedCategory, p)}
                            t={t}
                          />
                        </>
                      )}
                    </div>
                  ) : isLoadingCategories ? (
                    <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                      {t("Loading categories...")}
                    </div>
                  ) : (
                    <div className="pica-category-grid">
                      {categories.map((cat) => (
                        <div
                          key={cat._id}
                          className="pica-category-card"
                          onClick={() => this.fetchCategoryComics(cat.title, 1)}
                        >
                          {cat.thumbUrl ? (
                            <img src={cat.thumbUrl} alt={cat.title} className="pica-category-thumb" />
                          ) : (
                            <div className="pica-category-thumb" />
                          )}
                          <div className="pica-category-title">{cat.title}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Explore Sub-view: Rankings */}
              {exploreSubTab === "rank" && (
                <div>
                  {!token ? (
                    <div className="pica-login-prompt">
                      <div className="pica-login-prompt-icon">🏆</div>
                      <div className="pica-login-prompt-title">{t("Login Required for Leaderboard")}</div>
                      <div className="pica-login-prompt-desc">
                        {t("PicACG official leaderboard requires logging in with your account. Please log in first.")}
                      </div>
                      <button
                        className="pica-btn"
                        onClick={() => this.setState({ currentTab: "favorites", isBatchMode: false, selectedBatchIds: [] })}
                      >
                        {t("Go to Login")}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                        <div style={{ display: "flex", gap: 10 }}>
                          <select
                            className="pica-select"
                            value={rankTime}
                            onChange={(e) => {
                              this.setState({ rankTime: e.target.value as any }, () => this.fetchLeaderboard());
                            }}
                          >
                            <option value="H24">{t("24 Hours Leaderboard")}</option>
                            <option value="D7">{t("7 Days Leaderboard")}</option>
                            <option value="D30">{t("30 Days Leaderboard")}</option>
                          </select>
                          <select
                            className="pica-select"
                            value={rankType}
                            onChange={(e) => {
                              this.setState({ rankType: e.target.value as any }, () => this.fetchLeaderboard());
                            }}
                          >
                            <option value="VC">{t("Most Views")}</option>
                            <option value="CA">{t("Most Likes")}</option>
                          </select>
                        </div>
                        {rankResults.length > 0 && (
                          <button
                            className={`pica-btn ${isBatchMode ? "secondary" : "outline"}`}
                            style={{ padding: "4px 10px", fontSize: 13 }}
                            onClick={this.toggleBatchMode}
                          >
                            {isBatchMode ? t("Exit Batch Mode") : t("Batch Management")}
                          </button>
                        )}
                      </div>

                      {this.renderBatchBar(rankResults)}

                      {isRanking ? (
                        <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                          {t("Loading leaderboard...")}
                        </div>
                      ) : rankResults.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                          {t("No comics found")}
                        </div>
                      ) : (
                        <div className="pica-comic-grid">
                          {rankResults.map((c) => this.renderComicCard(c))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Explore Sub-view: Random */}
              {exploreSubTab === "random" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <button
                      className={`pica-btn ${isBatchMode ? "secondary" : "outline"}`}
                      style={{ padding: "4px 10px", fontSize: 13 }}
                      onClick={this.toggleBatchMode}
                    >
                      {isBatchMode ? t("Exit Batch Mode") : t("Batch Management")}
                    </button>
                    <button className="pica-btn secondary" onClick={this.fetchRandom} disabled={isRandomLoading}>
                      🎲 {t("Refresh Random")}
                    </button>
                  </div>

                  {this.renderBatchBar(randomResults)}

                  {isRandomLoading ? (
                    <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                      {t("Loading...")}
                    </div>
                  ) : randomResults.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                      {t("No comics found")}
                    </div>
                  ) : (
                    <div className="pica-comic-grid">
                      {randomResults.map((c) => this.renderComicCard(c))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Favorites */}
          {currentTab === "favorites" && (
            <div className="pica-favorites-view">
              {!token || !currentUser ? (
                <div className="pica-login-card">
                  <div className="pica-login-title">{t("PicACG Account Login")}</div>
                  {loginErrorMsg && <div className="pica-login-error">{loginErrorMsg}</div>}
                  <input
                    type="text"
                    className="pica-search-input"
                    placeholder={t("Account / Email")}
                    value={loginUsernameInput}
                    onChange={(e) => this.setState({ loginUsernameInput: e.target.value })}
                  />
                  <input
                    type="password"
                    className="pica-search-input"
                    placeholder={t("Password")}
                    value={loginPasswordInput}
                    onChange={(e) => this.setState({ loginPasswordInput: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") this.handleLogin();
                    }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={loginRememberInput}
                      onChange={(e) => this.setState({ loginRememberInput: e.target.checked })}
                    />
                    {t("Remember Password")}
                  </label>
                  <button className="pica-btn" onClick={this.handleLogin} disabled={isLoggingIn}>
                    {isLoggingIn ? t("Signing in...") : t("Sign In")}
                  </button>
                </div>
              ) : (
                <div>
                  {/* User Profile Card */}
                  <div className="pica-profile-card">
                    <div className="pica-profile-left">
                      {currentUser.avatarUrl ? (
                        <img src={currentUser.avatarUrl} alt="" className="pica-avatar" />
                      ) : (
                        <div className="pica-avatar" />
                      )}
                      <div className="pica-profile-meta">
                        <div className="pica-profile-name">{currentUser.name || currentUser.email}</div>
                        <div className="pica-profile-level">
                          <span className="pica-level-badge">Lv.{currentUser.level || 1}</span>
                          <span>{currentUser.title || "Knight"}</span>
                          <span style={{ marginLeft: 8, opacity: 0.8 }}>EXP: {currentUser.exp || 0}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="pica-btn secondary" onClick={() => this.fetchFavorites(1)}>
                        🔄 {t("Refresh")}
                      </button>
                      <button className="pica-btn outline" onClick={this.handleLogout}>
                        {t("Sign Out")}
                      </button>
                    </div>
                  </div>

                  {/* Batch Management Toolbar */}
                  <div className="pica-batch-bar">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        className={`pica-btn ${isBatchMode ? "secondary" : "outline"}`}
                        onClick={this.toggleBatchMode}
                      >
                        {isBatchMode ? t("Exit Batch Mode") : t("Batch Management")}
                      </button>
                      {isBatchMode && (
                        <>
                          <button className="pica-btn outline" onClick={this.selectAllOnPage}>
                            {t("Select All On Page")}
                          </button>
                          <button className="pica-btn outline" onClick={this.selectAllUnimported}>
                            {t("Select All Unimported")}
                          </button>
                          <button className="pica-btn outline" onClick={this.clearBatchSelection}>
                            {t("Deselect All")}
                          </button>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {t("Selected")}: {selectedBatchIds.length}
                          </span>
                        </>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      {isBatchMode && (
                        <button
                          className="pica-btn success"
                          disabled={selectedBatchIds.length === 0}
                          onClick={this.batchAddToQueue}
                        >
                          📥 {t("Batch Add to Queue")} ({selectedBatchIds.length})
                        </button>
                      )}
                      <select
                        className="pica-select"
                        value={favoriteSort}
                        onChange={(e) => {
                          this.setState({ favoriteSort: e.target.value as any }, () => this.fetchFavorites(1));
                        }}
                      >
                        <option value="dd">{t("Latest")}</option>
                        <option value="da">{t("Earliest")}</option>
                        <option value="ld">{t("Most Likes")}</option>
                        <option value="vd">{t("Most Views")}</option>
                      </select>
                    </div>
                  </div>

                  {isFavoritesLoading ? (
                    <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                      {t("Loading favorites...")}
                    </div>
                  ) : favoriteResults.length > 0 ? (
                    <>
                      <div className="pica-comic-grid">
                        {favoriteResults.map((c) => this.renderComicCard(c))}
                      </div>
                      <PicaPagination
                        current={favoritePage}
                        total={favoriteTotalPages}
                        onPageChange={(p) => this.fetchFavorites(p)}
                        t={t}
                      />
                    </>
                  ) : (
                    <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>
                      {t("No favorites found")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Download Tasks */}
          {currentTab === "downloads" && (
            <div className="pica-downloads-view">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{t("Download Tasks")}</span>
                <button className="pica-btn secondary" onClick={this.clearFinishedDownloads}>
                  {t("Clear Finished")}
                </button>
              </div>

              {Object.keys(downloadTasks).length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px", color: "#888" }}>
                  {t("No active or past download tasks")}
                </div>
              ) : (
                <div className="pica-download-list">
                  {Object.values(downloadTasks).map((task) => (
                    <div key={task.comicId} className="pica-download-item">
                      {task.coverUrl ? (
                        <img src={task.coverUrl} alt="" className="pica-download-cover" />
                      ) : (
                        <div className="pica-download-cover" />
                      )}
                      <div className="pica-download-info">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{task.title}</span>
                          <span
                            style={{
                              fontSize: 12,
                              color:
                                task.status === "completed"
                                  ? "#2ed573"
                                  : task.status === "failed"
                                    ? "#ff4757"
                                    : "#ff6b81",
                            }}
                          >
                            {task.status === "completed" && t("Completed & Imported")}
                            {task.status === "failed" && `${t("Failed")}: ${task.errorMsg || ""}`}
                            {task.status === "packaging" && t("Packaging CBZ...")}
                            {task.status === "downloading" && `${t("Downloading...")} ${task.percent}%`}
                            {task.status === "pending" && t("Queued")}
                            {task.status === "cancelled" && t("Cancelled")}
                          </span>
                        </div>

                        {task.currentEpTitle && (
                          <div style={{ fontSize: 11, color: "#888" }}>
                            {task.currentEpTitle} ({task.currentEpIndex || 1} / {task.totalEps || 1})
                          </div>
                        )}

                        <div className="pica-progress-bar-bg">
                          <div
                            className="pica-progress-bar-fill"
                            style={{
                              width: `${task.percent}%`,
                              backgroundColor:
                                task.status === "completed"
                                  ? "#2ed573"
                                  : task.status === "failed"
                                    ? "#ff4757"
                                    : "#ff6b81",
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 6 }}>
                        {task.status === "failed" && (
                          <button
                            className="pica-btn secondary"
                            onClick={() => this.retryDownload(task.comicId)}
                          >
                            {t("Retry")}
                          </button>
                        )}
                        {(task.status === "downloading" || task.status === "pending") && (
                          <button
                            className="pica-btn danger"
                            onClick={() => this.cancelDownload(task.comicId)}
                          >
                            {t("Cancel")}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: Settings */}
          {currentTab === "settings" && (
            <div className="pica-settings-view">
              <div className="pica-settings-form">
                <div className="pica-setting-group">
                  <label className="pica-setting-label">{t("Pica Route")}</label>
                  <div style={{ display: "flex", gap: 10 }}>
                    <select
                      className="pica-select"
                      style={{ flex: 1 }}
                      value={config.route}
                      onChange={(e) => {
                        const updated = { ...config, route: e.target.value as any };
                        this.setState({ config: updated });
                        this.saveConfig(updated);
                      }}
                    >
                      <option value="route1">{t("Route 1 (Official Channel 1)")}</option>
                      <option value="route2">{t("Route 2 (Official Channel 2)")}</option>
                      <option value="route3">{t("Route 3 (Official Channel 3)")}</option>
                    </select>
                    <button
                      className="pica-btn secondary"
                      onClick={() => this.testRoute(config.route)}
                    >
                      {routeSpeedTest[config.route] === "testing"
                        ? t("Testing...")
                        : typeof routeSpeedTest[config.route] === "number"
                          ? `${routeSpeedTest[config.route]}ms`
                          : t("Test Speed")}
                    </button>
                  </div>
                </div>

                <div className="pica-setting-group">
                  <label className="pica-setting-label">{t("Network Proxy")}</label>
                  <input
                    type="text"
                    className="pica-search-input"
                    placeholder={t("e.g. http://127.0.0.1:7890 or socks5://127.0.0.1:1080")}
                    value={config.proxy || ""}
                    onChange={(e) => {
                      const updated = { ...config, proxy: e.target.value };
                      this.setState({ config: updated });
                      this.saveConfig(updated);
                    }}
                  />
                  <div className="pica-setting-desc">
                    {t("Specify custom HTTP or SOCKS5 proxy if needed. Leave empty for direct connection.")}
                  </div>
                </div>

                <div className="pica-setting-group">
                  <label className="pica-setting-label">{t("Download Directory")}</label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="text"
                      className="pica-search-input"
                      placeholder={t("Default: ~/Downloads/KoodoReader_Comics")}
                      value={config.outputDir || ""}
                      readOnly
                      style={{ flex: 1 }}
                    />
                    <button
                      className="pica-btn secondary"
                      onClick={async () => {
                        const ipc = getIpc();
                        if (ipc) {
                          const selected = await ipc.invoke("select-path");
                          if (selected) {
                            const updated = { ...config, outputDir: selected };
                            this.setState({ config: updated });
                            this.saveConfig(updated);
                          }
                        }
                      }}
                    >
                      📁 {t("Browse...")}
                    </button>
                    {config.outputDir && (
                      <button
                        className="pica-btn outline"
                        onClick={() => {
                          const updated = { ...config, outputDir: "" };
                          this.setState({ config: updated });
                          this.saveConfig(updated);
                        }}
                      >
                        {t("Reset")}
                      </button>
                    )}
                  </div>
                  <div className="pica-setting-desc">
                    {t("Specify where downloaded CBZ comics are saved. Useful if C: drive is low on space.")}
                  </div>
                </div>

                <div className="pica-setting-group">
                  <label className="pica-setting-label">{t("Image Quality")}</label>
                  <select
                    className="pica-select"
                    value={config.quality}
                    onChange={(e) => {
                      const updated = { ...config, quality: e.target.value as any };
                      this.setState({ config: updated });
                      this.saveConfig(updated);
                    }}
                  >
                    <option value="original">{t("Original")}</option>
                    <option value="high">{t("High")}</option>
                    <option value="medium">{t("Medium")}</option>
                    <option value="low">{t("Low")}</option>
                  </select>
                </div>

                <div className="pica-setting-group">
                  <label className="pica-setting-label">{t("Download Concurrency Threads")}</label>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    className="pica-search-input"
                    style={{ width: 120 }}
                    value={config.threads || 3}
                    onChange={(e) => {
                      const updated = { ...config, threads: parseInt(e.target.value) || 3 };
                      this.setState({ config: updated });
                      this.saveConfig(updated);
                    }}
                  />
                </div>

                <div className="pica-setting-group">
                  <label className="pica-setting-label">{t("Request Delay")}</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={50}
                      max={1000}
                      step={50}
                      className="pica-search-input"
                      style={{ width: 120 }}
                      value={config.delayMs || 200}
                      onChange={(e) => {
                        const updated = { ...config, delayMs: parseInt(e.target.value) || 200 };
                        this.setState({ config: updated });
                        this.saveConfig(updated);
                      }}
                    />
                    <span>ms</span>
                  </div>
                  <div className="pica-setting-desc">
                    {t("Anti-scraping random delay between image batches to protect account.")}
                  </div>
                </div>

                <div className="pica-setting-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={config.autoImport !== false}
                      onChange={(e) => {
                        const updated = { ...config, autoImport: e.target.checked };
                        this.setState({ config: updated });
                        this.saveConfig(updated);
                      }}
                    />
                    <span className="pica-setting-label">
                      {t("Automatically import downloaded CBZ comics into Library")}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Comic Detail Drawer / Modal */}
        {this.state.selectedComicId && (
          <div className="pica-drawer-backdrop" onClick={this.closeComicDetail}>
            <div className="pica-drawer-content" onClick={(e) => e.stopPropagation()}>
              <div className="pica-drawer-header">
                <span style={{ fontSize: 16, fontWeight: 700 }}>{t("Comic Detail")}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    className="pica-btn outline"
                    onClick={this.toggleFavoriteDetail}
                    disabled={isTogglingFavorite}
                    style={{ padding: "4px 10px" }}
                  >
                    {isFavoritedDetail ? "❤️" : "🤍"}{" "}
                    {isFavoritedDetail ? t("In Favorites") : t("Add to Favorites")}
                  </button>
                  <div className="pica-close-btn" onClick={this.closeComicDetail}>
                    <span className="icon-close"></span>
                  </div>
                </div>
              </div>

              <div className="pica-drawer-body">
                {isLoadingDetail || !selectedComicDetail ? (
                  <div style={{ textAlign: "center", padding: "60px", color: "#888" }}>
                    {t("Loading comic details...")}
                  </div>
                ) : (
                  <div>
                    <div className="pica-detail-top">
                      {selectedComicDetail.thumbUrl && (
                        <img
                          src={selectedComicDetail.thumbUrl}
                          alt={selectedComicDetail.title}
                          className="pica-detail-cover"
                        />
                      )}
                      <div className="pica-detail-meta">
                        <div className="pica-detail-title">{selectedComicDetail.title}</div>
                        <div style={{ fontSize: 13, color: "#666" }}>
                          {t("Author")}: {selectedComicDetail.author || t("Unknown")}
                        </div>
                        {selectedComicDetail.chineseTeam && (
                          <div style={{ fontSize: 12, color: "#888" }}>
                            {t("Translator")}: {selectedComicDetail.chineseTeam}
                          </div>
                        )}
                        <div className="pica-tag-list">
                          {selectedComicDetail.categories?.map((cat) => (
                            <span key={cat} className="pica-tag-item">
                              {cat}
                            </span>
                          ))}
                          {selectedComicDetail.tags?.map((tag) => (
                            <span key={tag} className="pica-tag-item">
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <div style={{ fontSize: 12, color: "#999", marginTop: "auto" }}>
                          ❤️ {selectedComicDetail.likesCount || 0} | 👁️ {selectedComicDetail.viewsCount || 0} | 📄{" "}
                          {selectedComicDetail.pagesCount || 0}P
                        </div>
                      </div>
                    </div>

                    {selectedComicDetail.description && (
                      <div
                        style={{
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "#555",
                          background: "rgba(0,0,0,0.02)",
                          padding: "10px",
                          borderRadius: "6px",
                          marginBottom: "16px",
                        }}
                      >
                        {selectedComicDetail.description}
                      </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        {t("Chapters")} ({selectedComicDetail.episodes?.length || 0})
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="pica-btn outline"
                          style={{ padding: "3px 8px", fontSize: 12 }}
                          onClick={() => {
                            const allOrders = (selectedComicDetail.episodes || []).map((ep) => ep.order);
                            this.setState({ selectedEpOrders: allOrders });
                          }}
                        >
                          {t("Select All")}
                        </button>
                        <button
                          className="pica-btn outline"
                          style={{ padding: "3px 8px", fontSize: 12 }}
                          onClick={() => this.setState({ selectedEpOrders: [] })}
                        >
                          {t("Deselect All")}
                        </button>
                      </div>
                    </div>

                    <div className="pica-ep-grid">
                      {selectedComicDetail.episodes?.map((ep) => {
                        const isSelected = selectedEpOrders.includes(ep.order);
                        return (
                          <div
                            key={ep.id || ep.order}
                            className={`pica-ep-btn ${isSelected ? "selected" : ""}`}
                            onClick={() => {
                              this.setState((prev) => ({
                                selectedEpOrders: isSelected
                                  ? prev.selectedEpOrders.filter((o) => o !== ep.order)
                                  : [...prev.selectedEpOrders, ep.order],
                              }));
                            }}
                          >
                            {isSelected ? "✓ " : ""}{ep.title || `${t("Chapter")} ${ep.order}`}
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                      <button
                        className="pica-btn"
                        style={{ flex: 1 }}
                        onClick={() => {
                          this.enqueueDownload(selectedComicDetail, [], true);
                          this.closeComicDetail();
                        }}
                      >
                        📥 {t("Download Full Album (Merged CBZ)")}
                      </button>
                      <button
                        className="pica-btn secondary"
                        style={{ flex: 1 }}
                        disabled={selectedEpOrders.length === 0}
                        onClick={() => {
                          this.enqueueDownload(selectedComicDetail, selectedEpOrders, false);
                          this.closeComicDetail();
                        }}
                      >
                        📥 {t("Download Selected (Separate CBZ)")} ({selectedEpOrders.length})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}

export default PicaDialog;
