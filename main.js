const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  dialog,
  powerSaveBlocker,
  nativeTheme: electronNativeTheme,
  screen,
  systemPreferences,
  shell,
  clipboard,
  net,
  session,
} = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");
const isPackagedRuntime =
  app.isPackaged || path.extname(__dirname).toLowerCase() === ".asar";
const isDev = !isPackagedRuntime;
const personalDataDir = path.join(
  app.getPath("appData"),
  isDev ? "KoodoReaderPersonal-dev" : "KoodoReaderPersonal"
);
app.setPath("userData", personalDataDir);
const Store = require("electron-store");
const log = require("electron-log/main");
const os = require("os");
const { execFile } = require("child_process");
const store = new Store();
const fs = require("fs");
const fsExtra = require("fs-extra");
const nodeCrypto = require("crypto");
const yazl = require("yazl");
const yauzl = require("yauzl");
const Database = require("better-sqlite3");
const { getVoicePlugin } = require("./src/utils/plugins/main/registry");
const { initJmcomicIpc } = require("./scripts/jmcomic/jmcomicManager");
const { initPicaIpc } = require("./scripts/pica/picaManager");
const { mobileServer } = require("./scripts/mobile/mobileServer");
const { registerBookshelfRoutes } = require("./scripts/mobile/bookshelfRouter");
const { registerComicStreamerRoutes } = require("./scripts/mobile/comicStreamer");
const { registerNovelStreamerRoutes } = require("./scripts/mobile/novelStreamer");
const { registerProgressSyncRoutes } = require("./scripts/mobile/progressSyncRouter");
const configDir = app.getPath("userData");
const dirPath = path.join(configDir, "uploads");
const packageJson = require("./package.json");

const resolveStorage = () => {
  const stored = store.get("storageLocation");
  if (stored && fs.existsSync(stored)) return stored;
  const defaultPath = path.join(dirPath, "data");
  if (fs.existsSync(path.join(defaultPath, "config", "books.db"))) {
    return defaultPath;
  }
  try {
    const appData = app.getPath("appData");
    const prodData = path.join(appData, "KoodoReaderPersonal", "uploads", "data");
    if (fs.existsSync(path.join(prodData, "config", "books.db"))) {
      return prodData;
    }
    const legacyData = path.join(appData, "koodo-reader", "uploads", "data");
    if (fs.existsSync(path.join(legacyData, "config", "books.db"))) {
      return legacyData;
    }
  } catch (e) {}
  return defaultPath;
};

const initMobileServer = () => {
  try {
    let mobileToken = store.get("mobileCompanionToken");
    if (!mobileToken) {
      mobileToken = nodeCrypto.randomBytes(16).toString("hex");
      store.set("mobileCompanionToken", mobileToken);
    }

    const mobileContext = {
      getStoragePath: resolveStorage,
      getStore: () => store,
      getDb: () => {
        if (dbConnection && dbConnection["books"]) {
          return dbConnection["books"];
        }
        const sPath = resolveStorage();
        const dbPath = path.join(sPath, "config", "books.db");
        if (!fs.existsSync(dbPath)) return null;
        try {
          return getDBConnection("books", sPath, {
            createTableStatement: {
              books:
                "CREATE TABLE IF NOT EXISTS books (key text PRIMARY KEY, name text, author text, description text, md5 text, cover text, format text, publisher text, size integer, page integer, path text, charset text);",
            },
            migrateStatement: {},
          });
        } catch (e) {
          return new Database(dbPath, { readonly: true });
        }
      },
      onProgressUpdated: (bookKey, record) => {
        try {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send("mobile-progress-updated", { bookKey, record });
            }
          });
        } catch (e) {
          console.warn("[MobileServer] Error sending IPC progress notification:", e.message);
        }
      },
    };

    // Register Bookshelf API routes
    registerBookshelfRoutes(mobileServer, mobileContext);

    // Register Comic Streamer routes
    registerComicStreamerRoutes(mobileServer, mobileContext);

    // Register Novel Streamer routes
    registerNovelStreamerRoutes(mobileServer, mobileContext);

    // Register Two-Way Progress Sync routes
    registerProgressSyncRoutes(mobileServer, mobileContext);

    const isEnable = store.get("isEnableMobileCompanion");
    if (isEnable !== "no") {
      mobileServer
        .start({
          token: mobileToken,
          selectedAddress: store.get("mobileSelectedAddress") || null,
        })
        .then((status) => {
          console.info(`[MobileServer] Running at ${status.connectionUrl}`);
        })
        .catch((err) => {
          console.warn("[MobileServer] Failed to auto-start:", err.message);
        });
    }
  } catch (err) {
    console.error("[MobileServer] Init error:", err.message);
  }
};
let mainWin;
let tray = null;
let isQuitting = false;
let readerWindow;
let readerWindowList = [];
let dictWindow;
let transWindow;
let linkWindow;
let mainView;
//multi tab
// let mainViewList = []
let readerWindowReadyToClose = false;
let chatWindow;
let dbConnection = {};
let syncUtilCache = {};
let pickerUtilCache = {};
let downloadRequest = null;
let downloadFile = null;
let downloadFilePath = null;
const activeStoragePaths = new Set();

const closeAllDatabases = () => {
  for (const dbName of Object.keys(dbConnection)) {
    try {
      const db = dbConnection[dbName];
      if (db && typeof db.close === "function") {
        try {
          db.pragma("wal_checkpoint(TRUNCATE)");
        } catch (checkpointErr) {
          console.warn(`WAL checkpoint failed for ${dbName}:`, checkpointErr.message);
        }
        db.close();
      }
    } catch (err) {
      console.error(`Failed to close database ${dbName}:`, err.message);
    }
  }
  dbConnection = {};
};

const createPreUpdateBackup = (currentVersion) => {
  try {
    const backupBaseDir = path.join(configDir, "backups");
    if (!fs.existsSync(backupBaseDir)) {
      fs.mkdirSync(backupBaseDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetDir = path.join(
      backupBaseDir,
      `pre-update-v${currentVersion || "unknown"}-${timestamp}`
    );
    fs.mkdirSync(targetDir, { recursive: true });

    // 1. 备份各数据库存储路径下的 config 目录（包含所有的 *.db 文件）
    const pathsToBackup = new Set(activeStoragePaths);
    pathsToBackup.add(path.join(dirPath, "data"));

    for (const sPath of pathsToBackup) {
      const dbConfigDir = path.join(sPath, "config");
      if (fs.existsSync(dbConfigDir)) {
        const files = fs.readdirSync(dbConfigDir);
        for (const file of files) {
          if (file.endsWith(".db") || file.endsWith(".db-wal") || file.endsWith(".db-shm")) {
            const srcFile = path.join(dbConfigDir, file);
            const destFile = path.join(targetDir, file);
            fs.copyFileSync(srcFile, destFile);
          }
        }
      }
    }

    // 2. 备份应用基础配置 config.json (electron-store)
    const storeConfigFile = store.path;
    if (storeConfigFile && fs.existsSync(storeConfigFile)) {
      fs.copyFileSync(storeConfigFile, path.join(targetDir, "config.json"));
    }

    console.info("Pre-update backup created successfully at:", targetDir);

    // 3. 自动轮转清理：保留最近 5 份 pre-update-* 备份
    const allBackups = fs
      .readdirSync(backupBaseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("pre-update-"))
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(backupBaseDir, entry.name),
        time: fs.statSync(path.join(backupBaseDir, entry.name)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    if (allBackups.length > 5) {
      const toRemove = allBackups.slice(5);
      for (const item of toRemove) {
        fs.rmSync(item.fullPath, { recursive: true, force: true });
        console.info("Removed old pre-update backup:", item.name);
      }
    }
  } catch (err) {
    console.error("Failed to create pre-update backup:", err.message);
  }
};

const RESIZE_THROTTLE_MS = 300;

const throttle = (func, wait = RESIZE_THROTTLE_MS) => {
  let lastCall = 0;
  let timeoutId = null;
  return function (...args) {
    const now = Date.now();
    const invoke = () => {
      lastCall = Date.now();
      func.apply(this, args);
    };
    if (now - lastCall >= wait) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      invoke();
    } else if (!timeoutId) {
      timeoutId = setTimeout(
        () => {
          timeoutId = null;
          invoke();
        },
        wait - (now - lastCall)
      );
    }
  };
};
const getFingerprint = async () => {
  // First, try to get cached fingerprint
  let deviceUuid = store.get("fingerPrint");
  if (deviceUuid) {
    return deviceUuid;
  }

  // Try to get machine ID with additional error handling
  try {
    const { machineIdSync } = require("node-machine-id");
    let machineId = machineIdSync();
    if (machineId && typeof machineId === "string" && machineId.length > 0) {
      // Cache the machine ID for future use
      store.set("fingerPrint", machineId);
      return machineId;
    }
  } catch (error) {
    console.error("Failed to get machine ID:", error);
  }

  // Fallback: generate and cache a UUID
  let fingerprint = uuidv4().replace(/-/g, "");
  store.set("fingerPrint", fingerprint);
  return fingerprint;
};
const extractClixmlErrors = (text) => {
  if (!text) return "";
  const matches = text.match(
    /<S S="Error">([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]*>)*[^<]*)<\/S>/g
  );
  if (!matches) return text;
  return matches
    .map((m) =>
      m
        .replace(/<\/?S[^>]*>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/_x000D__x000A_/g, "\n")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
};

const runPowerShellScript = (script, timeout = 30000) => {
  return new Promise((resolve, reject) => {
    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ],
      {
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const rawMessage = (stderr || stdout || error.message || "").trim();
          const cleanMessage = extractClixmlErrors(rawMessage) || rawMessage;
          reject(new Error(cleanMessage));
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
};

const OCR_TEMP_DIR = path.join(configDir, "ocr-tmp");

// macOS OCR 二进制支持的语言（VNRecognizeTextRequest recognitionLanguages）
const MACOS_OCR_LANGS = new Set([
  "zh-Hans",
  "zh-Hant",
  "en-US",
  "ja-JP",
  "ko-KR",
  "fr-FR",
]);

// 把渲染进程传入的语言代码映射为各平台可识别的标签
// key: 应用内统一代码；value: { macos, win }
const OCR_LANG_MAP = {
  "zh-CN": { macos: "zh-Hans", win: "zh-Hans-CN" },
  "zh-SG": { macos: "zh-Hans", win: "zh-Hans-CN" },
  "zh-TW": { macos: "zh-Hant", win: "zh-Hant-TW" },
  "zh-HK": { macos: "zh-Hant", win: "zh-Hant-HK" },
  "zh-Hans": { macos: "zh-Hans", win: "zh-Hans-CN" },
  "zh-Hant": { macos: "zh-Hant", win: "zh-Hant-TW" },
  en: { macos: "en-US", win: "en-US" },
  "en-US": { macos: "en-US", win: "en-US" },
  "en-GB": { macos: "en-US", win: "en-GB" },
  ja: { macos: "ja-JP", win: "ja" },
  "ja-JP": { macos: "ja-JP", win: "ja" },
  ko: { macos: "ko-KR", win: "ko" },
  "ko-KR": { macos: "ko-KR", win: "ko" },
  fr: { macos: "fr-FR", win: "fr" },
  "fr-FR": { macos: "fr-FR", win: "fr" },
};

const resolveOcrLang = (lang) => {
  if (!lang || lang === "auto") return { macos: "auto", win: "auto" };
  return OCR_LANG_MAP[lang] || { macos: lang, win: lang };
};

// 从 base64 或 dataURL 中解析出 { buffer, ext }
const parseOcrImageInput = (input) => {
  if (typeof input !== "string" || !input) {
    throw new Error("Invalid image data");
  }
  // dataURL: data:image/png;base64,xxxx
  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const ext =
      dataUrlMatch[1].toLowerCase() === "jpeg"
        ? "jpg"
        : dataUrlMatch[1].toLowerCase();
    return { buffer: Buffer.from(dataUrlMatch[2], "base64"), ext };
  }
  // 纯 base64，按 PNG 处理
  return { buffer: Buffer.from(input, "base64"), ext: "png" };
};

const writeOcrTempImage = (buffer, ext) => {
  if (!fs.existsSync(OCR_TEMP_DIR)) {
    fs.mkdirSync(OCR_TEMP_DIR, { recursive: true });
  }
  const fileName = `ocr-${process.pid}-${Date.now()}.${ext}`;
  const filePath = path.join(OCR_TEMP_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

const cleanWindowsOcrText = (text) => {
  if (!text) return text;
  // Windows.Media.Ocr 对中日韩等无词边界的语言按"字"分词，Text 用空格连接，
  // 导致中文每字之间出现空格。循环去除 CJK 文字/全角标点之间的空格，
  // 保留英文与数字之间的空格。单次 replace 无法合并连续序列（如"符 号 学"），
  // 需循环直到无变化。
  //
  // CJK 范围用 Unicode 码点表示：
  //   一-龿   CJK 统一汉字（基本区）
  //   㐀-䶿   CJK 扩展 A 区
  //   ぀-ヿ   日文平假名 / 片假名
  //   가-힯   韩文谚文音节
  //   　-〿   CJK 符号与标点（全角空格、· 、。 等）
  //   ＀-￯   全角符号（全角字母数字、（） 等）
  const cjk =
    "\\u4e00-\\u9fbf\\u3400-\\u4dbf\\u3040-\\u30ff\\uac00-\\ud7af\\u3000-\\u303f\\uff00-\\uffef";
  const pattern = new RegExp("([" + cjk + "])\\s+([" + cjk + "])", "gu");
  let prev;
  let cur = text;
  do {
    prev = cur;
    cur = cur.replace(pattern, "$1$2");
  } while (cur !== prev);
  return cur;
};

// Windows: 通过 PowerShell 调用 Windows.Media.Ocr (WinRT)
const runWindowsOcr = (imagePath, winLang) => {
  // PowerShell 脚本里用单引号包裹路径，需转义内部单引号
  const escapePsSingle = (s) => s.replace(/'/g, "''");
  const escapedPath = escapePsSingle(imagePath);
  const langClause =
    winLang === "auto"
      ? "[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]::TryCreateFromUserProfileLanguages()"
      : "$( $__lang = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]::new('" +
        escapePsSingle(winLang) +
        "'); [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]::TryCreateFromLanguage($__lang) )";
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
function EncodeOut($prefix, $text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  Write-Output -NoEnumerate ($prefix + [Convert]::ToBase64String($bytes))
}
try {
  $path = '${escapedPath}'
  $file = Await ([Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = ${langClause}
  if ($null -eq $engine) { Write-Output 'LANGERR'; exit 0 }
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  EncodeOut 'OK' $result.Text
} catch {
  EncodeOut 'ERR' $_.Exception.Message
  exit 0
}
`;
  return runPowerShellScript(script, 60000).then((text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      throw new Error("Windows OCR returned empty result");
    }
    if (trimmed === "LANGERR") {
      const err = new Error(
        "Language package not installed! See: https://support.microsoft.com/help/17213"
      );
      err.code = "LANG_NOT_INSTALLED";
      throw err;
    }
    if (trimmed.startsWith("ERR")) {
      const msg = Buffer.from(trimmed.slice(3), "base64")
        .toString("utf8")
        .trim();
      throw new Error(msg || "Windows OCR failed");
    }
    if (trimmed.startsWith("OK")) {
      const b64 = trimmed.slice(2);
      const raw = b64 ? Buffer.from(b64, "base64").toString("utf8") : "";
      return cleanWindowsOcrText(raw);
    }
    throw new Error("Windows OCR returned unexpected output");
  });
};

// macOS: 调用打包的 Vision framework 二进制
const runMacosOcr = (imagePath, macosLang) => {
  const arch = process.arch; // arm64 / x64
  const archName =
    arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch;
  const binPath = isDev
    ? path.join(__dirname, "assets/macos/ocr-" + archName + "-apple-darwin")
    : path.join(
        process.resourcesPath,
        "assets/macos/ocr-" + archName + "-apple-darwin"
      );
  if (!fs.existsSync(binPath)) {
    const err = new Error("macOS OCR binary not found: " + binPath);
    err.code = "BIN_NOT_FOUND";
    throw err;
  }
  return new Promise((resolve, reject) => {
    execFile(
      binPath,
      [imagePath, macosLang],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = (stderr || error.message || "").trim();
          const err = new Error(msg || "macOS OCR failed");
          err.code = "BIN_FAILED";
          reject(err);
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
};

const getWindowHandleValue = (win) => {
  if (!win || typeof win.getNativeWindowHandle !== "function") {
    return "";
  }

  try {
    const handle = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(handle) || handle.length === 0) {
      return "";
    }

    if (handle.length >= 8 && typeof handle.readBigUInt64LE === "function") {
      return handle.readBigUInt64LE(0).toString();
    }

    return handle.readUInt32LE(0).toString();
  } catch (error) {
    console.warn("Failed to resolve native window handle:", error);
    return "";
  }
};

const loadUrlInAuxWindow = async (win, url) => {
  const wc = win.webContents;
  let currentUrl = "";
  try {
    currentUrl = wc.getURL();
  } catch (_) {
    currentUrl = "";
  }
  if (currentUrl === url) {
    wc.reload();
    return;
  }
  let needBlankIntermediate = false;
  try {
    const current = new URL(currentUrl);
    const next = new URL(url);
    // When only the hash differs, Chromium treats it as a same-page hashchange
    // and won't reload the page. Navigating through about:blank forces a full reload.
    needBlankIntermediate =
      current.origin === next.origin &&
      current.pathname === next.pathname &&
      current.search === next.search;
  } catch (_) {
    // ignore invalid URLs (e.g. empty string, about:blank)
  }
  if (needBlankIntermediate) {
    await wc.loadURL("about:blank");
  }
  await wc.loadURL(url);
};

const getWindowsHelloScript = (mode, message = "", hwnd = "") => {
  const escapedMessage = message.replace(/'/g, "''");
  const escapedHwnd = String(hwnd || "").replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Invoke-WinRtAsync {
  param(
    [Parameter(Mandatory = $true)] $Operation,
    [Parameter(Mandatory = $true)] [Type[]] $ResultTypes
  )

  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetGenericArguments().Count -eq $ResultTypes.Count -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

  if (-not $method) {
    throw 'Unable to bridge Windows Runtime async operation.'
  }

  $genericMethod = $method.MakeGenericMethod($ResultTypes)
  $task = $genericMethod.Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}

function Request-WindowsHelloVerification {
  param(
    [Parameter(Mandatory = $true)] [string] $Message,
    [string] $Hwnd
  )

  $isWindowInteropSupported = [Environment]::OSVersion.Version.Build -ge 22000 -and -not [string]::IsNullOrWhiteSpace($Hwnd)

  if (-not $isWindowInteropSupported) {
    return Invoke-WinRtAsync -Operation ($verifier::RequestVerificationAsync($Message)) -ResultTypes @([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace KoodoReaderInterop
{
    [ComImport]
    [Guid("39E050C3-4E74-441A-8DC0-B81104DF949C")]
    [InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
    public interface IUserConsentVerifierInterop
    {
        [return: MarshalAs(UnmanagedType.IInspectable)]
        object RequestVerificationForWindowAsync(
            IntPtr appWindow,
            [MarshalAs(UnmanagedType.HString)] string message,
            [In] ref Guid riid);
    }

    public static class UserConsentVerifierInteropHelper
    {
        public static object RequestVerificationForWindow(object activationFactory, long hwnd, string message, Guid riid)
        {
            IntPtr ptr = IntPtr.Zero;

            try
            {
                ptr = Marshal.GetIUnknownForObject(activationFactory);
                var interop = (IUserConsentVerifierInterop)Marshal.GetTypedObjectForIUnknown(ptr, typeof(IUserConsentVerifierInterop));
                return interop.RequestVerificationForWindowAsync(new IntPtr(hwnd), message, ref riid);
            }
            finally
            {
                if (ptr != IntPtr.Zero)
                {
                    Marshal.Release(ptr);
                }
            }
        }
    }
}
"@

  $activationFactory = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory($verifier)
  $asyncOperationGuid = [Guid]::Parse('fd596ffd-2318-558f-9dbe-d21df43764a5')
  $operation = [KoodoReaderInterop.UserConsentVerifierInteropHelper]::RequestVerificationForWindow($activationFactory, [Int64]::Parse($Hwnd), $Message, $asyncOperationGuid)
  return Invoke-WinRtAsync -Operation $operation -ResultTypes @([Windows.Security.Credentials.UI.UserConsentVerificationResult])
}

$verifier = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$availability = Invoke-WinRtAsync -Operation ($verifier::CheckAvailabilityAsync()) -ResultTypes @([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])

if ('${mode}' -eq 'check') {
  [Console]::Out.Write((@{
    available = ($availability.ToString() -eq 'Available')
    status = $availability.ToString()
  } | ConvertTo-Json -Compress))
  exit 0
}

if ($availability.ToString() -ne 'Available') {
  [Console]::Out.Write((@{
    success = $false
    code = 'Unavailable'
    status = $availability.ToString()
  } | ConvertTo-Json -Compress))
  exit 0
}

try {
  $result = Request-WindowsHelloVerification -Message '${escapedMessage}' -Hwnd '${escapedHwnd}'
  [Console]::Out.Write((@{
    success = ($result.ToString() -eq 'Verified')
    code = $result.ToString()
    status = $availability.ToString()
  } | ConvertTo-Json -Compress))
} catch {
  [Console]::Out.Write((@{
    success = $false
    code = 'Error'
    status = $_.Exception.Message
  } | ConvertTo-Json -Compress))
}
`.trim();
};

const getBiometricCapability = async () => {
  if (process.platform === "darwin") {
    const available =
      typeof systemPreferences.canPromptTouchID === "function" &&
      systemPreferences.canPromptTouchID();
    return {
      available,
      provider: "Touch ID",
      platform: process.platform,
      status: available ? "Available" : "Unavailable",
    };
  }

  if (process.platform === "win32") {
    try {
      const output = await runPowerShellScript(getWindowsHelloScript("check"));
      const result = output ? JSON.parse(output) : {};
      return {
        available: !!result.available,
        provider: "Windows Hello",
        platform: process.platform,
        status: result.status || "Unavailable",
      };
    } catch (error) {
      return {
        available: false,
        provider: "Windows Hello",
        platform: process.platform,
        status: "Error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    available: false,
    provider: "Biometric",
    platform: process.platform,
    status: "Unsupported",
  };
};

const promptBiometricAuth = async (
  promptMessage = "Authenticate",
  owningWindow = null
) => {
  if (process.platform === "darwin") {
    const available =
      typeof systemPreferences.canPromptTouchID === "function" &&
      systemPreferences.canPromptTouchID();
    if (!available) {
      return {
        success: false,
        code: "Unavailable",
        provider: "Touch ID",
      };
    }

    try {
      await systemPreferences.promptTouchID(promptMessage);
      return {
        success: true,
        code: "Verified",
        provider: "Touch ID",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        code: /cancel/i.test(message) ? "Canceled" : "Failed",
        provider: "Touch ID",
      };
    }
  }

  if (process.platform === "win32") {
    try {
      const hwnd = getWindowHandleValue(owningWindow);
      const output = await runPowerShellScript(
        getWindowsHelloScript("verify", promptMessage, hwnd),
        120000
      );
      const result = output ? JSON.parse(output) : {};
      return {
        success: !!result.success,
        code:
          result.code === "Unavailable" && result.status
            ? result.status
            : result.code || "Error",
        provider: "Windows Hello",
      };
    } catch (error) {
      console.error("Biometric verification error:", error.message);
      return {
        success: false,
        code: "Error",
        provider: "Windows Hello",
      };
    }
  }

  return {
    success: false,
    code: "Unsupported",
    provider: "Biometric",
  };
};

// Discord Rich Presence setup
let discordRPCClient = null;
let discordRPCReady = false;
let discordRPCConnecting = false;
const DISCORD_CLIENT_ID = "1490863275074781305"; // Koodo Reader Discord App ID

function initDiscordRPC() {
  if (discordRPCConnecting || discordRPCReady) return Promise.resolve();
  discordRPCConnecting = true;
  return new Promise((resolve) => {
    try {
      const DiscordRPC = require("discord-rpc");
      DiscordRPC.register(DISCORD_CLIENT_ID);
      const client = new DiscordRPC.Client({ transport: "ipc" });
      client.on("ready", () => {
        console.info("Discord RPC connected");
        discordRPCClient = client;
        discordRPCReady = true;
        discordRPCConnecting = false;
        resolve();
      });
      client.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
        console.warn("Discord RPC login failed:", err.message);
        discordRPCClient = null;
        discordRPCReady = false;
        discordRPCConnecting = false;
        resolve();
      });
    } catch (e) {
      console.warn("Discord RPC init failed:", e.message);
      discordRPCClient = null;
      discordRPCReady = false;
      discordRPCConnecting = false;
      resolve();
    }
  });
}
function destroyDiscordRPC() {
  if (discordRPCClient) {
    try {
      discordRPCClient.destroy();
    } catch (_) {}
    discordRPCClient = null;
  }
  discordRPCReady = false;
  discordRPCConnecting = false;
}
function buildProgressBar(percentage) {
  const total = 10;
  const filled = Math.round((percentage / 100) * total);
  const empty = total - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}
const singleInstance = app.requestSingleInstanceLock();
var filePath = null;
var pendingDeepLink = null;
if (process.platform != "darwin" && process.argv.length >= 2) {
  filePath = process.argv[1];
  // Check argv for a deep link URL (cold start)
  for (const arg of process.argv) {
    if (arg.startsWith("koodo-reader://")) {
      pendingDeepLink = arg;
      break;
    }
  }
}
log.transports.file.fileName = "debug.log";
log.transports.file.maxSize = 1024 * 1024; // 1MB
log.initialize();
store.set("appVersion", packageJson.version);
store.set("appPlatform", os.platform() + " " + os.release());
const mainWinDisplayScale = store.get("mainWinDisplayScale") || 1;
let options = {
  width: parseInt(store.get("mainWinWidth") || 1050) / mainWinDisplayScale,
  height: parseInt(store.get("mainWinHeight") || 660) / mainWinDisplayScale,
  x: parseInt(store.get("mainWinX")),
  y: parseInt(store.get("mainWinY")),
  backgroundColor:
    store.get("appSkin") === "night" ? "rgba(47, 52, 55, 1)" : "#fff",
  minWidth: 300,
  minHeight: 100,
  webPreferences: {
    webSecurity: !isDev,
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, "preload.js"),
    nativeWindowOpen: true,
    nodeIntegrationInSubFrames: false,
    allowRunningInsecureContent: false,
    enableRemoteModule: false,
    sandbox: true,
  },
};
const defaultAppIcon = isDev
  ? path.join(__dirname, "./public/assets/icon.png")
  : path.join(__dirname, "./build/assets/icon.png");
options.icon = defaultAppIcon;
// Single Instance Lock
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", (event, argv, workingDir) => {
    if (mainWin) {
      if (!mainWin.isVisible()) mainWin.show();
      mainWin.focus();
    }
    // Handle deep link passed via second-instance argv
    const deepLink = argv.find((arg) => arg.startsWith("koodo-reader://"));
    if (deepLink) {
      handleCallback(deepLink);
    }
    const kpackFile = argv.find(
      (arg) => typeof arg === "string" && arg.endsWith(".kpack")
    );
    if (kpackFile && mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send("open-share-package", kpackFile);
    }
  });
}
if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
  // Make sure the directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dirPath, "log.json"),
    JSON.stringify({ filePath }),
    "utf-8"
  );
}
const getDBConnection = (dbName, storagePath, sqlStatement) => {
  if (storagePath) {
    activeStoragePaths.add(storagePath);
  }
  if (!dbConnection[dbName]) {
    if (!fs.existsSync(path.join(storagePath, "config"))) {
      fs.mkdirSync(path.join(storagePath, "config"), { recursive: true });
    }
    dbConnection[dbName] = new Database(
      path.join(storagePath, "config", `${dbName}.db`),
      {}
    );
    dbConnection[dbName].pragma("journal_mode = WAL");
    dbConnection[dbName].exec(sqlStatement["createTableStatement"][dbName]);
    if (sqlStatement["migrateStatement"][dbName]) {
      let sqlList = sqlStatement["migrateStatement"][dbName];
      for (let sql of sqlList) {
        try {
          dbConnection[dbName].exec(sql);
        } catch (error) {}
      }
    }
  }
  return dbConnection[dbName];
};
const getSyncUtil = async (config, isUseCache = true) => {
  if (!isUseCache || !syncUtilCache[config.service]) {
    const { SyncUtil } = await import("./src/assets/lib/kookit-extra.min.mjs");
    syncUtilCache[config.service] = new SyncUtil(config.service, config);
  }
  return syncUtilCache[config.service];
};
const removeSyncUtil = (config) => {
  if (syncUtilCache[config.service]) {
    syncUtilCache[config.service].clearQueue();
    delete syncUtilCache[config.service];
  }
};
const getPickerUtil = async (config, isUseCache = true) => {
  if (!isUseCache || !pickerUtilCache[config.service]) {
    const { SyncUtil } = await import("./src/assets/lib/kookit-extra.min.mjs");
    pickerUtilCache[config.service] = new SyncUtil(config.service, config);
  }
  return pickerUtilCache[config.service];
};
const removePickerUtil = (config) => {
  if (pickerUtilCache[config.service]) {
    pickerUtilCache[config.service] = null;
  }
};
const getNativeThemeSource = (appSkin) => {
  if (appSkin === "night") {
    return "dark";
  }
  if (appSkin === "light") {
    return "light";
  }
  return "system";
};
const getNativeDarkColorStatus = () => {
  if (
    typeof electronNativeTheme.shouldUseDarkColorsForSystemIntegratedUI !==
    "undefined"
  ) {
    return electronNativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
  }
  return electronNativeTheme.shouldUseDarkColors;
};
const applyNativeThemeSource = (appSkin) => {
  if (process.type !== "browser") {
    return false;
  }
  electronNativeTheme.themeSource = getNativeThemeSource(appSkin);
  store.set("appSkin", appSkin || "system");
  return getNativeDarkColorStatus();
};
applyNativeThemeSource(store.get("appSkin"));
const buildProxyUrl = (config) => {
  const authentication =
    config.username || config.password
      ? `${encodeURIComponent(config.username || "")}:${encodeURIComponent(config.password || "")}@`
      : "";
  const portNumber = parseInt(config.port);
  return config.type === "socks5"
    ? `socks5://${authentication}${config.host}:${portNumber}`
    : `http://${authentication}${config.host}:${portNumber}`;
};
const applyProxyToSession = async () => {
  const { session } = require("electron");
  const http = require("http");
  const https = require("https");
  const config = store.get("proxyConfig");
  const defaultSession = session.defaultSession;
  const isEnabled =
    config && config.type !== "none" && config.enabled !== false && config.host;
  if (!isEnabled) {
    await defaultSession.setProxy({ mode: "direct" });
    https.globalAgent = new https.Agent();
    http.globalAgent = new http.Agent();
    return;
  }
  const proxyUrl = buildProxyUrl(config);
  let agent = null;
  try {
    if (config.type === "socks5") {
      const { SocksProxyAgent } = require("socks-proxy-agent");
      agent = new SocksProxyAgent(proxyUrl);
    } else {
      const { HttpsProxyAgent } = require("https-proxy-agent");
      agent = new HttpsProxyAgent(proxyUrl);
    }
  } catch (error) {
    agent = null;
  }
  const authentication = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password || "")}@`
    : "";
  if (config.type === "http") {
    const proxyAddress = `${authentication}${config.host}:${config.port}`;
    await defaultSession.setProxy({
      proxyRules: `http=${proxyAddress};https=${proxyAddress}`,
    });
  } else if (config.type === "socks5") {
    await defaultSession.setProxy({
      proxyRules: `socks5://${config.host}:${config.port}`,
    });
  }
  if (agent) {
    https.globalAgent = agent;
    http.globalAgent = agent;
  }
};
// Simple encryption function
const encrypt = (text, key) => {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return Buffer.from(result).toString("base64");
};

// Simple decryption function
const decrypt = (encryptedText, key) => {
  const buff = Buffer.from(encryptedText, "base64").toString();
  let result = "";
  for (let i = 0; i < buff.length; i++) {
    const charCode = buff.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return result;
};
// Helper to check if two rectangles intersect (for partial visibility)
const rectanglesIntersect = (rect1, rect2) => {
  return !(
    rect1.x + rect1.width <= rect2.x ||
    rect1.y + rect1.height <= rect2.y ||
    rect1.x >= rect2.x + rect2.width ||
    rect1.y >= rect2.y + rect2.height
  );
};

// Check if the window is at least partially visible on any display
const isWindowPartiallyVisible = (bounds) => {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    if (rectanglesIntersect(bounds, display.workArea)) {
      return true;
    }
  }
  return false;
};
const createTray = () => {
  let iconPath = isDev
    ? path.join(__dirname, "./public/assets/icon.png")
    : path.join(__dirname, "./build/assets/icon.png");
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (os.platform() === "darwin") {
    trayIcon = trayIcon.resize({ width: 16, height: 16, quality: "best" });
    trayIcon.setTemplateImage(false);
  }
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Koodo Reader Personal",
      click: () => {
        if (mainWin) {
          mainWin.show();
          mainWin.focus();
        }
      },
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Koodo Reader Personal");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWin) {
      mainWin.show();
      mainWin.focus();
    }
  });
};
const createMainWin = () => {
  const isMainWindVisible = isWindowPartiallyVisible({
    width: parseInt(store.get("mainWinWidth") || 1050) / mainWinDisplayScale,
    height: parseInt(store.get("mainWinHeight") || 660) / mainWinDisplayScale,
    x: parseInt(store.get("mainWinX")),
    y: parseInt(store.get("mainWinY")),
  });
  if (!isMainWindVisible) {
    delete options.x;
    delete options.y;
  }
  mainWin = new BrowserWindow(options);
  if (store.get("isAlwaysOnTop") === "yes") {
    mainWin.setAlwaysOnTop(true);
  }
  if (store.get("isAutoMaximizeWin") === "yes") {
    mainWin.maximize();
  }

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  const devPort = process.env.PORT || 3000;
  const urlLocation = isDev
    ? `http://localhost:${devPort}`
    : `file://${path.join(__dirname, "./build/index.html")}`;
  mainWin.loadURL(urlLocation);
  // Handle deep link on cold start: wait for renderer to mount its IPC listeners
  mainWin.webContents.once("did-finish-load", () => {
    if (pendingDeepLink) {
      const link = pendingDeepLink;
      pendingDeepLink = null;
      // Give React time to register ipcRenderer listeners before dispatching
      setTimeout(() => handleCallback(link), 1500);
    }
  });
  mainWin.on("close", (event) => {
    if (!isQuitting && store.get("isMinimizeToTray") === "yes") {
      event.preventDefault();
      mainWin.hide();
      if (!tray) {
        createTray();
      }
      return;
    }
    if (mainWin && !mainWin.isDestroyed()) {
      let bounds = mainWin.getBounds();
      const currentDisplay = screen.getDisplayMatching(bounds);
      const primaryDisplay = screen.getPrimaryDisplay();
      if (bounds.width > 300 && bounds.height > 100) {
        store.set({
          mainWinWidth: bounds.width,
          mainWinHeight: bounds.height,
          mainWinX: mainWin.isMaximized() ? 0 : bounds.x,
          mainWinY: mainWin.isMaximized() ? 0 : bounds.y,
          mainWinDisplayScale:
            currentDisplay.scaleFactor / primaryDisplay.scaleFactor,
        });
      }
    }
    mainWin = null;
  });
  const syncMainViewBounds = () => {
    if (mainView) {
      if (!mainWin) return;
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  };
  mainWin.on("resize", throttle(syncMainViewBounds));
  mainWin.on("maximize", () => {
    if (mainView) {
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  });
  mainWin.on("unmaximize", () => {
    if (mainView) {
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  });
  mainWin.on("focus", () => {
    if (mainView && !mainView.webContents.isDestroyed()) {
      mainView.webContents.focus();
    }
  });
  mainWin.webContents.on("console-message", (_event, level, message) => {
    const lvl =
      { 0: "info", 1: "info", 2: "warn", 3: "error" }[level] || "info";
    log[lvl](`[Renderer] ${message}`);
  });
  //cancel-download-app
  const normalizeFileData = (value) => {
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return value;
  };
  const runFileCommand = (args) => {
    if (!args || typeof args.operation !== "string") {
      throw new TypeError("Invalid file operation");
    }
    const operation = args.operation;
    const filePath = args.path === undefined ? undefined : args.path;
    switch (operation) {
      case "exists":
        return fs.existsSync(filePath);
      case "mkdir":
        return fs.mkdirSync(filePath, args.options || {});
      case "read":
      case "readFile":
        return fs.readFileSync(filePath, args.options);
      case "write":
        return fs.writeFileSync(
          filePath,
          normalizeFileData(args.data),
          args.options
        );
      case "append":
        return fs.appendFileSync(
          filePath,
          normalizeFileData(args.data),
          args.options
        );
      case "readdir": {
        const entries = fs.readdirSync(filePath, args.options || {});
        return args.options && args.options.withFileTypes
          ? entries.map((entry) => ({
              name: entry.name,
              isFile: entry.isFile(),
              isDirectory: entry.isDirectory(),
            }))
          : entries;
      }
      case "stat": {
        const stat = fs.statSync(filePath);
        return {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          isFile: stat.isFile(),
          isDirectory: stat.isDirectory(),
        };
      }
      case "unlink":
        return fs.unlinkSync(filePath);
      case "copyFile":
        return fs.copyFileSync(args.source, args.destination);
      case "rename":
        return fs.renameSync(args.source, args.destination);
      case "rm":
        return fs.rmSync(filePath, args.options || {});
      case "emptyDir":
        return fsExtra.emptyDirSync(filePath);
      case "copy":
        return fsExtra.copy(args.source, args.destination);
      default:
        throw new Error(`Unsupported file operation: ${operation}`);
    }
  };
  ipcMain.on("file-command-sync", (event, args) => {
    try {
      event.returnValue = { ok: true, value: runFileCommand(args) };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code:
            error && typeof error.code === "string" ? error.code : undefined,
        },
      };
    }
  });
  ipcMain.handle("file-command", async (event, args) => runFileCommand(args));
  ipcMain.on("node-command-sync", (event, args) => {
    try {
      if (!args || typeof args.operation !== "string") {
        throw new TypeError("Invalid Node operation");
      }
      const stringValue = (value) => {
        if (typeof value !== "string") {
          throw new TypeError("Invalid string argument");
        }
        return value;
      };
      const stringArgs = (values) => {
        if (
          !Array.isArray(values) ||
          values.some((value) => typeof value !== "string")
        ) {
          throw new TypeError("Invalid string arguments");
        }
        return values;
      };
      let value;
      switch (args.operation) {
        case "path-join":
          value = path.join(...stringArgs(args.values));
          break;
        case "path-dirname":
          value = path.dirname(stringValue(args.value));
          break;
        case "path-basename":
          value = path.basename(stringValue(args.value), args.suffix);
          break;
        case "path-extname":
          value = path.extname(stringValue(args.value));
          break;
        case "path-resolve":
          value = path.resolve(...stringArgs(args.values));
          break;
        case "path-posix-join":
          value = path.posix.join(...stringArgs(args.values));
          break;
        case "os-homedir":
          value = os.homedir();
          break;
        case "crypto-md5":
          value = nodeCrypto
            .createHash("md5")
            .update(normalizeFileData(args.data))
            .digest("hex");
          break;
        default:
          throw new Error(`Unsupported Node operation: ${args.operation}`);
      }
      event.returnValue = { ok: true, value };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code:
            error && typeof error.code === "string" ? error.code : undefined,
        },
      };
    }
  });
  ipcMain.handle("open-external", (event, url) => {
    if (typeof url !== "string" || !/^https?:|^mailto:/i.test(url)) {
      throw new TypeError("Invalid external URL");
    }
    return shell.openExternal(url);
  });
  ipcMain.on("clipboard-read-text-sync", (event) => {
    event.returnValue = clipboard.readText();
  });
  ipcMain.handle("dict-lookup", (event, args) => {
    const filePath = args && args.filePath;
    if (typeof (args && args.word) !== "string")
      throw new TypeError("Invalid dictionary word");
    const { MDX } = require("js-mdict");
    const result = new MDX(filePath).lookup(args.word);
    return result &&
      result.definition !== undefined &&
      result.definition !== null
      ? String(result.definition)
      : "";
  });
  ipcMain.handle("partial-md5", (event, filePath) => {
    const validatedPath = filePath;
    const hash = nodeCrypto.createHash("md5");
    const fd = fs.openSync(validatedPath, "r");
    try {
      const buffer = Buffer.alloc(1024);
      for (let i = -1; i <= 10; i++) {
        const position = 1024 << (2 * i);
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        hash.update(buffer.subarray(0, bytesRead));
      }
      return hash.digest("hex");
    } finally {
      fs.closeSync(fd);
    }
  });
  ipcMain.handle("crypto-file-md5", (event, filePath) => {
    if (typeof filePath !== "string" || !filePath) {
      throw new TypeError("Invalid file path");
    }
    return new Promise((resolve, reject) => {
      const hash = nodeCrypto.createHash("md5");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  });
  ipcMain.handle("cancel-download-app", () => {
    if (downloadRequest) {
      downloadRequest.destroy();
      downloadRequest = null;
    }
    if (downloadFile) {
      downloadFile.destroy();
      downloadFile = null;
    }
    if (downloadFilePath && fs.existsSync(downloadFilePath)) {
      fs.rmSync(downloadFilePath, { force: true });
    }
    downloadFilePath = null;
    return { code: 0, msg: "Download cancelled" };
  });
  // Discord RPC handlers
  ipcMain.handle("discord-rpc-update", async (event, config) => {
    const { bookTitle, author, percentage } = config;
    if (!discordRPCReady) {
      await initDiscordRPC();
    }
    if (!discordRPCClient || !discordRPCReady) return;
    try {
      const progressBar = buildProgressBar(percentage);
      await discordRPCClient.setActivity({
        details: bookTitle,
        state: `${progressBar} ${percentage}%  |  by ${author}`,
        largeImageKey: "koodo_reader_logo",
        largeImageText: "Koodo Reader Personal",
        startTimestamp: Date.now(),
        instance: false,
        buttons: [
          {
            label: "Get Koodo Reader Personal",
            url: "https://github.com/roverstargazer1-max/koodo-reader-personal",
          },
        ],
      });
    } catch (e) {
      console.warn("Failed to set Discord activity:", e.message);
    }
  });
  ipcMain.handle("discord-rpc-clear", async (event) => {
    if (discordRPCClient) {
      try {
        await discordRPCClient.clearActivity();
      } catch (e) {
        console.warn("Failed to clear Discord activity:", e.message);
      }
    }
  });
  ipcMain.handle("update-win-app", (event, config) => {
    if (
      process.env.PORTABLE_EXECUTABLE_DIR ||
      process.env.PORTABLE_EXECUTABLE_FILE
    ) {
      return {
        code: 2,
        msg: "检测到当前为便携版 (Portable)。请前往 Releases 页面下载新版便携版 exe 替换即可，数据不会丢失。",
        isPortable: true,
      };
    }
    if (!config || !/^[0-9A-Za-z.-]+$/.test(String(config.version))) {
      return { code: 1, msg: "Invalid release version" };
    }
    let fileName = `Koodo-Reader-Personal-${config.version}-x64-Setup.exe`;
    let supportedArchs = ["x64"];
    //get system arch
    let arch = os.arch();
    if (!supportedArchs.includes(arch)) {
      return { code: 1, msg: `Unsupported Windows architecture: ${arch}` };
    }

    let url = `https://github.com/roverstargazer1-max/koodo-reader-personal/releases/download/v${config.version}/${fileName}`;
    const https = require("https");
    const { spawn } = require("child_process");
    downloadFilePath = path.join(app.getPath("temp"), fileName);

    let downloadFailed = false;
    const failDownload = (error) => {
      if (downloadFailed) return;
      downloadFailed = true;
      const message = error.message || String(error);
      console.error("Failed to download Personal update:", message);
      if (downloadFile) {
        downloadFile.destroy();
        downloadFile = null;
      }
      if (downloadFilePath && fs.existsSync(downloadFilePath)) {
        fs.rmSync(downloadFilePath, { force: true });
      }
      downloadFilePath = null;
      downloadRequest = null;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("download-app-error", { message });
      }
    };

    const requestDownload = (requestUrl, redirectsRemaining = 5) => {
      downloadRequest = https.get(requestUrl, (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (redirectsRemaining === 0) {
            failDownload(new Error("Too many update download redirects"));
            return;
          }
          requestDownload(
            new URL(res.headers.location, requestUrl).toString(),
            redirectsRemaining - 1
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          failDownload(
            new Error(`Update download returned HTTP ${res.statusCode}`)
          );
          return;
        }

        const totalSize = Number(res.headers["content-length"] || 0);
        let downloadedSize = 0;
        downloadFile = fs.createWriteStream(downloadFilePath);
        downloadFile.on("error", failDownload);
        res.on("error", failDownload);
        res.on("data", (chunk) => {
          downloadedSize += chunk.length;
          const progress = totalSize
            ? ((downloadedSize / totalSize) * 100).toFixed(2)
            : "0.00";
          const downloadedMB = (downloadedSize / 1024 / 1024).toFixed(2);
          const totalMB = totalSize
            ? (totalSize / 1024 / 1024).toFixed(2)
            : "?";
          if (mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send("download-app-progress", {
              progress,
              downloadedMB,
              totalMB,
            });
          }
        });

        res.pipe(downloadFile);
        downloadFile.on("finish", () => {
          downloadFile.close();
          downloadFile = null;
          downloadRequest = null;

          let updateExePath = downloadFilePath;
          downloadFilePath = null;
          if (!fs.existsSync(updateExePath)) {
            console.error("更新包不存在:", updateExePath);
            return;
          }
          // 验证文件可执行性
          try {
            fs.accessSync(updateExePath, fs.constants.X_OK);
            console.info("更新包可执行性验证通过");
          } catch (err) {
            console.error("更新包不可执行:", err.message);
            return;
          }
          try {
            // 覆盖安装前先关闭数据库并创建数据快照，确保数据 100% 完整安全
            closeAllDatabases();
            createPreUpdateBackup(packageJson.version);

            // 先退出应用，再启动静默安装程序，自动覆盖安装并在完成后重启应用
            app.once("will-quit", () => {
              try {
                const child = spawn(
                  updateExePath,
                  ["/S", "--force-run", "--updated"],
                  {
                    stdio: "ignore",
                    detached: true,
                    shell: true,
                    windowsHide: true,
                  }
                );
                child.unref();
              } catch (spawnErr) {
                console.error(`启动更新安装程序失败: ${spawnErr.message}`);
              }
            });
            app.quit();
          } catch (err) {
            console.error(`更新执行异常: ${err.message}`);
          }
        });
      });
      downloadRequest.on("error", failDownload);
    };

    requestDownload(url);
    return { code: 0, msg: "Update download started" };
  });
  ipcMain.handle("open-book", (event, config) => {
    let { url, isMergeWord, isAutoFullscreen, isAutoMaximize, isPreventSleep } =
      config;
    if (isMergeWord) {
      delete options.backgroundColor;
    }
    store.set({
      url,
      isMergeWord: isMergeWord || "no",
      isAutoFullscreen: isAutoFullscreen || "no",
      isAutoMaximize: isAutoMaximize || "no",
      isPreventSleep: isPreventSleep || "no",
    });
    let id;
    if (isPreventSleep === "yes") {
      id = powerSaveBlocker.start("prevent-display-sleep");
      console.info(powerSaveBlocker.isStarted(id));
    }
    if (readerWindow) {
      readerWindowList.push(readerWindow);
    }
    if (isAutoFullscreen === "yes" || isAutoMaximize === "yes") {
      readerWindow = new BrowserWindow(options);
      readerWindow.webContents.on(
        "console-message",
        (_event, level, message) => {
          const lvl =
            { 0: "info", 1: "info", 2: "warn", 3: "error" }[level] || "info";
          log[lvl](`[Renderer] ${message}`);
        }
      );
      readerWindow.loadURL(url);
      if (isAutoFullscreen === "yes") {
        readerWindow.setFullScreen(true);
      } else if (isAutoMaximize === "yes") {
        readerWindow.maximize();
      }
    } else {
      const scaleRatio = store.get("windowDisplayScale") || 1;
      const isWindowVisible = isWindowPartiallyVisible({
        x: parseInt(store.get("windowX")),
        y: parseInt(store.get("windowY")),
        width: parseInt(store.get("windowWidth") || 1050) / scaleRatio,
        height: parseInt(store.get("windowHeight") || 660) / scaleRatio,
      });
      readerWindow = new BrowserWindow({
        ...options,
        width: parseInt(store.get("windowWidth") || 1050) / scaleRatio,
        height: parseInt(store.get("windowHeight") || 660) / scaleRatio,
        x: isWindowVisible ? parseInt(store.get("windowX")) : undefined,
        y: isWindowVisible ? parseInt(store.get("windowY")) : undefined,
        frame: isMergeWord === "yes" ? false : true,
        hasShadow: isMergeWord === "yes" ? false : true,
        transparent: isMergeWord === "yes" ? true : false,
      });
      readerWindow.webContents.on(
        "console-message",
        (_event, level, message) => {
          const lvl =
            { 0: "info", 1: "info", 2: "warn", 3: "error" }[level] || "info";
          log[lvl](`[Renderer] ${message}`);
        }
      );
      readerWindow.loadURL(url);
      // readerWindow.webContents.openDevTools();
    }
    if (store.get("isAlwaysOnTop") === "yes") {
      readerWindow.setAlwaysOnTop(true);
    }
    readerWindowReadyToClose = false;
    readerWindow.on("close", (event) => {
      // --- Step 1: ask renderer to flush reading-time data first ---
      if (
        !readerWindowReadyToClose &&
        readerWindow &&
        !readerWindow.isDestroyed()
      ) {
        event.preventDefault();
        readerWindow.webContents.send("before-reader-close");
        return;
      }
      // --- Step 2: actual close logic (reached after renderer replied) ---
      if (readerWindow && !readerWindow.isDestroyed()) {
        let bounds = readerWindow.getBounds();
        const currentDisplay = screen.getDisplayMatching(bounds);
        const primaryDisplay = screen.getPrimaryDisplay();
        if (bounds.width > 300 && bounds.height > 100) {
          store.set({
            windowWidth: bounds.width,
            windowHeight: bounds.height,
            windowX:
              readerWindow.isMaximized() &&
              currentDisplay.id === primaryDisplay.id
                ? 0
                : bounds.x,
            windowY:
              readerWindow.isMaximized() &&
              currentDisplay.id === primaryDisplay.id
                ? 0
                : bounds.y < 0
                  ? 0
                  : bounds.y,
            windowDisplayScale:
              currentDisplay.scaleFactor / primaryDisplay.scaleFactor,
          });
        }
      }
      if (isPreventSleep && !readerWindow.isDestroyed()) {
        id && powerSaveBlocker.stop(id);
      }
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("reading-finished", {});
      }
      if (discordRPCClient) {
        try {
          discordRPCClient.clearActivity();
        } catch (e) {
          console.warn("Failed to clear Discord activity:", e.message);
        }
      }
    });
    // Renderer finished flushing reading-time data — proceed with actual close
    ipcMain.once("reader-close-ready", () => {
      if (readerWindow && !readerWindow.isDestroyed()) {
        readerWindowReadyToClose = true;
        readerWindow.close();
      }
    });

    event.returnValue = "success";
  });
  ipcMain.handle("generate-tts", async (event, voiceConfig) => {
    const { text, speed, pluginKey, config } = voiceConfig || {};
    const plugin = getVoicePlugin(pluginKey);
    if (
      !plugin ||
      typeof text !== "string" ||
      typeof speed !== "number" ||
      !Number.isFinite(speed) ||
      !config ||
      typeof config !== "object" ||
      Array.isArray(config)
    ) {
      throw new Error("Invalid TTS plugin request");
    }
    const audioPath = await plugin.getAudioPath(text, speed, dirPath, config);
    if (
      typeof audioPath === "string" &&
      path.isAbsolute(audioPath) &&
      fs.existsSync(audioPath)
    ) {
      return pathToFileURL(audioPath).toString();
    }
    return audioPath;
  });
  ipcMain.handle("get-tts-voices", async (event, request) => {
    const { pluginKey, config } = request || {};
    const plugin = getVoicePlugin(pluginKey);
    if (
      !plugin ||
      typeof plugin.getTTSVoice !== "function" ||
      !config ||
      typeof config !== "object" ||
      Array.isArray(config)
    ) {
      throw new Error("Invalid TTS voice request");
    }
    const voices = await plugin.getTTSVoice(config);
    if (!Array.isArray(voices)) {
      throw new Error("Invalid TTS voice list");
    }
    return voices;
  });
  ipcMain.handle("cloud-upload", async (event, config) => {
    let syncUtil = await getSyncUtil(config, config.isUseCache);
    let result = await syncUtil.uploadFile(
      config.fileName,
      config.fileName,
      config.type
    );
    return result;
  });

  ipcMain.handle("cloud-download", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = await syncUtil.downloadFile(
      config.fileName,
      (config.isTemp ? "temp-" : "") + config.fileName,
      config.type
    );
    return result;
  });
  ipcMain.handle("cloud-progress", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = syncUtil.getDownloadedSize();
    return result;
  });
  ipcMain.handle("picker-download", async (event, config) => {
    let pickerUtil = await getPickerUtil(config);
    let result = await pickerUtil.remote.downloadFile(
      config.sourcePath,
      config.destPath
    );
    return result;
  });
  ipcMain.handle("picker-progress", async (event, config) => {
    let pickerUtil = await getPickerUtil(config);
    let result = await pickerUtil.getDownloadedSize();
    return result;
  });
  ipcMain.handle("cloud-reset", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = syncUtil.resetCounters();
    return result;
  });
  ipcMain.handle("cloud-stats", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = syncUtil.getStats();
    return result;
  });
  ipcMain.handle("cloud-delete", async (event, config) => {
    try {
      let syncUtil = await getSyncUtil(config, config.isUseCache);
      let result = await syncUtil.deleteFile(config.fileName, config.type);
      return result;
    } catch (error) {
      console.error("Error deleting file:", error);
    }
    return false;
  });

  ipcMain.handle("cloud-list", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = await syncUtil.listFiles(config.type);
    return result;
  });
  ipcMain.handle("picker-list", async (event, config) => {
    let pickerUtil = await getPickerUtil(config);
    let result = await pickerUtil.listFileInfos(config.currentPath);
    return result;
  });
  ipcMain.handle("cloud-exist", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = await syncUtil.isExist(config.fileName, config.type);
    return result;
  });
  ipcMain.handle("cloud-close", async (event, config) => {
    removeSyncUtil(config);
    return "pong";
  });

  ipcMain.handle("clear-tts", async (event, config) => {
    if (!fs.existsSync(path.join(dirPath, "tts"))) {
      return "pong";
    } else {
      const fsExtra = require("fs-extra");
      try {
        await fsExtra.remove(path.join(dirPath, "tts"));
        await fsExtra.mkdir(path.join(dirPath, "tts"));
        return "pong";
      } catch (err) {
        console.error(err);
        return "pong";
      }
    }
  });
  ipcMain.handle("select-path", async (event) => {
    var path = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return path.filePaths[0];
  });
  ipcMain.handle("select-file", async (event, config) => {
    const dialogOptions = { properties: ["openFile"] };
    if (config && config.filters) {
      dialogOptions.filters = config.filters;
    }
    var result = await dialog.showOpenDialog(dialogOptions);
    return result.filePaths[0];
  });
  ipcMain.handle("encrypt-data", async (event, config) => {
    let fingerprint = await getFingerprint();
    let encrypted = encrypt(config.token, fingerprint);
    store.set("encryptedToken", encrypted);
    return "pong";
  });
  ipcMain.handle("decrypt-data", async (event) => {
    let encrypted = store.get("encryptedToken");
    if (!encrypted) return "";
    let fingerprint = await getFingerprint();
    let decrypted = decrypt(encrypted, fingerprint);
    if (decrypted.startsWith("{") && decrypted.endsWith("}")) {
      return decrypted;
    } else {
      try {
        const { safeStorage } = require("electron");
        decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
        let newEncrypted = encrypt(decrypted, fingerprint);
        store.set("encryptedToken", newEncrypted);
        return decrypted;
      } catch (error) {
        console.error("Decryption failed:", error);
        return "{}";
      }
    }
  });
  ipcMain.handle("check-cloud-url", async (event, config) => {
    const https = require("https");
    const http = require("http");
    const { URL } = require("url");
    const { url } = config;
    return new Promise((resolve) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (e) {
        return resolve({ ok: false, reason: "invalid_url", detail: e.message });
      }
      const isHttps = parsedUrl.protocol === "https:";
      const lib = isHttps ? https : http;
      const port = parsedUrl.port
        ? parseInt(parsedUrl.port)
        : isHttps
          ? 443
          : 80;
      const options = {
        hostname: parsedUrl.hostname,
        port,
        path: parsedUrl.pathname || "/",
        method: "HEAD",
        timeout: 8000,
        rejectUnauthorized: true,
      };
      const req = lib.request(options, (res) => {
        resolve({
          ok: true,
          status: res.statusCode,
          detail: `HTTP ${res.statusCode}`,
        });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve({
          ok: false,
          reason: "timeout",
          detail: `Connection to ${parsedUrl.hostname}:${port} timed out after 8s`,
        });
      });
      req.on("error", (err) => {
        let reason = "unknown";
        if (err.code === "ENOTFOUND") {
          reason = "dns_failed";
        } else if (err.code === "ECONNREFUSED") {
          reason = "connection_refused";
        } else if (err.code === "ECONNRESET") {
          reason = "connection_reset";
        } else if (err.code === "ETIMEDOUT") {
          reason = "timeout";
        } else if (
          err.code === "CERT_HAS_EXPIRED" ||
          err.code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
          err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
        ) {
          reason = "ssl_error";
        } else if (err.message && err.message.includes("SSL")) {
          reason = "ssl_error";
        }
        resolve({
          ok: false,
          reason,
          code: err.code || "",
          detail: err.message,
        });
      });
      req.end();
    });
  });
  ipcMain.handle("get-proxy-config", async () => {
    const config = store.get("proxyConfig") || {
      enabled: false,
      type: "none",
      host: "",
      port: 0,
      username: "",
      password: "",
    };
    return config;
  });
  ipcMain.handle("set-proxy-config", async (event, config) => {
    const { enabled, type, host, port, username, password } = config || {};
    const validTypes = ["none", "http", "socks5"];
    if (!validTypes.includes(type)) {
      return { ok: false, reason: "invalid_input" };
    }
    if (type !== "none") {
      if (!host || typeof host !== "string" || host.includes("://")) {
        return { ok: false, reason: "invalid_input" };
      }
      const portNumber = parseInt(port);
      if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
        return { ok: false, reason: "invalid_input" };
      }
    }
    const finalEnabled = type === "none" ? false : !!enabled;
    const configToStore = {
      enabled: finalEnabled,
      type,
      host: type === "none" ? "" : host,
      port: type === "none" ? 0 : parseInt(port),
      username: type === "none" ? "" : username || "",
      password: type === "none" ? "" : password || "",
    };
    store.set("proxyConfig", configToStore);
    await applyProxyToSession();
    return { ok: true };
  });
  ipcMain.handle("test-proxy-connection", async (event, config) => {
    const https = require("https");
    const { URL } = require("url");
    const proxyConfig = config || {};
    const validTypes = ["http", "socks5"];
    if (!validTypes.includes(proxyConfig.type)) {
      return { ok: false, reason: "invalid_input", detail: "unsupported type" };
    }
    if (
      !proxyConfig.host ||
      typeof proxyConfig.host !== "string" ||
      proxyConfig.host.includes("://")
    ) {
      return { ok: false, reason: "invalid_input", detail: "invalid host" };
    }
    const portNumber = parseInt(proxyConfig.port);
    if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
      return { ok: false, reason: "invalid_input", detail: "invalid port" };
    }
    const proxyUrl = buildProxyUrl(proxyConfig);
    let agent;
    try {
      if (proxyConfig.type === "socks5") {
        const { SocksProxyAgent } = require("socks-proxy-agent");
        agent = new SocksProxyAgent(proxyUrl);
      } else {
        const { HttpsProxyAgent } = require("https-proxy-agent");
        agent = new HttpsProxyAgent(proxyUrl);
      }
    } catch (error) {
      return { ok: false, reason: "agent_init_failed", detail: error.message };
    }
    const target = new URL("https://www.google.com/");
    const startTime = Date.now();
    return new Promise((resolve) => {
      const options = {
        hostname: target.hostname,
        port: 443,
        path: "/",
        method: "HEAD",
        timeout: 10000,
        agent,
        rejectUnauthorized: true,
      };
      const request = https.request(options, (response) => {
        const elapsedMs = Date.now() - startTime;
        if (response.statusCode === 407) {
          return resolve({
            ok: false,
            reason: "proxy_auth_failed",
            status: 407,
            elapsedMs,
            detail: `HTTP 407 Proxy Authentication Required`,
          });
        }
        resolve({
          ok:
            response.statusCode &&
            response.statusCode >= 200 &&
            response.statusCode < 400,
          status: response.statusCode,
          elapsedMs,
          detail: `HTTP ${response.statusCode}`,
        });
      });
      request.on("timeout", () => {
        request.destroy();
        resolve({
          ok: false,
          reason: "timeout",
          elapsedMs: Date.now() - startTime,
          detail: `Connection to ${target.hostname} timed out after 10s`,
        });
      });
      request.on("error", (error) => {
        let reason = "unknown";
        if (error.code === "ENOTFOUND") {
          reason = "dns_failed";
        } else if (error.code === "ECONNREFUSED") {
          reason = "connection_refused";
        } else if (error.code === "ECONNRESET") {
          reason = "connection_reset";
        } else if (error.code === "ETIMEDOUT") {
          reason = "timeout";
        } else if (error.code === "EPROTO") {
          reason = "ssl_error";
        } else if (
          error.code === "CERT_HAS_EXPIRED" ||
          error.code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
          error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
        ) {
          reason = "ssl_error";
        } else if (error.message && error.message.includes("SSL")) {
          reason = "ssl_error";
        }
        resolve({
          ok: false,
          reason,
          code: error.code || "",
          elapsedMs: Date.now() - startTime,
          detail: error.message,
        });
      });
      request.end();
    });
  });
  ipcMain.handle("get-mac", async (event, config) => {
    const { machineIdSync } = require("node-machine-id");
    return machineIdSync();
  });
  ipcMain.handle("get-device-name", async () => {
    return os.hostname() || "";
  });
  ipcMain.handle("get-biometric-capability", async () => {
    return await getBiometricCapability();
  });
  ipcMain.handle("prompt-biometric-auth", async (event, config) => {
    const senderWindow =
      BrowserWindow.fromWebContents(event.sender) ||
      BrowserWindow.getFocusedWindow() ||
      mainWin ||
      null;
    return await promptBiometricAuth(config?.message, senderWindow);
  });

  ipcMain.handle("reset-reader-position", async (event) => {
    store.delete("windowX");
    store.delete("windowY");
    return "success";
  });
  ipcMain.handle("reset-main-position", async (event) => {
    store.delete("mainWinX");
    store.delete("mainWinY");
    app.relaunch();
    app.exit();
    return "success";
  });

  ipcMain.handle("select-zip-file", async (event, config) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Zip Files", extensions: ["zip"] }],
    });

    if (result.canceled) {
      return "";
    } else {
      const filePath = result.filePaths[0];
      return filePath;
    }
  });

  ipcMain.handle("select-book", async (event, config) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Books",
          extensions: [
            "epub",
            "pdf",
            "txt",
            "mobi",
            "azw3",
            "azw",
            "htm",
            "html",
            "xml",
            "xhtml",
            "mhtml",
            "docx",
            "md",
            "fb2",
            "cbz",
            "cbt",
            "cbr",
            "cb7",
          ],
        },
      ],
    });

    if (result.canceled) {
      console.info("User canceled the file selection");
      return [];
    } else {
      const filePaths = result.filePaths;
      console.info("Selected file path:", filePaths);
      return filePaths;
    }
  });
  ipcMain.handle("custom-database-command", async (event, config) => {
    const { SqlStatement } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let { query, storagePath, data, dbName, executeType } = config;
    let db = getDBConnection(dbName, storagePath, SqlStatement.sqlStatement);
    const row = db.prepare(query);
    let result;
    if (data && data.length > 0) {
      result = row[executeType](...data);
    } else {
      result = row[executeType]();
    }
    return result;
  });
  ipcMain.handle("database-command", async (event, config) => {
    const { SqlStatement } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let { statement, statementType, executeType, dbName, data, storagePath } =
      config;
    if (
      (statement === "getByKeysStatement" ||
        statement === "getByBookKeysStatement") &&
      (!data || !Array.isArray(data) || data.length === 0)
    ) {
      return [];
    }
    let db = getDBConnection(dbName, storagePath, SqlStatement.sqlStatement);
    let sql = "";
    if (statementType === "string") {
      sql = SqlStatement.sqlStatement[statement][dbName];
    } else if (statementType === "function") {
      sql = SqlStatement.sqlStatement[statement][dbName](data);
    }
    const row = db.prepare(sql);
    let result;
    if (data) {
      if (statement.startsWith("save") || statement.startsWith("update")) {
        data = SqlStatement.jsonToSqlite[dbName](data);
      }
      let queryParams = data;
      if (statement === "getByKeysStatement" && Array.isArray(data)) {
        queryParams = [...data, ...data];
      }
      result = row[executeType](queryParams);
    } else {
      result = row[executeType]();
    }
    if (executeType === "all") {
      return result.map((item) => SqlStatement.sqliteToJson[dbName](item));
    } else if (executeType === "get") {
      return SqlStatement.sqliteToJson[dbName](result);
    } else {
      return result;
    }
  });
  ipcMain.handle("close-database", async (event, config) => {
    const { SqlStatement } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let { dbName, storagePath } = config;
    let db = getDBConnection(dbName, storagePath, SqlStatement.sqlStatement);
    delete dbConnection[dbName];
    // Flush WAL into the main .db file and flip to rollback journal mode so the
    // on-disk file is self-contained (header read/write version = 1, no -wal
    // dependency). Other consumers — e.g. the Expo app's expo-sqlite
    // deserializeDatabaseAsync — can only open a non-WAL SQLite image; without
    // this, backups restored there fail with "unable to open database file".
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.pragma("journal_mode = DELETE");
    } catch (error) {
      console.error("failed to checkpoint/switch journal mode:", error);
    }
    db.close();
  });
  // 流式打包备份：遍历 dataPath 下的固定目录与配置文件，
  // 用 yazl 逐文件 addFile 直接写入目标 zip，避免将整库读入内存。
  ipcMain.handle("backup-path", async (event, config) => {
    if (!config || typeof config !== "object") {
      throw new TypeError("Invalid backup config");
    }
    const { targetPath, fileName, dataPath, dirs, files } = config;
    if (
      [targetPath, dataPath].some((v) => typeof v !== "string" || !v) ||
      typeof fileName !== "string" ||
      !fileName ||
      !Array.isArray(dirs) ||
      !Array.isArray(files)
    ) {
      throw new TypeError("Invalid backup arguments");
    }
    const sendProgress = (percent) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("backup-progress", { percent });
      }
    };
    // 校验 dirs/files 路径均位于 dataPath 之内，防止路径穿越
    const base = path.resolve(dataPath);
    const assertInside = (p) => {
      const resolved = path.resolve(p);
      const rel = path.relative(base, resolved);
      if (
        rel.startsWith(".." + path.sep) ||
        path.isAbsolute(rel) ||
        rel.split(path.sep).includes("..")
      ) {
        throw new Error("Backup source path is outside the data directory");
      }
      return resolved;
    };
    try {
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }
      const destinationPath = path.join(targetPath, fileName);
      const tempPath = destinationPath + ".tmp";
      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.level = 6;
        const output = fs.createWriteStream(tempPath);
        let totalBytes = 0;
        let writtenBytes = 0;
        // 条目源文件由 yazl 内部以 createReadStream 读取，读写出错时 yazl 虽会
        // 触发 emit("error")，但 outputStream 的 "end" 不再走到，导致 promise
        // 永久悬挂、进度 toast 卡死。统一收集错误：完成后销毁输出流再 reject，
        // 主进程 catch 会清理 .tmp 并向渲染进程返回失败。
        const errored = (err) => {
          try {
            output.destroy();
          } catch (_) {}
          reject(err);
        };
        output.on("error", errored);
        zip.outputStream.on("error", errored);
        zip.on("error", errored);
        const finish = () => {
          output.end();
        };
        output.on("close", resolve);
        // 列出所有待打包的源文件并累计总字节数（用于进度估算）
        const entries = [];
        const collect = (zipDir, sourceDir) => {
          let direntNames;
          try {
            direntNames = fs.readdirSync(sourceDir, { withFileTypes: true });
          } catch (_) {
            return;
          }
          if (direntNames.length === 0) return;
          for (const entry of direntNames) {
            const sourcePath = path.join(sourceDir, entry.name);
            const entryZip = path.posix.join(zipDir, entry.name);
            if (entry.isDirectory()) {
              collect(entryZip, sourcePath);
            } else if (entry.isFile()) {
              try {
                totalBytes += fs.statSync(sourcePath).size;
              } catch (_) {}
              entries.push({ sourcePath, entryZip });
            }
          }
        };
        for (const dir of dirs) {
          const sourceDir = assertInside(path.join(dataPath, dir));
          if (fs.existsSync(sourceDir)) {
            zip.addEmptyDirectory(dir);
            collect(dir, sourceDir);
          }
        }
        for (const filePath of files) {
          const sourcePath = assertInside(
            path.resolve(dataPath, filePath.replace(/^[/\\]/, ""))
          );
          if (fs.existsSync(sourcePath)) {
            try {
              totalBytes += fs.statSync(sourcePath).size;
            } catch (_) {}
            entries.push({
              sourcePath,
              entryZip: path.posix.normalize(filePath.replace(/^[/\\]/, "")),
            });
          }
        }
        for (const entry of entries) {
          zip.addFile(entry.sourcePath, entry.entryZip);
        }
        zip.end();
        zip.outputStream.on("data", (chunk) => {
          writtenBytes += chunk.length;
        });
        zip.outputStream.on("end", () => {
          finish();
        });
        // 进度估算：zip.outputStream 无内建进度，按“已写入条目的源字节”
        // 与总字节数的比例上报（压缩前后差异不影响 UI 展示）
        zip.outputStream.pipe(output);
        const report = setInterval(() => {
          const percent = totalBytes
            ? Math.min(100, Math.round((writtenBytes / totalBytes) * 100))
            : 100;
          sendProgress(percent);
        }, 100);
        zip.outputStream.on("end", () => {
          clearInterval(report);
        });
      });
      let tempStat;
      try {
        tempStat = fs.statSync(tempPath);
      } catch (_) {
        throw new Error("Backup output file was not created");
      }
      if (fs.existsSync(destinationPath)) {
        fs.unlinkSync(destinationPath);
      }
      fs.renameSync(tempPath, destinationPath);
      sendProgress(100);
      return { ok: true, size: tempStat.size };
    } catch (error) {
      try {
        const tempPath = path.join(targetPath, fileName) + ".tmp";
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (_) {}
      const message = error instanceof Error ? error.message : String(error);
      console.error("backup-path failed:", message);
      return { ok: false, error: message };
    }
  });
  // 流式解压恢复：用 yauzl 逐条目 openReadStream，避免把整个 zip 读入内存。
  // 资产文件（book/cover/dict/background/font/snapshot）在主进程直接流式写盘，
  // config 类文件（config/*.db、config.json、sync.json）回传渲染进程处理：
  // .db 经 sql.js 解析后与本地记录合并写入，json 写入 ConfigService。
  ipcMain.handle("restore-path", async (event, config) => {
    if (!config || typeof config !== "object") {
      throw new TypeError("Invalid restore config");
    }
    const { filePath, dataPath } = config;
    if (
      typeof filePath !== "string" ||
      !filePath ||
      typeof dataPath !== "string" ||
      !dataPath
    ) {
      throw new TypeError("Invalid restore arguments");
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: "Backup file not found" };
    }
    const sendProgress = (percent) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("restore-progress", { percent });
      }
    };
    const base = path.resolve(dataPath);
    const assertInside = (p) => {
      const resolved = path.resolve(p);
      const rel = path.relative(base, resolved);
      if (
        rel.startsWith(".." + path.sep) ||
        path.isAbsolute(rel) ||
        rel.split(path.sep).includes("..")
      ) {
        throw new Error(
          "Restore destination path is outside the data directory"
        );
      }
      return resolved;
    };
    const ASSET_PREFIXES = [
      "book/",
      "cover/",
      "dict/",
      "background/",
      "font/",
      "snapshot/",
    ];
    const isConfigFile = (name) => {
      if (!name.startsWith("config/")) return false;
      const rest = name.slice("config/".length);
      if (rest.includes("/")) return false;
      return (
        rest.endsWith(".db") || rest === "config.json" || rest === "sync.json"
      );
    };
    const isAssetFile = (name) =>
      ASSET_PREFIXES.some((prefix) => name.startsWith(prefix));
    const isFileEntry = (entry) => !/\/$/.test(entry.fileName);

    // 用 yauzl 回调式 API 遍历（其 eachEntry() 迭代器与 FdSlicer 的 ref/unref
    // 时序存在冲突，遍历结束后 fd 会被提前关闭，故不使用 for await 形式）。
    const scanEntries = () =>
      new Promise((resolve, reject) => {
        yauzl.fromFd(
          fs.openSync(filePath, "r"),
          { lazyEntries: true, autoClose: true },
          (err, zf) => {
            if (err) return reject(err);
            let hasNewConfig = false;
            let totalEntries = 0;
            zf.on("entry", (entry) => {
              if (entry.fileName === "config/config.json") hasNewConfig = true;
              totalEntries++;
              zf.readEntry();
            });
            zf.on("end", () => resolve({ hasNewConfig, totalEntries }));
            zf.on("error", reject);
            zf.readEntry();
          }
        );
      });

    let scanResult;
    try {
      scanResult = await scanEntries();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
    if (!scanResult.hasNewConfig) {
      return { ok: false, isNewBackup: false };
    }
    const totalEntries = scanResult.totalEntries;

    // 第二遍：逐条目 openReadStream 流式处理。
    const configBuffers = [];
    let processed = 0;
    const processAllEntries = () =>
      new Promise((resolve, reject) => {
        yauzl.fromFd(
          fs.openSync(filePath, "r"),
          { lazyEntries: true, autoClose: true },
          (err, zf) => {
            if (err) return reject(err);
            const advance = () => {
              processed++;
              sendProgress(
                Math.round((processed / Math.max(totalEntries, 1)) * 100)
              );
              zf.readEntry();
            };
            zf.on("entry", (entry) => {
              const name = entry.fileName;
              if (!isFileEntry(entry)) {
                // 目录条目：在主进程创建对应目录。若目标路径被一个异常空文件占住
                // （历史残留），先删除该文件再建目录，避免后续写入 ENOENT。
                if (isAssetFile(name) || name.startsWith("config/")) {
                  let dirDest;
                  try {
                    dirDest = assertInside(
                      path.join(dataPath, name.replace(/\/$/, ""))
                    );
                  } catch (e3) {
                    return reject(e3);
                  }
                  try {
                    if (
                      fs.existsSync(dirDest) &&
                      !fs.statSync(dirDest).isDirectory()
                    ) {
                      fs.unlinkSync(dirDest);
                    }
                    fs.mkdirSync(dirDest, { recursive: true });
                  } catch (e3) {
                    return reject(e3);
                  }
                }
                advance();
                return;
              }
              zf.openReadStream(entry, (e2, readStream) => {
                if (e2) return reject(e2);
                if (isAssetFile(name)) {
                  // 流式写盘，不进内存
                  let destination;
                  try {
                    destination = assertInside(path.join(dataPath, name));
                  } catch (e3) {
                    return reject(e3);
                  }
                  const directory = path.dirname(destination);
                  try {
                    if (
                      fs.existsSync(directory) &&
                      !fs.statSync(directory).isDirectory()
                    ) {
                      fs.unlinkSync(directory);
                    }
                    fs.mkdirSync(directory, { recursive: true });
                  } catch (e3) {
                    return reject(e3);
                  }
                  const output = fs.createWriteStream(destination);
                  output.on("error", reject);
                  readStream.on("error", reject);
                  output.on("close", advance);
                  readStream.pipe(output);
                } else if (isConfigFile(name)) {
                  // config 类文件（*.db / config.json / sync.json）累积为 Buffer
                  // 回传渲染进程处理：.db 经 sql.js 解析合并，json 写入 ConfigService
                  const chunks = [];
                  readStream.on("data", (chunk) => chunks.push(chunk));
                  readStream.on("error", reject);
                  readStream.on("end", () => {
                    const buf = Buffer.concat(chunks);
                    configBuffers.push({
                      name,
                      buffer: buf.buffer.slice(
                        buf.byteOffset,
                        buf.byteOffset + buf.byteLength
                      ),
                    });
                    advance();
                  });
                } else {
                  readStream.resume();
                  readStream.on("end", advance);
                  readStream.on("error", reject);
                }
              });
            });
            zf.on("end", resolve);
            zf.on("error", reject);
            zf.readEntry();
          }
        );
      });

    try {
      await processAllEntries();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("restore-path failed:", message);
      return { ok: false, error: message };
    }
    sendProgress(100);
    return {
      ok: true,
      isNewBackup: true,
      configFiles: configBuffers,
    };
  });
  // 选择保存路径（支持 .kpack）
  ipcMain.handle("select-save-path", async (event, config) => {
    const dialogOptions = {
      title: config && config.title ? config.title : "Save Share Package",
      defaultPath:
        config && config.defaultPath ? config.defaultPath : "share.kpack",
      filters: (config && config.filters) || [
        { name: "Koodo Share Package (*.kpack)", extensions: ["kpack"] },
        { name: "All Files (*.*)", extensions: ["*"] },
      ],
    };
    const result = await dialog.showSaveDialog(dialogOptions);
    if (result.canceled) return null;
    return result.filePath;
  });

  // 流式导出分享包 (.kpack)
  ipcMain.handle("export-share-package", async (event, config) => {
    if (!config || typeof config !== "object") {
      throw new TypeError("Invalid share package export config");
    }
    const { targetFilePath, manifest, books, includeNotes, notes, dataPath } =
      config;
    if (
      !targetFilePath ||
      typeof targetFilePath !== "string" ||
      !manifest ||
      !Array.isArray(books) ||
      !dataPath ||
      typeof dataPath !== "string"
    ) {
      throw new TypeError("Invalid export-share-package arguments");
    }

    const sendProgress = (percent) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("share-export-progress", { percent });
      }
    };

    const finalPath = targetFilePath.endsWith(".kpack")
      ? targetFilePath
      : targetFilePath + ".kpack";
    const tempPath = finalPath + ".tmp";

    try {
      const parentDir = path.dirname(finalPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.level = 6;
        const output = fs.createWriteStream(tempPath);

        const errored = (err) => {
          try {
            output.destroy();
          } catch (_) {}
          reject(err);
        };
        output.on("error", errored);
        zip.outputStream.on("error", errored);
        zip.on("error", errored);
        output.on("close", resolve);

        // 1. 写入 manifest.json
        const manifestBuffer = Buffer.from(
          JSON.stringify(manifest, null, 2),
          "utf8"
        );
        zip.addBuffer(manifestBuffer, "manifest.json");

        // 2. 写入 notes.json（若包含笔记）
        if (includeNotes && Array.isArray(notes) && notes.length > 0) {
          const notesBuffer = Buffer.from(
            JSON.stringify(notes, null, 2),
            "utf8"
          );
          zip.addBuffer(notesBuffer, "notes/notes.json");
        }

        // 3. 收集并添加图书文件与封面文件
        let totalBytes = manifestBuffer.length;
        let writtenBytes = 0;
        const entriesToAdd = [];

        for (const book of books) {
          const format = (book.format || "epub").toLowerCase();
          const internalBookPath = path.join(
            dataPath,
            "book",
            `${book.key}.${format}`
          );
          let sourceBookPath = internalBookPath;
          if (
            !fs.existsSync(sourceBookPath) &&
            book.path &&
            fs.existsSync(book.path)
          ) {
            sourceBookPath = book.path;
          }
          if (fs.existsSync(sourceBookPath)) {
            try {
              totalBytes += fs.statSync(sourceBookPath).size;
            } catch (_) {}
            entriesToAdd.push({
              source: sourceBookPath,
              entryName: `books/${book.key}.${format}`,
            });
          }

          let coverFileName = null;
          let sourceCoverPath = null;
          const coverFolder = path.join(dataPath, "cover");
          if (fs.existsSync(coverFolder)) {
            try {
              const coverFiles = fs.readdirSync(coverFolder);
              const matched = coverFiles.find(
                (f) => f.startsWith(book.key + ".") || f === book.key
              );
              if (matched) {
                coverFileName = matched;
                sourceCoverPath = path.join(coverFolder, matched);
              }
            } catch (_) {}
          }

          if (sourceCoverPath && fs.existsSync(sourceCoverPath)) {
            try {
              totalBytes += fs.statSync(sourceCoverPath).size;
            } catch (_) {}
            const ext = path.extname(coverFileName) || ".png";
            entriesToAdd.push({
              source: sourceCoverPath,
              entryName: `covers/${book.key}${ext}`,
            });
          } else if (
            book.cover &&
            typeof book.cover === "string" &&
            book.cover.startsWith("data:image/")
          ) {
            try {
              const mimeMatch = book.cover.match(
                /^data:image\/([a-zA-Z0-9+]+);base64,/
              );
              const subType = mimeMatch
                ? mimeMatch[1].replace("+xml", "")
                : "png";
              const ext = subType === "jpeg" ? "jpg" : subType;
              const base64Data = book.cover.split("base64,")[1];
              if (base64Data) {
                const buf = Buffer.from(base64Data, "base64");
                totalBytes += buf.length;
                entriesToAdd.push({
                  buffer: buf,
                  entryName: `covers/${book.key}.${ext}`,
                });
              }
            } catch (_) {}
          }
        }

        for (const entry of entriesToAdd) {
          if (entry.source) {
            zip.addFile(entry.source, entry.entryName);
          } else if (entry.buffer) {
            zip.addBuffer(entry.buffer, entry.entryName);
          }
        }

        zip.end();
        zip.outputStream.on("data", (chunk) => {
          writtenBytes += chunk.length;
        });

        zip.outputStream.pipe(output);

        const report = setInterval(() => {
          const percent = totalBytes
            ? Math.min(100, Math.round((writtenBytes / totalBytes) * 100))
            : 100;
          sendProgress(percent);
        }, 100);

        zip.outputStream.on("end", () => {
          clearInterval(report);
        });
      });

      let tempStat;
      try {
        tempStat = fs.statSync(tempPath);
      } catch (_) {
        throw new Error("Share package output file was not created");
      }
      if (fs.existsSync(finalPath)) {
        fs.unlinkSync(finalPath);
      }
      fs.renameSync(tempPath, finalPath);
      sendProgress(100);
      return { ok: true, filePath: finalPath, size: tempStat.size };
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (_) {}
      const message = error instanceof Error ? error.message : String(error);
      console.error("export-share-package failed:", message);
      return { ok: false, error: message };
    }
  });

  // 预览检查分享包 (.kpack)
  ipcMain.handle("inspect-share-package", async (event, config) => {
    if (!config || typeof config !== "object" || !config.filePath) {
      throw new TypeError("Invalid inspect-share-package arguments");
    }
    const { filePath } = config;
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: "File not found" };
    }

    try {
      const stat = fs.statSync(filePath);
      const manifest = await new Promise((resolve, reject) => {
        yauzl.open(
          filePath,
          { lazyEntries: true, autoClose: true },
          (err, zf) => {
            if (err) return reject(err);
            let foundManifest = false;

            zf.on("entry", (entry) => {
              if (entry.fileName === "manifest.json") {
                foundManifest = true;
                zf.openReadStream(entry, (readErr, stream) => {
                  if (readErr) return reject(readErr);
                  const chunks = [];
                  stream.on("data", (c) => chunks.push(c));
                  stream.on("error", reject);
                  stream.on("end", () => {
                    try {
                      const content = Buffer.concat(chunks).toString("utf8");
                      resolve(JSON.parse(content));
                    } catch (e) {
                      reject(e);
                    }
                  });
                });
              } else {
                zf.readEntry();
              }
            });

            zf.on("end", () => {
              if (!foundManifest) {
                reject(
                  new Error("Not a valid share package: missing manifest.json")
                );
              }
            });
            zf.on("error", reject);
            zf.readEntry();
          }
        );
      });

      return {
        ok: true,
        filePath,
        totalSize: stat.size,
        manifest,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("inspect-share-package failed:", message);
      return { ok: false, error: message };
    }
  });

  // 流式导入分享包 (.kpack)
  ipcMain.handle("import-share-package", async (event, config) => {
    if (!config || typeof config !== "object") {
      throw new TypeError("Invalid import-share-package arguments");
    }
    const { filePath, dataPath, existingBookNames } = config;
    if (
      !filePath ||
      typeof filePath !== "string" ||
      !dataPath ||
      typeof dataPath !== "string"
    ) {
      throw new TypeError("Invalid arguments for import-share-package");
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: "Share package file not found" };
    }

    const sendProgress = (percent) => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("share-import-progress", { percent });
      }
    };

    try {
      const bookDir = path.join(dataPath, "book");
      const coverDir = path.join(dataPath, "cover");
      if (!fs.existsSync(bookDir)) fs.mkdirSync(bookDir, { recursive: true });
      if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });

      // 第一步：读取 manifest.json 和 notes/notes.json
      const meta = await new Promise((resolve, reject) => {
        yauzl.open(
          filePath,
          { lazyEntries: true, autoClose: true },
          (err, zf) => {
            if (err) return reject(err);
            let manifest = null;
            let rawNotes = [];

            zf.on("entry", (entry) => {
              if (entry.fileName === "manifest.json") {
                zf.openReadStream(entry, (readErr, stream) => {
                  if (readErr) return reject(readErr);
                  const chunks = [];
                  stream.on("data", (c) => chunks.push(c));
                  stream.on("error", reject);
                  stream.on("end", () => {
                    try {
                      manifest = JSON.parse(
                        Buffer.concat(chunks).toString("utf8")
                      );
                    } catch (e) {
                      return reject(e);
                    }
                    zf.readEntry();
                  });
                });
              } else if (entry.fileName === "notes/notes.json") {
                zf.openReadStream(entry, (readErr, stream) => {
                  if (readErr) return reject(readErr);
                  const chunks = [];
                  stream.on("data", (c) => chunks.push(c));
                  stream.on("error", reject);
                  stream.on("end", () => {
                    try {
                      rawNotes = JSON.parse(
                        Buffer.concat(chunks).toString("utf8")
                      );
                    } catch (e) {
                      return reject(e);
                    }
                    zf.readEntry();
                  });
                });
              } else {
                zf.readEntry();
              }
            });

            zf.on("end", () => {
              if (!manifest) {
                return reject(new Error("Missing manifest.json in share package"));
              }
              resolve({ manifest, rawNotes });
            });
            zf.on("error", reject);
            zf.readEntry();
          }
        );
      });

      const { manifest, rawNotes } = meta;
      const existingNameSet = new Set(
        Array.isArray(existingBookNames) ? existingBookNames : []
      );

      // 计算重命名（如果重名，添加（1）、（2）...）
      const getRenamedTitle = (title) => {
        if (!existingNameSet.has(title)) {
          existingNameSet.add(title);
          return title;
        }
        let index = 1;
        let candidate = `${title}（${index}）`;
        while (existingNameSet.has(candidate)) {
          index++;
          candidate = `${title}（${index}）`;
        }
        existingNameSet.add(candidate);
        return candidate;
      };

      const keyMap = {}; // originalKey -> newKey
      const newBooks = [];
      let renamedCount = 0;

      for (const b of manifest.books || []) {
        const origKey = b.originalKey || b.key;
        const newKey = nodeCrypto.randomUUID().replace(/-/g, "");
        keyMap[origKey] = newKey;

        const originalTitle = b.name || "Untitled";
        const finalTitle = getRenamedTitle(originalTitle);
        if (finalTitle !== originalTitle) {
          renamedCount++;
        }

        const format = (b.format || "epub").toUpperCase();
        const ext = format.toLowerCase();
        const targetBookPath = path.join(bookDir, `${newKey}.${ext}`);

        newBooks.push({
          key: newKey,
          name: finalTitle,
          author: b.author || "",
          description: b.description || "",
          md5: b.md5 || "",
          cover: "",
          format: format,
          publisher: b.publisher || "",
          size: b.size || 0,
          page: 0,
          path: targetBookPath,
          charset: b.charset || "utf-8",
        });
      }

      // 重新映射 notes 的 bookKey 与 key
      const newNotes = [];
      for (const note of rawNotes || []) {
        const mappedBookKey = keyMap[note.bookKey];
        if (mappedBookKey) {
          newNotes.push({
            ...note,
            key: nodeCrypto.randomUUID().replace(/-/g, ""),
            bookKey: mappedBookKey,
          });
        }
      }

      // 第二步：流式解压 book 与 cover 文件到本地目录
      await new Promise((resolve, reject) => {
        yauzl.open(
          filePath,
          { lazyEntries: true, autoClose: true },
          (err, zf) => {
            if (err) return reject(err);
            const total = zf.entryCount || 1;
            let count = 0;

            const next = () => {
              count++;
              sendProgress(Math.min(99, Math.round((count / total) * 100)));
              zf.readEntry();
            };

            zf.on("entry", (entry) => {
              const name = entry.fileName;
              if (name.startsWith("books/")) {
                const baseName = path.basename(name);
                const dotIdx = baseName.indexOf(".");
                const origKey = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
                const ext = dotIdx > 0 ? baseName.slice(dotIdx + 1) : "epub";
                const mappedKey = keyMap[origKey];
                if (mappedKey) {
                  const targetFile = path.join(
                    bookDir,
                    `${mappedKey}.${ext.toLowerCase()}`
                  );
                  zf.openReadStream(entry, (readErr, readStream) => {
                    if (readErr) return reject(readErr);
                    const writeStream = fs.createWriteStream(targetFile);
                    writeStream.on("close", next);
                    writeStream.on("error", reject);
                    readStream.on("error", reject);
                    readStream.pipe(writeStream);
                  });
                  return;
                }
              } else if (name.startsWith("covers/")) {
                const baseName = path.basename(name);
                const dotIdx = baseName.indexOf(".");
                const origKey =
                  dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
                const ext = dotIdx > 0 ? baseName.slice(dotIdx) : ".png";
                const mappedKey = keyMap[origKey];
                if (mappedKey) {
                  const targetCover = path.join(coverDir, `${mappedKey}${ext}`);
                  zf.openReadStream(entry, (readErr, readStream) => {
                    if (readErr) return reject(readErr);
                    const writeStream = fs.createWriteStream(targetCover);
                    writeStream.on("close", next);
                    writeStream.on("error", reject);
                    readStream.on("error", reject);
                    readStream.pipe(writeStream);
                  });
                  return;
                }
              }
              next();
            });

            zf.on("end", resolve);
            zf.on("error", reject);
            zf.readEntry();
          }
        );
      });

      sendProgress(100);
      return {
        ok: true,
        books: newBooks,
        notes: newNotes,
        shelfName: manifest.shelfName || null,
        renamedCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("import-share-package failed:", message);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("set-always-on-top", async (event, config) => {
    store.set("isAlwaysOnTop", config.isAlwaysOnTop);
    if (mainWin && !mainWin.isDestroyed()) {
      if (config.isAlwaysOnTop === "yes") {
        mainWin.setAlwaysOnTop(true);
      } else {
        mainWin.setAlwaysOnTop(false);
      }
    }
    if (readerWindow && !readerWindow.isDestroyed()) {
      if (config.isAlwaysOnTop === "yes") {
        readerWindow.setAlwaysOnTop(true);
      } else {
        readerWindow.setAlwaysOnTop(false);
      }
    }
    return "pong";
  });
  ipcMain.handle("set-auto-maximize", async (event, config) => {
    store.set("isAutoMaximizeWin", config.isAutoMaximizeWin);
    if (mainWin && !mainWin.isDestroyed()) {
      if (config.isAutoMaximizeWin === "yes") {
        mainWin.maximize();
      } else {
        mainWin.unmaximize();
      }
    }
    if (readerWindow && !readerWindow.isDestroyed()) {
      if (config.isAlwaysOnTop === "yes") {
        readerWindow.setAlwaysOnTop(true);
      } else {
        readerWindow.setAlwaysOnTop(false);
      }
    }
    return "pong";
  });
  ipcMain.handle("toggle-auto-launch", async (event, config) => {
    app.setLoginItemSettings({
      openAtLogin: config.isAutoLaunch === "yes",
    });
    return "pong";
  });
  ipcMain.handle("toggle-minimize-to-tray", async (event, config) => {
    store.set("isMinimizeToTray", config.isMinimizeToTray);
    if (config.isMinimizeToTray === "no" && tray) {
      tray.destroy();
      tray = null;
    }
    return "pong";
  });
  ipcMain.handle("open-explorer-folder", async (event, config) => {
    const { shell } = require("electron");
    if (config.isFolder) {
      shell.openPath(config.path);
    } else {
      shell.showItemInFolder(config.path);
    }

    return "pong";
  });
  ipcMain.handle("open-file-path", async (event, config) => {
    const { shell } = require("electron");
    if (config && config.path) {
      if (config.isFolder) {
        shell.openPath(config.path);
      } else {
        shell.showItemInFolder(config.path);
      }
    }
    return "pong";
  });
  ipcMain.handle("get-debug-logs", async (event, config) => {
    const { shell } = require("electron");
    const file = log.transports.file.getFile();
    shell.showItemInFolder(file.path);
    return "pong";
  });

  ipcMain.on("user-data", (event, arg) => {
    event.returnValue = dirPath;
  });
  ipcMain.handle("hide-reader", (event, arg) => {
    if (
      readerWindow &&
      !readerWindow.isDestroyed() &&
      readerWindow.isFocused()
    ) {
      readerWindow.minimize();
      event.returnvalue = true;
    } else if (mainWin && mainWin.isFocused()) {
      mainWin.minimize();
      event.returnvalue = true;
    } else {
      event.returnvalue = false;
    }
  });
  ipcMain.handle("open-console", (event, arg) => {
    mainWin.webContents.openDevTools();
    event.returnvalue = true;
  });
  ipcMain.handle("reload-reader", (event, arg) => {
    if (readerWindowList.length > 0) {
      readerWindowList.forEach((win) => {
        if (
          win &&
          !win.isDestroyed() &&
          win.webContents.getURL().indexOf(arg.bookKey) > -1
        ) {
          win.reload();
        }
      });
    }
    if (
      readerWindow &&
      !readerWindow.isDestroyed() &&
      readerWindow.webContents.getURL().indexOf(arg.bookKey) > -1
    ) {
      readerWindow.reload();
    }
  });
  ipcMain.handle("reload-main", (event, arg) => {
    if (mainWin) {
      mainWin.reload();
    }
  });

  ipcMain.handle("new-chat", (event, config) => {
    if (!chatWindow && mainWin) {
      let bounds = mainWin.getBounds();
      chatWindow = new BrowserWindow({
        ...options,
        width: 450,
        height: bounds.height,
        x: bounds.x + (bounds.width - 450),
        y: bounds.y,
        frame: true,
        hasShadow: true,
        transparent: false,
        webPreferences: {
          ...options.webPreferences,
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, "chat-preload.js"),
        },
      });
      chatWindow.loadURL(config.url);
      chatWindow.on("close", (event) => {
        chatWindow && chatWindow.destroy();
        chatWindow = null;
      });
    } else if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.show();
      chatWindow.focus();
    }
  });
  ipcMain.on("chat-message", (event, msg) => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send("chat-message", msg);
    }
  });
  ipcMain.handle("clear-all-data", (event, config) => {
    store.clear();
  });
  ipcMain.handle("new-tab", (event, config) => {
    if (mainWin) {
      mainView = new WebContentsView(options);
      mainWin.contentView.addChildView(mainView);
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
      mainView.webContents.loadURL(config.url);
      mainView.webContents.on("console-message", (_event, level, message) => {
        const lvl =
          { 0: "info", 1: "info", 2: "warn", 3: "error" }[level] || "info";
        log[lvl](`[Renderer] ${message}`);
      });
    }
  });
  ipcMain.handle("reload-tab", (event, config) => {
    if (mainWin && mainView) {
      mainView.webContents.reload();
    }
  });
  ipcMain.handle("adjust-tab-size", (event, config) => {
    if (mainWin && mainView) {
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  });
  ipcMain.handle("exit-tab", (event, message) => {
    return new Promise((resolve) => {
      const doRemoveTab = () => {
        if (mainWin && mainView) {
          mainWin.contentView.removeChildView(mainView);
        }
        if (discordRPCClient) {
          try {
            discordRPCClient.clearActivity();
          } catch (e) {
            console.warn("Failed to clear Discord activity:", e.message);
          }
        }
        resolve(undefined);
      };

      // Ask the tab renderer to flush reading-time data first, then close
      if (mainView && !mainView.webContents.isDestroyed()) {
        const timeoutId = setTimeout(() => {
          // Fallback: if renderer doesn't reply within 3s, close anyway
          ipcMain.removeListener("tab-close-ready", onTabCloseReady);
          doRemoveTab();
        }, 3000);
        const onTabCloseReady = () => {
          clearTimeout(timeoutId);
          doRemoveTab();
        };
        ipcMain.once("tab-close-ready", onTabCloseReady);
        mainView.webContents.send("before-tab-close");
      } else {
        doRemoveTab();
      }
    });
  });
  ipcMain.handle("enter-tab-fullscreen", () => {
    if (mainWin && mainView) {
      mainWin.setFullScreen(true);
      console.info("enter full");
    }
  });
  ipcMain.handle("exit-tab-fullscreen", () => {
    if (mainWin && mainView) {
      mainWin.setFullScreen(false);
      console.info("exit full");
    }
  });
  ipcMain.handle("enter-fullscreen", () => {
    if (readerWindow) {
      readerWindow.setFullScreen(true);
      console.info("enter full");
    }
  });
  ipcMain.handle("exit-fullscreen", () => {
    if (readerWindow && !readerWindow.isDestroyed()) {
      readerWindow.setFullScreen(false);
      console.info("exit full");
    }
  });
  ipcMain.handle("open-url", async (event, config) => {
    if (config.type === "dict") {
      if (!dictWindow || dictWindow.isDestroyed()) {
        dictWindow = new BrowserWindow({ icon: defaultAppIcon });
      }
      dictWindow.focus();
      await loadUrlInAuxWindow(dictWindow, config.url);
    } else if (config.type === "trans") {
      if (!transWindow || transWindow.isDestroyed()) {
        transWindow = new BrowserWindow({ icon: defaultAppIcon });
      }
      transWindow.focus();
      await loadUrlInAuxWindow(transWindow, config.url);
    } else {
      if (!linkWindow || linkWindow.isDestroyed()) {
        linkWindow = new BrowserWindow({ icon: defaultAppIcon });
      }
      linkWindow.loadURL(config.url);
      linkWindow.focus();
    }

    event.returnvalue = true;
  });
  ipcMain.handle("switch-moyu", (event, arg) => {
    let id;
    if (store.get("isPreventSleep") === "yes") {
      id = powerSaveBlocker.start("prevent-display-sleep");
      console.info(powerSaveBlocker.isStarted(id));
    }
    if (readerWindow && !readerWindow.isDestroyed()) {
      readerWindowReadyToClose = true;
      readerWindow.close();
      if (store.get("isMergeWord") === "yes") {
        delete options.backgroundColor;
      }
      const scaleRatio = store.get("windowDisplayScale") || 1;
      Object.assign(options, {
        width: parseInt(store.get("windowWidth") || 1050) / scaleRatio,
        height: parseInt(store.get("windowHeight") || 660) / scaleRatio,
        x: parseInt(store.get("windowX")),
        y: parseInt(store.get("windowY")),
        frame: store.get("isMergeWord") !== "yes" ? false : true,
        hasShadow: store.get("isMergeWord") !== "yes" ? false : true,
        transparent: store.get("isMergeWord") !== "yes" ? true : false,
      });

      store.set(
        "isMergeWord",
        store.get("isMergeWord") !== "yes" ? "yes" : "no"
      );
      if (readerWindow) {
        readerWindowList.push(readerWindow);
      }
      readerWindow = new BrowserWindow(options);
      if (store.get("isAlwaysOnTop") === "yes") {
        readerWindow.setAlwaysOnTop(true);
      }
      readerWindow.webContents.on(
        "console-message",
        (_event, level, message) => {
          const lvl =
            { 0: "info", 1: "info", 2: "warn", 3: "error" }[level] || "info";
          log[lvl](`[Renderer] ${message}`);
        }
      );
      readerWindow.loadURL(store.get("url"));
      readerWindowReadyToClose = false;
      readerWindow.on("close", (event) => {
        // --- Step 1: ask renderer to flush reading-time data first ---
        if (
          !readerWindowReadyToClose &&
          readerWindow &&
          !readerWindow.isDestroyed()
        ) {
          event.preventDefault();
          readerWindow.webContents.send("before-reader-close");
          return;
        }
        // --- Step 2: actual close logic (reached after renderer replied) ---
        if (!readerWindow.isDestroyed()) {
          let bounds = readerWindow.getBounds();
          const currentDisplay = screen.getDisplayMatching(bounds);
          const primaryDisplay = screen.getPrimaryDisplay();
          if (bounds.width > 300 && bounds.height > 100) {
            store.set({
              windowWidth: bounds.width,
              windowHeight: bounds.height,
              windowX:
                readerWindow.isMaximized() &&
                currentDisplay.id === primaryDisplay.id
                  ? 0
                  : bounds.x,
              windowY:
                readerWindow.isMaximized() &&
                currentDisplay.id === primaryDisplay.id
                  ? 0
                  : bounds.y < 0
                    ? 0
                    : bounds.y,
            });
          }
        }
        if (store.get("isPreventSleep") && !readerWindow.isDestroyed()) {
          id && powerSaveBlocker.stop(id);
        }
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send("reading-finished", {});
        }
        if (discordRPCClient) {
          try {
            discordRPCClient.clearActivity();
          } catch (e) {
            console.warn("Failed to clear Discord activity:", e.message);
          }
        }
      });
      // Renderer finished flushing reading-time data — proceed with actual close
      ipcMain.once("reader-close-ready", () => {
        if (readerWindow && !readerWindow.isDestroyed()) {
          readerWindowReadyToClose = true;
          readerWindow.close();
        }
      });
    }
    event.returnvalue = false;
  });
  ipcMain.on("storage-location", (event, config) => {
    event.returnValue = path.join(dirPath, "data");
  });
  ipcMain.on("url-window-status", (event, config) => {
    if (config.type === "dict") {
      event.returnValue =
        dictWindow && !dictWindow.isDestroyed() ? true : false;
    } else if (config.type === "trans") {
      event.returnValue =
        transWindow && !transWindow.isDestroyed() ? true : false;
    } else {
      event.returnValue =
        linkWindow && !linkWindow.isDestroyed() ? true : false;
    }
  });
  ipcMain.handle("mobile-server-status", async () => {
    return mobileServer.getStatus();
  });
  ipcMain.handle("mobile-server-toggle", async (event, enabled) => {
    if (enabled) {
      store.set("isEnableMobileCompanion", "yes");
      let token = store.get("mobileCompanionToken");
      if (!token) {
        token = nodeCrypto.randomBytes(16).toString("hex");
        store.set("mobileCompanionToken", token);
      }
      return await mobileServer.start({
        token,
        selectedAddress: store.get("mobileSelectedAddress") || null,
      });
    } else {
      store.set("isEnableMobileCompanion", "no");
      return await mobileServer.stop();
    }
  });
  ipcMain.handle("mobile-server-reset-token", async () => {
    const newToken = mobileServer.resetToken();
    store.set("mobileCompanionToken", newToken);
    return mobileServer.getStatus();
  });
  ipcMain.handle("mobile-server-select-address", async (event, address) => {
    mobileServer.setSelectedAddress(address);
    store.set("mobileSelectedAddress", address);
    return mobileServer.getStatus();
  });
  ipcMain.handle("mobile-sync-progress", async (event, { bookKey, record }) => {
    if (!bookKey || !record) return { success: false, reason: "Missing bookKey or record" };
    try {
      let records = {};
      const raw = store.get("recordLocation");
      if (typeof raw === "string") {
        try { records = JSON.parse(raw); } catch (e) {}
      } else if (typeof raw === "object" && raw !== null) {
        records = raw;
      }

      const existing = records[bookKey];
      const incomingTime = record.timestamp || Date.now();
      if (existing && existing.timestamp && existing.timestamp > incomingTime) {
        return { success: true, updated: false, reason: "Existing record is newer" };
      }

      records[bookKey] = {
        ...(existing || {}),
        ...record,
        timestamp: incomingTime,
      };
      store.set("recordLocation", JSON.stringify(records));

      // Update books.db page column if available
      try {
        const sPath = resolveStorage();
        const dbPath = path.join(sPath, "config", "books.db");
        if (fs.existsSync(dbPath) && record.page) {
          const db = (dbConnection && dbConnection["books"]) || new Database(dbPath);
          db.prepare("UPDATE books SET page = ? WHERE key = ?").run(parseInt(record.page, 10), bookKey);
        }
      } catch (dbErr) {}

      return { success: true, updated: true };
    } catch (err) {
      console.error("[Main] Error syncing progress:", err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle("mobile-sync-all-progress", async (event, desktopRecords = {}) => {
    try {
      let records = {};
      const raw = store.get("recordLocation");
      if (typeof raw === "string") {
        try { records = JSON.parse(raw); } catch (e) {}
      } else if (typeof raw === "object" && raw !== null) {
        records = raw;
      }

      const newerRecordsFromMobile = {};
      let changed = false;

      if (desktopRecords && typeof desktopRecords === "object") {
        for (const [key, dRec] of Object.entries(desktopRecords)) {
          if (!dRec) continue;
          const mRec = records[key];
          const dTime = dRec.timestamp || 0;
          const mTime = mRec ? (mRec.timestamp || 0) : 0;

          if (!mRec) {
            records[key] = { ...dRec, timestamp: dTime || Date.now() };
            changed = true;
          } else if (dTime >= mTime) {
            records[key] = { ...mRec, ...dRec, timestamp: dTime || Date.now() };
            changed = true;
          } else {
            // Mobile record is newer than desktop record
            newerRecordsFromMobile[key] = mRec;
          }
        }
      }

      // Also check if mobile store has any books that desktop completely lacks
      for (const [key, mRec] of Object.entries(records)) {
        if (!desktopRecords || !desktopRecords[key]) {
          newerRecordsFromMobile[key] = mRec;
        }
      }

      if (changed) {
        store.set("recordLocation", JSON.stringify(records));
      }

      return { success: true, newerRecords: newerRecordsFromMobile };
    } catch (err) {
      console.error("[Main] Error syncing all progress:", err);
      return { success: false, error: err.message, newerRecords: {} };
    }
  });
  ipcMain.handle("mobile-sync-blurred-books", async (event, blurredBooks = []) => {
    try {
      store.set("blurredBooks", Array.isArray(blurredBooks) ? blurredBooks : []);
      return { success: true };
    } catch (err) {
      console.error("[Main] Error syncing blurred books:", err);
      return { success: false, error: err.message };
    }
  });
  ipcMain.on("get-dirname", (event, arg) => {
    event.returnValue = __dirname;
  });
  ipcMain.on("system-color", (event, arg) => {
    event.returnValue = getNativeDarkColorStatus() || false;
  });
  ipcMain.handle("set-native-theme-source", (event, appSkin) => {
    return applyNativeThemeSource(appSkin);
  });
  ipcMain.on("get-file-data", function (event) {
    if (fs.existsSync(path.join(dirPath, "log.json"))) {
      try {
        const _data = JSON.parse(
          fs.readFileSync(path.join(dirPath, "log.json"), "utf-8") || "{}"
        );
        if (_data && _data.filePath) {
          filePath = _data.filePath;
          setTimeout(() => {
            fs.writeFileSync(path.join(dirPath, "log.json"), "{}", "utf-8");
          }, 1000);
        }
      } catch (error) {
        console.error("Error reading log.json:", error);
      }
    }

    event.returnValue = filePath;
    filePath = null;
  });
  ipcMain.on("check-file-data", function (event) {
    if (fs.existsSync(path.join(dirPath, "log.json"))) {
      try {
        const _data = JSON.parse(
          fs.readFileSync(path.join(dirPath, "log.json"), "utf-8") || "{}"
        );
        if (_data && _data.filePath) {
          filePath = _data.filePath;
        }
      } catch (error) {
        console.error("Error reading log.json:", error);
      }
    }

    event.returnValue = filePath;
    filePath = null;
  });
  ipcMain.handle("system-ocr", async (event, config) => {
    const { base64, lang } = config || {};
    let tempPath = null;
    try {
      const { buffer, ext } = parseOcrImageInput(base64);
      tempPath = writeOcrTempImage(buffer, ext);
      const { macos, win } = resolveOcrLang(lang);
      let text = "";
      if (process.platform === "darwin") {
        text = await runMacosOcr(tempPath, macos);
      } else if (process.platform === "win32") {
        text = await runWindowsOcr(tempPath, win);
      } else {
        return {
          ok: false,
          error: "System OCR is only supported on Windows and macOS",
        };
      }
      return { ok: true, text };
    } catch (error) {
      log.error("system-ocr failed:", error.message);
      return { ok: false, error: error.message || "OCR failed" };
    } finally {
      if (tempPath) {
        try {
          fs.unlinkSync(tempPath);
        } catch (e) {
          // 忽略清理失败
        }
      }
    }
  });
  initJmcomicIpc(ipcMain, () => mainWin);
  initPicaIpc(ipcMain, () => mainWin);
};

const applyCorsToRendererRequests = () => {
  const filter = {
    urls: ["http://*/*", "https://*/*"],
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      const url = details.url || "";
      if (
        url.includes("jmapinodeudzn.net") ||
        url.includes("jmapiproxy") ||
        url.includes("18comic") ||
        url.includes("cdnhjk.net") ||
        url.includes("cdngwc")
      ) {
        delete details.requestHeaders["Referer"];
        delete details.requestHeaders["Origin"];
        details.requestHeaders["User-Agent"] =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );
  session.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods":
          "GET, POST, PUT, DELETE, OPTIONS, PATCH",
        "Access-Control-Allow-Headers": "*, Authorization",
        "Access-Control-Expose-Headers": "*",
      };
      if (details.method === "OPTIONS") {
        corsHeaders["Access-Control-Max-Age"] = "86400";
      }
      for (const [name, value] of Object.entries(corsHeaders)) {
        for (const existingName of Object.keys(responseHeaders)) {
          if (existingName.toLowerCase() === name.toLowerCase()) {
            delete responseHeaders[existingName];
          }
        }
        responseHeaders[name] = [value];
      }
      callback({ responseHeaders });
    }
  );
};

app.on("ready", async () => {
  applyCorsToRendererRequests();
  await applyProxyToSession();
  initMobileServer();
  createMainWin();
});
app.on("before-quit", () => {
  isQuitting = true;
  mobileServer.stop();
  destroyDiscordRPC();
  closeAllDatabases();
});
app.on("window-all-closed", () => {
  app.quit();
});
app.on("open-file", (e, pathToFile) => {
  filePath = pathToFile;
  if (
    pathToFile &&
    pathToFile.endsWith(".kpack") &&
    mainWin &&
    !mainWin.isDestroyed()
  ) {
    mainWin.webContents.send("open-share-package", pathToFile);
  }
});
// Register protocol handler
app.setAsDefaultProtocolClient("koodo-reader");
const serializeArg = (arg) => {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
};
const originalConsoleLog = console.log;
console.log = function (...args) {
  originalConsoleLog(...args); // 保留原日志
  log.info(args.map(serializeArg).join(" ")); // 写入日志文件
};
const originalConsoleError = console.error;
console.error = function (...args) {
  originalConsoleError(...args); // 保留原错误日志
  log.error(args.map(serializeArg).join(" ")); // 写入错误日志文件
};
const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  originalConsoleWarn(...args); // 保留原警告日志
  log.warn(args.map(serializeArg).join(" ")); // 写入警告日志文件
};
const originalConsoleInfo = console.info;
console.info = function (...args) {
  originalConsoleInfo(...args); // 保留原信息日志
  log.info(args.map(serializeArg).join(" ")); // 写入信息日志文件
};
// Handle MacOS deep linking
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleCallback(url);
});
const handleCallback = (url) => {
  try {
    // 检查 URL 是否有效
    if (!url.startsWith("koodo-reader://")) {
      console.error("Invalid URL format:", url);
      return;
    }

    // 解析 URL
    const parsedUrl = new URL(url);
    const code = parsedUrl.searchParams.get("code");
    const state = parsedUrl.searchParams.get("state");
    const pickerData = parsedUrl.searchParams.get("pickerData");

    const bookKey = parsedUrl.searchParams.get("bookKey");
    const noteKey = parsedUrl.searchParams.get("noteKey");
    const importUrl = parsedUrl.searchParams.get("importUrl");

    if (code && mainWin) {
      mainWin.webContents.send("oauth-callback", { code, state });
    }
    if (pickerData && mainWin) {
      let config = JSON.parse(decodeURIComponent(pickerData));
      mainWin.webContents.send("picker-finished", config);
    }
    if (bookKey && mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send("open-book-from-link", { bookKey });
    }
    if (noteKey && mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send("open-note-from-link", { noteKey });
    }
    if (importUrl && mainWin) {
      const decodedUrl = decodeURIComponent(importUrl);
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send("import-url-from-link", { url: decodedUrl });
    }
  } catch (error) {
    console.error("Error handling callback URL:", error);
    console.info("Problematic URL:", url);
  }
};
