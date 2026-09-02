import React from "react";
import "./booklist.css";
import BookCardItem from "../../../components/bookCardItem";
import BookListItem from "../../../components/bookListItem";
import BookCoverItem from "../../../components/bookCoverItem";
import BookModel from "../../../models/Book";
import { BookListProps, BookListState } from "./interface";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { Redirect, withRouter } from "react-router-dom";
import ViewMode from "../../../components/viewMode";
import SelectBook from "../../../components/selectBook";
import { Trans } from "react-i18next";
import Book from "../../../models/Book";
import { isElectron } from "react-device-detect";
import DatabaseService from "../../../utils/storage/databaseService";
import { throttle } from "../../../utils/common";
import { isRectOverlap, Rect } from "../../../utils/reader/selectionUtil";
declare var window: any;
let currentBookMode = "home";
function getBookCountPerPage() {
  const container = document.querySelector(
    ".book-list-container"
  ) as HTMLElement;
  if (!container) return 24; // fallback
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  // 133px card width + 4px left margin + 4px right margin = 141px per slot
  // 201px card height + 4px top margin + 4px bottom margin = 209px per slot
  const bookWidth = 141;
  const bookHeight = 209;
  const columns = Math.max(1, Math.floor(containerWidth / bookWidth));
  const rows = Math.max(1, Math.floor(containerHeight / bookHeight)) + 2;
  return columns * rows;
}

class BookList extends React.Component<BookListProps, BookListState> {
  private scrollContainer: React.RefObject<HTMLUListElement>;
  private visibilityChangeHandler: ((event: Event) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private readingFinishedHandler: ((config: any) => void) | null = null;
  private isSelecting = false;
  private startSelectionKeys: string[] = [];
  private isModifierActive = false;
  private isToggleMode = false;
  // 标记当前 mousedown→mouseup 之间是否发生了真正的拖拽（距离 ≥ 4px）
  // 用于区分「点击空白取消选中」与「框选拖拽」
  private isDragging = false;

  constructor(props: BookListProps) {
    super(props);
    this.scrollContainer = React.createRef();
    this.state = {
      favoriteBooks: Object.keys(
        ConfigService.getAllListConfig("favoriteBooks")
      ).length,
      isHideShelfBook:
        ConfigService.getReaderConfig("isHideShelfBook") === "yes",
      displayedBooksCount: 24,
      isLoadingMore: false,
      fullBooksData: [], // 存储从数据库加载的完整书籍数据
      cardScale: parseFloat(ConfigService.getReaderConfig("cardScale") || "1"),
      readingStatusFilter: "",
      selectionBox: null,
    };
  }
  UNSAFE_componentWillMount() {
    this.props.handleFetchBooks();
  }

  async componentDidMount() {
    if (!this.props.books || !this.props.books[0]) {
      return <Redirect to="manager/empty" />;
    }
    this.setState({
      displayedBooksCount: getBookCountPerPage(),
    });

    // 保存 resize 监听器引用（节流，避免拖拽窗口时频繁触发）
    this.resizeHandler = throttle(() => {
      //recount the book count per page when the window is resized
      this.props.handleFetchBooks();
    });
    window.addEventListener("resize", this.resizeHandler);

    // 设置滚动监听器
    this.setupScrollListener();

    // 保存 visibilitychange 监听器引用
    this.visibilityChangeHandler = async (event) => {
      if (document.visibilityState === "visible" && !isElectron) {
        await this.handleFinishReading();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);

    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      this.readingFinishedHandler = async (config: any) => {
        this.handleFinishReading();
      };
      ipcRenderer.on("reading-finished", this.readingFinishedHandler);
    }

    // 初始加载完整的书籍数据
    await this.loadFullBooksData();

    window.addEventListener("mousemove", this.handleGlobalMouseMove);
    window.addEventListener("mouseup", this.handleGlobalMouseUp);
    window.addEventListener("keydown", this.handleKeyDown);
  }

  componentWillUnmount() {
    window.removeEventListener("mousemove", this.handleGlobalMouseMove);
    window.removeEventListener("mouseup", this.handleGlobalMouseUp);
    window.removeEventListener("keydown", this.handleKeyDown);

    // 清理滚动监听器
    this.cleanupScrollListener();

    // 清理 resize 监听器
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // 清理 visibilitychange 监听器
    if (this.visibilityChangeHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.visibilityChangeHandler
      );
      this.visibilityChangeHandler = null;
    }

    // 清理 IPC 监听器（只移除自身，避免误删 Header 等其他组件的监听器）
    if (isElectron && this.readingFinishedHandler) {
      const ipcRenderer = window.electronAPI;
      ipcRenderer.removeListener(
        "reading-finished",
        this.readingFinishedHandler
      );
      this.readingFinishedHandler = null;
    }
  }

  componentDidUpdate(prevProps: BookListProps, prevState: BookListState) {
    // 当书籍列表更新时，重置显示数量
    if (
      prevProps.books !== this.props.books ||
      prevProps.searchResults !== this.props.searchResults ||
      prevProps.isSearch !== this.props.isSearch ||
      prevProps.mode !== this.props.mode ||
      prevProps.shelfTitle !== this.props.shelfTitle
    ) {
      this.setState({
        displayedBooksCount: getBookCountPerPage(),
        isLoadingMore: false,
      });
      this.props.handleLoadMore(false);
      // 滚动到顶部
      if (this.scrollContainer.current) {
        this.scrollContainer.current.scrollTop = 0;
      }
      // 重新加载完整的书籍数据
      this.loadFullBooksData();
    }
    // 阅读状态筛选变化时，重新加载完整书籍数据
    if (prevState.readingStatusFilter !== this.state.readingStatusFilter) {
      this.loadFullBooksData();
    }
  }

  // 从数据库加载完整的书籍数据
  loadFullBooksData = async () => {
    const { books } = this.handleBooks();
    const displayedBooks = books.slice(0, this.state.displayedBooksCount);

    const fullBooksData: Book[] = [];
    for (let i = 0; i < displayedBooks.length; i++) {
      const book = await DatabaseService.getRecord(
        displayedBooks[i].key,
        "books"
      );
      if (book) {
        fullBooksData.push(book);
      }
    }

    this.setState({ fullBooksData });
  };
  handleFinishReading = async () => {
    if (!this.scrollContainer.current) return;
    if (
      this.scrollContainer.current &&
      this.scrollContainer.current.scrollTop > 100
    ) {
      //ignore if the scroll is not at top
    } else {
      this.props.handleFetchBooks();
    }
  };

  setupScrollListener = () => {
    const scrollContainer = this.scrollContainer.current;
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", this.handleScroll);
    }
  };

  cleanupScrollListener = () => {
    const scrollContainer = this.scrollContainer.current;
    if (scrollContainer) {
      scrollContainer.removeEventListener("scroll", this.handleScroll);
    }
  };

  handleScroll = () => {
    const scrollContainer = this.scrollContainer.current;
    if (!scrollContainer || this.state.isLoadingMore) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    // 当滚动到底部附近时触发加载更多
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      this.loadMoreBooks();
    }
  };

  loadMoreBooks = () => {
    const { books } = this.handleBooks();
    const { displayedBooksCount } = this.state;

    if (displayedBooksCount >= books.length) {
      return; // 已经显示所有图书
    }

    this.setState({ isLoadingMore: true });
    this.props.handleLoadMore(true);
    // 异步加载更多书籍数据
    setTimeout(async () => {
      const newDisplayedBooksCount = Math.min(
        displayedBooksCount + getBookCountPerPage(),
        books.length
      );

      // 加载新增的书籍数据
      const newBooks = books.slice(displayedBooksCount, newDisplayedBooksCount);
      const newFullBooksData: Book[] = [];
      for (let i = 0; i < newBooks.length; i++) {
        const book = await DatabaseService.getRecord(newBooks[i].key, "books");
        if (book) {
          newFullBooksData.push(book);
        }
      }

      this.setState({
        displayedBooksCount: newDisplayedBooksCount,
        isLoadingMore: false,
        fullBooksData: [...this.state.fullBooksData, ...newFullBooksData],
      });
    }, 100);
  };

  handleKeyFilter = (items: any[], arr: string[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items.forEach((subItem: any) => {
        if (subItem.key === item) {
          itemArr.push(subItem);
        }
      });
    });
    return itemArr;
  };

  handleShelf(items: any, shelfTitle: string) {
    if (!shelfTitle) return items;
    let currentShelfTitle = shelfTitle;
    let currentShelfList = ConfigService.getMapConfig(
      currentShelfTitle,
      "shelfList"
    );
    let shelfItems = items.filter((item: { key: number }) => {
      return currentShelfList.indexOf(item.key) > -1;
    });
    return shelfItems;
  }

  //get the searched books according to the index
  handleIndexFilter = (items: any, arr: number[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items[item] && itemArr.push(items[item]);
    });
    return itemArr;
  };
  handleFilterShelfBook = (items: BookModel[]) => {
    return items.filter((item) => {
      return (
        ConfigService.getFromAllMapConfig(item.key, "shelfList").length === 0
      );
    });
  };
  handleCardScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const scale = parseFloat(e.target.value);
    this.setState({ cardScale: scale });
    ConfigService.setReaderConfig("cardScale", String(scale));
  };

  filterBooksByReadingStatus = (books: Book[], status: string): Book[] => {
    if (!status) return books;
    return books.filter((book) => {
      const record = ConfigService.getObjectConfig(
        book.key,
        "recordLocation",
        {}
      );
      const percentage: string =
        record && record.percentage ? record.percentage : "";
      if (status === "unread") {
        return !percentage || percentage === "0";
      } else if (status === "reading") {
        return percentage && percentage !== "0" && percentage !== "1";
      } else if (status === "finished") {
        return percentage === "1";
      }
      return true;
    });
  };

  handleContainerMouseDown = (e: React.MouseEvent) => {
    // 仅响应鼠标左键 (button === 0)
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    // 如果点击的是滚动条、按钮、下拉菜单、输入框或卡片上的操作图标/右键菜单触发区，则不启动框选
    if (
      target.closest("button") ||
      target.closest("select") ||
      target.closest("input") ||
      target.closest(".book-selected-icon") ||
      target.closest(".book-download-action")
    ) {
      return;
    }

    const isCardClick = !!target.closest(".book-selectable-item");
    // 如果点击在卡片上（无论是否处于多选状态），只要未按下 Ctrl/Shift 键，均保留卡片的默认点击选中与拖拽行为，防止误触发框选并冲掉已选中的书籍集合
    if (isCardClick && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      return;
    }

    this.isSelecting = true;
    this.isDragging = false; // 每次 mousedown 时重置拖拽标志
    this.isModifierActive = e.ctrlKey || e.metaKey || e.shiftKey;
    this.isToggleMode = e.ctrlKey || e.metaKey;
    this.startSelectionKeys = [...(this.props.selectedBooks || [])];

    this.setState({
      selectionBox: {
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
      },
    });
  };

  handleGlobalMouseMove = (e: MouseEvent) => {
    if (!this.isSelecting || !this.state.selectionBox) return;

    const { startX, startY } = this.state.selectionBox;
    const currentX = e.clientX;
    const currentY = e.clientY;

    const dragDistance = Math.hypot(currentX - startX, currentY - startY);
    // 只有拖拽距离超过 4px 才正式激活框选（防止轻微手抖误触）
    if (dragDistance < 4) return;

    // 标记本次 mousedown→mouseup 确实发生了拖拽
    this.isDragging = true;

    if (!this.props.isSelectBook) {
      this.props.handleSelectBook(true);
    }

    this.setState({
      selectionBox: {
        startX,
        startY,
        currentX,
        currentY,
      },
    });

    const boxLeft = Math.min(startX, currentX);
    const boxTop = Math.min(startY, currentY);
    const boxRight = Math.max(startX, currentX);
    const boxBottom = Math.max(startY, currentY);

    const selectionRect: Rect = {
      left: boxLeft,
      top: boxTop,
      right: boxRight,
      bottom: boxBottom,
      width: boxRight - boxLeft,
      height: boxBottom - boxTop,
    };

    // 获取所有当前 DOM 渲染的书籍卡片并进行碰撞检测（触摸即选）
    const bookElements = document.querySelectorAll(".book-selectable-item");
    const hitKeys: string[] = [];

    bookElements.forEach((el) => {
      const bookKey = el.getAttribute("data-book-key");
      if (!bookKey) return;
      const domRect = el.getBoundingClientRect();
      const itemRect: Rect = {
        left: domRect.left,
        top: domRect.top,
        right: domRect.right,
        bottom: domRect.bottom,
        width: domRect.width,
        height: domRect.height,
      };

      if (isRectOverlap(selectionRect, itemRect)) {
        hitKeys.push(bookKey);
      }
    });

    let nextSelectedKeys: string[] = [];
    if (this.isToggleMode) {
      // Ctrl/Cmd: 反选/加选
      const startSet = new Set(this.startSelectionKeys);
      const hitSet = new Set(hitKeys);
      const combined = new Set<string>();

      // 如果原本有且当前被框中，则排除（反选）
      // 如果原本没有但当前被框中，则加入
      for (const k of this.startSelectionKeys) {
        if (!hitSet.has(k)) {
          combined.add(k);
        }
      }
      for (const k of hitKeys) {
        if (!startSet.has(k)) {
          combined.add(k);
        }
      }
      nextSelectedKeys = Array.from(combined);
    } else if (this.isModifierActive) {
      // Shift: 增量并集
      nextSelectedKeys = Array.from(
        new Set([...this.startSelectionKeys, ...hitKeys])
      );
    } else {
      // 普通拉框
      nextSelectedKeys = hitKeys;
    }

    this.props.handleSelectedBooks(nextSelectedKeys);
  };

  handleGlobalMouseUp = () => {
    if (!this.isSelecting) return;

    // 如果本次是纯点击（未发生拖拽 && 无修饰键），视为「点击空白区域取消全部选中」
    if (
      !this.isDragging &&
      !this.isModifierActive &&
      (this.props.selectedBooks?.length ?? 0) > 0
    ) {
      this.props.handleSelectedBooks([]);
      this.props.handleSelectBook(false);
    }

    this.isSelecting = false;
    this.isDragging = false;
    this.setState({ selectionBox: null });
  };

  handleKeyDown = (e: KeyboardEvent) => {
    // 1. 如果当前打开了删除确认弹窗，不重复触发
    if (this.props.isOpenDeleteDialog) return;

    // 2. 如果焦点在输入框、文本框、选择框或富文本中，不拦截按键
    const target = e.target as HTMLElement;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        target.closest("input") ||
        target.closest("textarea") ||
        target.closest("select"))
    ) {
      return;
    }

    // 3. Escape：退出多选模式，清除所有选中
    if (e.key === "Escape") {
      if (this.props.isSelectBook || (this.props.selectedBooks?.length ?? 0) > 0) {
        e.preventDefault();
        this.props.handleSelectedBooks([]);
        this.props.handleSelectBook(false);
      }
      return;
    }

    // 4. Ctrl+A：全选当前列表所有图书
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      const allKeys = Array.from(
        document.querySelectorAll(".book-selectable-item"),
        (el) => el.getAttribute("data-book-key") ?? ""
      ).filter(Boolean);
      if (allKeys.length > 0) {
        if (!this.props.isSelectBook) {
          this.props.handleSelectBook(true);
        }
        this.props.handleSelectedBooks(allKeys);
      }
      return;
    }

    // 5. 响应 Delete / Backspace 键触发二次确认删除弹窗
    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.props.selectedBooks && this.props.selectedBooks.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        if (!this.props.isSelectBook) {
          this.props.handleSelectBook(true);
        }
        this.props.handleDeleteDialog(true);
      }
    }
  };

  renderBookList = (books: Book[], bookMode: string) => {
    if (books.length === 0 && !this.props.isSearch) {
      return <Redirect to="/manager/empty" />;
    }
    if (bookMode !== currentBookMode) {
      currentBookMode = bookMode;
    }

    // 使用状态中已加载的完整书籍数据，并按当前过滤后的 books 顺序/范围进行裁剪
    const filteredKeys = new Set(books.map((b) => b.key));
    const displayedBooks = this.props.isSearch
      ? books
      : this.state.fullBooksData.filter((b) => filteredKeys.has(b.key));

    return displayedBooks.map((item: BookModel, index: number) => {
      return this.props.viewMode === "list" ? (
        <BookListItem
          key={index}
          {...({
            book: item,
            isSelected: this.props.selectedBooks.indexOf(item.key) > -1,
            allBooks: displayedBooks,
            bookIndex: index,
          } as any)}
        />
      ) : this.props.viewMode === "card" ? (
        <BookCardItem
          key={index}
          {...({
            book: item,
            cardScale: this.state.cardScale,
            isSelected: this.props.selectedBooks.indexOf(item.key) > -1,
            allBooks: displayedBooks,
            bookIndex: index,
          } as any)}
        />
      ) : (
        <BookCoverItem
          key={index}
          {...({
            book: item,
            isSelected: this.props.selectedBooks.indexOf(item.key) > -1,
            allBooks: displayedBooks,
            bookIndex: index,
          } as any)}
        />
      );
    });
  };
  handleBooks = () => {
    let bookMode = this.props.isSearch
      ? "search"
      : this.props.shelfTitle
        ? "shelf"
        : this.props.mode === "favorite"
          ? "favorite"
          : this.state.isHideShelfBook
            ? "hide"
            : "home";
    let books =
      bookMode === "search"
        ? this.props.searchResults
        : bookMode === "shelf"
          ? this.handleShelf(this.props.books, this.props.shelfTitle)
          : bookMode === "favorite"
            ? this.handleKeyFilter(
                this.props.books,
                ConfigService.getAllListConfig("favoriteBooks")
              )
            : bookMode === "hide"
              ? this.handleFilterShelfBook(this.props.books)
              : this.props.books;
    if (this.state.readingStatusFilter) {
      books = this.filterBooksByReadingStatus(
        books,
        this.state.readingStatusFilter
      );
    }
    const topBookKeys: string[] = ConfigService.getAllListConfig("topBooks");
    if (topBookKeys.length > 0) {
      const topSet = new Set(topBookKeys);
      const topBooks = [...topBookKeys]
        .map((key) => books.find((b) => b.key === key))
        .filter(Boolean) as Book[];
      const restBooks = books.filter((b) => !topSet.has(b.key));
      books = [...topBooks, ...restBooks];
    }
    return {
      books,
      bookMode,
    };
  };

  render() {
    if (
      (this.state.favoriteBooks === 0 && this.props.mode === "favorite") ||
      !this.props.books ||
      !this.props.books[0]
    ) {
      return <Redirect to="/manager/empty" />;
    }
    const { books, bookMode } = this.handleBooks();
    return (
      <>
        <div
          className="book-list-header"
          style={
            this.props.isCollapsed
              ? { width: "calc(100% - 70px)", left: "70px" }
              : {}
          }
        >
          <SelectBook />

          <div
            style={this.props.isSelectBook ? { display: "none" } : {}}
            className="book-list-header-right"
          >
            {this.props.viewMode === "card" && (
              <input
                type="range"
                min="0.6"
                max="2"
                step="0.05"
                value={this.state.cardScale}
                onChange={this.handleCardScaleChange}
                className="book-card-scale-slider"
                title="Adjust cover size"
              />
            )}
            <div className="book-list-total-page">
              <Trans i18nKey="Total books" count={books.length}>
                {"Total " + books.length + " books"}
              </Trans>
            </div>
            <select
              className="lang-setting-dropdown"
              value={this.state.readingStatusFilter}
              onChange={(e) => {
                this.setState({ readingStatusFilter: e.target.value });
              }}
              style={{ marginRight: "10px", width: "70px", borderWidth: "0px" }}
            >
              <option value="" className="lang-setting-option">
                {this.props.t("All")}
              </option>
              <option value="unread" className="lang-setting-option">
                {this.props.t("Unread")}
              </option>
              <option value="reading" className="lang-setting-option">
                {this.props.t("CurrentlyReading")}
              </option>
              <option value="finished" className="lang-setting-option">
                {this.props.t("Finished")}
              </option>
            </select>
            <ViewMode />
          </div>
        </div>
        <div
          className="book-list-container-parent"
          style={
            this.props.isCollapsed
              ? { width: "calc(100vw - 70px)", left: "70px" }
              : {}
          }
        >
          <div
            className="book-list-container"
            onMouseDown={this.handleContainerMouseDown}
          >
            <ul
              className="book-list-item-box"
              ref={this.scrollContainer}
              style={
                { "--card-scale": this.state.cardScale } as React.CSSProperties
              }
            >
              {this.renderBookList(books, bookMode)}
            </ul>
            {this.state.selectionBox && (
              <div
                className="book-selection-marquee"
                style={{
                  left: `${Math.min(this.state.selectionBox.startX, this.state.selectionBox.currentX)}px`,
                  top: `${Math.min(this.state.selectionBox.startY, this.state.selectionBox.currentY)}px`,
                  width: `${Math.abs(this.state.selectionBox.currentX - this.state.selectionBox.startX)}px`,
                  height: `${Math.abs(this.state.selectionBox.currentY - this.state.selectionBox.startY)}px`,
                }}
              />
            )}
          </div>
        </div>
      </>
    );
  }
}

export default withRouter(BookList as any);
