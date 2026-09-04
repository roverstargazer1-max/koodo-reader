const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");

const NOVEL_MIME_TYPES = {
  ".epub": "application/epub+zip",
  ".txt": "text/plain; charset=utf-8",
  ".mobi": "application/x-mobipocket-ebook",
  ".azw3": "application/vnd.amazon.ebook",
  ".azw": "application/vnd.amazon.ebook",
  ".fb2": "application/x-fictionbook+xml",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown; charset=utf-8",
};

function cleanHtmlText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .trim();
}

function readZipEntry(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      stream.on("error", reject);
    });
  });
}

const chaptersCache = new Map();

async function parseEpubChapters(novelPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(novelPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) return reject(err);
      const entries = new Map();
      zipfile.readEntry();
      zipfile.on("entry", (e) => {
        entries.set(e.fileName, e);
        zipfile.readEntry();
      });
      zipfile.on("end", async () => {
        try {
          const container = entries.get("META-INF/container.xml");
          if (!container) throw new Error("No container.xml found in EPUB");
          const containerXml = await readZipEntry(zipfile, container);
          const opfMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
          const opfPath = opfMatch ? opfMatch[1] : "OEBPS/content.opf";
          const opfDir = opfPath.includes("/")
            ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
            : "";

          const opfEntry = entries.get(opfPath);
          if (!opfEntry) throw new Error("No OPF entry found: " + opfPath);
          const opfXml = await readZipEntry(zipfile, opfEntry);

          const manifest = new Map();
          const itemMatches = opfXml.match(/<item\s+[^>]+>/gi) || [];
          for (const tag of itemMatches) {
            const idMatch = tag.match(/\bid=["']([^"']+)["']/i);
            const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
            if (idMatch && hrefMatch) {
              manifest.set(idMatch[1], path.posix.join(opfDir, hrefMatch[1]));
            }
          }

          const spine = [];
          const itemrefMatches = opfXml.match(/<itemref\s+[^>]+>/gi) || [];
          for (const tag of itemrefMatches) {
            const idrefMatch = tag.match(/\bidref=["']([^"']+)["']/i);
            if (idrefMatch) {
              spine.push(idrefMatch[1]);
            }
          }

          const chapters = [];
          for (let i = 0; i < spine.length; i++) {
            const id = spine[i];
            const href = manifest.get(id);
            if (!href) continue;
            const normHref = path.posix.normalize(href);
            const entry = entries.get(normHref) || entries.get(href);
            if (!entry) continue;

            const html = await readZipEntry(zipfile, entry);
            const pMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
            let paragraphs = pMatches.map((p) => cleanHtmlText(p)).filter(Boolean);

            if (paragraphs.length === 0) {
              const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
              if (bodyMatch) {
                paragraphs = cleanHtmlText(bodyMatch[1])
                  .split(/\r?\n+/)
                  .map((s) => s.trim())
                  .filter(Boolean);
              }
            }

            if (paragraphs.length === 0) continue;

            const titleMatch =
              html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
              html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
            const title = titleMatch
              ? cleanHtmlText(titleMatch[1])
              : `第 ${chapters.length + 1} 节`;
            chapters.push({ id, title, paragraphs });
          }

          zipfile.close();
          resolve(chapters);
        } catch (e) {
          zipfile.close();
          reject(e);
        }
      });
    });
  });
}

function parseTxtChapters(novelPath, defaultTitle) {
  const buf = fs.readFileSync(novelPath);
  let rawText = "";
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    rawText = decoder.decode(buf);
  } catch (e) {
    try {
      rawText = buf.toString("binary");
    } catch (e2) {
      rawText = buf.toString("utf-8");
    }
  }

  const chapterRegex = /(?:^|\n)(第[0-9一二三四五六七八九十百千万0-9]+[章回节卷集部篇幕][^\n]*|Chapter\s+[0-9A-Za-z]+[^\n]*)/g;
  const matches = [];
  let match;
  while ((match = chapterRegex.exec(rawText)) !== null) {
    matches.push({ index: match.index, title: match[1].trim() });
  }

  const chapters = [];
  if (matches.length === 0) {
    const paragraphs = rawText.split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
    chapters.push({ id: "ch1", title: defaultTitle || "正文", paragraphs });
  } else {
    if (matches[0].index > 0) {
      const introText = rawText.slice(0, matches[0].index).trim();
      if (introText) {
        chapters.push({
          id: "ch0",
          title: "序言 / 前言",
          paragraphs: introText.split(/\r?\n+/).map((p) => p.trim()).filter(Boolean),
        });
      }
    }
    for (let i = 0; i < matches.length; i++) {
      const title = matches[i].title;
      const startIndex = matches[i].index + matches[i].title.length;
      const endIndex = i < matches.length - 1 ? matches[i + 1].index : rawText.length;
      const body = rawText.slice(startIndex, endIndex).trim();
      const paragraphs = body.split(/\r?\n+/).map((p) => p.trim()).filter(Boolean);
      chapters.push({ id: `ch${i + 1}`, title, paragraphs });
    }
  }
  return chapters;
}

/**
 * Locate novel file on disk.
 */
function resolveNovelPath(bookKey, format = "epub", storagePath = "", hintPath = "") {
  if (hintPath && fs.existsSync(hintPath)) {
    const stat = fs.statSync(hintPath);
    if (stat.isFile()) return hintPath;
  }

  if (storagePath) {
    const extensions = [format, "epub", "txt", "mobi", "azw3", "azw", "fb2", "md", "docx"];
    for (const ext of extensions) {
      const p = path.join(storagePath, "book", `${bookKey}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

/**
 * Register Novel streaming routes onto mobile server.
 */
function registerNovelStreamerRoutes(server, context = {}) {
  const getStoragePath = () => {
    if (context.getStoragePath) return context.getStoragePath();
    if (context.storagePath) return context.storagePath;
    return path.join(process.cwd(), "uploads", "data");
  };

  const getBookMetadata = (bookKey) => {
    if (context.getBook) return context.getBook(bookKey);
    let db = null;
    if (context.getDb) db = context.getDb();
    else if (context.db) db = context.db;
    if (!db) {
      const storagePath = getStoragePath();
      const dbPath = path.join(storagePath, "config", "books.db");
      if (fs.existsSync(dbPath)) {
        try {
          const Database = require("better-sqlite3");
          db = new Database(dbPath, { readonly: true });
        } catch (e) {}
      }
    }
    if (db) {
      try {
        return db.prepare("SELECT * FROM books WHERE key = ?").get(bookKey);
      } catch (e) {
        console.error("[NovelStreamer] Error looking up book:", e);
      }
    }
    return null;
  };

  // GET /api/book/:key/file
  server.registerRoute("GET", "/api/book/:key/file", (req, res, { params }) => {
    try {
      const bookKey = params.key;
      const book = getBookMetadata(bookKey);
      const storagePath = getStoragePath();
      const novelPath = resolveNovelPath(
        bookKey,
        book ? book.format : "epub",
        storagePath,
        book ? book.path : ""
      );

      if (!novelPath || !fs.existsSync(novelPath)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Novel file not found");
        return;
      }

      const stat = fs.statSync(novelPath);
      const totalSize = stat.size;
      const ext = path.extname(novelPath).toLowerCase();
      const mime = NOVEL_MIME_TYPES[ext] || "application/octet-stream";

      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        // Parse HTTP Range: bytes=start-end
        const matches = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (!matches) {
          res.writeHead(416, {
            "Content-Range": `bytes */${totalSize}`,
            "Content-Type": "text/plain",
          });
          res.end("Requested Range Not Satisfiable");
          return;
        }

        let start = matches[1] ? parseInt(matches[1], 10) : 0;
        let end = matches[2] ? parseInt(matches[2], 10) : totalSize - 1;

        if (start >= totalSize || end >= totalSize || start > end) {
          res.writeHead(416, {
            "Content-Range": `bytes */${totalSize}`,
            "Content-Type": "text/plain",
          });
          res.end("Requested Range Not Satisfiable");
          return;
        }

        const chunkSize = end - start + 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": mime,
          "Cache-Control": "public, max-age=86400",
        });

        fs.createReadStream(novelPath, { start, end }).pipe(res);
      } else {
        // Full file stream
        res.writeHead(200, {
          "Content-Length": totalSize,
          "Accept-Ranges": "bytes",
          "Content-Type": mime,
          "Cache-Control": "public, max-age=86400",
        });

        fs.createReadStream(novelPath).pipe(res);
      }
    } catch (err) {
      console.error("[NovelStreamer] Error streaming novel file:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  // GET /api/book/:key/novel/chapters
  server.registerRoute("GET", "/api/book/:key/novel/chapters", async (req, res, { params }) => {
    try {
      const bookKey = params.key;
      const book = getBookMetadata(bookKey);
      const storagePath = getStoragePath();
      const novelPath = resolveNovelPath(
        bookKey,
        book ? book.format : "epub",
        storagePath,
        book ? book.path : ""
      );

      if (!novelPath || !fs.existsSync(novelPath)) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Novel file not found" }));
        return;
      }

      const stat = fs.statSync(novelPath);
      const cached = chaptersCache.get(bookKey);
      if (cached && cached.mtime === stat.mtimeMs) {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        });
        res.end(JSON.stringify(cached.data));
        return;
      }

      const ext = path.extname(novelPath).toLowerCase();
      let chapters = [];
      if (ext === ".epub") {
        chapters = await parseEpubChapters(novelPath);
      } else {
        chapters = parseTxtChapters(novelPath, book ? book.name : path.basename(novelPath));
      }

      const data = {
        title: book ? book.name : path.basename(novelPath),
        format: ext.replace(".", ""),
        chapters,
      };

      chaptersCache.set(bookKey, { mtime: stat.mtimeMs, data });

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error("[NovelStreamer] Error extracting novel chapters:", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

module.exports = {
  resolveNovelPath,
  registerNovelStreamerRoutes,
  NOVEL_MIME_TYPES,
};
