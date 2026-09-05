import React from "react";
import "./filterDialog.css";
import { FilterDialogProps, FilterDialogState } from "./interface";
import {
  createEmptyFilterConfig,
  getActiveFilterCount,
  isFilterActive,
  TriState,
} from "../../../utils/filterUtil";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { Trans } from "react-i18next";
import DatabaseService from "../../../utils/storage/databaseService";

export const NOVEL_FORMATS = [
  "EPUB",
  "TXT",
  "PDF",
  "MOBI",
  "AZW3",
  "FB2",
  "DOCX",
];

export const COMIC_FORMATS = [
  "CBZ",
  "CBR",
  "CBT",
  "CB7",
];

const COMIC_EXT_SET = new Set(["cbz", "cbr", "cbt", "cb7", "zip", "rar"]);

class FilterDialog extends React.Component<FilterDialogProps, FilterDialogState> {
  private dragStartX = 0;
  private dragStartY = 0;
  private initialPosX = 0;
  private initialPosY = 0;

  constructor(props: FilterDialogProps) {
    super(props);
    const defaultX = props.isCollapsed ? 470 : 360;
    const defaultY = 70;
    this.state = {
      authorSearchKeyword: "",
      posX: defaultX,
      posY: defaultY,
      isDragging: false,
    };
  }

  async componentDidMount() {
    window.addEventListener("keydown", this.handleKeyDown);
    if (
      !this.props.books ||
      this.props.books.length === 0 ||
      !this.props.books.some((b) => b && b.format)
    ) {
      try {
        const records = await DatabaseService.getAllRecords("books");
        if (records && records.length > 0) {
          this.setState({ fallbackBooks: records });
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("mousemove", this.handleGlobalMouseMove);
    window.removeEventListener("mouseup", this.handleGlobalMouseUp);
  }

  handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.props.handleFilterDisplay(false);
    }
  };

  handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest("button, .filter-dialog-clear-btn, .filter-dialog-close-btn")
    ) {
      return;
    }
    e.preventDefault();
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.initialPosX = this.state.posX;
    this.initialPosY = this.state.posY;
    this.setState({ isDragging: true });
    window.addEventListener("mousemove", this.handleGlobalMouseMove);
    window.addEventListener("mouseup", this.handleGlobalMouseUp);
  };

  handleGlobalMouseMove = (e: MouseEvent) => {
    if (!this.state.isDragging) return;
    const deltaX = e.clientX - this.dragStartX;
    const deltaY = e.clientY - this.dragStartY;
    const maxX = Math.max(10, window.innerWidth - 450);
    const maxY = Math.max(10, window.innerHeight - 80);
    const posX = Math.min(Math.max(10, this.initialPosX + deltaX), maxX);
    const posY = Math.min(Math.max(10, this.initialPosY + deltaY), maxY);
    this.setState({ posX, posY });
  };

  handleGlobalMouseUp = () => {
    if (this.state.isDragging) {
      this.setState({ isDragging: false });
    }
    window.removeEventListener("mousemove", this.handleGlobalMouseMove);
    window.removeEventListener("mouseup", this.handleGlobalMouseUp);
  };

  handleToggleChip = (
    dimension: "shelves" | "readingStatus" | "formats" | "authors" | "unclassifiedShelf" | "favorite",
    key?: string
  ) => {
    const currentConfig = {
      ...this.props.filterConfig,
      shelves: { ...this.props.filterConfig.shelves },
      readingStatus: { ...this.props.filterConfig.readingStatus },
      formats: { ...this.props.filterConfig.formats },
      authors: { ...this.props.filterConfig.authors },
    };

    if (dimension === "unclassifiedShelf") {
      const cur = currentConfig.unclassifiedShelf;
      currentConfig.unclassifiedShelf = !cur
        ? "include"
        : cur === "include"
        ? "exclude"
        : undefined;
    } else if (dimension === "favorite") {
      const cur = currentConfig.favorite;
      currentConfig.favorite = !cur
        ? "include"
        : cur === "include"
        ? "exclude"
        : undefined;
    } else if (key) {
      const cur = currentConfig[dimension][key];
      if (!cur) {
        currentConfig[dimension][key] = "include";
      } else if (cur === "include") {
        currentConfig[dimension][key] = "exclude";
      } else {
        delete currentConfig[dimension][key];
      }
    }

    this.props.handleFilterConfig(currentConfig);
  };

  handleClearAll = () => {
    this.props.handleFilterConfig(createEmptyFilterConfig());
  };

  getGroupFormatState = (formatsList: string[]): TriState | undefined => {
    if (formatsList.length === 0) return undefined;
    const states = formatsList.map(
      (fmt) => this.props.filterConfig.formats[fmt.toLowerCase()]
    );
    if (states.every((s) => s === "include")) return "include";
    if (states.every((s) => s === "exclude")) return "exclude";
    return undefined;
  };

  handleToggleGroupFormats = (formatsList: string[]) => {
    const currentState = this.getGroupFormatState(formatsList);
    const nextFormats = { ...this.props.filterConfig.formats };

    if (!currentState) {
      // 未全选 -> 全部包含
      formatsList.forEach((fmt) => {
        nextFormats[fmt.toLowerCase()] = "include";
      });
    } else if (currentState === "include") {
      // 全部包含 -> 全部排除
      formatsList.forEach((fmt) => {
        nextFormats[fmt.toLowerCase()] = "exclude";
      });
    } else {
      // 全部排除 -> 清除重置
      formatsList.forEach((fmt) => {
        delete nextFormats[fmt.toLowerCase()];
      });
    }

    this.props.handleFilterConfig({
      ...this.props.filterConfig,
      formats: nextFormats,
    });
  };

  renderChip(
    label: string,
    state: TriState | undefined,
    onClick: () => void,
    key?: any,
    extraClassName?: string
  ) {
    const isInclude = state === "include";
    const isExclude = state === "exclude";

    return (
      <div
        key={key || label}
        className={`filter-chip ${
          isInclude
            ? "filter-chip-include"
            : isExclude
            ? "filter-chip-exclude"
            : ""
        } ${extraClassName || ""}`}
        onClick={onClick}
        title={
          isInclude
            ? this.props.t("Included (Click to exclude)")
            : isExclude
            ? this.props.t("Excluded (Click to clear)")
            : this.props.t("Not filtered (Click to include)")
        }
      >
        {isInclude && <span className="filter-chip-icon">✓</span>}
        {isExclude && <span className="filter-chip-icon">✕</span>}
        <span>{label}</span>
      </div>
    );
  }

  render() {
    const { filterConfig, books, isCollapsed } = this.props;
    const activeCount = getActiveFilterCount(filterConfig);
    const hasActive = isFilterActive(filterConfig);

    const effectiveBooks =
      this.props.books && this.props.books.some((b) => b && b.format)
        ? this.props.books
        : this.state.fallbackBooks || this.props.books || [];

    // 1. 书架列表
    const shelfListMap = ConfigService.getAllMapConfig("shelfList") || {};
    const shelfNames = Object.keys(shelfListMap);

    // 2. 格式分类构建（小说 与 漫画）
    const libraryFormats = new Set<string>();
    (effectiveBooks || []).forEach((b) => {
      if (b && b.format) {
        const clean = b.format.toUpperCase().replace(/^\./, "").trim();
        if (clean) libraryFormats.add(clean);
      }
    });

    const novelFormats = [...NOVEL_FORMATS];
    const comicFormats = [...COMIC_FORMATS];
    const otherFormats: string[] = [];

    libraryFormats.forEach((fmt) => {
      const fmtLower = fmt.toLowerCase();
      if (COMIC_EXT_SET.has(fmtLower)) {
        if (!comicFormats.includes(fmt)) {
          comicFormats.push(fmt);
        }
      } else if (
        [
          "epub",
          "txt",
          "pdf",
          "mobi",
          "azw3",
          "azw",
          "fb2",
          "docx",
          "md",
          "html",
          "htm",
          "xhtml",
          "mhtml",
          "xml",
        ].includes(fmtLower)
      ) {
        if (!novelFormats.includes(fmt)) {
          novelFormats.push(fmt);
        }
      } else {
        if (
          !novelFormats.includes(fmt) &&
          !comicFormats.includes(fmt) &&
          !otherFormats.includes(fmt)
        ) {
          otherFormats.push(fmt);
        }
      }
    });

    // 3. 作者列表与搜索过滤
    const authorSet = new Set<string>();
    (effectiveBooks || []).forEach((b) => {
      const author = (b && b.author ? b.author.trim() : "") || "Unknown";
      authorSet.add(author);
    });
    const authors = Array.from(authorSet).sort();
    const filteredAuthors = authors.filter((a) =>
      a.toLowerCase().includes(this.state.authorSearchKeyword.toLowerCase())
    );

    return (
      <div
        className={`sort-dialog-container filter-dialog-container ${
          this.state.isDragging ? "dragging" : ""
        }`}
        style={{
          left: `${this.state.posX}px`,
          top: `${this.state.posY}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题与清空栏（支持拖拽） */}
        <div
          className="filter-dialog-header"
          onMouseDown={this.handleHeaderMouseDown}
          title={this.props.t("Drag to move")}
        >
          <div className="filter-dialog-title-group">
            <span className="filter-drag-indicator">⋮⋮</span>
            <span className="filter-dialog-title">
              <Trans>Filter books</Trans>
            </span>
            {activeCount > 0 && (
              <span className="filter-dialog-count-badge">
                {activeCount}
              </span>
            )}
          </div>
          <div className="filter-dialog-actions">
            <div
              className={`filter-dialog-clear-btn ${hasActive ? "" : "disabled"}`}
              onClick={this.handleClearAll}
              title={this.props.t("Clear all filters")}
            >
              <span className="icon-trash" style={{ fontSize: "12px" }}></span>
              <span><Trans>Reset</Trans></span>
            </div>
            <div
              className="filter-dialog-close-btn"
              onClick={() => this.props.handleFilterDisplay(false)}
              title={this.props.t("Close")}
            >
              ✕
            </div>
          </div>
        </div>

        {/* 三态操作提示条 */}
        <div className="filter-dialog-tip-bar">
          <span><Trans>Click to cycle</Trans>:</span>
          <span>
            <Trans>Neutral</Trans> ➔ <span style={{ color: "var(--theme-color, #1890ff)", fontWeight: 600 }}>✓ <Trans>Include</Trans></span> ➔ <span style={{ color: "#ef4444", fontWeight: 600 }}>✕ <Trans>Exclude</Trans></span>
          </span>
        </div>

        {/* 筛选内容区 */}
        <div className="filter-dialog-body">
          {/* 1. 书架维度 */}
          <div className="filter-section">
            <div className="filter-section-header">
              <span className="filter-section-title"><Trans>Shelf</Trans></span>
            </div>
            <div className="filter-chips-wrap">
              {this.renderChip(
                this.props.t("Unclassified books"),
                filterConfig.unclassifiedShelf,
                () => this.handleToggleChip("unclassifiedShelf"),
                "__unclassified__"
              )}
              {shelfNames.map((shelfName) =>
                this.renderChip(
                  shelfName,
                  filterConfig.shelves[shelfName],
                  () => this.handleToggleChip("shelves", shelfName),
                  shelfName
                )
              )}
            </div>
          </div>

          {/* 2. 阅读状态 */}
          <div className="filter-section">
            <div className="filter-section-header">
              <span className="filter-section-title"><Trans>Reading Status</Trans></span>
            </div>
            <div className="filter-chips-wrap">
              {this.renderChip(
                this.props.t("Unread"),
                filterConfig.readingStatus["unread"],
                () => this.handleToggleChip("readingStatus", "unread"),
                "unread"
              )}
              {this.renderChip(
                this.props.t("CurrentlyReading"),
                filterConfig.readingStatus["reading"],
                () => this.handleToggleChip("readingStatus", "reading"),
                "reading"
              )}
              {this.renderChip(
                this.props.t("Finished"),
                filterConfig.readingStatus["finished"],
                () => this.handleToggleChip("readingStatus", "finished"),
                "finished"
              )}
            </div>
          </div>

          {/* 3. 图书格式（分为小说与漫画两组展示） */}
          <div className="filter-section">
            <div className="filter-section-header">
              <span className="filter-section-title"><Trans>Format</Trans></span>
            </div>

            {/* 3.1 小说格式 */}
            <div className="filter-format-group">
              <div className="filter-format-group-header">
                <span className="filter-format-group-title">
                  <Trans>Novels / E-books</Trans>
                </span>
              </div>
              <div className="filter-chips-wrap">
                {this.renderChip(
                  this.props.t("All novels"),
                  this.getGroupFormatState(novelFormats),
                  () => this.handleToggleGroupFormats(novelFormats),
                  "__group_novels__",
                  "filter-chip-all"
                )}
                {novelFormats.map((fmt) =>
                  this.renderChip(
                    fmt,
                    filterConfig.formats[fmt.toLowerCase()],
                    () => this.handleToggleChip("formats", fmt.toLowerCase()),
                    fmt
                  )
                )}
              </div>
            </div>

            {/* 3.2 漫画格式 */}
            <div className="filter-format-group">
              <div className="filter-format-group-header">
                <span className="filter-format-group-title">
                  <Trans>Comics</Trans>
                </span>
              </div>
              <div className="filter-chips-wrap">
                {this.renderChip(
                  this.props.t("All comics"),
                  this.getGroupFormatState(comicFormats),
                  () => this.handleToggleGroupFormats(comicFormats),
                  "__group_comics__",
                  "filter-chip-all"
                )}
                {comicFormats.map((fmt) =>
                  this.renderChip(
                    fmt,
                    filterConfig.formats[fmt.toLowerCase()],
                    () => this.handleToggleChip("formats", fmt.toLowerCase()),
                    fmt
                  )
                )}
              </div>
            </div>

            {/* 3.3 其他格式（如有） */}
            {otherFormats.length > 0 && (
              <div className="filter-format-group">
                <div className="filter-format-group-header">
                  <span className="filter-format-group-title">
                    <Trans>Other formats</Trans>
                  </span>
                </div>
                <div className="filter-chips-wrap">
                  {otherFormats.map((fmt) =>
                    this.renderChip(
                      fmt,
                      filterConfig.formats[fmt.toLowerCase()],
                      () => this.handleToggleChip("formats", fmt.toLowerCase()),
                      fmt
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 4. 作者维度 */}
          {authors.length > 0 && (
            <div className="filter-section">
              <div className="filter-section-header">
                <span className="filter-section-title"><Trans>Author</Trans></span>
                <span style={{ fontSize: "11px", opacity: 0.5 }}>
                  {authors.length} <Trans>Authors</Trans>
                </span>
              </div>
              {authors.length > 8 && (
                <input
                  type="text"
                  className="filter-author-search-input"
                  placeholder={this.props.t("Search author...")}
                  value={this.state.authorSearchKeyword}
                  onChange={(e) =>
                    this.setState({ authorSearchKeyword: e.target.value })
                  }
                />
              )}
              <div className="filter-author-chips-scroll">
                {filteredAuthors.length > 0 ? (
                  filteredAuthors.map((author) =>
                    this.renderChip(
                      author,
                      filterConfig.authors[author],
                      () => this.handleToggleChip("authors", author),
                      author
                    )
                  )
                ) : (
                  <div className="filter-author-empty">
                    <Trans>No matching author</Trans>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 5. 收藏状态 */}
          <div className="filter-section">
            <div className="filter-section-header">
              <span className="filter-section-title"><Trans>Favorites</Trans></span>
            </div>
            <div className="filter-chips-wrap">
              {this.renderChip(
                this.props.t("Favorited only"),
                filterConfig.favorite === "include" ? "include" : undefined,
                () => {
                  const cur = filterConfig.favorite;
                  this.props.handleFilterConfig({
                    ...filterConfig,
                    favorite: cur === "include" ? undefined : "include",
                  });
                },
                "fav_inc"
              )}
              {this.renderChip(
                this.props.t("Unfavorited only"),
                filterConfig.favorite === "exclude" ? "exclude" : undefined,
                () => {
                  const cur = filterConfig.favorite;
                  this.props.handleFilterConfig({
                    ...filterConfig,
                    favorite: cur === "exclude" ? undefined : "exclude",
                  });
                },
                "fav_exc"
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default FilterDialog;
