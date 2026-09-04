const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { app, session } = require("electron");
const {
  BRIDGE_SCRIPT: SCRIPT_PATH,
  resolveJmcomicRuntime,
  runtimeEnvironment,
  runtimeUnavailableResult,
} = require("./runtime");

const activeDownloadProcesses = new Map();

function getRuntime(options = {}) {
  return resolveJmcomicRuntime(options, {
    isPackaged: app.isPackaged || __dirname.toLowerCase().includes("app.asar"),
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  });
}

/**
 * Run bridge script command and return parsed JSON
 */
function runBridgeCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const runtime = getRuntime(options);
    if (!runtime.available) {
      resolve(runtimeUnavailableResult(runtime));
      return;
    }
    const cmdArgs = [...runtime.prefixArgs, command, ...args];

    let timer = null;
    let child = null;
    let isSettled = false;

    const safeResolve = (val) => {
      if (isSettled) return;
      isSettled = true;
      if (timer) clearTimeout(timer);
      resolve(val);
    };

    // 120s timeout
    timer = setTimeout(() => {
      if (child && !child.killed) child.kill();
      safeResolve({
        code: 1,
        msg: `Command timed out after 120s: ${command}`,
        error: "TIMEOUT",
      });
    }, 120000);

    try {
      child = spawn(runtime.executable, cmdArgs, {
        cwd: runtime.cwd,
        env: runtimeEnvironment(runtime),
        windowsHide: true,
      });
    } catch (spawnErr) {
      return safeResolve({
        code: 1,
        msg: `Failed to spawn JMComic runtime (${runtime.executable}): ${spawnErr.message}`,
        error: spawnErr.message,
      });
    }

    let stdoutData = "";
    let stderrData = "";

    child.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk) => {
      stderrData += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      safeResolve({
        code: 1,
        msg: `Failed to spawn JMComic runtime (${runtime.executable}): ${err.message}`,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      if (stdoutData.trim()) {
        const lines = stdoutData.trim().split("\n");
        let lastJson = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith("{") && line.endsWith("}")) {
            try {
              lastJson = JSON.parse(line);
              break;
            } catch (e) {}
          }
        }
        if (lastJson) {
          return safeResolve(lastJson);
        }
      }

      if (code !== 0) {
        safeResolve({
          code: 1,
          msg: stderrData.trim() || `Command failed with exit code ${code}`,
          raw: stdoutData,
        });
      } else {
        safeResolve({
          code: 0,
          msg: "ok",
          raw: stdoutData,
        });
      }
    });
  });
}

function installSourceEnvironment(options = {}) {
  if (app.isPackaged || __dirname.toLowerCase().includes("app.asar")) {
    return runBridgeCommand("check_env", [], options).then((status) => ({
      code: status.code,
      msg:
        status.code === 0
          ? "Bundled JMComic sidecar is ready."
          : status.msg,
      data:
        status.code === 0
          ? "Packaged mode uses the bundled, immutable JMComic sidecar."
          : status.msg,
    }));
  }

  return new Promise((resolve) => {
    const setupScript = path.resolve(__dirname, "..", "setup-python.js");
    const args = [setupScript, "--json"];
    if (typeof options.pythonPath === "string" && options.pythonPath.trim()) {
      args.push("--python", options.pythonPath.trim());
    }

    const child = spawn(process.execPath, args, {
      cwd: path.resolve(__dirname, "..", ".."),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let isSettled = false;
    const safeResolve = (result) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      safeResolve({
        code: 1,
        msg: "Project Python environment setup timed out after 10 minutes.",
        data: stderr || stdout,
      });
    }, 10 * 60 * 1000);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      safeResolve({ code: 1, msg: error.message, data: stderr || stdout });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      const lines = output.split(/\r?\n/).filter(Boolean);
      const resultLine = [...lines]
        .reverse()
        .find((line) => line.trim().startsWith("{"));
      try {
        safeResolve(JSON.parse(resultLine));
      } catch {
        safeResolve({
          code: code === 0 ? 0 : 1,
          msg:
            code === 0
              ? "Project Python environment is ready."
              : "Project Python environment setup failed.",
          data: output,
        });
      }
    });
  });
}
/**
 * Setup webRequest headers for 18comic images (bypass anti-hotlink)
 */
function setupJmcomicImageProxy() {
  const filter = {
    urls: [
      "*://*.18comic.vip/*",
      "*://*.18comic.org/*",
      "*://*.jmcomic.me/*",
      "*://*.jmcomic1.me/*",
      "*://*.jm-comic.org/*",
      "*://*.jm-comic.club/*",
      "*://*.jm-comic2.club/*",
      "*://*.jm-comic3.club/*",
      "*://*.jmapiproxy2.cc/*",
      "*://*.cdnhjk.net/*",
      "*://*.cdngwc.cc/*",
      "*://*.cdngwc.net/*",
      "*://*.cdngwc.club/*",
    ],
  };

  try {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      filter,
      (details, callback) => {
        const requestHeaders = { ...details.requestHeaders };
        requestHeaders["Referer"] = "https://18comic.vip/";
        requestHeaders["User-Agent"] =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        callback({ cancel: false, requestHeaders });
      }
    );
  } catch (err) {
    console.error("Failed to setup JMComic webRequest interceptor:", err);
  }
}

function initJmcomicIpc(ipcMain, getMainWindow) {
  setupJmcomicImageProxy();

  // 1. Check environment
  ipcMain.handle("jmcomic-check-env", async (event, config = {}) => {
    return runBridgeCommand("check_env", [], config);
  });

  // 2. Install dependencies
  ipcMain.handle("jmcomic-install-deps", async (event, config = {}) => {
    return installSourceEnvironment(config);
  });

  // 3. Get available domains
  ipcMain.handle("jmcomic-get-domains", async (event, config = {}) => {
    return runBridgeCommand("get_domains", [], config);
  });

  // 4. Search
  ipcMain.handle("jmcomic-search", async (event, params = {}) => {
    const args = [];
    if (params.query) args.push("--query", params.query);
    if (params.page) args.push("--page", String(params.page));
    if (params.order) args.push("--order", params.order);
    if (params.time) args.push("--time", params.time);
    if (params.category) args.push("--category", params.category);
    if (params.mainTag !== undefined && params.mainTag !== null) {
      args.push("--main_tag", String(params.mainTag));
    }
    if (params.proxy) args.push("--proxy", params.proxy);
    if (params.domain) args.push("--domain", params.domain);

    return runBridgeCommand("search", args, params);
  });

  // 5. Rank
  ipcMain.handle("jmcomic-rank", async (event, params = {}) => {
    const args = [];
    if (params.page) args.push("--page", String(params.page));
    if (params.time) args.push("--time", params.time);
    if (params.order) args.push("--order", params.order);
    if (params.category) args.push("--category", params.category);
    if (params.proxy) args.push("--proxy", params.proxy);
    if (params.domain) args.push("--domain", params.domain);

    return runBridgeCommand("rank", args, params);
  });

  // 6. Detail
  ipcMain.handle("jmcomic-detail", async (event, params = {}) => {
    const args = ["--album_id", String(params.albumId)];
    if (params.proxy) args.push("--proxy", params.proxy);
    if (params.domain) args.push("--domain", params.domain);

    return runBridgeCommand("detail", args, params);
  });

  // 7. Login
  ipcMain.handle("jmcomic-login", async (event, params = {}) => {
    const args = [
      "--username",
      String(params.username || ""),
      "--password",
      String(params.password || ""),
    ];
    if (params.proxy) args.push("--proxy", params.proxy);
    if (params.domain) args.push("--domain", params.domain);

    return runBridgeCommand("login", args, params);
  });

  // 8. Get favorites
  ipcMain.handle("jmcomic-get-favorites", async (event, params = {}) => {
    const args = [];
    if (params.folderId !== undefined && params.folderId !== null) {
      args.push("--folder_id", String(params.folderId));
    }
    if (params.page) args.push("--page", String(params.page));
    if (params.order) args.push("--order", params.order);
    if (params.cookies) {
      args.push(
        "--cookies",
        typeof params.cookies === "string"
          ? params.cookies
          : JSON.stringify(params.cookies)
      );
    }
    if (params.username) args.push("--username", params.username);
    if (params.password) args.push("--password", params.password);
    if (params.proxy) args.push("--proxy", params.proxy);
    if (params.domain) args.push("--domain", params.domain);

    return runBridgeCommand("favorites", args, params);
  });

  // 9. Toggle favorite
  ipcMain.handle("jmcomic-toggle-favorite", async (event, params = {}) => {
    const args = ["--album_id", String(params.albumId)];
    if (params.folderId !== undefined && params.folderId !== null) {
      args.push("--folder_id", String(params.folderId));
    }
    if (params.cookies) {
      args.push(
        "--cookies",
        typeof params.cookies === "string"
          ? params.cookies
          : JSON.stringify(params.cookies)
      );
    }
    if (params.username) args.push("--username", params.username);
    if (params.password) args.push("--password", params.password);
    if (params.proxy) args.push("--proxy", params.proxy);
    if (params.domain) args.push("--domain", params.domain);

    return runBridgeCommand("toggle_favorite", args, params);
  });

  // 7. Download with streaming progress
  ipcMain.handle("jmcomic-download", async (event, params = {}) => {
    const {
      albumId,
      photoIds = [],
      outputDir,
      combine = true,
      threads = 5,
      proxy,
      domain,
      pythonPath,
    } = params;

    const taskId = String(albumId);
    if (activeDownloadProcesses.has(taskId)) {
      return { code: 1, msg: "Download already in progress for this album" };
    }

    const defaultOutputDir =
      outputDir || path.join(app.getPath("downloads"), "KoodoReader_Comics");
    if (!fs.existsSync(defaultOutputDir)) {
      fs.mkdirSync(defaultOutputDir, { recursive: true });
    }

    const runtime = getRuntime({ pythonPath });
    if (!runtime.available) {
      return runtimeUnavailableResult(runtime);
    }

    const args = [
      ...runtime.prefixArgs,
      "download",
      "--album_id",
      String(albumId),
      "--output_dir",
      defaultOutputDir,
      "--combine",
      combine ? "true" : "false",
      "--threads",
      String(threads),
    ];

    if (photoIds && photoIds.length > 0) {
      args.push("--photo_ids", photoIds.join(","));
    }
    if (proxy) args.push("--proxy", proxy);
    if (domain) args.push("--domain", domain);

    const child = spawn(runtime.executable, args, {
      cwd: runtime.cwd,
      env: runtimeEnvironment(runtime),
      windowsHide: true,
    });

    activeDownloadProcesses.set(taskId, child);

    let lineBuffer = "";
    let finishResult = null;

    child.stdout.on("data", (chunk) => {
      lineBuffer += chunk.toString("utf-8");
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith("PROGRESS:")) {
          try {
            const progressData = JSON.parse(line.substring(9));
            const win = getMainWindow ? getMainWindow() : null;
            if (win && !win.isDestroyed()) {
              win.webContents.send("jmcomic-download-progress", {
                albumId,
                ...progressData,
              });
            }
          } catch (e) {}
        } else if (line.startsWith("{") && line.endsWith("}")) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.event === "finish" || parsed.code === 0) {
              finishResult = parsed;
            }
          } catch (e) {}
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      console.error("[JMComic Download stderr]:", chunk.toString("utf-8"));
    });

    child.on("close", (code) => {
      activeDownloadProcesses.delete(taskId);
      const win = getMainWindow ? getMainWindow() : null;
      if (finishResult && finishResult.code === 0) {
        if (win && !win.isDestroyed()) {
          win.webContents.send("jmcomic-download-finish", {
            albumId,
            ...finishResult,
          });
        }
      } else {
        if (win && !win.isDestroyed()) {
          win.webContents.send("jmcomic-download-error", {
            albumId,
            msg: `Download process exited with code ${code}`,
          });
        }
      }
    });

    return { code: 0, msg: "Download started", taskId };
  });

  // 8. Cancel download
  ipcMain.handle("jmcomic-cancel-download", async (event, params = {}) => {
    const taskId = String(params.albumId || params.taskId);
    if (activeDownloadProcesses.has(taskId)) {
      const proc = activeDownloadProcesses.get(taskId);
      proc.kill("SIGTERM");
      activeDownloadProcesses.delete(taskId);
      return { code: 0, msg: "Download cancelled" };
    }
    return { code: 1, msg: "No active download found with that ID" };
  });
}

module.exports = {
  initJmcomicIpc,
  resolveJmcomicRuntime,
  setupJmcomicImageProxy,
};

