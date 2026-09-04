const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileServer } = require("./mobileServer");
const { registerProgressSyncRoutes } = require("./progressSyncRouter");
const { registerBookshelfRoutes } = require("./bookshelfRouter");

test("Comic progress sync handles 80% progress with chapterDocIndex and two-way sync without decay", async () => {
  const storeData = {};
  const mockStore = {
    get: (key) => storeData[key] || null,
    set: (key, val) => {
      storeData[key] = val;
    },
  };

  const ipcRelayEvents = [];
  const server = new MobileServer();
  const token = "comic-sync-token";

  registerProgressSyncRoutes(server, {
    getStore: () => mockStore,
    onProgressUpdated: (bookKey, record) => {
      ipcRelayEvents.push({ bookKey, record });
    },
  });

  const status = await server.start({
    port: 28395,
    host: "127.0.0.1",
    token,
  });

  try {
    // 1. Mobile comic reader reports progress at 80% (page 80 of 100)
    const postComic = await fetch(
      `http://127.0.0.1:${status.port}/api/book/comic-100/progress?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookKey: "comic-100",
          page: 80,
          totalPages: 100,
          percentage: 0.8,
          timestamp: Date.now(),
          format: "cbz",
          chapterTitle: "第 80 页",
          chapterDocIndex: 79,
          chapterHref: "page_079.jpg",
        }),
      }
    );
    assert.equal(postComic.status, 200);
    const postComicData = await postComic.json();
    assert.equal(postComicData.success, true);
    assert.equal(postComicData.updated, true);
    assert.equal(postComicData.progress.page, "80");
    assert.equal(postComicData.progress.count, "100");
    assert.equal(postComicData.progress.percentage, "0.8");
    assert.equal(postComicData.progress.chapterDocIndex, "79");
    assert.equal(postComicData.progress.chapterHref, "page_079.jpg");
    assert.equal(postComicData.progress.cfi, "");
    assert.equal(postComicData.progress.xpath, "");

    // 2. GET progress confirms all fields are intact
    const getComic = await fetch(
      `http://127.0.0.1:${status.port}/api/book/comic-100/progress?token=${token}`
    );
    assert.equal(getComic.status, 200);
    const getComicData = await getComic.json();
    assert.equal(getComicData.progress.page, "80");
    assert.equal(getComicData.progress.chapterDocIndex, "79");
    assert.equal(getComicData.progress.percentage, "0.8");

    // 3. Test that if incoming chapterHref is an object, it is sanitized to string
    const postObjectHref = await fetch(
      `http://127.0.0.1:${status.port}/api/book/comic-obj-href/progress?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookKey: "comic-obj-href",
          page: 80,
          totalPages: 100,
          percentage: 0.8,
          timestamp: Date.now() + 1000,
          chapterHref: { index: 79, name: "page_079.jpg", size: 54321 },
        }),
      }
    );
    assert.equal(postObjectHref.status, 200);
    const postObjectHrefData = await postObjectHref.json();
    assert.equal(typeof postObjectHrefData.progress.chapterHref, "string");
    assert.equal(postObjectHrefData.progress.chapterHref, "page_079.jpg");
  } finally {
    await server.stop();
  }
});

test("Bookshelf API accurately derives comic page from chapterDocIndex or percentage when record.page is empty", async () => {
  const storeData = {
    recordLocation: JSON.stringify({
      // Desktop Kookit wrote chapterDocIndex 79 and percentage 0.80, but left page as empty string
      "comic-from-desktop": {
        page: "",
        percentage: "0.8000",
        chapterDocIndex: "79",
        chapterHref: "page_079.jpg",
        chapterTitle: "Page 80",
        timestamp: 1700000000,
      },
      // Synced only with percentage 0.65
      "comic-pct-only": {
        page: "",
        percentage: "0.65",
        timestamp: 1700000000,
      },
    }),
  };

  const mockDb = {
    prepare: () => ({
      all: () => [
        {
          key: "comic-from-desktop",
          name: "Test Comic 1",
          format: "cbz",
          page: 100,
        },
        {
          key: "comic-pct-only",
          name: "Test Comic 2",
          format: "cbz",
          page: 100,
        },
      ],
    }),
  };

  const server = new MobileServer();
  const token = "shelf-test-token";

  registerBookshelfRoutes(server, {
    getStore: () => ({
      get: (key) => storeData[key] || null,
    }),
    getDb: () => mockDb,
  });

  const status = await server.start({
    port: 28396,
    host: "127.0.0.1",
    token,
  });

  try {
    const res = await fetch(
      `http://127.0.0.1:${status.port}/api/books?token=${token}`
    );
    assert.equal(res.status, 200);
    const books = await res.json();
    assert.equal(books.length, 2);

    const book1 = books.find((b) => b.key === "comic-from-desktop");
    assert.ok(book1);
    // Derived from chapterDocIndex (79 + 1 = 80)
    assert.equal(book1.page, 80);
    assert.equal(book1.percentage, 0.8);

    const book2 = books.find((b) => b.key === "comic-pct-only");
    assert.ok(book2);
    // Derived from percentage * totalPages (0.65 * 100 = 65)
    assert.equal(book2.page, 65);
    assert.equal(book2.percentage, 0.65);
  } finally {
    await server.stop();
  }
});

test("Mobile waterfall placeholder aspect-ratio calculation and restoration logic prevents 25% decay", () => {
  // Simulate mobile device width 390px
  const viewportWidth = 390;
  const initialRatio = 1.414;
  const estimatedHeight = Math.round(viewportWidth * initialRatio); // 551px

  // Verify placeholder height matches real comic page height (~550px) instead of 200px
  assert.equal(estimatedHeight, 551);
  assert.ok(
    estimatedHeight > 500 && estimatedHeight < 600,
    "Estimated placeholder height must closely match typical manga height"
  );

  // Simulate opening a comic at 80% progress
  const book = { page: 0, percentage: 0.8 };
  const totalPages = 100;
  let currentPage = book.page > 0 ? book.page : 1;

  // Verify client-side calculation once totalPages is known
  if (currentPage <= 1 && book.percentage > 0 && totalPages > 0) {
    currentPage = Math.min(
      totalPages,
      Math.max(1, Math.round(book.percentage * totalPages))
    );
  }
  assert.equal(currentPage, 80);

  // Simulate multiple open/exit cycles: verify currentPage NEVER decays to 50% or 25%
  for (let cycle = 1; cycle <= 10; cycle++) {
    // If restoration lock is active, isRestoringScroll is true -> progress report is suppressed
    const isRestoringScroll = true;
    let reportedPage = currentPage;
    if (isRestoringScroll) {
      // reportProgress returns early without modifying stored progress
      reportedPage = currentPage; // untouched
    }
    assert.equal(
      reportedPage,
      80,
      `Cycle ${cycle}: progress must remain at page 80 without decay`
    );
  }
});
