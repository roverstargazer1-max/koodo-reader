const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const yazl = require("yazl");
const { MobileServer } = require("./mobileServer");
const { registerComicStreamerRoutes } = require("./comicStreamer");

/**
 * Helper to build a real CBZ archive on disk using yazl.
 */
function createTestCbz(destPath, fileEntries) {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    const outStream = fs.createWriteStream(destPath);

    for (const entry of fileEntries) {
      zipfile.addBuffer(Buffer.from(entry.content), entry.name);
    }

    zipfile.outputStream.pipe(outStream).on("close", resolve).on("error", reject);
    zipfile.end();
  });
}

test("comicStreamer extracts pages and streams images from real CBZ archive", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-comic-test-"));
  const bookDir = path.join(tempDir, "book");
  fs.mkdirSync(bookDir, { recursive: true });

  const cbzPath = path.join(bookDir, "test-manga.cbz");

  // Add pages out of alphabetical order to test natural sorting: page_10 before page_02
  const pages = [
    { name: "page_10.png", content: "PNG_DATA_PAGE_10_XYZ" },
    { name: "page_01.png", content: "PNG_DATA_PAGE_01_ABC" },
    { name: "page_02.jpg", content: "JPG_DATA_PAGE_02_DEF" },
    { name: "readme.txt", content: "ignore non-image file" },
  ];

  await createTestCbz(cbzPath, pages);

  const server = new MobileServer();
  const token = "comic-test-token";

  registerComicStreamerRoutes(server, {
    storagePath: tempDir,
    getBook: (key) => {
      if (key === "test-manga") {
        return { key: "test-manga", format: "cbz", path: cbzPath };
      }
      return null;
    },
  });

  const status = await server.start({
    port: 28350,
    host: "127.0.0.1",
    token,
  });

  try {
    // 1. GET pages
    const pagesRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-manga/comic/pages?token=${token}`
    );
    assert.equal(pagesRes.status, 200);
    const pagesData = await pagesRes.json();
    assert.equal(pagesData.totalPages, 3); // ignored readme.txt

    // Check natural sorting order: page_01 -> page_02 -> page_10
    assert.equal(pagesData.pages[0].name, "page_01.png");
    assert.equal(pagesData.pages[1].name, "page_02.jpg");
    assert.equal(pagesData.pages[2].name, "page_10.png");

    // 2. Stream page 0 (page_01.png)
    const p0Res = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-manga/comic/page/0?token=${token}`
    );
    assert.equal(p0Res.status, 200);
    assert.equal(p0Res.headers.get("content-type"), "image/png");
    assert.equal(p0Res.headers.get("cache-control"), "public, max-age=86400");
    const p0Text = await p0Res.text();
    assert.equal(p0Text, "PNG_DATA_PAGE_01_ABC");

    // 3. Stream page 1 (page_02.jpg)
    const p1Res = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-manga/comic/page/1?token=${token}`
    );
    assert.equal(p1Res.status, 200);
    assert.equal(p1Res.headers.get("content-type"), "image/jpeg");
    const p1Text = await p1Res.text();
    assert.equal(p1Text, "JPG_DATA_PAGE_02_DEF");

    // 4. Stream page 2 (page_10.png)
    const p2Res = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-manga/comic/page/2?token=${token}`
    );
    assert.equal(p2Res.status, 200);
    const p2Text = await p2Res.text();
    assert.equal(p2Text, "PNG_DATA_PAGE_10_XYZ");

    // 5. Out of bounds index -> 404
    const pOutRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-manga/comic/page/99?token=${token}`
    );
    assert.equal(pOutRes.status, 404);
  } finally {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("comicStreamer streams images from loose folder directory", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-folder-test-"));
  const folderPath = path.join(tempDir, "chapter_1");
  fs.mkdirSync(folderPath, { recursive: true });

  fs.writeFileSync(path.join(folderPath, "01.jpg"), "JPG_01");
  fs.writeFileSync(path.join(folderPath, "02.webp"), "WEBP_02");

  const server = new MobileServer();
  const token = "folder-test-token";

  registerComicStreamerRoutes(server, {
    storagePath: tempDir,
    getBook: (key) => {
      if (key === "folder-manga") {
        return { key: "folder-manga", format: "folder", path: folderPath };
      }
      return null;
    },
  });

  const status = await server.start({
    port: 28360,
    host: "127.0.0.1",
    token,
  });

  try {
    const pagesRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/folder-manga/comic/pages?token=${token}`
    );
    assert.equal(pagesRes.status, 200);
    const pagesData = await pagesRes.json();
    assert.equal(pagesData.totalPages, 2);

    const p0Res = await fetch(
      `http://127.0.0.1:${status.port}/api/book/folder-manga/comic/page/0?token=${token}`
    );
    assert.equal(p0Res.status, 200);
    assert.equal(p0Res.headers.get("content-type"), "image/jpeg");
    assert.equal(await p0Res.text(), "JPG_01");

    const p1Res = await fetch(
      `http://127.0.0.1:${status.port}/api/book/folder-manga/comic/page/1?token=${token}`
    );
    assert.equal(p1Res.status, 200);
    assert.equal(p1Res.headers.get("content-type"), "image/webp");
    assert.equal(await p1Res.text(), "WEBP_02");
  } finally {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
