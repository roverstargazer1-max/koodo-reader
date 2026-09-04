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

const RESOURCE_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
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

function extractBlocks(html, entryPath, bookKey = "") {
  const entryDir = path.posix.dirname(entryPath);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : html;

  // Replace image tags with structured markers
  let processed = content.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) return "";
    const src = srcMatch[1].split("#")[0].split("?")[0];
    const resolved = path.posix.normalize(path.posix.join(entryDir, src));
    const altMatch = attrs.match(/\balt=["']([^"']+)["']/i);
    const alt = altMatch ? altMatch[1] : "";
    return `\n[[KOODO_IMG:${resolved}|${alt}]]\n`;
  });

  processed = processed.replace(/<image\b([^>]*?)>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/\b(?:xlink:href|href)=["']([^"']+)["']/i);
    if (!srcMatch) return "";
    const src = srcMatch[1].split("#")[0].split("?")[0];
    const resolved = path.posix.normalize(path.posix.join(entryDir, src));
    return `\n[[KOODO_IMG:${resolved}|]]\n`;
  });

  const withLineBreaks = processed
    .replace(/<\/(?:p|div|h[1-6]|section|blockquote|article)>/gi, "\n")
    .replace(/<(?:hr|br)\s*\/?>/gi, "\n");

  const rawLines = withLineBreaks.split(/\r?\n+/);
  const blocks = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const imgMatch = trimmed.match(/^\[\[KOODO_IMG:([^\|]+)\|(.*)\]\]$/);
    if (imgMatch) {
      blocks.push({
        type: "image",
        src: `/api/book/${encodeURIComponent(bookKey)}/resource?path=${encodeURIComponent(imgMatch[1])}`,
        alt: imgMatch[2] || "",
      });
    } else if (trimmed.includes("[[KOODO_IMG:")) {
      const parts = trimmed.split(/(\[\[KOODO_IMG:[^\]]+\]\])/);
      for (const part of parts) {
        const m = part.match(/^\[\[KOODO_IMG:([^\|]+)\|(.*)\]\]$/);
        if (m) {
          blocks.push({
            type: "image",
            src: `/api/book/${encodeURIComponent(bookKey)}/resource?path=${encodeURIComponent(m[1])}`,
            alt: m[2] || "",
          });
        } else {
          const text = cleanHtmlText(part);
          if (text) blocks.push(text);
        }
      }
    } else {
      const text = cleanHtmlText(trimmed);
      if (text) blocks.push(text);
    }
  }

  return blocks;
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

async function parseEpubChapters(novelPath, bookKey = "") {
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
          let ncxPath = "";
          const itemMatches = opfXml.match(/<item\s+[^>]+>/gi) || [];
          for (const tag of itemMatches) {
            const idMatch = tag.match(/\bid=["']([^"']+)["']/i);
            const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
            const mediaMatch = tag.match(/\bmedia-type=["']([^"']+)["']/i);
            if (idMatch && hrefMatch) {
              const fullHref = path.posix.join(opfDir, hrefMatch[1]);
              manifest.set(idMatch[1], fullHref);
              if (
                (mediaMatch && mediaMatch[1].includes("dtbncx")) ||
                idMatch[1].toLowerCase() === "ncx" ||
                hrefMatch[1].endsWith(".ncx")
              ) {
                ncxPath = fullHref;
              }
            }
          }

          // Parse TOC map if NCX is present
          const tocTitles = new Map();
          if (ncxPath) {
            const ncxEntry = entries.get(path.posix.normalize(ncxPath)) || entries.get(ncxPath);
            if (ncxEntry) {
              const ncxXml = await readZipEntry(zipfile, ncxEntry);
              const ncxDir = path.posix.dirname(ncxPath);
              const navPointMatches = ncxXml.match(/<navPoint[\s\S]*?<\/navPoint>/gi) || [];
              for (const np of navPointMatches) {
                const labelMatch = np.match(/<text[^>]*>([\s\S]*?)<\/text>/i);
                const contentMatch = np.match(/<content\s+[^>]*src=["']([^"']+)["']/i);
                if (labelMatch && contentMatch) {
                  const label = cleanHtmlText(labelMatch[1]);
                  const rawSrc = contentMatch[1].split("#")[0].split("?")[0];
                  const normSrc = path.posix.normalize(path.posix.join(ncxDir, rawSrc));
                  if (label && normSrc) {
                    tocTitles.set(normSrc, label);
                  }
                }
              }
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
            const blocks = extractBlocks(html, normHref, bookKey);

            if (blocks.length === 0) continue;

            // Determine title
            let title = tocTitles.get(normHref);
            if (!title) {
              const titleMatch =
                html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
              if (titleMatch) {
                const rawTitle = cleanHtmlText(titleMatch[1]);
                if (rawTitle && !/^\d+$/.test(rawTitle)) {
                  title = rawTitle;
                }
              }
            }

            if (!title) {
              if (blocks.length === 1 && typeof blocks[0] === "object" && blocks[0].type === "image") {
                title = "插图";
              } else {
                title = `第 ${chapters.length + 1} 节`;
              }
            }

            chapters.push({ id, title, paragraphs: blocks });
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
        chapters = await parseEpubChapters(novelPath, bookKey);
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

  // GET /api/book/:key/resource?path=...
  server.registerRoute("GET", "/api/book/:key/resource", (req, res, { params, query }) => {
    try {
      const bookKey = params.key;
      const resourcePath = query ? query.get("path") : null;
      if (!resourcePath) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing resource path parameter");
        return;
      }

      // Security check: prevent path traversal
      const normTarget = path.posix.normalize(decodeURIComponent(resourcePath)).replace(/^\//, "");
      if (normTarget.startsWith("..")) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden path");
        return;
      }

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
        res.end("Book file not found");
        return;
      }

      yauzl.open(novelPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Failed to open book archive");
          return;
        }

        let found = false;
        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          const entryNorm = path.posix.normalize(entry.fileName).replace(/^\//, "");
          if (entryNorm === normTarget || entry.fileName === resourcePath) {
            found = true;
            const ext = path.extname(entry.fileName).toLowerCase();
            const contentType = RESOURCE_MIME_TYPES[ext] || "application/octet-stream";

            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr) {
                zipfile.close();
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Error reading resource entry");
                return;
              }

              res.writeHead(200, {
                "Content-Type": contentType,
                "Content-Length": entry.uncompressedSize,
                "Cache-Control": "public, max-age=86400",
              });

              readStream.pipe(res);
              readStream.on("end", () => zipfile.close());
              readStream.on("error", () => {
                zipfile.close();
                if (!res.headersSent) {
                  res.writeHead(500, { "Content-Type": "text/plain" });
                  res.end("Stream error");
                }
              });
            });
          } else {
            zipfile.readEntry();
          }
        });

        zipfile.on("end", () => {
          if (!found) {
            zipfile.close();
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Resource not found in book");
          }
        });
      });
    } catch (err) {
      console.error("[NovelStreamer] Error streaming resource:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });
}

module.exports = {
  resolveNovelPath,
  registerNovelStreamerRoutes,
  NOVEL_MIME_TYPES,
  RESOURCE_MIME_TYPES,
};
