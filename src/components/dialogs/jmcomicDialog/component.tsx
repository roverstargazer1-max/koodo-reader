import React from "react";
import "./jmcomicDialog.css";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import {
  JmAlbumItem,
  JmAlbumDetailData,
  JmcomicConfig,
  JmcomicDialogProps,
  JmcomicDialogState,
  JmDownloadTask,
} from "./interface";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";

const getIpc = () => (window as any).electronAPI || (window as any).ipcRenderer;

const extractPayload = (arg1: any, arg2: any) => {
  if (arg2 !== undefined) return arg2;
  return arg1;
};

interface JmcomicPaginationProps {
  current: number;
  total: number;
  onPageChange: (p: number) => void;
  t: (key: string) => string;
}

const JmcomicPagination: React.FC<JmcomicPaginationProps> = ({
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

  // Generate page items
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
            className={`jmcomic-pagination-btn ${item === current ? "active" : ""}`}
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
            className="jmcomic-pagination-ellipsis"
            title={t("Previous page")}
            onClick={() => handleJump(Math.max(1, current - 5))}
          >
            ...
          </span>
        );
      } else {
        return (
          <span
            key={`ellipsis-right-${idx}`}
            className="jmcomic-pagination-ellipsis"
            title={t("Next page")}
            onClick={() => handleJump(Math.min(total, current + 5))}
          >
            ...
          </span>
        );
      }
    });
  };

  return (
    <div className="jmcomic-pagination">
      <button
        className="jmcomic-pagination-btn"
        disabled={current <= 1}
        onClick={() => onPageChange(current - 1)}
        title={t("Previous page")}
      >
        <Trans>Previous page</Trans>
      </button>

      {renderPageButtons()}

      <button
        className="jmcomic-pagination-btn"
        disabled={current >= total}
        onClick={() => onPageChange(current + 1)}
        title={t("Next page")}
      >
        <Trans>Next page</Trans>
      </button>

      <div className="jmcomic-pagination-jump">
        <span><Trans>Page</Trans></span>
        <input
          type="number"
          min={1}
          max={total}
          className="jmcomic-pagination-input"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => handleJump()}
        />
        <span>/ {total}</span>
        <button
          className="jmcomic-pagination-jump-btn"
          onClick={() => handleJump()}
          title={t("Confirm")}
        >
          <Trans>Confirm</Trans>
        </button>
      </div>
    </div>
  );
};

class JmcomicDialog extends React.Component<
  JmcomicDialogProps,
  JmcomicDialogState
> {
  private progressListener: any = null;
  private finishListener: any = null;
  private errorListener: any = null;

  constructor(props: JmcomicDialogProps) {
    super(props);
    const savedConfig = this.loadConfig();
    const savedTasks = this.loadTasks();
    const savedAuth = this.loadAuth();
    const savedUser = this.loadUser();
    const savedCookies = this.loadCookies();

    this.state = {
      currentTab: "search",
      searchQuery: "",
      searchOrder: "mr",
      searchPage: 1,
      searchTotalPages: 1,
      searchTotalCount: 0,
      searchResults: [],
      isSearching: false,

      rankTime: "m",
      rankOrder: "mv",
      rankPage: 1,
      rankTotalPages: 1,
      rankResults: [],
      isRanking: false,

      // Favorites state
      currentUser: savedUser,
      savedAuth: savedAuth,
      cookies: savedCookies,
      isLoggingIn: false,
      loginUsernameInput: savedAuth?.username || "",
      loginPasswordInput: savedAuth?.password || "",
      loginRememberInput: savedAuth?.remember !== false,
      loginErrorMsg: "",

      favoriteFolders: [{ id: "0", name: "全部/默认收藏" }],
      activeFolderId: "0",
      favoriteOrder: "mr",
      favoritePage: 1,
      favoriteTotalPages: 1,
      favoriteTotalCount: 0,
      favoriteResults: [],
      isFavoritesLoading: false,

      isBatchMode: false,
      selectedBatchIds: [],

      selectedAlbumId: null,
      selectedAlbumDetail: null,
      selectedChapterIds: [],
      isLoadingDetail: false,
      isFavoritedDetail: false,
      isTogglingFavorite: false,

      downloadTasks: savedTasks,
      downloadQueue: [],
      isQueueRunning: false,

      config: savedConfig,
      availableDomains: [
        "18comic.vip",
        "18comic.org",
        "jmcomic1.me",
        "jmcomic.me",
        "jm-comic.org",
      ],
      envStatus: {
        checked: false,
        hasPython: false,
        hasJmcomic: false,
      },
    };
  }

  componentDidMount() {
    this.checkEnvironment();
    this.fetchDomains();
    this.setupDownloadListeners();
  }

  componentWillUnmount() {
    this.removeDownloadListeners();
  }

  loadAuth(): { username: string; password?: string; remember: boolean } | null {
    try {
      return ConfigService.getObjectConfig("jmcomicAuth") || null;
    } catch {
      return null;
    }
  }

  loadUser(): any | null {
    try {
      return ConfigService.getObjectConfig("jmcomicUser") || null;
    } catch {
      return null;
    }
  }

  loadCookies(): Record<string, string> | null {
    try {
      return ConfigService.getObjectConfig("jmcomicCookies") || null;
    } catch {
      return null;
    }
  }

  loadTasks(): Record<string, JmDownloadTask> {
    try {
      return ConfigService.getObjectConfig("jmcomicDownloadTasks") || {};
    } catch {
      return {};
    }
  }

  saveTasks(tasks: Record<string, JmDownloadTask>) {
    try {
      ConfigService.setObjectConfig("jmcomicDownloadTasks", tasks);
    } catch (e) {
      console.error("Failed to persist download tasks:", e);
    }
  }

  loadConfig(): JmcomicConfig {
    const raw = ConfigService.getObjectConfig("jmcomicConfig") || {};
    return {
      pythonPath: raw.pythonPath || "",
      proxy: raw.proxy || "",
      domain: raw.domain || "18comic.vip",
      threads: raw.threads || 5,
      outputDir: raw.outputDir || "",
      combineCbz: raw.combineCbz !== false,
      autoImport: raw.autoImport !== false,
    };
  }

  saveConfig(newConfig: Partial<JmcomicConfig>) {
    const updated = { ...this.state.config, ...newConfig };
    this.setState({ config: updated });
    ConfigService.setObjectConfig("jmcomicConfig", updated);
  }

  importBookFile = async (filePath: string, fileName: string) => {
    const ipc = getIpc();
    try {
      if (ipc) {
        // Read file content as Buffer / ArrayBuffer
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
      console.error("Import file failed:", filePath, err);
    }
    return false;
  };

  setupDownloadListeners() {
    const ipc = getIpc();
    if (ipc) {
      this.progressListener = (arg1: any, arg2: any) => {
        const data = extractPayload(arg1, arg2);
        if (!data) return;
        const { albumId, percent, photo_title, photo_index, total_photos } =
          data;
        this.setState((prev) => {
          const task = prev.downloadTasks[albumId] || {
            albumId,
            title: `JM${albumId}`,
            author: "",
            coverUrl: "",
            status: "downloading",
            percent: 0,
          };

          const newTasks = {
            ...prev.downloadTasks,
            [albumId]: {
              ...task,
              status: percent >= 92 ? ("packaging" as const) : ("downloading" as const),
              percent,
              currentPhotoTitle: photo_title,
              currentPhotoIndex: photo_index,
              totalPhotos: total_photos,
            },
          };
          this.saveTasks(newTasks);
          return { downloadTasks: newTasks };
        });
      };

      this.finishListener = async (arg1: any, arg2: any) => {
        const data = extractPayload(arg1, arg2);
        if (!data) return;
        const { albumId, files, title, author, cover_url } = data;
        this.setState((prev) => {
          const task = prev.downloadTasks[albumId] || {
            albumId,
            title: title || `JM${albumId}`,
            author: author || "",
            coverUrl: cover_url || "",
            status: "completed",
            percent: 100,
          };

          const newTasks = {
            ...prev.downloadTasks,
            [albumId]: {
              ...task,
              title: title || task.title,
              author: author || task.author,
              coverUrl: cover_url || task.coverUrl,
              status: "completed" as const,
              percent: 100,
              createdFiles: files,
              imported: true,
            },
          };
          this.saveTasks(newTasks);
          return { downloadTasks: newTasks, isQueueRunning: false };
        }, () => {
          setTimeout(() => this.processNextInQueue(), 800);
        });

        toast.success(
          `${this.props.t("Download Completed")}: ${title || albumId}`
        );

        // Auto import into Koodo library if enabled
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
        const { albumId, msg } = data;
        this.setState((prev) => {
          const task = prev.downloadTasks[albumId] || {
            albumId,
            title: `JM${albumId}`,
            author: "",
            coverUrl: "",
            status: "failed",
            percent: 0,
          };

          const newTasks = {
            ...prev.downloadTasks,
            [albumId]: {
              ...task,
              status: "failed" as const,
              errorMsg: msg,
            },
          };
          this.saveTasks(newTasks);
          return { downloadTasks: newTasks, isQueueRunning: false };
        }, () => {
          setTimeout(() => this.processNextInQueue(), 800);
        });
        toast.error(`${this.props.t("Download Failed")}: ${msg || ""}`);
      };

      ipc.on("jmcomic-download-progress", this.progressListener);
      ipc.on("jmcomic-download-finish", this.finishListener);
      ipc.on("jmcomic-download-error", this.errorListener);
    }
  }

  isBookInLibrary = (album: JmAlbumItem | { id: string; title: string }) => {
    const books = this.props.books || [];
    if (!books.length) return false;
    const albumId = String(album.id);
    const cleanTitle = (album.title || "").toLowerCase().trim();
    return books.some((b: any) => {
      if (!b) return false;
      const bName = (b.name || "").toLowerCase();
      const bTitle = (b.title || "").toLowerCase();
      const bKey = (b.key || "").toLowerCase();
      if (
        bName.includes(`jm${albumId}`) ||
        bTitle.includes(`jm${albumId}`) ||
        bKey.includes(`jm${albumId}`)
      ) {
        return true;
      }
      if (cleanTitle && (bName.includes(cleanTitle) || bTitle.includes(cleanTitle))) {
        return true;
      }
      return false;
    });
  };

  enqueueBatchDownloads = (albumIds: string[]) => {
    if (!albumIds || albumIds.length === 0) return;
    const { downloadTasks, downloadQueue } = this.state;
    const newTasks = { ...downloadTasks };
    const toQueue: string[] = [];

    for (const aid of albumIds) {
      if (
        !newTasks[aid] ||
        newTasks[aid].status === "failed" ||
        newTasks[aid].status === "cancelled" ||
        newTasks[aid].status === "completed"
      ) {
        const item =
          this.state.favoriteResults.find((a) => a.id === aid) ||
          this.state.searchResults.find((a) => a.id === aid) ||
          this.state.rankResults.find((a) => a.id === aid);

        newTasks[aid] = {
          albumId: aid,
          title: item ? item.title : `JM${aid}`,
          author: item ? item.author : "",
          coverUrl: item ? item.cover : "",
          status: "pending",
          percent: 0,
        };
        toQueue.push(aid);
      }
    }

    const updatedQueue = [...downloadQueue, ...toQueue];
    this.saveTasks(newTasks);
    this.setState(
      {
        downloadTasks: newTasks,
        downloadQueue: updatedQueue,
        isBatchMode: false,
        selectedBatchIds: [],
      },
      () => {
        toast.success(
          `${this.props.t("Added to Download Queue")}: ${toQueue.length} ${this.props.t("comics")}`
        );
        this.processNextInQueue();
      }
    );
  };

  processNextInQueue = async () => {
    const { isQueueRunning, downloadQueue, downloadTasks, config } = this.state;
    if (isQueueRunning) return;
    if (downloadQueue.length === 0) return;

    const nextAlbumId = downloadQueue[0];
    const remainingQueue = downloadQueue.slice(1);

    this.setState({
      isQueueRunning: true,
      downloadQueue: remainingQueue,
    });

    const task = downloadTasks[nextAlbumId];
    if (!task || task.status === "cancelled") {
      this.setState({ isQueueRunning: false }, () => this.processNextInQueue());
      return;
    }

    const ipc = getIpc();
    try {
      if (ipc) {
        await ipc.invoke("jmcomic-download", {
          albumId: nextAlbumId,
          photoIds: [],
          combine: config.combineCbz !== false,
          threads: config.threads || 5,
          proxy: config.proxy,
          domain: config.domain,
          outputDir: config.outputDir,
          pythonPath: config.pythonPath,
        });
      }
    } catch (err: any) {
      console.error("Queue start error:", err);
      this.setState({ isQueueRunning: false }, () => this.processNextInQueue());
    }
  };

  handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const {
      loginUsernameInput,
      loginPasswordInput,
      loginRememberInput,
      config,
    } = this.state;

    if (!loginUsernameInput.trim() || !loginPasswordInput.trim()) {
      toast.error(this.props.t("Username and password are required"));
      return;
    }

    this.setState({ isLoggingIn: true, loginErrorMsg: "" });
    const ipc = getIpc();
    try {
      if (ipc) {
        const res = await ipc.invoke("jmcomic-login", {
          username: loginUsernameInput.trim(),
          password: loginPasswordInput.trim(),
          proxy: config.proxy,
          domain: config.domain,
          pythonPath: config.pythonPath,
        });

        if (res && res.code === 0 && res.data) {
          const { profile, cookies } = res.data;
          const savedAuth = {
            username: loginUsernameInput.trim(),
            password: loginRememberInput ? loginPasswordInput.trim() : "",
            remember: loginRememberInput,
          };
          ConfigService.setObjectConfig("jmcomicAuth", savedAuth);
          ConfigService.setObjectConfig("jmcomicUser", profile);
          ConfigService.setObjectConfig("jmcomicCookies", cookies);

          this.setState({
            currentUser: profile,
            savedAuth,
            cookies,
            loginPasswordInput: loginRememberInput ? loginPasswordInput : "",
            isLoggingIn: false,
          });

          toast.success(
            `${this.props.t("Welcome")}, ${profile.username || loginUsernameInput}!`
          );
          this.fetchFavorites(1, "0");
        } else {
          const errMsg = res ? res.msg : "Login failed";
          this.setState({ loginErrorMsg: errMsg, isLoggingIn: false });
          toast.error(errMsg);
        }
      }
    } catch (err: any) {
      this.setState({
        loginErrorMsg: err.message || "Login error",
        isLoggingIn: false,
      });
      toast.error(err.message || "Login error");
    }
  };

  handleLogout = () => {
    ConfigService.setObjectConfig("jmcomicUser", null);
    ConfigService.setObjectConfig("jmcomicCookies", null);
    const savedAuth = this.state.savedAuth;
    if (!savedAuth?.remember) {
      ConfigService.setObjectConfig("jmcomicAuth", null);
      this.setState({
        savedAuth: null,
        loginUsernameInput: "",
        loginPasswordInput: "",
      });
    }
    this.setState({
      currentUser: null,
      cookies: null,
      favoriteResults: [],
      favoriteFolders: [{ id: "0", name: "全部/默认收藏" }],
      isBatchMode: false,
      selectedBatchIds: [],
    });
    toast(this.props.t("Logged out"));
  };

  fetchFavorites = async (page = 1, folderId?: string) => {
    const targetFolder =
      folderId !== undefined ? folderId : this.state.activeFolderId;
    const { favoriteOrder, config, cookies, savedAuth } = this.state;
    this.setState({
      isFavoritesLoading: true,
      favoritePage: page,
      activeFolderId: targetFolder,
    });

    const ipc = getIpc();
    try {
      if (ipc) {
        const res = await ipc.invoke("jmcomic-get-favorites", {
          folderId: targetFolder,
          page,
          order: favoriteOrder,
          cookies,
          username: savedAuth?.username,
          password: savedAuth?.password,
          proxy: config.proxy,
          domain: config.domain,
          pythonPath: config.pythonPath,
        });

        if (res && res.code === 0 && res.data) {
          const {
            folders,
            results,
            total_count,
            total_pages,
            cookies: latestCookies,
          } = res.data;
          if (latestCookies && Object.keys(latestCookies).length > 0) {
            this.setState({ cookies: latestCookies });
            ConfigService.setObjectConfig("jmcomicCookies", latestCookies);
          }
          this.setState({
            favoriteFolders:
              folders && folders.length > 0
                ? folders
                : this.state.favoriteFolders,
            favoriteResults: results || [],
            favoriteTotalCount: total_count || 0,
            favoriteTotalPages: total_pages || 1,
          });
        } else {
          if (
            res &&
            res.msg &&
            (res.msg.includes("401") ||
              res.msg.includes("登录") ||
              res.msg.includes("login"))
          ) {
            if (savedAuth?.password) {
              await this.handleLogin();
              return;
            } else {
              this.setState({ currentUser: null });
              toast.error(
                this.props.t("Session expired, please log in again.")
              );
            }
          } else {
            toast.error(res ? res.msg : "Failed to fetch favorites");
          }
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Favorites fetch error");
    } finally {
      this.setState({ isFavoritesLoading: false });
    }
  };

  handleToggleFavorite = async (albumId: string) => {
    const {
      cookies,
      savedAuth,
      config,
      isFavoritedDetail,
      favoriteResults,
    } = this.state;
    this.setState({ isTogglingFavorite: true });
    const ipc = getIpc();
    try {
      if (ipc) {
        const res = await ipc.invoke("jmcomic-toggle-favorite", {
          albumId,
          cookies,
          username: savedAuth?.username,
          password: savedAuth?.password,
          proxy: config.proxy,
          domain: config.domain,
          pythonPath: config.pythonPath,
        });

        if (res && res.code === 0) {
          const nextState = !isFavoritedDetail;
          this.setState({ isFavoritedDetail: nextState });
          toast.success(
            nextState
              ? this.props.t("Added to Favorites")
              : this.props.t("Removed from Favorites")
          );

          if (!nextState) {
            this.setState({
              favoriteResults: favoriteResults.filter((a) => a.id !== albumId),
            });
          }
        } else {
          toast.error(res ? res.msg : "Operation failed");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle favorite");
    } finally {
      this.setState({ isTogglingFavorite: false });
    }
  };

  removeDownloadListeners() {
    const ipc = getIpc();
    if (ipc) {
      if (this.progressListener) {
        ipc.removeListener(
          "jmcomic-download-progress",
          this.progressListener
        );
      }
      if (this.finishListener) {
        ipc.removeListener("jmcomic-download-finish", this.finishListener);
      }
      if (this.errorListener) {
        ipc.removeListener("jmcomic-download-error", this.errorListener);
      }
    }
  }

  handleSelectPythonFile = async () => {
    const ipc = getIpc();
    if (!ipc) {
      toast.error(
        this.props.t("JMComic feature requires the Electron desktop client.")
      );
      return;
    }
    try {
      const selected = await ipc.invoke("select-file", {
        filters: [
          { name: "Python Executable", extensions: ["exe", "*"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (selected && typeof selected === "string") {
        this.saveConfig({ pythonPath: selected });
        this.checkEnvironment();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to select file");
    }
  };

  handleSelectOutputDir = async () => {
    const ipc = getIpc();
    if (!ipc) {
      toast.error(
        this.props.t("JMComic feature requires the Electron desktop client.")
      );
      return;
    }
    try {
      const selected = await ipc.invoke("select-path");
      if (selected && typeof selected === "string") {
        this.saveConfig({ outputDir: selected });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to select directory");
    }
  };

  checkEnvironment = async () => {
    const ipc = getIpc();
    if (!ipc) {
      this.setState({
        envStatus: {
          checked: true,
          hasPython: false,
          hasJmcomic: false,
          message: this.props.t(
            "Electron IPC is not available (desktop client required)"
          ),
          isChecking: false,
        },
      });
      toast.error(
        this.props.t("JMComic feature requires the Electron desktop client.")
      );
      return;
    }

    this.setState((prev) => ({
      envStatus: { ...prev.envStatus, isChecking: true },
    }));
    const toastId = "jm-env-check";
    toast.loading(this.props.t("Checking Python environment..."), {
      id: toastId,
    });

    try {
      const res = await ipc.invoke("jmcomic-check-env", {
        pythonPath: this.state.config.pythonPath,
      });

      if (res && res.code === 0 && res.data) {
        const hasJm = Boolean(res.data.has_jmcomic);
        this.setState({
          envStatus: {
            checked: true,
            hasPython: true,
            hasJmcomic: hasJm,
            pythonVersion: res.data.python_version,
            jmcomicVersion: res.data.jmcomic_version,
            pythonPath: res.data.python_path,
            runtimeMode: res.data.runtimeMode,
            expectedJmcomicVersion: res.data.expectedJmcomicVersion,
            runtimeAvailable: res.data.runtimeAvailable !== false,
            isChecking: false,
            message: hasJm
              ? ""
              : res.data.import_error ||
                this.props.t("JMComic module not installed"),
          },
        });

        if (hasJm) {
          toast.success(
            `${this.props.t("Python & JMComic Ready")} (v${res.data.jmcomic_version || ""})`,
            { id: toastId }
          );
        } else {
          toast(
            this.props.t(
              "Python detected, but JMComic module is missing. Please click Install."
            ),
            { id: toastId, icon: "⚠️" }
          );
        }
      } else {
        const errMsg = res ? res.msg : this.props.t("Python executable not found");
        this.setState({
          envStatus: {
            checked: true,
            hasPython: res?.data?.runtimeAvailable === true,
            hasJmcomic: false,
            pythonPath: res?.data?.python_path,
            runtimeMode: res?.data?.runtimeMode,
            expectedJmcomicVersion: res?.data?.expectedJmcomicVersion,
            runtimeAvailable: res?.data?.runtimeAvailable,
            message: errMsg,
            isChecking: false,
          },
        });
        toast.error(`${this.props.t("Check Failed")}: ${errMsg}`, {
          id: toastId,
        });
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      this.setState({
        envStatus: {
          checked: true,
          hasPython: false,
          hasJmcomic: false,
          message: errMsg,
          isChecking: false,
        },
      });
      toast.error(`${this.props.t("Check Failed")}: ${errMsg}`, {
        id: toastId,
      });
    } finally {
      this.setState((prev) => ({
        envStatus: { ...prev.envStatus, isChecking: false },
      }));
    }
  };

  installDependencies = async () => {
    const ipc = getIpc();
    if (!ipc) {
      this.setState((prev) => ({
        envStatus: {
          ...prev.envStatus,
          isInstalling: false,
          message: this.props.t(
            "Electron IPC is not available (desktop client required)"
          ),
        },
      }));
      toast.error(
        this.props.t("JMComic feature requires the Electron desktop client.")
      );
      return;
    }

    this.setState((prev) => ({
      envStatus: { ...prev.envStatus, isInstalling: true, installLogs: "" },
    }));
    const toastId = "jm-install";
    toast.loading(
      this.props.t(
        "Installing JMComic dependencies... (may take 10~30 seconds)"
      ),
      {
        id: toastId,
      }
    );

    try {
      const res = await ipc.invoke("jmcomic-install-deps", {
        pythonPath: this.state.config.pythonPath,
      });

      if (res && res.code === 0) {
        toast.success(
          this.props.t("JMComic dependencies installed successfully!"),
          { id: toastId }
        );
        this.setState((prev) => ({
          envStatus: {
            ...prev.envStatus,
            isInstalling: false,
            installLogs: res.data || res.msg,
          },
        }));
        await this.checkEnvironment();
      } else {
        const errMsg = res ? res.msg : this.props.t("Installation failed");
        toast.error(`${this.props.t("Installation failed")}: ${errMsg}`, {
          id: toastId,
        });
        this.setState((prev) => ({
          envStatus: {
            ...prev.envStatus,
            isInstalling: false,
            message: errMsg,
            installLogs: (res && res.data) || errMsg,
          },
        }));
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      toast.error(`${this.props.t("Installation failed")}: ${errMsg}`, {
        id: toastId,
      });
      this.setState((prev) => ({
        envStatus: {
          ...prev.envStatus,
          isInstalling: false,
          message: errMsg,
          installLogs: errMsg,
        },
      }));
    } finally {
      this.setState((prev) => ({
        envStatus: { ...prev.envStatus, isInstalling: false },
      }));
    }
  };

  fetchDomains = async () => {
    const ipc = getIpc();
    if (!ipc) return;
    try {
      const res = await ipc.invoke("jmcomic-get-domains", {
        pythonPath: this.state.config.pythonPath,
      });
      if (res && res.code === 0 && Array.isArray(res.data)) {
        this.setState({ availableDomains: res.data });
      }
    } catch (e) {}
  };

  handleSearch = async (page = 1) => {
    const { searchQuery, searchOrder, config } = this.state;
    if (!searchQuery.trim()) return;

    this.setState({ isSearching: true, searchPage: page });
    const ipc = getIpc();
    try {
      if (ipc) {
        const res = await ipc.invoke("jmcomic-search", {
          query: searchQuery.trim(),
          page,
          order: searchOrder,
          proxy: config.proxy,
          domain: config.domain,
          pythonPath: config.pythonPath,
        });

        if (res && res.code === 0 && res.data) {
          this.setState({
            searchResults: res.data.results || [],
            searchTotalPages: res.data.total_pages || 1,
            searchTotalCount: res.data.total_count || 0,
          });
        } else {
          toast.error(res ? res.msg : "Search failed");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Search error");
    } finally {
      this.setState({ isSearching: false });
    }
  };

  handleRank = async (page = 1) => {
    const { rankTime, rankOrder, config } = this.state;
    this.setState({ isRanking: true, rankPage: page });
    const ipc = getIpc();

    try {
      if (ipc) {
        const res = await ipc.invoke("jmcomic-rank", {
          time: rankTime,
          order: rankOrder,
          page,
          proxy: config.proxy,
          domain: config.domain,
          pythonPath: config.pythonPath,
        });

        if (res && res.code === 0 && res.data) {
          this.setState({
            rankResults: res.data.results || [],
            rankTotalPages: res.data.total_pages || 1,
          });
        } else {
          toast.error(res ? res.msg : "Failed to load rankings");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Rank query error");
    } finally {
      this.setState({ isRanking: false });
    }
  };

  openAlbumDetail = async (albumId: string) => {
    this.setState({
      selectedAlbumId: albumId,
      selectedAlbumDetail: null,
      selectedChapterIds: [],
      isLoadingDetail: true,
    });
    const ipc = getIpc();

    try {
      if (ipc) {
        const res = await ipc.invoke("jmcomic-detail", {
          albumId,
          proxy: this.state.config.proxy,
          domain: this.state.config.domain,
          pythonPath: this.state.config.pythonPath,
        });

        if (res && res.code === 0 && res.data) {
          const detail: JmAlbumDetailData = res.data;
          this.setState({
            selectedAlbumDetail: detail,
            selectedChapterIds: detail.chapters.map((c) => c.id),
          });
        } else {
          toast.error(res ? res.msg : "Failed to fetch album details");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Detail query error");
    } finally {
      this.setState({ isLoadingDetail: false });
    }
  };

  startDownload = async (
    albumId: string,
    photoIds: string[] = [],
    combine = true
  ) => {
    const { config, selectedAlbumDetail } = this.state;
    const title = selectedAlbumDetail
      ? selectedAlbumDetail.title
      : `JM${albumId}`;
    const author = selectedAlbumDetail ? selectedAlbumDetail.author : "";
    const coverUrl = selectedAlbumDetail ? selectedAlbumDetail.cover : "";

    this.setState((prev) => {
      const newTasks = {
        ...prev.downloadTasks,
        [albumId]: {
          albumId,
          title,
          author,
          coverUrl,
          status: "pending" as const,
          percent: 0,
        },
      };
      this.saveTasks(newTasks);
      return {
        downloadTasks: newTasks,
        selectedAlbumId: null, // close detail modal
      };
    });

    toast(this.props.t("Download started in background"), { icon: "📥" });
    const ipc = getIpc();

    try {
      if (ipc) {
        await ipc.invoke("jmcomic-download", {
          albumId,
          photoIds,
          combine,
          threads: config.threads,
          proxy: config.proxy,
          domain: config.domain,
          outputDir: config.outputDir,
          pythonPath: config.pythonPath,
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Download initiation error");
    }
  };

  cancelDownload = async (albumId: string) => {
    const ipc = getIpc();
    try {
      if (ipc) {
        await ipc.invoke("jmcomic-cancel-download", { albumId });
        this.setState((prev) => {
          const newTasks = {
            ...prev.downloadTasks,
            [albumId]: {
              ...prev.downloadTasks[albumId],
              status: "cancelled" as const,
            },
          };
          this.saveTasks(newTasks);
          return { downloadTasks: newTasks };
        });
        toast(this.props.t("Download Cancelled"));
      }
    } catch (err: any) {
      toast.error(err.message || "Cancel failed");
    }
  };

  renderSearchBar() {
    const { searchQuery, searchOrder, isSearching } = this.state;
    return (
      <div className="jmcomic-search-bar">
        <input
          type="text"
          className="jmcomic-search-input"
          placeholder={this.props.t("Search by keyword, author, or JM ID...")}
          value={searchQuery}
          onChange={(e) => this.setState({ searchQuery: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && this.handleSearch(1)}
        />
        <select
          className="jmcomic-select"
          value={searchOrder}
          onChange={(e: any) =>
            this.setState({ searchOrder: e.target.value }, () =>
              this.handleSearch(1)
            )
          }
        >
          <option value="mr">{this.props.t("Latest")}</option>
          <option value="mv">{this.props.t("Most Views")}</option>
          <option value="tf">{this.props.t("Most Likes")}</option>
          <option value="mp">{this.props.t("Most Pictures")}</option>
        </select>
        <button
          className="jmcomic-btn"
          onClick={() => this.handleSearch(1)}
          disabled={isSearching}
        >
          {isSearching ? this.props.t("Searching...") : this.props.t("Search")}
        </button>
      </div>
    );
  }

  renderRankBar() {
    const { rankTime, rankOrder, isRanking } = this.state;
    return (
      <div className="jmcomic-search-bar">
        <div style={{ display: "flex", gap: "6px" }}>
          {[
            { key: "t", label: "Today" },
            { key: "w", label: "Weekly" },
            { key: "m", label: "Monthly" },
            { key: "a", label: "All Time" },
          ].map((item) => (
            <button
              key={item.key}
              className={`jmcomic-tab-btn ${rankTime === item.key ? "active" : ""}`}
              onClick={() =>
                this.setState({ rankTime: item.key as any }, () =>
                  this.handleRank(1)
                )
              }
            >
              <Trans>{item.label}</Trans>
            </button>
          ))}
        </div>
        <select
          className="jmcomic-select"
          style={{ marginLeft: "auto" }}
          value={rankOrder}
          onChange={(e: any) =>
            this.setState({ rankOrder: e.target.value }, () =>
              this.handleRank(1)
            )
          }
        >
          <option value="mv">{this.props.t("Most Views")}</option>
          <option value="tf">{this.props.t("Most Likes")}</option>
        </select>
        <button
          className="jmcomic-btn secondary"
          onClick={() => this.handleRank(1)}
          disabled={isRanking}
        >
          {isRanking ? this.props.t("Loading...") : this.props.t("Refresh")}
        </button>
      </div>
    );
  }

  handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.currentTarget;
    const currentSrc = target.src || "";
    const retryCount = parseInt(target.getAttribute("data-retry") || "0", 10);
    const cdnList = [
      "cdn-msp3.jmapiproxy2.cc",
      "cdn-msp2.jmapiproxy2.cc",
      "cdn-msp.jmapiproxy1.cc",
      "cdn-msp.jmapinodeudzn.net",
      "cdn-msp3.jmapinodeudzn.net",
    ];

    if (retryCount < cdnList.length) {
      const nextDomain = cdnList[retryCount];
      target.setAttribute("data-retry", String(retryCount + 1));
      try {
        const parsed = new URL(currentSrc);
        target.src = `https://${nextDomain}${parsed.pathname}`;
        return;
      } catch (_) {}
    }

    target.src =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='140' viewBox='0 0 100 140'><rect width='100' height='140' fill='%23eee'/><text x='50' y='70' fill='%23aaa' font-size='12' text-anchor='middle'>JMComic</text></svg>";
  };

  renderAlbumCard(
    album: JmAlbumItem,
    isBatch = false,
    isSelected = false,
    onToggleSelect?: (id: string) => void
  ) {
    const inLibrary = this.isBookInLibrary(album);
    return (
      <div
        key={album.id}
        className={`jmcomic-card ${isBatch ? "batch-mode" : ""} ${isSelected ? "selected" : ""}`}
        onClick={() => {
          if (isBatch && onToggleSelect) {
            onToggleSelect(album.id);
          } else {
            this.openAlbumDetail(album.id);
          }
        }}
      >
        {isBatch && (
          <input
            type="checkbox"
            className="jmcomic-card-checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              if (onToggleSelect) onToggleSelect(album.id);
            }}
          />
        )}
        {inLibrary && (
          <div className="jmcomic-card-in-library-badge">
            ✓ <Trans>In Library</Trans>
          </div>
        )}
        <div className="jmcomic-card-cover-box">
          <img
            src={album.cover}
            alt={album.title}
            className="jmcomic-card-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={this.handleImageError}
          />
        </div>
        <div className="jmcomic-card-info">
          <div className="jmcomic-card-title" title={album.title}>
            {album.title}
          </div>
          <div className="jmcomic-card-author">{album.author}</div>
          {album.tags && album.tags.length > 0 && (
            <div className="jmcomic-card-tags">
              {album.tags.slice(0, 3).map((tag, i) => (
                <span key={i} className="jmcomic-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  renderPagination(
    current: number,
    total: number,
    onPageChange: (p: number) => void
  ) {
    if (total <= 1) return null;
    return (
      <JmcomicPagination
        current={current}
        total={total}
        onPageChange={onPageChange}
        t={this.props.t}
      />
    );
  }

  renderDetailModal() {
    const {
      selectedAlbumId,
      selectedAlbumDetail,
      selectedChapterIds,
      isLoadingDetail,
      isFavoritedDetail,
      isTogglingFavorite,
    } = this.state;
    if (!selectedAlbumId) return null;

    const allSelected =
      selectedAlbumDetail &&
      selectedChapterIds.length === selectedAlbumDetail.chapters.length;

    return (
      <div
        className="jmcomic-detail-overlay"
        onClick={() => this.setState({ selectedAlbumId: null })}
      >
        <div
          className="jmcomic-detail-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="jmcomic-detail-header">
            <span style={{ fontWeight: "bold", fontSize: "15px" }}>
              <Trans>Comic Detail</Trans>
            </span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                className={`jmcomic-fav-btn ${isFavoritedDetail ? "favorited" : ""}`}
                onClick={() => this.handleToggleFavorite(selectedAlbumId)}
                disabled={isTogglingFavorite}
                title={
                  isFavoritedDetail
                    ? this.props.t("Remove from Favorites")
                    : this.props.t("Add to Favorites")
                }
              >
                {isTogglingFavorite && (
                  <span
                    className="jmcomic-spinner dark"
                    style={{ width: 10, height: 10 }}
                  />
                )}
                {isFavoritedDetail ? "❤️" : "🤍"}{" "}
                {isFavoritedDetail
                  ? this.props.t("Favorited")
                  : this.props.t("Favorite")}
              </button>
              <div
                className="jmcomic-close-btn"
                onClick={() => this.setState({ selectedAlbumId: null })}
              >
                ✕
              </div>
            </div>
          </div>

          {isLoadingDetail || !selectedAlbumDetail ? (
            <div style={{ padding: "40px", textAlign: "center" }}>
              <Trans>Loading comic details...</Trans>
            </div>
          ) : (
            <>
              <div className="jmcomic-detail-content">
                <img
                  src={selectedAlbumDetail.cover}
                  alt={selectedAlbumDetail.title}
                  className="jmcomic-detail-cover"
                  referrerPolicy="no-referrer"
                  onError={this.handleImageError}
                />
                <div className="jmcomic-detail-meta">
                  <div className="jmcomic-detail-title">
                    {selectedAlbumDetail.title}
                  </div>
                  <div style={{ fontSize: "13px", opacity: 0.8 }}>
                    <Trans>Author</Trans>: {selectedAlbumDetail.author}
                  </div>
                  {selectedAlbumDetail.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {selectedAlbumDetail.tags.map((t, i) => (
                        <span key={i} className="jmcomic-tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {selectedAlbumDetail.description && (
                    <div
                      style={{
                        fontSize: "12px",
                        opacity: 0.7,
                        maxHeight: "60px",
                        overflowY: "auto",
                      }}
                    >
                      {selectedAlbumDetail.description}
                    </div>
                  )}

                  <div className="jmcomic-chapters-box">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: "13px", fontWeight: 600 }}>
                        <Trans>Chapters</Trans> (
                        {selectedAlbumDetail.chapters.length})
                      </span>
                      <button
                        className="jmcomic-btn secondary"
                        style={{ padding: "2px 8px", fontSize: "11px" }}
                        onClick={() => {
                          if (allSelected) {
                            this.setState({ selectedChapterIds: [] });
                          } else {
                            this.setState({
                              selectedChapterIds:
                                selectedAlbumDetail.chapters.map((c) => c.id),
                            });
                          }
                        }}
                      >
                        {allSelected
                          ? this.props.t("Deselect All")
                          : this.props.t("Select All")}
                      </button>
                    </div>

                    <div className="jmcomic-chapters-list">
                      {selectedAlbumDetail.chapters.map((ch) => {
                        const isChecked = selectedChapterIds.includes(ch.id);
                        return (
                          <div key={ch.id} className="jmcomic-chapter-row">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  this.setState({
                                    selectedChapterIds: [
                                      ...selectedChapterIds,
                                      ch.id,
                                    ],
                                  });
                                } else {
                                  this.setState({
                                    selectedChapterIds:
                                      selectedChapterIds.filter(
                                        (id) => id !== ch.id
                                      ),
                                    });
                                }
                              }}
                            />
                            <span>{ch.title}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="jmcomic-detail-actions">
                <button
                  className="jmcomic-btn secondary"
                  onClick={() =>
                    this.startDownload(
                      selectedAlbumDetail.id,
                      selectedChapterIds,
                      false
                    )
                  }
                  disabled={selectedChapterIds.length === 0}
                >
                  <Trans>Download Selected (Separate CBZ)</Trans>
                </button>
                <button
                  className="jmcomic-btn"
                  onClick={() =>
                    this.startDownload(selectedAlbumDetail.id, [], true)
                  }
                >
                  <Trans>Download Full Album (Merged CBZ)</Trans>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  renderFavoritesTab() {
    const {
      currentUser,
      isLoggingIn,
      loginUsernameInput,
      loginPasswordInput,
      loginRememberInput,
      loginErrorMsg,
      favoriteFolders,
      activeFolderId,
      favoriteOrder,
      favoritePage,
      favoriteTotalPages,
      favoriteTotalCount,
      favoriteResults,
      isFavoritesLoading,
      isBatchMode,
      selectedBatchIds,
    } = this.state;

    // 1. If not logged in, render Login Form
    if (!currentUser) {
      return (
        <div className="jmcomic-login-container">
          <form className="jmcomic-login-card" onSubmit={this.handleLogin}>
            <div className="jmcomic-login-title">
              <Trans>Log in to JMComic</Trans>
            </div>
            <div className="jmcomic-login-subtitle">
              <Trans>
                Log in with your JM account to view favorites and batch import comics
              </Trans>
            </div>

            {loginErrorMsg && (
              <div className="jmcomic-login-error">{loginErrorMsg}</div>
            )}

            <div className="jmcomic-form-group">
              <label className="jmcomic-form-label">
                <Trans>Username / Email</Trans>
              </label>
              <input
                type="text"
                className="jmcomic-search-input"
                placeholder={this.props.t(
                  "Enter your JM account username or email"
                )}
                value={loginUsernameInput}
                onChange={(e) =>
                  this.setState({ loginUsernameInput: e.target.value })
                }
                autoFocus
              />
            </div>

            <div className="jmcomic-form-group">
              <label className="jmcomic-form-label">
                <Trans>Password</Trans>
              </label>
              <input
                type="password"
                className="jmcomic-search-input"
                placeholder={this.props.t("Enter your JM account password")}
                value={loginPasswordInput}
                onChange={(e) =>
                  this.setState({ loginPasswordInput: e.target.value })
                }
              />
            </div>

            <div
              className="jmcomic-form-group"
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                marginTop: 6,
                marginBottom: 16,
              }}
            >
              <input
                type="checkbox"
                id="jm-remember-pwd"
                checked={loginRememberInput}
                onChange={(e) =>
                  this.setState({ loginRememberInput: e.target.checked })
                }
              />
              <label
                htmlFor="jm-remember-pwd"
                className="jmcomic-form-label"
                style={{ marginBottom: 0, cursor: "pointer", fontSize: 13 }}
              >
                <Trans>Remember password (auto login next time)</Trans>
              </label>
            </div>

            <button
              type="submit"
              className="jmcomic-btn"
              style={{ width: "100%", padding: "10px", fontSize: "15px" }}
              disabled={isLoggingIn}
            >
              {isLoggingIn && <span className="jmcomic-spinner" />}
              {isLoggingIn
                ? this.props.t("Logging in...")
                : this.props.t("Log in")}
            </button>
          </form>
        </div>
      );
    }

    // 2. If logged in, render Profile Bar + Folder Tabs + Filter + Batch Bar + Grid
    const handleToggleSelectId = (id: string) => {
      this.setState((prev) => {
        const exists = prev.selectedBatchIds.includes(id);
        return {
          selectedBatchIds: exists
            ? prev.selectedBatchIds.filter((x) => x !== id)
            : [...prev.selectedBatchIds, id],
        };
      });
    };

    return (
      <div>
        {/* User Profile Bar */}
        <div className="jmcomic-profile-bar">
          <div className="jmcomic-profile-user">
            {currentUser.photo ? (
              <img
                src={currentUser.photo}
                alt={currentUser.username}
                className="jmcomic-profile-avatar"
                referrerPolicy="no-referrer"
                onError={this.handleImageError}
              />
            ) : (
              <div className="jmcomic-profile-avatar-placeholder">
                {(currentUser.username || "JM")[0].toUpperCase()}
              </div>
            )}
            <div className="jmcomic-profile-meta">
              <div className="jmcomic-profile-name">
                {currentUser.username}
              </div>
              <div className="jmcomic-profile-badges">
                <span className="jmcomic-profile-badge level">
                  {currentUser.level_name || `Lv.${currentUser.level || 1}`}
                </span>
                {currentUser.coin !== undefined && (
                  <span className="jmcomic-profile-badge">
                    🪙 {currentUser.coin} <Trans>Coins</Trans>
                  </span>
                )}
                <span className="jmcomic-profile-badge">
                  ⭐ {currentUser.album_favorites || favoriteTotalCount}{" "}
                  <Trans>Favorites</Trans>
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              className="jmcomic-btn secondary"
              style={{ padding: "6px 12px", fontSize: "12px" }}
              onClick={() => this.fetchFavorites(favoritePage, activeFolderId)}
              disabled={isFavoritesLoading}
            >
              {isFavoritesLoading && <span className="jmcomic-spinner dark" />}
              {isFavoritesLoading
                ? this.props.t("Refreshing...")
                : `🔄 ${this.props.t("Refresh")}`}
            </button>
            <button
              className="jmcomic-btn secondary"
              style={{ padding: "6px 12px", fontSize: "12px", opacity: 0.8 }}
              onClick={this.handleLogout}
            >
              🚪 <Trans>Logout</Trans>
            </button>
          </div>
        </div>

        {/* Folder Tabs */}
        {favoriteFolders && favoriteFolders.length > 1 && (
          <div className="jmcomic-folder-tabs">
            {favoriteFolders.map((f) => (
              <div
                key={f.id}
                className={`jmcomic-folder-tab ${activeFolderId === f.id ? "active" : ""}`}
                onClick={() => this.fetchFavorites(1, f.id)}
              >
                📁 {f.name}
              </div>
            ))}
          </div>
        )}

        {/* Action / Filter Bar */}
        <div className="jmcomic-search-bar" style={{ marginBottom: "12px" }}>
          <select
            className="jmcomic-select"
            value={favoriteOrder}
            onChange={(e: any) =>
              this.setState({ favoriteOrder: e.target.value }, () =>
                this.fetchFavorites(1)
              )
            }
          >
            <option value="mr">{this.props.t("Latest Added")}</option>
            <option value="mv">{this.props.t("Most Views")}</option>
            <option value="tf">{this.props.t("Most Likes")}</option>
            <option value="mp">{this.props.t("Most Pictures")}</option>
          </select>

          <button
            className={`jmcomic-btn ${isBatchMode ? "" : "secondary"}`}
            style={{ marginLeft: "auto", fontSize: "13px" }}
            onClick={() =>
              this.setState((prev) => ({
                isBatchMode: !prev.isBatchMode,
                selectedBatchIds: [],
              }))
            }
          >
            {isBatchMode
              ? this.props.t("Exit Batch Mode")
              : `☑️ ${this.props.t("Batch Import")}`}
          </button>
        </div>

        {/* Batch Selection Toolbar (when active) */}
        {isBatchMode && (
          <div className="jmcomic-batch-bar">
            <div style={{ fontSize: "13px", fontWeight: 500 }}>
              <Trans>Selected</Trans>: <strong>{selectedBatchIds.length}</strong> /{" "}
              {favoriteResults.length} <Trans>comics</Trans>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                className="jmcomic-btn secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() =>
                  this.setState({
                    selectedBatchIds: favoriteResults.map((a) => a.id),
                  })
                }
              >
                <Trans>Select All</Trans>
              </button>
              <button
                className="jmcomic-btn secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => {
                  const unimported = favoriteResults
                    .filter((a) => !this.isBookInLibrary(a))
                    .map((a) => a.id);
                  this.setState({ selectedBatchIds: unimported });
                }}
              >
                <Trans>Select Un-imported</Trans>
              </button>
              <button
                className="jmcomic-btn secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={() => this.setState({ selectedBatchIds: [] })}
              >
                <Trans>Deselect</Trans>
              </button>
              <button
                className="jmcomic-btn"
                style={{ padding: "5px 14px", fontSize: "13px" }}
                disabled={selectedBatchIds.length === 0}
                onClick={() => this.enqueueBatchDownloads(selectedBatchIds)}
              >
                📥 <Trans>Batch Add to Downloads</Trans> (
                {selectedBatchIds.length})
              </button>
            </div>
          </div>
        )}

        {/* Comics Grid */}
        <div className="jmcomic-grid">
          {favoriteResults.map((album) =>
            this.renderAlbumCard(
              album,
              isBatchMode,
              selectedBatchIds.includes(album.id),
              handleToggleSelectId
            )
          )}
        </div>

        {favoriteResults.length === 0 && !isFavoritesLoading && (
          <div
            style={{
              padding: "60px 0",
              textAlign: "center",
              opacity: 0.6,
            }}
          >
            <Trans>No favorite comics found in this folder</Trans>
          </div>
        )}

        {isFavoritesLoading && (
          <div style={{ padding: "40px 0", textAlign: "center" }}>
            <span className="jmcomic-spinner dark" />
            <div
              style={{ marginTop: "10px", fontSize: "13px", opacity: 0.7 }}
            >
              <Trans>Loading favorite comics...</Trans>
            </div>
          </div>
        )}

        {this.renderPagination(favoritePage, favoriteTotalPages, (p) =>
          this.fetchFavorites(p, activeFolderId)
        )}
      </div>
    );
  }

  deleteTask = (albumId: string) => {
    this.setState((prev) => {
      const copy = { ...prev.downloadTasks };
      delete copy[albumId];
      this.saveTasks(copy);
      return { downloadTasks: copy };
    });
  };

  handleManualImport = async (task: JmDownloadTask) => {
    if (!task.createdFiles || task.createdFiles.length === 0) {
      toast.error(this.props.t("No files found to import"));
      return;
    }
    let successCount = 0;
    for (const file of task.createdFiles) {
      const ok = await this.importBookFile(file.path, file.name);
      if (ok) successCount++;
    }
    if (successCount > 0) {
      toast.success(
        `${this.props.t("Imported to library successfully")}: ${task.title}`
      );
    } else {
      toast.error(this.props.t("Import failed"));
    }
  };

  handleOpenFileLocation = async (filePath?: string) => {
    if (!filePath) return;
    const ipc = getIpc();
    try {
      if (ipc) {
        await ipc.invoke("open-explorer-folder", {
          path: filePath,
          isFolder: false,
        });
      }
    } catch (e) {
      console.error("Open file location failed:", e);
    }
  };

  renderDownloadsTab() {
    const { downloadTasks } = this.state;
    const taskList = Object.values(downloadTasks);

    if (taskList.length === 0) {
      return (
        <div style={{ padding: "60px 0", textAlign: "center", opacity: 0.6 }}>
          <Trans>No active or past download tasks</Trans>
        </div>
      );
    }

    return (
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <span style={{ fontWeight: 600 }}>
            <Trans>Download Tasks</Trans> ({taskList.length})
          </span>
          <button
            className="jmcomic-btn secondary"
            style={{ fontSize: "12px", padding: "4px 10px" }}
            onClick={() => {
              const activeOnly: Record<string, JmDownloadTask> = {};
              for (const [k, v] of Object.entries(downloadTasks)) {
                if (v.status === "downloading" || v.status === "pending") {
                  activeOnly[k] = v;
                }
              }
              this.setState({ downloadTasks: activeOnly });
              this.saveTasks(activeOnly);
            }}
          >
            <Trans>Clear Finished</Trans>
          </button>
        </div>

        {taskList.map((task) => (
          <div key={task.albumId} className="jmcomic-task-item">
            {task.coverUrl ? (
              <img
                src={task.coverUrl}
                alt={task.title}
                className="jmcomic-task-cover"
                referrerPolicy="no-referrer"
                onError={this.handleImageError}
              />
            ) : (
              <div
                className="jmcomic-task-cover"
                style={{ background: "#ddd" }}
              />
            )}
            <div className="jmcomic-task-info">
              <div style={{ fontWeight: 600, fontSize: "14px" }}>
                {task.title}
              </div>
              <div style={{ fontSize: "12px", opacity: 0.7 }}>
                {task.status === "downloading" &&
                  `${this.props.t("Downloading")}: ${task.currentPhotoTitle || ""} (${task.percent}%)`}
                {task.status === "packaging" &&
                  `${this.props.t("Packaging CBZ...")} (${task.percent}%)`}
                {task.status === "completed" && (
                  <span style={{ color: "#34c759" }}>
                    ✓ <Trans>Completed</Trans>
                  </span>
                )}
                {task.status === "failed" && (
                  <span style={{ color: "#ff3b30" }}>
                    ✗ <Trans>Failed</Trans>: {task.errorMsg}
                  </span>
                )}
                {task.status === "cancelled" && (
                  <span style={{ color: "#888" }}>
                    <Trans>Cancelled</Trans>
                  </span>
                )}
              </div>
              {(task.status === "downloading" ||
                task.status === "packaging") && (
                <div className="jmcomic-progress-track">
                  <div
                    className="jmcomic-progress-bar"
                    style={{ width: `${task.percent}%` }}
                  />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              {(task.status === "downloading" ||
                task.status === "pending") && (
                <button
                  className="jmcomic-btn secondary"
                  style={{ padding: "4px 8px", fontSize: "11px" }}
                  onClick={() => this.cancelDownload(task.albumId)}
                >
                  <Trans>Cancel</Trans>
                </button>
              )}

              {task.status === "completed" && (
                <>
                  <button
                    className="jmcomic-btn secondary"
                    style={{ padding: "4px 8px", fontSize: "11px" }}
                    onClick={() => this.handleManualImport(task)}
                    title={this.props.t("Import to Library")}
                  >
                    <Trans>Import to Library</Trans>
                  </button>
                  {task.createdFiles && task.createdFiles[0] && (
                    <button
                      className="jmcomic-btn secondary"
                      style={{ padding: "4px 8px", fontSize: "11px" }}
                      onClick={() =>
                        this.handleOpenFileLocation(task.createdFiles![0].path)
                      }
                      title={this.props.t("Open File Location")}
                    >
                      <Trans>Open Folder</Trans>
                    </button>
                  )}
                  <button
                    className="jmcomic-btn secondary"
                    style={{ padding: "4px 8px", fontSize: "11px", opacity: 0.7 }}
                    onClick={() => this.deleteTask(task.albumId)}
                    title={this.props.t("Delete")}
                  >
                    ✕
                  </button>
                </>
              )}

              {(task.status === "failed" || task.status === "cancelled") && (
                <button
                  className="jmcomic-btn secondary"
                  style={{ padding: "4px 8px", fontSize: "11px", opacity: 0.7 }}
                  onClick={() => this.deleteTask(task.albumId)}
                  title={this.props.t("Delete")}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  renderSettingsTab() {
    const { config, envStatus, availableDomains } = this.state;
    const isReady = envStatus.hasPython && envStatus.hasJmcomic;
    const isBundledRuntime = envStatus.runtimeMode === "bundled-sidecar";
    const boxStatusClass = envStatus.isChecking || envStatus.isInstalling
      ? "loading"
      : isReady
      ? "success"
      : envStatus.hasPython
      ? "warning"
      : "error";

    return (
      <div style={{ maxWidth: "600px" }}>
        {/* Environment Status Box */}
        <div className={`jmcomic-env-box ${boxStatusClass}`}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "6px",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "14px" }}>
              {isBundledRuntime
                ? this.props.t("Bundled JMComic Sidecar Status")
                : this.props.t("Python Environment Status")}
            </div>
            {isReady && !envStatus.isChecking && !envStatus.isInstalling && (
              <span
                style={{
                  fontSize: "11px",
                  background: "#34c759",
                  color: "#fff",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontWeight: "bold",
                }}
              >
                READY
              </span>
            )}
          </div>

          {/* Status Message / Info */}
          {(envStatus.isChecking || envStatus.isInstalling) && (
            <div>
              <div
                style={{
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "4px",
                }}
              >
                <div className="jmcomic-spinner dark" />
                <span>
                  {envStatus.isInstalling
                    ? this.props.t(
                        "Installing required dependencies (pip install jmcomic)..."
                      )
                    : this.props.t("Detecting Python & JMComic environment...")}
                </span>
              </div>
              <div className="jmcomic-pulse-track">
                <div className="jmcomic-pulse-bar" />
              </div>
            </div>
          )}

          {!envStatus.isChecking && !envStatus.isInstalling && (
            <div style={{ fontSize: "12px", lineHeight: "1.6" }}>
              {isReady ? (
                <div>
                  <div style={{ color: "#34c759", fontWeight: 500 }}>
                    ✓ <Trans>Python & JMComic Ready</Trans> ({envStatus.jmcomicVersion})
                  </div>
                  {envStatus.pythonPath && (
                    <div style={{ opacity: 0.7, fontSize: "11px" }}>
                      <Trans>Executable</Trans>: {envStatus.pythonPath}
                    </div>
                  )}
                  {envStatus.runtimeMode && (
                    <div style={{ opacity: 0.7, fontSize: "11px" }}>
                      <Trans>Runtime mode</Trans>: {envStatus.runtimeMode}
                    </div>
                  )}
                </div>
              ) : envStatus.hasPython ? (
                <div>
                  <div style={{ color: "#ff9500", fontWeight: 500 }}>
                    ⚠️ <Trans>Python detected, but JMComic module is missing. Please click Install.</Trans>
                  </div>
                  {envStatus.pythonPath && (
                    <div style={{ opacity: 0.7, fontSize: "11px" }}>
                      <Trans>Executable</Trans>: {envStatus.pythonPath}
                    </div>
                  )}
                  <div style={{ opacity: 0.8, fontSize: "11px" }}>
                    <Trans>Please click "Install JMComic Dependencies" below to install.</Trans>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ color: "#ff3b30", fontWeight: 500 }}>
                    ✗ {envStatus.message || this.props.t("Python executable not detected")}
                  </div>
                  {envStatus.pythonPath && (
                    <div style={{ opacity: 0.7, fontSize: "11px" }}>
                      <Trans>Executable</Trans>: {envStatus.pythonPath}
                    </div>
                  )}
                  <div style={{ opacity: 0.8, fontSize: "11px", marginTop: "2px" }}>
                    <Trans>Please ensure Python 3.10+ is installed and available in PATH, or specify custom path below.</Trans>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button
              className="jmcomic-btn secondary"
              style={{ fontSize: "12px", padding: "5px 12px" }}
              onClick={this.checkEnvironment}
              disabled={envStatus.isChecking || envStatus.isInstalling}
            >
              {envStatus.isChecking && <span className="jmcomic-spinner dark" />}
              {envStatus.isChecking
                ? this.props.t("Checking...")
                : this.props.t("Check Environment")}
            </button>

            <button
              className="jmcomic-btn"
              style={{ fontSize: "12px", padding: "5px 12px" }}
              onClick={this.installDependencies}
              disabled={envStatus.isChecking || envStatus.isInstalling}
            >
              {envStatus.isInstalling && <span className="jmcomic-spinner" />}
              {envStatus.isInstalling
                ? this.props.t("Installing dependencies...")
                : isBundledRuntime
                ? this.props.t("Verify Bundled Sidecar")
                : this.props.t("Create or Repair Project Environment")}
            </button>
          </div>

          {/* Logs Output if available */}
          {envStatus.installLogs && (
            <details className="jmcomic-log-details" open={!isReady}>
              <summary>
                <Trans>Installation Logs</Trans>
              </summary>
              <pre className="jmcomic-log-box">{envStatus.installLogs}</pre>
            </details>
          )}
        </div>

        {/* A custom Python is a source-mode override; releases always use the sidecar. */}
        {!isBundledRuntime && <div className="jmcomic-form-group">
          <label className="jmcomic-form-label">
            <Trans>Python Executable Path (Optional)</Trans>
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              className="jmcomic-search-input"
              style={{ flex: 1 }}
              placeholder={this.props.t("Default: project .venv")}
              value={config.pythonPath || ""}
              onChange={(e) => this.saveConfig({ pythonPath: e.target.value })}
            />
            <button
              className="jmcomic-btn secondary"
              style={{ whiteSpace: "nowrap", padding: "0 12px", fontSize: "12px" }}
              onClick={this.handleSelectPythonFile}
            >
              <Trans>Browse...</Trans>
            </button>
          </div>
          <span className="jmcomic-form-desc">
            <Trans>
              Specify a custom Python or virtual environment path if needed.
            </Trans>
          </span>
        </div>}

        {/* Download Output Directory */}
        <div className="jmcomic-form-group">
          <label className="jmcomic-form-label">
            <Trans>Download Directory</Trans>
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              className="jmcomic-search-input"
              style={{ flex: 1 }}
              placeholder={this.props.t("Default: ~/Downloads/KoodoReader_Comics")}
              value={config.outputDir || ""}
              readOnly
            />
            <button
              className="jmcomic-btn secondary"
              style={{ whiteSpace: "nowrap", padding: "0 12px", fontSize: "12px" }}
              onClick={this.handleSelectOutputDir}
            >
              <Trans>Browse...</Trans>
            </button>
            {config.outputDir && (
              <button
                className="jmcomic-btn outline"
                style={{ whiteSpace: "nowrap", padding: "0 10px", fontSize: "12px" }}
                onClick={() => this.saveConfig({ outputDir: "" })}
              >
                <Trans>Reset</Trans>
              </button>
            )}
          </div>
          <span className="jmcomic-form-desc">
            <Trans>
              Specify where downloaded CBZ comics are saved. Useful if C: drive is low on space.
            </Trans>
          </span>
        </div>

        {/* Proxy */}
        <div className="jmcomic-form-group">
          <label className="jmcomic-form-label">
            <Trans>Network Proxy</Trans>
          </label>
          <input
            type="text"
            className="jmcomic-search-input"
            placeholder={this.props.t("e.g. http://127.0.0.1:7890 (leave empty for direct)")}
            value={config.proxy || ""}
            onChange={(e) => this.saveConfig({ proxy: e.target.value })}
          />
        </div>

        {/* Domain */}
        <div className="jmcomic-form-group">
          <label className="jmcomic-form-label">
            <Trans>JMComic Domain Route</Trans>
          </label>
          <select
            className="jmcomic-select"
            value={config.domain || "18comic.vip"}
            onChange={(e) => this.saveConfig({ domain: e.target.value })}
          >
            {availableDomains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {/* Download Concurrency */}
        <div className="jmcomic-form-group">
          <label className="jmcomic-form-label">
            <Trans>Download Concurrency Threads</Trans>: {config.threads || 5}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            value={config.threads || 5}
            onChange={(e) =>
              this.saveConfig({ threads: parseInt(e.target.value) })
            }
          />
        </div>

        {/* Auto import */}
        <div className="jmcomic-form-group" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            id="jm-auto-import"
            checked={config.autoImport !== false}
            onChange={(e) => this.saveConfig({ autoImport: e.target.checked })}
          />
          <label htmlFor="jm-auto-import" className="jmcomic-form-label" style={{ marginBottom: 0, cursor: "pointer" }}>
            <Trans>Automatically import downloaded CBZ comics into Library</Trans>
          </label>
        </div>
      </div>
    );
  }

  render() {
    const {
      currentTab,
      searchResults,
      searchPage,
      searchTotalPages,
      rankResults,
      rankPage,
      rankTotalPages,
      downloadTasks,
    } = this.state;

    const activeDownloadsCount = Object.values(downloadTasks).filter(
      (t) => t.status === "downloading" || t.status === "pending"
    ).length;

    return (
      <div className="jmcomic-dialog-container">
        {/* Header Tabs */}
        <div className="jmcomic-header">
          <div className="jmcomic-tabs">
            <button
              className={`jmcomic-tab-btn ${currentTab === "search" ? "active" : ""}`}
              onClick={() => this.setState({ currentTab: "search" })}
            >
              🔍 <Trans>Search Comics</Trans>
            </button>
            <button
              className={`jmcomic-tab-btn ${currentTab === "rank" ? "active" : ""}`}
              onClick={() => {
                this.setState({ currentTab: "rank" }, () => {
                  if (rankResults.length === 0) this.handleRank(1);
                });
              }}
            >
              🔥 <Trans>Rankings</Trans>
            </button>
            <button
              className={`jmcomic-tab-btn ${currentTab === "favorites" ? "active" : ""}`}
              onClick={() => {
                this.setState({ currentTab: "favorites" }, () => {
                  if (
                    this.state.currentUser &&
                    this.state.favoriteResults.length === 0
                  ) {
                    this.fetchFavorites(1, "0");
                  }
                });
              }}
            >
              ⭐ <Trans>My Favorites</Trans>
            </button>
            <button
              className={`jmcomic-tab-btn ${currentTab === "downloads" ? "active" : ""}`}
              onClick={() => this.setState({ currentTab: "downloads" })}
            >
              📥 <Trans>Downloads</Trans>
              {activeDownloadsCount > 0 && (
                <span className="jmcomic-badge">{activeDownloadsCount}</span>
              )}
            </button>
            <button
              className={`jmcomic-tab-btn ${currentTab === "settings" ? "active" : ""}`}
              onClick={() => this.setState({ currentTab: "settings" })}
            >
              ⚙️ <Trans>Settings</Trans>
            </button>
          </div>
          <div
            className="jmcomic-close-btn"
            onClick={() => this.props.handleJmcomicDialog(false)}
          >
            ✕
          </div>
        </div>

        {/* Body content */}
        <div className="jmcomic-body">
          {currentTab === "search" && (
            <>
              {this.renderSearchBar()}
              <div className="jmcomic-grid">
                {searchResults.map((album) => this.renderAlbumCard(album))}
              </div>
              {searchResults.length === 0 && (
                <div
                  style={{
                    padding: "60px 0",
                    textAlign: "center",
                    opacity: 0.6,
                  }}
                >
                  <Trans>Search for comics by title, author, or JM ID</Trans>
                </div>
              )}
              {this.renderPagination(
                searchPage,
                searchTotalPages,
                this.handleSearch
              )}
            </>
          )}

          {currentTab === "rank" && (
            <>
              {this.renderRankBar()}
              <div className="jmcomic-grid">
                {rankResults.map((album) => this.renderAlbumCard(album))}
              </div>
              {this.renderPagination(
                rankPage,
                rankTotalPages,
                this.handleRank
              )}
            </>
          )}

          {currentTab === "favorites" && this.renderFavoritesTab()}

          {currentTab === "downloads" && this.renderDownloadsTab()}

          {currentTab === "settings" && this.renderSettingsTab()}
        </div>

        {/* Detail Modal */}
        {this.renderDetailModal()}
      </div>
    );
  }
}

export default JmcomicDialog;

