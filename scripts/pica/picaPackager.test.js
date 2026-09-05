const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const yauzl = require("yauzl");
const {
  generateComicInfoXml,
  buildCbzArchive,
  runConcurrentPool,
} = require("./picaPackager");

test("generateComicInfoXml produces valid standard ComicInfo.xml with escaped characters", () => {
  const meta = {
    title: "Comic & Manga <Test> \"Special\"",
    series: "Series 'Name' & Co.",
    number: 3,
    author: "Test Author & Writer",
    chineseTeam: "Translation <Group>",
    description: "Line 1\nLine 2 with <html> & special chars",
    categories: ["Action", "Adventure", "Fantasy"],
    tags: ["Full Color", "Short Story"],
    pageCount: 36,
  };

  const xml = generateComicInfoXml(meta);

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'));
  assert.ok(xml.includes("<Title>Comic &amp; Manga &lt;Test&gt; &quot;Special&quot;</Title>"));
  assert.ok(xml.includes("<Series>Series &apos;Name&apos; &amp; Co.</Series>"));
  assert.ok(xml.includes("<Number>3</Number>"));
  assert.ok(xml.includes("<Writer>Test Author &amp; Writer</Writer>"));
  assert.ok(xml.includes("<Translator>Translation &lt;Group&gt;</Translator>"));
  assert.ok(xml.includes("<Genre>Action, Adventure, Fantasy</Genre>"));
  assert.ok(xml.includes("<Tags>Full Color, Short Story</Tags>"));
  assert.ok(xml.includes("<PageCount>36</PageCount>"));
  assert.ok(xml.includes("<Manga>YesAndRightToLeft</Manga>"));
});

test("buildCbzArchive creates readable .cbz zip archive containing ComicInfo.xml and pages", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-test-"));
  const cbzPath = path.join(tempDir, "test-comic.cbz");

  const xmlContent = generateComicInfoXml({
    title: "CBZ Archive Test",
    author: "Test Author",
    pageCount: 2,
  });

  const fileEntries = [
    { buffer: Buffer.from("dummy image page 1 content"), archivePath: "page_0001.jpg" },
    { buffer: Buffer.from("dummy image page 2 content"), archivePath: "page_0002.jpg" },
  ];

  await buildCbzArchive(cbzPath, fileEntries, xmlContent);
  assert.ok(fs.existsSync(cbzPath));
  assert.ok(fs.statSync(cbzPath).size > 0);

  // Read entries from generated CBZ with yauzl
  const readEntries = await new Promise((resolve, reject) => {
    const entries = [];
    yauzl.open(cbzPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        entries.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.on("end", () => resolve(entries));
      zipfile.on("error", reject);
    });
  });

  assert.ok(readEntries.includes("ComicInfo.xml"));
  assert.ok(readEntries.includes("page_0001.jpg"));
  assert.ok(readEntries.includes("page_0002.jpg"));

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("runConcurrentPool processes all items preserving order", async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const results = await runConcurrentPool(
    items,
    async (item, idx) => {
      await new Promise((r) => setTimeout(r, 10));
      return item * 10;
    },
    3,
    0
  );

  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80]);
});

test("runConcurrentPool stops early when isCancelled returns true", async () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let cancelled = false;
  let executedCount = 0;

  await assert.rejects(
    async () => {
      await runConcurrentPool(
        items,
        async (item) => {
          executedCount++;
          if (item === 2) {
            cancelled = true;
          }
          await new Promise((r) => setTimeout(r, 15));
          return item;
        },
        2,
        0,
        null,
        () => cancelled
      );
    },
    {
      name: "Error",
      message: "Download cancelled by user",
    }
  );

  // Since it cancelled on item 2, it should not execute all 10 items
  assert.ok(executedCount < items.length, `Expected executedCount < 10, got ${executedCount}`);
});

test("runConcurrentPool gracefully propagates worker errors without unhandled rejections", async () => {
  const items = [1, 2, 3, 4, 5];
  await assert.rejects(
    async () => {
      await runConcurrentPool(
        items,
        async (item) => {
          if (item === 2) {
            throw new Error("Worker network failure");
          }
          await new Promise((r) => setTimeout(r, 10));
          return item;
        },
        3,
        0
      );
    },
    {
      name: "Error",
      message: "Worker network failure",
    }
  );
});
