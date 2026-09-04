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

test("novelStreamer extracts EPUB chapters with images and streams resources", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-novel-epub-test-"));
  const bookDir = path.join(tempDir, "book");
  fs.mkdirSync(bookDir, { recursive: true });

  const epubPath = path.join(bookDir, "real-epub.epub");
  const yazl = require("yazl");
  const zip = new yazl.ZipFile();

  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opfXml = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <manifest>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="img1" href="Images/pic.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`;

  const ch1Html = `<!DOCTYPE html>
<html>
<head><title>第一章 冒险</title></head>
<body>
  <h1>第一章 冒险</h1>
  <div><img src="../Images/pic.jpg" alt="插图1"/></div>
  <p>出发前的一段对话。</p>
</body>
</html>`;

  const imageBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  zip.addBuffer(Buffer.from(containerXml), "META-INF/container.xml");
  zip.addBuffer(Buffer.from(opfXml), "OEBPS/content.opf");
  zip.addBuffer(Buffer.from(ch1Html), "OEBPS/Text/ch1.xhtml");
  zip.addBuffer(imageBuffer, "OEBPS/Images/pic.jpg");
  zip.end();

  await new Promise((resolve) => {
    const out = fs.createWriteStream(epubPath);
    zip.outputStream.pipe(out);
    out.on("close", resolve);
  });

  const server = new MobileServer();
  const token = "epub-test-token";

  registerNovelStreamerRoutes(server, {
    storagePath: tempDir,
    getBook: (key) => {
      if (key === "real-epub") return { key: "real-epub", format: "epub", path: epubPath };
      return null;
    },
  });

  const status = await server.start({
    port: 28375,
    host: "127.0.0.1",
    token,
  });

  try {
    // 1. Get structured chapters
    const chaptersRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/real-epub/novel/chapters?token=${token}`
    );
    assert.equal(chaptersRes.status, 200);
    const data = await chaptersRes.json();
    assert.equal(data.chapters.length, 1);
    assert.equal(data.chapters[0].title, "第一章 冒险");

    const paras = data.chapters[0].paragraphs;
    assert.equal(paras.length, 3);
    assert.equal(paras[0], "第一章 冒险");
    assert.deepEqual(paras[1], {
      type: "image",
      src: `/api/book/real-epub/resource?path=OEBPS%2FImages%2Fpic.jpg`,
      alt: "插图1",
    });
    assert.equal(paras[2], "出发前的一段对话。");

    // 2. Stream image resource
    const imgRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/real-epub/resource?path=OEBPS/Images/pic.jpg&token=${token}`
    );
    assert.equal(imgRes.status, 200);
    assert.equal(imgRes.headers.get("content-type"), "image/jpeg");
    const imgData = Buffer.from(await imgRes.arrayBuffer());
    assert.deepEqual(imgData, imageBuffer);

    // 3. Prevent path traversal
    const badPathRes = await fetch(
      `http://127.0.0.1:${status.port}/api/book/real-epub/resource?path=../secret&token=${token}`
    );
    assert.equal(badPathRes.status, 403);
  } finally {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
