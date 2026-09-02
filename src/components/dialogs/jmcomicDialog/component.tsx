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

      selectedAlbumId: null,
      selectedAlbumDetail: null,
      selectedChapterIds: [],
      isLoadingDetail: false,

      downloadTasks: {},

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

          return {
            downloadTasks: {
              ...prev.downloadTasks,
              [albumId]: {
                ...task,
                status: percent >= 92 ? "packaging" : "downloading",
                percent,
                currentPhotoTitle: photo_title,
                currentPhotoIndex: photo_index,
                totalPhotos: total_photos,
              },
            },
          };
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

          return {
            downloadTasks: {
              ...prev.downloadTasks,
              [albumId]: {
                ...task,
                status: "completed",
                percent: 100,
                createdFiles: files,
                imported: true,
              },
            },
          };
        });

        toast.success(
          `${this.props.t("Download Completed")}: ${title || albumId}`
        );

        // Auto import into Koodo library if enabled
        if (this.state.config.autoImport && files && files.length > 0) {
          for (const item of files) {
            try {
              if (ipc) {
                const buffer = await ipc.invoke("file-command", {
                  operation: "readFile",
                  path: item.path,
                });
                if (buffer) {
                  const fileObj = new File([buffer], item.name, {
                    type: "application/x-cbz",
                  });
                  await this.props.importBookFunc(fileObj);
                }
              }
            } catch (err) {
              console.error("Auto import failed:", err);
            }
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

          return {
            downloadTasks: {
              ...prev.downloadTasks,
              [albumId]: {
                ...task,
                status: "failed",
                errorMsg: msg,
              },
            },
          };
        });
        toast.error(`${this.props.t("Download Failed")}: ${msg || ""}`);
      };

      ipc.on("jmcomic-download-progress", this.progressListener);
      ipc.on("jmcomic-download-finish", this.finishListener);
      ipc.on("jmcomic-download-error", this.errorListener);
    }
  }

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
            hasPython: false,
            hasJmcomic: false,
            pythonPath: res?.data?.python_path,
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

    this.setState((prev) => ({
      downloadTasks: {
        ...prev.downloadTasks,
        [albumId]: {
          albumId,
          title,
          author,
          coverUrl,
          status: "pending",
          percent: 0,
        },
      },
      selectedAlbumId: null, // close detail modal
    }));

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
        this.setState((prev) => ({
          downloadTasks: {
            ...prev.downloadTasks,
            [albumId]: {
              ...prev.downloadTasks[albumId],
              status: "cancelled",
            },
          },
        }));
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

  renderAlbumCard(album: JmAlbumItem) {
    return (
      <div
        key={album.id}
        className="jmcomic-card"
        onClick={() => this.openAlbumDetail(album.id)}
      >
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
      <div className="jmcomic-pagination">
        <button
          className="jmcomic-btn secondary"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          <Trans>Previous</Trans>
        </button>
        <span style={{ fontSize: "13px", opacity: 0.7 }}>
          {current} / {total}
        </span>
        <button
          className="jmcomic-btn secondary"
          disabled={current >= total}
          onClick={() => onPageChange(current + 1)}
        >
          <Trans>Next</Trans>
        </button>
      </div>
    );
  }

  renderDetailModal() {
    const {
      selectedAlbumId,
      selectedAlbumDetail,
      selectedChapterIds,
      isLoadingDetail,
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
            <div
              className="jmcomic-close-btn"
              onClick={() => this.setState({ selectedAlbumId: null })}
            >
              ✕
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
                    ✓ <Trans>Completed & Imported</Trans>
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
            <div>
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
            </div>
          </div>
        ))}
      </div>
    );
  }

  renderSettingsTab() {
    const { config, envStatus, availableDomains } = this.state;
    const isReady = envStatus.hasPython && envStatus.hasJmcomic;
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
              <Trans>Python Environment Status</Trans>
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
                : this.props.t("Install JMComic Dependencies")}
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

        {/* Python Path */}
        <div className="jmcomic-form-group">
          <label className="jmcomic-form-label">
            <Trans>Python Executable Path (Optional)</Trans>
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              className="jmcomic-search-input"
              style={{ flex: 1 }}
              placeholder={this.props.t("Default: system python / python3")}
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

