const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { MobileServer } = require("./mobileServer");
const { registerBookshelfRoutes } = require("./bookshelfRouter");

function createTestEnvironment() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-shelf-test-"));
  const configDir = path.join(tempDir, "config");
  const coverDir = path.join(tempDir, "cover");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(coverDir, { recursive: true });

  // Base64 1x1 transparent PNG
  const base64Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const booksData = [
    {
      key: "comic-1",
      name: "Attack on Titan Vol 1",
      author: "Isayama",
      format: "cbz",
      size: 25000000,
      page: 192,
      cover: "",
      path: "/books/aot.cbz",
    },
    {
      key: "novel-1",
      name: "Three Body Problem",
      author: "Liu Cixin",
      format: "epub",
      size: 1500000,
      page: 450,
      cover: base64Png,
      path: "/books/3body.epub",
    },
    {
      key: "novel-2",
      name: "1984",
      author: "George Orwell",
      format: "txt",
      size: 500000,
      page: 120,
      cover: "",
      path: "/books/1984.txt",
    },
  ];

  const db = {
    prepare: (sql) => ({
      all: () => booksData,
      get: (key) => booksData.find((b) => b.key === key),
    }),
    close: () => {},
  };

  // Write a physical cover file for comic-1
  const comicCoverPath = path.join(coverDir, "comic-1.png");
  fs.writeFileSync(comicCoverPath, Buffer.from("fake-png-content-12345"));

  // Mock store with recordLocation and blurredBooks
  const mockStore = {
    get: (key) => {
      if (key === "recordLocation") {
        return {
          "comic-1": {
            page: "96",
            percentage: "0.50",
            timestamp: 1725400000000,
            chapterTitle: "Chapter 2",
          },
          "novel-1": {
            page: "45",
            percentage: "0.10",
            timestamp: 1725300000000,
          },
        };
      }
      if (key === "blurredBooks") {
        return ["comic-1"];
      }
      return null;
    },
  };

  return { tempDir, db, mockStore };
}

test("Bookshelf API returns formatted book list with progress and blurred cover status", async () => {
  const { tempDir, db, mockStore } = createTestEnvironment();
  const server = new MobileServer();
  const token = "shelf-test-token";

  registerBookshelfRoutes(server, {
    storagePath: tempDir,
    getStore: () => mockStore,
    getDb: () => db,
  });

  const status = await server.start({
    port: 28330,
    host: "127.0.0.1",
    token,
  });

  try {
    const res = await fetch(`http://127.0.0.1:${status.port}/api/books?token=${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");

    const books = await res.json();
    assert.equal(books.length, 3);

    // Verify comic-1
    const comic = books.find((b) => b.key === "comic-1");
    assert.ok(comic);
    assert.equal(comic.name, "Attack on Titan Vol 1");
    assert.equal(comic.format, "cbz");
    assert.equal(comic.category, "comic");
    assert.equal(comic.page, 96);
    assert.equal(comic.totalPage, 192);
    assert.equal(comic.percentage, 0.5);
    assert.equal(comic.lastReadTime, 1725400000000);
    assert.equal(comic.coverUrl, "/api/cover/comic-1");
    assert.equal(comic.isBlurred, true);

    // Verify novel-1
    const novel = books.find((b) => b.key === "novel-1");
    assert.ok(novel);
    assert.equal(novel.category, "novel");
    assert.equal(novel.percentage, 0.1);
    assert.equal(novel.isBlurred, false);
  } finally {
    await server.stop();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Cover API streams physical cover, base64 cover, and SVG fallback", async () => {
  const { tempDir, db, mockStore } = createTestEnvironment();
  const server = new MobileServer();
  const token = "cover-test-token";

  registerBookshelfRoutes(server, {
    storagePath: tempDir,
    getStore: () => mockStore,
    getDb: () => db,
  });

  const status = await server.start({
    port: 28340,
    host: "127.0.0.1",
    token,
  });

  try {
    // 1. Physical cover file: comic-1.png
    const res1 = await fetch(`http://127.0.0.1:${status.port}/api/cover/comic-1?token=${token}`);
    assert.equal(res1.status, 200);
    assert.equal(res1.headers.get("content-type"), "image/png");
    assert.equal(res1.headers.get("cache-control"), "public, max-age=86400");
    const buf1 = await res1.text();
    assert.equal(buf1, "fake-png-content-12345");

    // 2. Base64 decoded cover: novel-1
    const res2 = await fetch(`http://127.0.0.1:${status.port}/api/cover/novel-1?token=${token}`);
    assert.equal(res2.status, 200);
    assert.equal(res2.headers.get("content-type"), "image/png");
    const arrBuf2 = await res2.arrayBuffer();
    assert.ok(arrBuf2.byteLength > 0);

    // 3. Fallback SVG cover: novel-2
    const res3 = await fetch(`http://127.0.0.1:${status.port}/api/cover/novel-2?token=${token}`);
    assert.equal(res3.status, 200);
    assert.ok(res3.headers.get("content-type").includes("image/svg+xml"));
    const svgText = await res3.text();
    assert.ok(svgText.includes("<svg"));
    assert.ok(svgText.includes("1984"));
  } finally {
    await server.stop();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
