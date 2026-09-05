const path = require("path");
const fs = require("fs");
const { session } = require("electron");
const { PicaClient, ROUTE_HOSTS } = require("./picaClient");
const { downloadComicPackage } = require("./picaPackager");

let defaultPicaClient = new PicaClient();
const activeDownloadTasks = new Map(); // comicId -> { cancel: Function }

/**
 * Configure Electron webRequest headers for PicACG media & images (anti-hotlink bypass)
 */
function setupPicaImageProxy() {
  const filter = {
    urls: [
      "*://*.picacomic.com/*",
      "*://*.cdnhjk.net/*",
      "*://*.manhuabika.com/*",
      "*://*.wikawika.xyz/*",
    ],
  };

  try {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      filter,
      (details, callback) => {
        const requestHeaders = { ...details.requestHeaders };
        requestHeaders["Referer"] = "https://picaapi.picacomic.com/";
        requestHeaders["User-Agent"] = "okhttp/3.8.1";
        requestHeaders["accept"] = "image/webp,image/apng,image/*,*/*;q=0.8";
        callback({ cancel: false, requestHeaders });
      }
    );
  } catch (err) {
    console.error("Failed to setup PicACG webRequest interceptor:", err);
  }
}

/**
 * Initialize all IPC channels for PicACG
 */
function initPicaIpc(ipcMain, getMainWindow) {
  setupPicaImageProxy();

  // 1. Update client configuration (proxy, route, quality, token)
  ipcMain.handle("pica-update-config", async (event, config = {}) => {
    try {
      defaultPicaClient.updateConfig(config);
      if (config.token) {
        defaultPicaClient.setToken(config.token);
      }
      return { code: 200, msg: "Config updated" };
    } catch (err) {
      return { code: 500, error: err.message };
    }
  });

  // 2. Test route latency / connectivity
  ipcMain.handle("pica-test-route", async (event, params = {}) => {
    const route = params.route || "route1";
    const tempClient = new PicaClient({
      route,
      proxy: params.proxy || defaultPicaClient.proxy,
      timeout: 10000,
    });
    const startTime = Date.now();
    try {
      const res = await tempClient.getCategories();
      const latency = Date.now() - startTime;
      if (res.code === 200) {
        return { code: 200, latency, success: true };
      }
      return { code: res.code, latency, error: res.message, success: false };
    } catch (err) {
      return { code: 500, latency: Date.now() - startTime, error: err.message, success: false };
    }
  });

  // 3. Login
  ipcMain.handle("pica-login", async (event, params = {}) => {
    const { username, password, remember = true, proxy, route } = params;
    if (proxy !== undefined || route) {
      defaultPicaClient.updateConfig({ proxy, route });
    }
    const res = await defaultPicaClient.signIn(username, password, remember);
    return res;
  });

  // 4. Get profile
  ipcMain.handle("pica-get-profile", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getProfile();
  });

  // 5. Get categories
  ipcMain.handle("pica-get-categories", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getCategories();
  });

  // 6. Get comics list with filters
  ipcMain.handle("pica-get-comics", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getComics(params);
  });

  // 7. Search comics
  ipcMain.handle("pica-search", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.search(params);
  });

  // 8. Get Leaderboard
  ipcMain.handle("pica-get-leaderboard", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getLeaderboard(params);
  });

  // 9. Get Random
  ipcMain.handle("pica-get-random", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getRandom();
  });

  // 10. Comic Detail
  ipcMain.handle("pica-get-detail", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getComicDetail(params.comicId);
  });

  // 11. Comic Episodes
  ipcMain.handle("pica-get-episodes", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getEpisodes(params.comicId, params.page || 1);
  });

  // 12. Episode Pages
  ipcMain.handle("pica-get-pages", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getEpisodePages(params.comicId, params.order, params.page || 1);
  });

  // 13. User Favorites
  ipcMain.handle("pica-get-favorites", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.getFavorites(params.page || 1, params.sort || "dd");
  });

  // 14. Toggle Favorite
  ipcMain.handle("pica-toggle-favorite", async (event, params = {}) => {
    if (params && params.token) defaultPicaClient.setToken(params.token);
    return defaultPicaClient.toggleFavorite(params.comicId);
  });

  // 15. Download comic chapters with streaming progress
  ipcMain.handle("pica-download", async (event, params = {}) => {
    const {
      comicId,
      selectedEpOrders = [],
      combineCbz = true,
      outputDir,
      threads = 3,
      delayMs = 200,
      proxy,
      route,
      quality,
      token,
    } = params;

    const taskId = String(comicId);
    if (activeDownloadTasks.has(taskId)) {
      return { code: 1, msg: "Download already in progress for this comic" };
    }

    if (proxy !== undefined || route || quality || token) {
      defaultPicaClient.updateConfig({ proxy, route, quality, token });
    }

    let cancelled = false;
    activeDownloadTasks.set(taskId, {
      cancel: () => {
        cancelled = true;
      },
    });

    // Run packaging asynchronously
    (async () => {
      try {
        const result = await downloadComicPackage({
          client: defaultPicaClient,
          comicId,
          selectedEpOrders,
          combineCbz,
          outputDir,
          threads,
          delayMs,
          onProgress: (progressData) => {
            const win = getMainWindow ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
              win.webContents.send("pica-download-progress", {
                comicId,
                ...progressData,
              });
            }
          },
          isCancelled: () => cancelled,
        });

        activeDownloadTasks.delete(taskId);
        if (cancelled) {
          return;
        }
        const win = getMainWindow ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
          win.webContents.send("pica-download-finish", {
            comicId,
            ...result,
          });
        }
      } catch (err) {
        activeDownloadTasks.delete(taskId);
        const isUserCancel = cancelled || err.message === "Download cancelled by user";
        const win = getMainWindow ? getMainWindow() : null;
        if (win && !win.isDestroyed()) {
          win.webContents.send("pica-download-error", {
            comicId,
            msg: err.message,
            cancelled: isUserCancel,
          });
        }
      }
    })();

    return { code: 0, msg: "Download started", taskId };
  });

  // 16. Cancel active download
  ipcMain.handle("pica-cancel-download", async (event, params = {}) => {
    const taskId = String(params.comicId || params.taskId);
    if (activeDownloadTasks.has(taskId)) {
      const task = activeDownloadTasks.get(taskId);
      if (task.cancel) task.cancel();
      activeDownloadTasks.delete(taskId);
      return { code: 0, msg: "Download cancelled" };
    }
    return { code: 1, msg: "No active download found with that ID" };
  });
}

module.exports = {
  initPicaIpc,
  setupPicaImageProxy,
  defaultPicaClient,
};
