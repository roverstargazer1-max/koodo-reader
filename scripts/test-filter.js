const test = require("node:test");
const assert = require("node:assert");

// 模拟纯逻辑实现（镜像 filterUtil.ts 算法以供单元自动化验证）
function isFilterActive(config) {
  if (!config) return false;
  if (config.unclassifiedShelf) return true;
  if (config.favorite) return true;

  const hasActiveInMap = (map) =>
    map && Object.values(map).some((state) => state === "include" || state === "exclude");

  return !!(
    hasActiveInMap(config.shelves) ||
    hasActiveInMap(config.readingStatus) ||
    hasActiveInMap(config.formats) ||
    hasActiveInMap(config.authors)
  );
}

function filterBooks(books, config, { shelfListMap, favoriteKeySet, readingStatusMap }) {
  if (!books || books.length === 0) return [];
  if (!isFilterActive(config)) return books;

  const includedShelves = Object.keys(config.shelves || {}).filter(
    (name) => config.shelves[name] === "include"
  );
  const excludedShelves = new Set(
    Object.keys(config.shelves || {}).filter(
      (name) => config.shelves[name] === "exclude"
    )
  );
  const isUnclassifiedIncluded = config.unclassifiedShelf === "include";
  const isUnclassifiedExcluded = config.unclassifiedShelf === "exclude";
  const hasShelfInclude = includedShelves.length > 0 || isUnclassifiedIncluded;

  const includedReadingStatuses = new Set(
    Object.keys(config.readingStatus || {}).filter(
      (s) => config.readingStatus[s] === "include"
    )
  );
  const excludedReadingStatuses = new Set(
    Object.keys(config.readingStatus || {}).filter(
      (s) => config.readingStatus[s] === "exclude"
    )
  );

  const includedFormats = new Set(
    Object.keys(config.formats || {})
      .filter((f) => config.formats[f] === "include")
      .map((f) => f.toLowerCase())
  );
  const excludedFormats = new Set(
    Object.keys(config.formats || {})
      .filter((f) => config.formats[f] === "exclude")
      .map((f) => f.toLowerCase())
  );

  const includedAuthors = new Set(
    Object.keys(config.authors || {}).filter(
      (a) => config.authors[a] === "include"
    )
  );
  const excludedAuthors = new Set(
    Object.keys(config.authors || {}).filter(
      (a) => config.authors[a] === "exclude"
    )
  );

  return books.filter((book) => {
    const bookKeyStr = String(book.key);

    // 1. 收藏状态
    const isFav = favoriteKeySet.has(bookKeyStr);
    if (config.favorite === "include" && !isFav) return false;
    if (config.favorite === "exclude" && isFav) return false;

    // 2. 书架
    const bookBelongShelves = [];
    for (const shelfName of Object.keys(shelfListMap)) {
      const keys = shelfListMap[shelfName] || [];
      if (keys.some((k) => String(k) === bookKeyStr)) {
        bookBelongShelves.push(shelfName);
      }
    }
    const isUnclassified = bookBelongShelves.length === 0;

    if (isUnclassifiedExcluded && isUnclassified) return false;
    for (const shelf of bookBelongShelves) {
      if (excludedShelves.has(shelf)) return false;
    }

    if (hasShelfInclude) {
      let matchedInclude = false;
      if (isUnclassifiedIncluded && isUnclassified) {
        matchedInclude = true;
      } else {
        matchedInclude = bookBelongShelves.some((s) => includedShelves.includes(s));
      }
      if (!matchedInclude) return false;
    }

    // 3. 阅读状态
    const readingStatus = readingStatusMap[bookKeyStr] || "unread";
    if (excludedReadingStatuses.has(readingStatus)) return false;
    if (
      includedReadingStatuses.size > 0 &&
      !includedReadingStatuses.has(readingStatus)
    ) {
      return false;
    }

    // 4. 格式
    const bookFormat = (book.format || "").toLowerCase();
    if (excludedFormats.has(bookFormat)) return false;
    if (includedFormats.size > 0 && !includedFormats.has(bookFormat)) {
      return false;
    }

    // 5. 作者
    const author = (book.author || "").trim() || "Unknown";
    if (excludedAuthors.has(author)) return false;
    if (includedAuthors.size > 0 && !includedAuthors.has(author)) {
      return false;
    }

    return true;
  });
}

// 模拟测试数据
const mockBooks = [
  { key: "1", name: "三国演义", author: "罗贯中", format: "epub" },
  { key: "2", name: "水浒传", author: "施耐庵", format: "pdf" },
  { key: "3", name: "西游记", author: "吴承恩", format: "mobi" },
  { key: "4", name: "红楼梦", author: "曹雪芹", format: "epub" },
  { key: "5", name: "计算机网络", author: "谢希仁", format: "pdf" },
];

const mockContext = {
  shelfListMap: {
    "四大名著": ["1", "2", "3", "4"],
    "科技": ["5"],
    "精选": ["1", "5"],
  },
  favoriteKeySet: new Set(["1", "4"]),
  readingStatusMap: {
    "1": "reading",
    "2": "finished",
    "3": "unread",
    "4": "unread",
    "5": "reading",
  },
};

test("1. 空筛选配置返回全量图书", () => {
  const res = filterBooks(mockBooks, {
    shelves: {},
    readingStatus: {},
    formats: {},
    authors: {},
  }, mockContext);
  assert.strictEqual(res.length, 5);
});

test("2. 书架正选（包含）：四大名著", () => {
  const res = filterBooks(mockBooks, {
    shelves: { "四大名著": "include" },
    readingStatus: {},
    formats: {},
    authors: {},
  }, mockContext);
  assert.strictEqual(res.length, 4);
  assert.deepStrictEqual(res.map((b) => b.key), ["1", "2", "3", "4"]);
});

test("3. 书架反选（排除）：排除四大名著", () => {
  const res = filterBooks(mockBooks, {
    shelves: { "四大名著": "exclude" },
    readingStatus: {},
    formats: {},
    authors: {},
  }, mockContext);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].name, "计算机网络");
});

test("4. 格式包含（OR）与排除（NOT ANY）", () => {
  // 包含 EPUB 或 PDF
  const res1 = filterBooks(mockBooks, {
    shelves: {},
    readingStatus: {},
    formats: { epub: "include", pdf: "include" },
    authors: {},
  }, mockContext);
  assert.strictEqual(res1.length, 4); // 排除 mobi(3)

  // 排除 PDF
  const res2 = filterBooks(mockBooks, {
    shelves: {},
    readingStatus: {},
    formats: { pdf: "exclude" },
    authors: {},
  }, mockContext);
  assert.strictEqual(res2.length, 3);
  assert.ok(!res2.some((b) => b.format === "pdf"));
});

test("5. 阅读状态筛选：未读", () => {
  const res = filterBooks(mockBooks, {
    shelves: {},
    readingStatus: { unread: "include" },
    formats: {},
    authors: {},
  }, mockContext);
  assert.strictEqual(res.length, 2);
  assert.deepStrictEqual(res.map((b) => b.key), ["3", "4"]);
});

test("6. 收藏状态筛选：仅已收藏", () => {
  const res = filterBooks(mockBooks, {
    shelves: {},
    readingStatus: {},
    formats: {},
    authors: {},
    favorite: "include",
  }, mockContext);
  assert.strictEqual(res.length, 2);
  assert.deepStrictEqual(res.map((b) => b.key), ["1", "4"]);
});

test("7. 跨维度组合筛选：四大名著 + EPUB + 排除已读完", () => {
  const res = filterBooks(mockBooks, {
    shelves: { "四大名著": "include" },
    readingStatus: { finished: "exclude" },
    formats: { epub: "include" },
    authors: {},
  }, mockContext);
  // 四大名著中 EPUB 有 1(三国) 和 4(红楼梦)，且都不是 finished
  assert.strictEqual(res.length, 2);
  assert.deepStrictEqual(res.map((b) => b.key), ["1", "4"]);
});

test("8. 跨维度极端排除导致 0 结果", () => {
  const res = filterBooks(mockBooks, {
    shelves: { "四大名著": "include" },
    formats: { epub: "exclude", pdf: "exclude", mobi: "exclude" },
    readingStatus: {},
    authors: {},
  }, mockContext);
  assert.strictEqual(res.length, 0);
});
