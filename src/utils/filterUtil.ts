import BookModel from "../models/Book";
import { ConfigService } from "../assets/lib/kookit-extra-browser.min";

export type TriState = "include" | "exclude";

export interface FilterConfig {
  shelves: { [name: string]: TriState };
  unclassifiedShelf?: TriState;
  readingStatus: { [status: string]: TriState };
  formats: { [format: string]: TriState };
  authors: { [author: string]: TriState };
  favorite?: TriState;
}

export const createEmptyFilterConfig = (): FilterConfig => ({
  shelves: {},
  unclassifiedShelf: undefined,
  readingStatus: {},
  formats: {},
  authors: {},
  favorite: undefined,
});

/**
 * 判断筛选条件是否处于激活状态（任意维度有设置包含或排除）
 */
export const isFilterActive = (config?: FilterConfig | null): boolean => {
  if (!config) return false;
  if (config.unclassifiedShelf) return true;
  if (config.favorite) return true;

  const hasActiveInMap = (map?: { [key: string]: TriState }) =>
    map && Object.values(map).some((state) => state === "include" || state === "exclude");

  return !!(
    hasActiveInMap(config.shelves) ||
    hasActiveInMap(config.readingStatus) ||
    hasActiveInMap(config.formats) ||
    hasActiveInMap(config.authors)
  );
};

/**
 * 获取当前已激活的条件总数
 */
export const getActiveFilterCount = (config?: FilterConfig | null): number => {
  if (!config) return 0;
  let count = 0;
  if (config.unclassifiedShelf) count++;
  if (config.favorite) count++;

  const countMap = (map?: { [key: string]: TriState }) => {
    if (!map) return;
    for (const val of Object.values(map)) {
      if (val === "include" || val === "exclude") count++;
    }
  };

  countMap(config.shelves);
  countMap(config.readingStatus);
  countMap(config.formats);
  countMap(config.authors);

  return count;
};

/**
 * 解析书籍的阅读状态：unread | reading | finished
 */
export const getBookReadingStatus = (bookKey: string): "unread" | "reading" | "finished" => {
  const record = ConfigService.getObjectConfig(bookKey, "recordLocation", {});
  let percentage: string = record && record.percentage ? String(record.percentage) : "";
  if (percentage) {
    const val = parseFloat(percentage);
    if (!isNaN(val)) {
      if (val > 1 && val <= 100) {
        percentage = val === 100 ? "1" : String(val / 100);
      } else if (val > 100) {
        percentage = "1";
      }
    }
  }

  if (!percentage || percentage === "0") {
    return "unread";
  } else if (percentage === "1") {
    return "finished";
  } else {
    return "reading";
  }
};

/**
 * 核心图书筛选函数
 * 逻辑规范：
 * - 跨维度：取“且 (AND)”关系；
 * - 同维度内部多个“包含”：取“或 (OR)”关系；
 * - 同维度内部“排除”：一票否决（NOT ANY）；
 * - 同时存在包含与排除：必须命中包含之一，且不得命中任何排除项。
 */
export const filterBooks = (
  books: BookModel[],
  config: FilterConfig
): BookModel[] => {
  if (!books || books.length === 0) return [];
  if (!isFilterActive(config)) return books;

  // 预提取书架字典与收藏列表
  const shelfListMap = ConfigService.getAllMapConfig("shelfList") || {};
  const favoriteBooksList: any[] = ConfigService.getAllListConfig("favoriteBooks") || [];
  const favoriteKeySet = new Set(favoriteBooksList.map((k) => String(k)));

  // 书架包含与排除列表
  const includedShelves = Object.keys(config.shelves).filter(
    (name) => config.shelves[name] === "include"
  );
  const excludedShelves = new Set(
    Object.keys(config.shelves).filter(
      (name) => config.shelves[name] === "exclude"
    )
  );
  const isUnclassifiedIncluded = config.unclassifiedShelf === "include";
  const isUnclassifiedExcluded = config.unclassifiedShelf === "exclude";
  const hasShelfInclude = includedShelves.length > 0 || isUnclassifiedIncluded;

  // 阅读状态包含与排除
  const includedReadingStatuses = new Set(
    Object.keys(config.readingStatus).filter(
      (s) => config.readingStatus[s] === "include"
    )
  );
  const excludedReadingStatuses = new Set(
    Object.keys(config.readingStatus).filter(
      (s) => config.readingStatus[s] === "exclude"
    )
  );

  // 格式包含与排除（全部统一小写匹配，去掉可能存在的前导点）
  const includedFormats = new Set(
    Object.keys(config.formats)
      .filter((f) => config.formats[f] === "include")
      .map((f) => f.toLowerCase().replace(/^\./, "").trim())
  );
  const excludedFormats = new Set(
    Object.keys(config.formats)
      .filter((f) => config.formats[f] === "exclude")
      .map((f) => f.toLowerCase().replace(/^\./, "").trim())
  );

  // 作者包含与排除
  const includedAuthors = new Set(
    Object.keys(config.authors).filter(
      (a) => config.authors[a] === "include"
    )
  );
  const excludedAuthors = new Set(
    Object.keys(config.authors).filter(
      (a) => config.authors[a] === "exclude"
    )
  );

  return books.filter((book) => {
    const bookKeyStr = String(book.key);

    // 1. 收藏状态维度 (Favorite)
    const isFav = favoriteKeySet.has(bookKeyStr);
    if (config.favorite === "include" && !isFav) return false;
    if (config.favorite === "exclude" && isFav) return false;

    // 2. 书架维度 (Shelves & Unclassified)
    const bookBelongShelves: string[] = [];
    for (const shelfName of Object.keys(shelfListMap)) {
      const keys: any[] = shelfListMap[shelfName] || [];
      if (keys.some((k) => String(k) === bookKeyStr)) {
        bookBelongShelves.push(shelfName);
      }
    }
    const isUnclassified = bookBelongShelves.length === 0;

    // 2.1 书架排除判定 (一票否决)
    if (isUnclassifiedExcluded && isUnclassified) return false;
    for (const shelf of bookBelongShelves) {
      if (excludedShelves.has(shelf)) return false;
    }

    // 2.2 书架包含判定 (OR)
    if (hasShelfInclude) {
      let matchedInclude = false;
      if (isUnclassifiedIncluded && isUnclassified) {
        matchedInclude = true;
      } else {
        matchedInclude = bookBelongShelves.some((s) => includedShelves.includes(s));
      }
      if (!matchedInclude) return false;
    }

    // 3. 阅读状态维度 (Reading Status)
    const readingStatus = getBookReadingStatus(bookKeyStr);
    if (excludedReadingStatuses.has(readingStatus)) return false;
    if (
      includedReadingStatuses.size > 0 &&
      !includedReadingStatuses.has(readingStatus)
    ) {
      return false;
    }

    // 4. 图书格式维度 (Format)
    const bookFormat = (book.format || "").toLowerCase().replace(/^\./, "").trim();
    if (excludedFormats.has(bookFormat)) return false;
    if (includedFormats.size > 0 && !includedFormats.has(bookFormat)) {
      return false;
    }

    // 5. 作者维度 (Author)
    const author = (book.author || "").trim() || "Unknown";
    if (excludedAuthors.has(author)) return false;
    if (includedAuthors.size > 0 && !includedAuthors.has(author)) {
      return false;
    }

    return true;
  });
};
