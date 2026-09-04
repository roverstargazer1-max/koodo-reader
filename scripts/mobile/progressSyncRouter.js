const fs = require("fs");
const path = require("path");

/**
 * Register Two-Way Reading Progress Sync routes onto mobile server.
 *
 * @param {object} server MobileServer instance
 * @param {object} context Environment context { getStore, getDb, onProgressUpdated }
 */
function registerProgressSyncRoutes(server, context = {}) {
  const getStore = () => {
    if (context.getStore) return context.getStore();
    return context.store || null;
  };

  const getStoreRecords = () => {
    try {
      const s = getStore();
      if (!s) return {};
      const raw = s.get("recordLocation");
      if (typeof raw === "string") return JSON.parse(raw);
      if (typeof raw === "object" && raw !== null) return raw;
    } catch (e) {
      console.warn("[ProgressSync] Error reading records from store:", e);
    }
    return {};
  };

  const saveStoreRecords = (records) => {
    try {
      const s = getStore();
      if (s) {
        s.set("recordLocation", JSON.stringify(records));
        return true;
      }
    } catch (e) {
      console.error("[ProgressSync] Error saving records to store:", e);
    }
    return false;
  };

  const updateBookDbPage = (bookKey, page) => {
    try {
      let db = null;
      if (context.getDb) db = context.getDb();
      else if (context.db) db = context.db;
      if (db && page) {
        db.prepare("UPDATE books SET page = ? WHERE key = ?").run(parseInt(page, 10), bookKey);
      }
    } catch (e) {
      // ignore
    }
  };

  // 1. GET /api/book/:key/progress
  server.registerRoute("GET", "/api/book/:key/progress", (req, res, { params }) => {
    try {
      const bookKey = params.key;
      const records = getStoreRecords();
      const progress = records[bookKey] || null;

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(JSON.stringify({ bookKey, progress }));
    } catch (err) {
      console.error("[ProgressSync] GET progress error:", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  const handleProgressPost = (req, res, bookKeyOverride) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy(); // Flood protection
      }
    });

    req.on("end", () => {
      try {
        const incoming = JSON.parse(body || "{}");
        const bookKey = bookKeyOverride || incoming.bookKey || incoming.key;
        if (!bookKey) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Missing bookKey" }));
          return;
        }

        const incomingTime = incoming.timestamp || Date.now();

        const records = getStoreRecords();
        const existing = records[bookKey];

        // Timestamp conflict resolution: latest timestamp wins
        if (existing && existing.timestamp && existing.timestamp > incomingTime) {
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
          });
          res.end(
            JSON.stringify({
              success: true,
              updated: false,
              reason: "Existing progress is newer than incoming update",
              progress: existing,
            })
          );
          return;
        }

        const updatedRecord = {
          ...(existing || {}),
          page: String(incoming.page || (existing && existing.page) || 1),
          percentage: String(incoming.percentage !== undefined ? incoming.percentage : (existing && existing.percentage) || 0),
          count: String(incoming.totalPages || incoming.count || (existing && existing.count) || incoming.page || 1),
          timestamp: incomingTime,
          chapterTitle: incoming.chapterTitle || (existing && existing.chapterTitle) || "",
          // Clear outdated desktop CFI/xpath so desktop navigates using latest mobile percentage/page
          cfi: "",
          xpath: "",
          text: "",
        };
        if (incoming.chapterDocIndex !== undefined) {
          updatedRecord.chapterDocIndex = String(incoming.chapterDocIndex);
        }

        records[bookKey] = updatedRecord;
        saveStoreRecords(records);
        updateBookDbPage(bookKey, incoming.page);

        // Notify desktop IPC handler if registered
        if (typeof context.onProgressUpdated === "function") {
          try {
            context.onProgressUpdated(bookKey, updatedRecord);
          } catch (ipcErr) {
            console.warn("[ProgressSync] onProgressUpdated callback error:", ipcErr);
          }
        }

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(
          JSON.stringify({
            success: true,
            updated: true,
            progress: updatedRecord,
          })
        );
      } catch (err) {
        console.error("[ProgressSync] POST progress error:", err);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  };

  // 2. POST /api/book/:key/progress
  server.registerRoute("POST", "/api/book/:key/progress", (req, res, { params }) => {
    handleProgressPost(req, res, params.key);
  });

  // 3. POST /api/progress
  server.registerRoute("POST", "/api/progress", (req, res) => {
    handleProgressPost(req, res, null);
  });
}

module.exports = {
  registerProgressSyncRoutes,
};
