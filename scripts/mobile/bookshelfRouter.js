const fs = require("fs");
const path = require("path");
let Database = null;
try {
  Database = require("better-sqlite3");
} catch (e) {
  // If running in standalone Node where better-sqlite3 was compiled for Electron ABI
}

const COMIC_FORMATS = new Set(["cbz", "cbr", "cbt", "cb7", "zip", "folder"]);
const NOVEL_FORMATS = new Set(["epub", "txt", "mobi", "azw3", "azw", "fb2", "docx", "md"]);

function generateFallbackCoverSvg(title = "") {
  const char = (title.trim()[0] || "K").toUpperCase();
  const bgColors = ["#4338ca", "#0369a1", "#0f766e", "#b45309", "#7c2d12", "#6d28d9"];
  const colorIndex = Math.abs(char.charCodeAt(0)) % bgColors.length;
  const bg = bgColors[colorIndex];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bg}" />
        <stop offset="100%" stop-color="#111827" />
      </linearGradient>
    </defs>
    <rect width="300" height="420" fill="url(#grad)" rx="8"/>
    <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="72" font-weight="bold" opacity="0.85">${char}</text>
    <text x="50%" y="75%" dominant-baseline="middle" text-anchor="middle" fill="#d1d5db" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" font-weight="500" width="240">${escapeXml(title.slice(0, 20))}</text>
  </svg>`;
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
    }
  });
}

/**
 * Register Bookshelf API routes onto mobile server.
 *
 * @param {object} server MobileServer instance
 * @param {object} context Environment context { getStoragePath, getStore, getDb }
 */
function registerBookshelfRoutes(server, context = {}) {
  const getStoragePath = () => {
    if (context.getStoragePath) return context.getStoragePath();
    if (context.storagePath) return context.storagePath;
    return path.join(process.cwd(), "uploads", "data");
  };

  const getStoreRecords = () => {
    try {
      if (context.getStore) {
        const s = context.getStore();
        const raw = s.get("recordLocation");
        if (typeof raw === "string") return JSON.parse(raw);
        if (typeof raw === "object" && raw !== null) return raw;
      }
    } catch (e) {
      // ignore
    }
    return {};
  };

  const getStoreBlurredBooks = () => {
    try {
      if (context.getStore) {
        const s = context.getStore();
        const raw = s.get("blurredBooks");
        if (Array.isArray(raw)) return raw;
        if (typeof raw === "string") return JSON.parse(raw);
      }
    } catch (e) {
      // ignore
    }
    return [];
  };

  const getDatabase = () => {
    if (context.getDb) return context.getDb();
    if (context.db) return context.db;
    const storagePath = getStoragePath();
    const dbPath = path.join(storagePath, "config", "books.db");
    if (!fs.existsSync(dbPath)) return null;
    return new Database(dbPath, { readonly: true });
  };

  // 1. GET /api/books
  server.registerRoute("GET", "/api/books", (req, res) => {
    try {
      const db = getDatabase();
      let books = [];
      if (db) {
        try {
          books = db.prepare("SELECT * FROM books").all();
        } catch (dbErr) {
          console.error("[BookshelfAPI] Error querying books:", dbErr);
        }
      }

      const records = getStoreRecords();
      const blurredBooks = getStoreBlurredBooks();
      const blurredSet = new Set(Array.isArray(blurredBooks) ? blurredBooks : []);

      const result = books.map((book) => {
        const record = records[book.key] || {};
        let percentage = 0;
        if (record.percentage !== undefined) {
          const parsed = parseFloat(record.percentage);
          if (!isNaN(parsed)) {
            percentage = parsed > 1 ? parsed / 100 : parsed;
          }
        }

        const format = (book.format || "").toLowerCase();
        let category = "other";
        if (COMIC_FORMATS.has(format)) {
          category = "comic";
        } else if (NOVEL_FORMATS.has(format)) {
          category = "novel";
        }

        return {
          key: book.key,
          name: book.name || "Untitled",
          author: book.author || "Unknown",
          description: book.description || "",
          format: format,
          category,
          size: book.size || 0,
          page: parseInt(record.page || book.page || 0, 10),
          totalPage: parseInt(book.page || 0, 10),
          percentage: Math.min(1, Math.max(0, percentage)),
          lastReadTime: record.timestamp || record.time || 0,
          chapterTitle: record.chapterTitle || "",
          isBlurred: blurredSet.has(book.key),
          coverUrl: `/api/cover/${encodeURIComponent(book.key)}`,
        };
      });

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error("[BookshelfAPI] Handler failure:", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // 2. GET /api/cover/:key
  server.registerRoute("GET", "/api/cover/:key", (req, res, { params }) => {
    try {
      const key = params.key;
      const storagePath = getStoragePath();
      const coverDir = path.join(storagePath, "cover");

      // Check on disk: cover/<key>.<ext>
      const extensions = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
      for (const ext of extensions) {
        const filePath = path.join(coverDir, `${key}${ext}`);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          const mime = ext === ".png"
            ? "image/png"
            : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";

          res.writeHead(200, {
            "Content-Type": mime,
            "Content-Length": stats.size,
            "Cache-Control": "public, max-age=86400",
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      // Check base64 in SQLite database
      const db = getDatabase();
      if (db) {
        try {
          const row = db.prepare("SELECT name, cover FROM books WHERE key = ?").get(key);
          if (row && row.cover && row.cover.startsWith("data:image/")) {
            const matches = row.cover.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches) {
              const mimeType = matches[1];
              const buffer = Buffer.from(matches[2], "base64");
              res.writeHead(200, {
                "Content-Type": mimeType,
                "Content-Length": buffer.length,
                "Cache-Control": "public, max-age=86400",
              });
              res.end(buffer);
              return;
            }
          }

          // Fallback SVG with title
          const title = row ? row.name : "";
          const svg = generateFallbackCoverSvg(title);
          res.writeHead(200, {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          });
          res.end(svg);
          return;
        } catch (dbErr) {
          console.error("[BookshelfAPI] Cover DB lookup failed:", dbErr);
        }
      }

      // Default fallback SVG
      const svg = generateFallbackCoverSvg("Book");
      res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(svg);
    } catch (err) {
      console.error("[BookshelfAPI] Cover error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });
}

module.exports = {
  registerBookshelfRoutes,
  generateFallbackCoverSvg,
  COMIC_FORMATS,
  NOVEL_FORMATS,
};
