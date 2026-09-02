const path = require("path");
const fs = require("fs");
const { spawn, execSync } = require("child_process");
const { app, session } = require("electron");

const SCRIPT_PATH = path.join(__dirname, "jm_bridge.py");
const activeDownloadProcesses = new Map();

/**
 * Resolve python executable path
 */
function resolvePythonPath(customPythonPath) {
  if (
    customPythonPath &&
    typeof customPythonPath === "string" &&
    customPythonPath.trim()
  ) {
    const trimmed = customPythonPath.trim();
    if (fs.existsSync(trimmed)) {
      return trimmed;
    }
  }

  if (process.env.PYTHON && fs.existsSync(process.env.PYTHON)) {
    return process.env.PYTHON;
  }

  if (process.platform === "win32") {
    // 1. Try finding via where.exe
    const lookupCommands = [
      "where.exe python",
      "where.exe py",
      "where.exe python3",
    ];
    for (const cmd of lookupCommands) {
      try {
        const stdout = execSync(cmd, {
          encoding: "utf-8",
          timeout: 2500,
          windowsHide: true,
        });
        const lines = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          if (line.toLowerCase().includes("windowsapps")) {
            try {
              if (fs.existsSync(line) && fs.statSync(line).size > 0) {
                return line;
              }
            } catch (e) {}
            continue;
          }
          if (fs.existsSync(line)) {
            return line;
          }
        }
      } catch (e) {}
    }

    // 2. Search common Windows directories
    const localAppData = process.env.LOCALAPPDATA || "";
    const appData = process.env.APPDATA || "";
    const userProfile = process.env.USERPROFILE || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const pyVersions = [
      "Python314",
      "Python313",
      "Python312",
      "Python311",
      "Python310",
      "Python39",
      "Python38",
    ];
    const candidates = [];

    for (const ver of pyVersions) {
      candidates.push(
        path.join(localAppData, "Programs", "Python", ver, "python.exe")
      );
      candidates.push(
        path.join(
          userProfile,
          "AppData",
          "Local",
          "Programs",
          "Python",
          ver,
          "python.exe"
        )
      );
      candidates.push(path.join(programFiles, "Python", ver, "python.exe"));
      candidates.push(path.join(programFiles, ver, "python.exe"));
      candidates.push(path.join(programFilesX86, "Python", ver, "python.exe"));
      candidates.push(path.join(programFilesX86, ver, "python.exe"));
      candidates.push(`C:\\${ver}\\python.exe`);
      candidates.push(`C:\\Program Files\\${ver}\\python.exe`);
    }

    // Common Conda / Scoop / Chocolatey paths
    candidates.push(
      path.join(userProfile, "miniconda3", "python.exe"),
      path.join(userProfile, "anaconda3", "python.exe"),
      path.join(localAppData, "miniconda3", "python.exe"),
      path.join(localAppData, "anaconda3", "python.exe"),
      "C:\\ProgramData\\miniconda3\\python.exe",
      "C:\\ProgramData\\anaconda3\\python.exe",
      path.join(userProfile, "scoop", "shims", "python.exe"),
      path.join(userProfile, "scoop", "apps", "python", "current", "python.exe"),
      "C:\\ProgramData\\chocolatey\\bin\\python.exe",
      "C:\\tools\\python3\\python.exe",
      "C:\\Windows\\py.exe"
    );

    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        return c;
      }
    }

    return "python";
  } else {
    // macOS / Linux lookup
    const lookupCommands = ["which python3", "which python"];
    for (const cmd of lookupCommands) {
      try {
        const stdout = execSync(cmd, { encoding: "utf-8", timeout: 2500 });
        const line = stdout.trim();
        if (line && fs.existsSync(line)) {
          return line;
        }
      } catch (e) {}
    }

    const unixCandidates = [
      "/usr/local/bin/python3",
      "/opt/homebrew/bin/python3",
      "/usr/bin/python3",
      path.join(process.env.HOME || "", ".pyenv", "shims", "python3"),
      path.join(process.env.HOME || "", "miniconda3", "bin", "python3"),
      path.join(process.env.HOME || "", "anaconda3", "bin", "python3"),
    ];

    for (const c of unixCandidates) {
      if (c && fs.existsSync(c)) {
        return c;
      }
    }

    return "python3";
  }
}

/**
 * Run bridge script command and return parsed JSON
 */
function runBridgeCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const pythonPath = resolvePythonPath(options.pythonPath);
    const cmdArgs = [SCRIPT_PATH, command, ...args];

    let timer = null;
    let isSettled = false;

    const safeResolve = (val) => {
      if (isSettled) return;
      isSettled = true;
      if (timer) clearTimeout(timer);
      resolve(val);
    };

    // 120s timeout
    timer = setTimeout(() => {
      safeResolve({
        code: 1,
        msg: `Command timed out after 120s: ${command}`,
        error: "TIMEOUT",
      });
    }, 120000);

    let child;
    try {
      child = spawn(pythonPath, cmdArgs, {
        cwd: path.dirname(SCRIPT_PATH),
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
      });
    } catch (spawnErr) {
      return safeResolve({
        code: 1,
        msg: `Failed to spawn Python process (${pythonPath}): ${spawnErr.message}`,
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
        msg: `Failed to spawn Python process (${pythonPath}): ${err.message}`,
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

/**
 * Initialize IPC handlers for JMComic
 */
function initJmcomicIpc(ipcMain, getMainWindow) {
  setupJmcomicImageProxy();

  // 1. Check environment
  ipcMain.handle("jmcomic-check-env", async (event, config = {}) => {
    return runBridgeCommand("check_env", [], config);
  });

  // 2. Install dependencies
  ipcMain.handle("jmcomic-install-deps", async (event, config = {}) => {
    return runBridgeCommand("install_deps", [], config);
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

    const args = [
      SCRIPT_PATH,
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

    const execPath = resolvePythonPath(pythonPath);
    const child = spawn(execPath, args, {
      cwd: path.dirname(SCRIPT_PATH),
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
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
  resolvePythonPath,
  setupJmcomicImageProxy,
};

