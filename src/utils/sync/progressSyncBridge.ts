import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { handleFetchBooks } from "../../store/actions/manager";

declare var window: any;

let isApplyingFromMobile = false;
let isInitialized = false;

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
            timestamp: val?.timestamp || Date.now(),
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

  // 1b. Hook ConfigService list config methods so desktop blur modifications sync to main store
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
  };

  if (!window.electronAPI) return;

  // Initial sync of blurred books list to main store
  syncBlurredBooksToMain();

  // 2. Initial Bi-Directional Reconciliation with Main Process Store
  if (window.electronAPI.invoke) {
    try {
      const allDesktopRecords = ConfigService.getAllObjectConfig("recordLocation");
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
                const merged = {
                  ...existing,
                  ...(newerRecord as any),
                  timestamp: (newerRecord as any).timestamp || Date.now(),
                  // Clear stale desktop CFI and xpath so desktop opens at the mobile position
                  cfi: "",
                  xpath: "",
                  text: "",
                };
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

      const incomingTime = record.timestamp || Date.now();
      if (existing && existing.timestamp && existing.timestamp > incomingTime) {
        return; // existing desktop is strictly newer
      }

      const merged = {
        ...existing,
        page: String(record.page || existing.page || 1),
        percentage: String(record.percentage !== undefined ? record.percentage : existing.percentage || 0),
        count: String(record.count || record.totalPages || existing.count || 1),
        chapterTitle: record.chapterTitle || existing.chapterTitle || "",
        timestamp: incomingTime,
        // Clear stale desktop CFI and xpath so desktop opens at the mobile position
        cfi: "",
        xpath: "",
        text: "",
      };
      if (record.chapterDocIndex !== undefined) {
        merged.chapterDocIndex = String(record.chapterDocIndex);
      }

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
