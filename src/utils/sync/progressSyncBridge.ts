import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { handleFetchBooks } from "../../store/actions/manager";

declare var window: any;

let isApplyingFromMobile = false;
let isInitialized = false;

/**
 * Normalize a timestamp to milliseconds.
 * Kookit engine records timestamps in seconds (10-digit), while mobile and
 * standard JS use milliseconds (13-digit). This mismatch caused all desktop
 * progress updates to be silently discarded by the conflict-resolution logic.
 */
function normalizeTimestamp(ts: number | undefined): number {
  if (!ts) return Date.now();
  // If the timestamp looks like seconds (≤ 2099-01-01 in seconds = 4070908800),
  // convert it to milliseconds
  if (ts < 1e11) return ts * 1000;
  return ts;
}

/**
 * Two-way Progress Synchronization Bridge
 * Connects desktop renderer (localStorage via ConfigService) with Electron main process store.
 */
export function initProgressSyncBridge(storeInstance?: any) {
  if (isInitialized) return;
  isInitialized = true;

  // 1. Hook ConfigService.setObjectConfig so ALL desktop readers automatically sync progress to main
  const originalSetObjectConfig = ConfigService.setObjectConfig;
  ConfigService.setObjectConfig = function (
    key: string,
    val: any,
    name: string,
    ...rest: any[]
  ) {
    const recordToSave =
      name === "recordLocation" && !isApplyingFromMobile
        ? {
            ...(val || {}),
            // Always use millisecond timestamps — normalize in case Kookit
            // engine wrote a second-resolution timestamp (10-digit integer)
            timestamp: normalizeTimestamp(val?.timestamp),
          }
        : val;

    originalSetObjectConfig.call(this, key, recordToSave, name, ...rest);

    if (name === "recordLocation" && !isApplyingFromMobile && window.electronAPI?.invoke) {
      window.electronAPI
        .invoke("mobile-sync-progress", {
          bookKey: key,
          record: recordToSave,
        })
        .catch((err: any) => {
          console.warn("[ProgressSyncBridge] Error syncing progress to main:", err);
        });
    }
  };

  const syncBlurredBooksToMain = (list?: any) => {
    try {
      if (window.electronAPI?.invoke) {
        const blurred =
          list !== undefined
            ? list
            : ConfigService.getAllListConfig("blurredBooks") || [];
        window.electronAPI
          .invoke("mobile-sync-blurred-books", blurred)
          .catch((err: any) => {
            console.warn("[ProgressSyncBridge] Error syncing blurredBooks to main:", err);
          });
      }
    } catch (e) {
      console.warn("[ProgressSyncBridge] Error calling mobile-sync-blurred-books:", e);
    }
  };

  let shelfSyncTimer: any = null;
  const syncShelvesToMain = () => {
    if (shelfSyncTimer) clearTimeout(shelfSyncTimer);
    shelfSyncTimer = setTimeout(() => {
      try {
        if (window.electronAPI?.invoke) {
          const shelfList = ConfigService.getAllMapConfig("shelfList") || {};
          const sortedShelfList =
            ConfigService.getAllListConfig("sortedShelfList") || [];
          window.electronAPI
            .invoke("mobile-sync-shelves", { shelfList, sortedShelfList })
            .catch((err: any) => {
              console.warn(
                "[ProgressSyncBridge] Error syncing shelves to main:",
                err
              );
            });
        }
      } catch (e) {
        console.warn("[ProgressSyncBridge] Error calling mobile-sync-shelves:", e);
      }
    }, 200);
  };

  // 1b. Hook ConfigService list config methods so desktop blur and shelf modifications sync to main store
  const originalSetAllListConfig = ConfigService.setAllListConfig;
  ConfigService.setAllListConfig = function (
    list: any,
    name: string,
    ...rest: any[]
  ) {
    (originalSetAllListConfig as any).call(this, list, name, ...rest);
    if (name === "blurredBooks") {
      syncBlurredBooksToMain(list);
    }
    if (name === "sortedShelfList") {
      syncShelvesToMain();
    }
  };

  const originalSetListConfig = ConfigService.setListConfig;
  ConfigService.setListConfig = function (
    item: string,
    name: string,
    ...rest: any[]
  ) {
    (originalSetListConfig as any).call(this, item, name, ...rest);
    if (name === "blurredBooks") {
      syncBlurredBooksToMain();
    }
    if (name === "sortedShelfList") {
      syncShelvesToMain();
    }
  };

  const originalDeleteListConfig = ConfigService.deleteListConfig;
  ConfigService.deleteListConfig = function (
    item: string,
    name: string,
    ...rest: any[]
  ) {
    (originalDeleteListConfig as any).call(this, item, name, ...rest);
    if (name === "blurredBooks") {
      syncBlurredBooksToMain();
    }
    if (name === "sortedShelfList") {
      syncShelvesToMain();
    }
  };

  // 1c. Hook ConfigService map config methods so desktop shelf modifications sync to main store
  const originalSetMapConfig = ConfigService.setMapConfig;
  ConfigService.setMapConfig = function (
    key: string,
    val: any,
    name: string,
    ...rest: any[]
  ) {
    (originalSetMapConfig as any).call(this, key, val, name, ...rest);
    if (name === "shelfList") {
      syncShelvesToMain();
    }
  };

  const originalSetOneMapConfig = ConfigService.setOneMapConfig;
  ConfigService.setOneMapConfig = function (
    key: string,
    val: any,
    name: string,
    ...rest: any[]
  ) {
    (originalSetOneMapConfig as any).call(this, key, val, name, ...rest);
    if (name === "shelfList") {
      syncShelvesToMain();
    }
  };

  const originalSetAllMapConfig = ConfigService.setAllMapConfig;
  ConfigService.setAllMapConfig = function (
    map: any,
    name: string,
    ...rest: any[]
  ) {
    (originalSetAllMapConfig as any).call(this, map, name, ...rest);
    if (name === "shelfList") {
      syncShelvesToMain();
    }
  };

  const originalDeleteMapConfig = ConfigService.deleteMapConfig;
  ConfigService.deleteMapConfig = function (
    key: string,
    name: string,
    ...rest: any[]
  ) {
    (originalDeleteMapConfig as any).call(this, key, name, ...rest);
    if (name === "shelfList") {
      syncShelvesToMain();
    }
  };

  const originalDeleteFromMapConfig = ConfigService.deleteFromMapConfig;
  ConfigService.deleteFromMapConfig = function (
    key: string,
    val: any,
    name: string,
    ...rest: any[]
  ) {
    (originalDeleteFromMapConfig as any).call(this, key, val, name, ...rest);
    if (name === "shelfList") {
      syncShelvesToMain();
    }
  };

  if (!window.electronAPI) return;

  // Initial sync of blurred books and shelves to main store
  syncBlurredBooksToMain();
  syncShelvesToMain();

  // 2. Initial Bi-Directional Reconciliation with Main Process Store
  if (window.electronAPI.invoke) {
    try {
      // Normalize all desktop record timestamps before sending to main process,
      // so that the conflict-resolution comparison uses consistent units.
      const rawDesktopRecords = ConfigService.getAllObjectConfig("recordLocation");
      const allDesktopRecords: Record<string, any> = {};
      for (const [bookKey, rec] of Object.entries(rawDesktopRecords || {})) {
        if (!rec) continue;
        allDesktopRecords[bookKey] = {
          ...(rec as any),
          timestamp: normalizeTimestamp((rec as any).timestamp),
        };
      }

      window.electronAPI
        .invoke("mobile-sync-all-progress", allDesktopRecords)
        .then((res: any) => {
          if (res && res.newerRecords && Object.keys(res.newerRecords).length > 0) {
            console.info("[ProgressSyncBridge] Startup sync applying records:", Object.keys(res.newerRecords));
            isApplyingFromMobile = true;
            try {
              for (const [bookKey, newerRecord] of Object.entries(res.newerRecords)) {
                if (!newerRecord) continue;
                const existing = ConfigService.getObjectConfig(bookKey, "recordLocation", {});
                const nr = newerRecord as any;
                const merged: any = {
                  ...existing,
                  ...nr,
                  timestamp: normalizeTimestamp(nr.timestamp),
                };
                // Only clear CFI/xpath if the mobile record has actual position context
                // (chapterDocIndex or text). If it only has percentage, preserve them
                // so that desktop can attempt a more accurate restore.
                if (nr.chapterDocIndex !== undefined || nr.text) {
                  merged.cfi = "";
                  merged.xpath = "";
                }
                // Preserve paragraph-level fields from mobile record
                if (nr.text) merged.text = nr.text;
                if (nr.count !== undefined) merged.count = String(nr.count);
                if (nr.chapterDocIndex !== undefined) merged.chapterDocIndex = String(nr.chapterDocIndex);
                if (nr.chapterHref) {
                  merged.chapterHref =
                    typeof nr.chapterHref === "object"
                      ? nr.chapterHref.name || ""
                      : String(nr.chapterHref);
                }

                originalSetObjectConfig.call(
                  ConfigService,
                  bookKey,
                  merged,
                  "recordLocation"
                );
              }
            } finally {
              isApplyingFromMobile = false;
            }

            window.dispatchEvent(
              new CustomEvent("koodo-progress-synced", {
                detail: { newerRecords: res.newerRecords },
              })
            );

            if (storeInstance && storeInstance.dispatch) {
              storeInstance.dispatch(handleFetchBooks() as any);
            }
          }
        })
        .catch((err: any) => {
          console.warn("[ProgressSyncBridge] Error during initial progress sync:", err);
        });
    } catch (e) {
      console.warn("[ProgressSyncBridge] Startup sync error:", e);
    }
  }

  // 3. Live Sync Listener from Mobile
  if (window.electronAPI.on) {
    window.electronAPI.on("mobile-progress-updated", (arg1: any, arg2: any) => {
      const data = arg1 && arg1.bookKey ? arg1 : arg2 && arg2.bookKey ? arg2 : arg1;
      if (!data || !data.bookKey || !data.record) return;
      const { bookKey, record } = data;
      console.info("[ProgressSyncBridge] Live progress received:", bookKey, record.percentage, record.chapterTitle);
      const existing = ConfigService.getObjectConfig(bookKey, "recordLocation", {});

      const incomingTime = normalizeTimestamp(record.timestamp);
      const existingTime = normalizeTimestamp(existing?.timestamp);
      if (existing && existingTime > incomingTime) {
        console.info("[ProgressSyncBridge] Desktop is newer, skipping mobile update:", bookKey);
        return; // existing desktop is strictly newer
      }

      const merged: any = {
        ...existing,
        page: String(record.page || existing.page || 1),
        percentage: String(record.percentage !== undefined ? record.percentage : existing.percentage || 0),
        chapterTitle: record.chapterTitle || existing.chapterTitle || "",
        timestamp: incomingTime,
      };

      // Preserve paragraph-level fields from mobile record when available;
      // only fall back to desktop values when mobile didn't send them.
      if (record.text) {
        merged.text = record.text;
      }
      if (record.count !== undefined) {
        merged.count = String(record.count);
      } else {
        merged.count = String(record.totalPages || existing.count || 1);
      }
      if (record.chapterDocIndex !== undefined) {
        merged.chapterDocIndex = String(record.chapterDocIndex);
      }
      if (record.chapterHref) {
        merged.chapterHref =
          typeof record.chapterHref === "object"
            ? record.chapterHref.name || ""
            : String(record.chapterHref);
      }

      // Clear stale desktop CFI/xpath only when mobile provided position context,
      // so that the desktop reader can use paragraph-level restoration
      merged.cfi = "";
      merged.xpath = "";

      isApplyingFromMobile = true;
      try {
        originalSetObjectConfig.call(ConfigService, bookKey, merged, "recordLocation");
      } finally {
        isApplyingFromMobile = false;
      }

      window.dispatchEvent(
        new CustomEvent("koodo-progress-synced", {
          detail: { bookKey, record: merged },
        })
      );

      // Refresh bookshelf UI with the new progress
      if (storeInstance && storeInstance.dispatch) {
        storeInstance.dispatch(handleFetchBooks() as any);
      }
    });
  }
}
