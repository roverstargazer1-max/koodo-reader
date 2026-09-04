const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { MobileServer } = require("./mobileServer");
const { registerNovelStreamerRoutes } = require("./novelStreamer");

test("novelStreamer streams EPUB and TXT files with Range support", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-novel-test-"));
  const bookDir = path.join(tempDir, "book");
  fs.mkdirSync(bookDir, { recursive: true });

  const epubPath = path.join(bookDir, "test-book.epub");
  const txtPath = path.join(bookDir, "test-novel.txt");

  const epubContent = "EPUB_MOCK_DATA_0123456789_ABCDEF";
  const txtContent = "第一章 开篇\n这是一段测试小说文本。\n第二章 发展\n故事继续推进。";

  fs.writeFileSync(epubPath, Buffer.from(epubContent));
  fs.writeFileSync(txtPath, Buffer.from(txtContent, "utf-8"));

  const server = new MobileServer();
  const token = "novel-test-token";

  registerNovelStreamerRoutes(server, {
    storagePath: tempDir,
    getBook: (key) => {
      if (key === "test-book") return { key: "test-book", format: "epub", path: epubPath };
      if (key === "test-novel") return { key: "test-novel", format: "txt", path: txtPath };
      return null;
    },
  });

  const status = await server.start({
    port: 28370,
    host: "127.0.0.1",
    token,
  });

  try {
    // 1. Full EPUB file download
    const epubRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-book/file?token=${token}`
    );
    assert.equal(epubRes.status, 200);
    assert.equal(epubRes.headers.get("content-type"), "application/epub+zip");
    assert.equal(epubRes.headers.get("accept-ranges"), "bytes");
    assert.equal(epubRes.headers.get("content-length"), String(epubContent.length));
    const epubText = await epubRes.text();
    assert.equal(epubText, epubContent);

    // 2. Range request: first 10 bytes
    const rangeRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-book/file?token=${token}`,
      {
        headers: { Range: "bytes=0-9" },
      }
    );
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get("content-range"), `bytes 0-9/${epubContent.length}`);
    assert.equal(rangeRes.headers.get("content-length"), "10");
    const rangeText = await rangeRes.text();
    assert.equal(rangeText, epubContent.slice(0, 10));

    // 3. Full TXT file download
    const txtRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-novel/file?token=${token}`
    );
    assert.equal(txtRes.status, 200);
    assert.equal(txtRes.headers.get("content-type"), "text/plain; charset=utf-8");
    const receivedTxt = await txtRes.text();
    assert.equal(receivedTxt, txtContent);

    // 4. Unsatisfiable Range -> 416
    const badRangeRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-book/file?token=${token}`,
      {
        headers: { Range: "bytes=9999-10000" },
      }
    );
    assert.equal(badRangeRes.status, 416);

    // 5. Structured Chapters endpoint for TXT
    const chaptersRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-novel/novel/chapters?token=${token}`
    );
    assert.equal(chaptersRes.status, 200);
    const chaptersData = await chaptersRes.json();
    assert.equal(chaptersData.format, "txt");
    assert.equal(chaptersData.chapters.length, 2);
    assert.equal(chaptersData.chapters[0].title, "第一章 开篇");
    assert.equal(chaptersData.chapters[0].paragraphs[0], "这是一段测试小说文本。");
    assert.equal(chaptersData.chapters[1].title, "第二章 发展");
  } finally {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
