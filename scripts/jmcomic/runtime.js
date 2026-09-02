const fs = require("fs");
const path = require("path");

const EXPECTED_JMCOMIC_VERSION = "2.7.5";
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const BRIDGE_SCRIPT = path.join(__dirname, "jm_bridge.py");

function projectVenvPython(platform = process.platform) {
  return platform === "win32"
    ? path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(PROJECT_ROOT, ".venv", "bin", "python");
}

function resolveJmcomicRuntime(options = {}, context = {}) {
  const isPackaged = Boolean(context.isPackaged);
  const platform = context.platform || process.platform;

  if (isPackaged) {
    const resourcesPath = context.resourcesPath || process.resourcesPath;
    const executable = path.join(
      resourcesPath,
      "jmcomic-bridge",
      platform === "win32" ? "jmcomic-bridge.exe" : "jmcomic-bridge"
    );
    return {
      executable,
      prefixArgs: [],
      cwd: path.dirname(executable),
      mode: "bundled-sidecar",
      available: fs.existsSync(executable),
    };
  }

  const customPython =
    typeof options.pythonPath === "string" ? options.pythonPath.trim() : "";
  if (customPython) {
    return {
      executable: customPython,
      prefixArgs: [BRIDGE_SCRIPT],
      cwd: __dirname,
      mode: "custom-python",
      available: fs.existsSync(customPython),
    };
  }

  const executable = projectVenvPython(platform);
  return {
    executable,
    prefixArgs: [BRIDGE_SCRIPT],
    cwd: __dirname,
    mode: "project-venv",
    available: fs.existsSync(executable),
  };
}

function runtimeEnvironment(runtime) {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    KOODO_JM_RUNTIME_MODE: runtime.mode,
    KOODO_JM_EXPECTED_VERSION: EXPECTED_JMCOMIC_VERSION,
  };
}

function runtimeUnavailableResult(runtime) {
  const repair =
    runtime.mode === "bundled-sidecar"
      ? "Reinstall Koodo Reader Personal from a complete release package."
      : "Run `yarn setup` from the project root, then restart the app.";
  return {
    code: 1,
    msg: `JMComic runtime was not found at ${runtime.executable}. ${repair}`,
    data: {
      has_jmcomic: false,
      runtimeAvailable: false,
      python_path: runtime.executable,
      runtimeMode: runtime.mode,
      expectedJmcomicVersion: EXPECTED_JMCOMIC_VERSION,
    },
  };
}

module.exports = {
  BRIDGE_SCRIPT,
  EXPECTED_JMCOMIC_VERSION,
  PROJECT_ROOT,
  projectVenvPython,
  resolveJmcomicRuntime,
  runtimeEnvironment,
  runtimeUnavailableResult,
};
