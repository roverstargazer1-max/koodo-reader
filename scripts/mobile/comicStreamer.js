const fs = require("fs");
const path = require("path");
const yauzl = require("yauzl");

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
]);

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

// In-memory cache for central directory entries
// Key: filePath -> { mtimeMs, entries: [{ index, fileName, uncompressedSize, entry }] }
const zipEntryCache = new Map();

// Natural sort collator (e.g. 1.jpg, 2.jpg, 10.jpg)
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isImageFile(fileName) {
  if (!fileName || typeof fileName !== "string") return false;
  const base = path.basename(fileName);
  if (base.startsWith(".") || fileName.includes("__MACOSX/")) return false;
  const ext = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Scan a ZIP/CBZ file's central directory and cache image entries in natural sort order.
 */
function getZipEntries(filePath) {
  return new Promise((resolve, reject) => {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    const cached = zipEntryCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return resolve(cached.entries);
    }

    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return reject(err);

      const rawEntries = [];

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (!entry.fileName.endsWith("/") && isImageFile(entry.fileName)) {
          rawEntries.push(entry);
        }
        zipfile.readEntry();
      });

      zipfile.on("end", () => {
        // Natural sort by entry.fileName
        rawEntries.sort((a, b) => collator.compare(a.fileName, b.fileName));

        const entries = rawEntries.map((entry, index) => ({
          index,
          fileName: entry.fileName,
          size: entry.uncompressedSize,
          uncompressedSize: entry.uncompressedSize,
          entry,
        }));

        zipEntryCache.set(filePath, {
          mtimeMs: stat.mtimeMs,
          entries,
        });

        resolve(entries);
      });

      zipfile.on("error", (zipErr) => {
        reject(zipErr);
      });
    });
  });
}

/**
 * Scan an uncompressed loose image directory and return image files in natural sort order.
 */
function getFolderEntries(dirPath) {
  const stat = fs.statSync(dirPath);
  const cached = zipEntryCache.get(dirPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return Promise.resolve(cached.entries);
  }

  const fileNames = fs.readdirSync(dirPath);
  const images = fileNames.filter((f) => isImageFile(f));
  images.sort((a, b) => collator.compare(a, b));

  const entries = images.map((fileName, index) => {
    const fullPath = path.join(dirPath, fileName);
    const fstat = fs.statSync(fullPath);
    return {
      index,
      fileName,
      size: fstat.size,
      uncompressedSize: fstat.size,
      fullPath,
    };
  });

  zipEntryCache.set(dirPath, {
    mtimeMs: stat.mtimeMs,
    entries,
  });

  return Promise.resolve(entries);
}

/**
 * Locate comic file or directory given a book key and optional format/hint path.
 */
function resolveComicPath(bookKey, format = "cbz", storagePath = "", hintPath = "") {
  // 1. Direct hint path if provided and exists
  if (hintPath && fs.existsSync(hintPath)) {
    return hintPath;
  }

  // 2. Storage path: book/<key>.<format>
  if (storagePath) {
    const extensions = [format, "cbz", "zip", "cbr", "cbt", "cb7"];
    for (const ext of extensions) {
      const p = path.join(storagePath, "book", `${bookKey}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

/**
 * Register Comic Streamer routes onto mobile server.
 */
function registerComicStreamerRoutes(server, context = {}) {
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
        console.error("[ComicStreamer] Error looking up book:", e);
      }
    }
    return null;
  };

  // 1. GET /api/book/:key/comic/pages
  server.registerRoute("GET", "/api/book/:key/comic/pages", async (req, res, { params }) => {
    try {
      const bookKey = params.key;
      const book = getBookMetadata(bookKey);
      const storagePath = getStoragePath();
      const comicPath = resolveComicPath(
        bookKey,
        book ? book.format : "cbz",
        storagePath,
        book ? book.path : ""
      );

      if (!comicPath) {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Comic archive not found on disk" }));
        return;
      }

      const stat = fs.statSync(comicPath);
      let entries = [];
      if (stat.isDirectory()) {
        entries = await getFolderEntries(comicPath);
      } else {
        entries = await getZipEntries(comicPath);
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(
        JSON.stringify({
          bookKey,
          totalPages: entries.length,
          pages: entries.map((e) => ({
            index: e.index,
            name: path.basename(e.fileName),
            size: e.size,
          })),
        })
      );
    } catch (err) {
      console.error("[ComicStreamer] Error fetching pages:", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // 2. GET /api/book/:key/comic/page/:index
  server.registerRoute("GET", "/api/book/:key/comic/page/:index", async (req, res, { params }) => {
    try {
      const bookKey = params.key;
      const pageIndex = parseInt(params.index, 10);
      if (isNaN(pageIndex) || pageIndex < 0) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid page index");
        return;
      }

      const book = getBookMetadata(bookKey);
      const storagePath = getStoragePath();
      const comicPath = resolveComicPath(
        bookKey,
        book ? book.format : "cbz",
        storagePath,
        book ? book.path : ""
      );

      if (!comicPath) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Comic archive not found");
        return;
      }

      const stat = fs.statSync(comicPath);

      // Handle uncompressed loose folder
      if (stat.isDirectory()) {
        const entries = await getFolderEntries(comicPath);
        if (pageIndex >= entries.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Page index out of bounds");
          return;
        }

        const pageItem = entries[pageIndex];
        const ext = path.extname(pageItem.fileName).toLowerCase();
        const mime = MIME_MAP[ext] || "image/jpeg";

        res.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": pageItem.size,
          "Cache-Control": "public, max-age=86400",
        });

        fs.createReadStream(pageItem.fullPath).pipe(res);
        return;
      }

      // Handle CBZ/ZIP archive with zero temporary files
      const entries = await getZipEntries(comicPath);
      if (pageIndex >= entries.length) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Page index out of bounds");
        return;
      }

      const targetEntry = entries[pageIndex];
      const ext = path.extname(targetEntry.fileName).toLowerCase();
      const mime = MIME_MAP[ext] || "image/jpeg";

      yauzl.open(comicPath, { lazyEntries: true, autoClose: true }, (openErr, zipfile) => {
        if (openErr) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(`Failed to open zip: ${openErr.message}`);
          return;
        }

        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          if (entry.fileName === targetEntry.fileName) {
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end(`Stream error: ${streamErr.message}`);
                return;
              }

              res.writeHead(200, {
                "Content-Type": mime,
                "Content-Length": entry.uncompressedSize,
                "Cache-Control": "public, max-age=86400",
              });

              readStream.pipe(res);
            });
          } else {
            zipfile.readEntry();
          }
        });

        zipfile.on("error", (err) => {
          console.error("[ComicStreamer] Zipfile error:", err);
        });
      });
    } catch (err) {
      console.error("[ComicStreamer] Error streaming page:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });
}

module.exports = {
  getZipEntries,
  getFolderEntries,
  resolveComicPath,
  registerComicStreamerRoutes,
  isImageFile,
};
