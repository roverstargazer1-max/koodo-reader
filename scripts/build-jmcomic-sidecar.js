const { spawn } = require("child_process");
const path = require("path");

const { PROJECT_ROOT, projectVenvPython } = require("./jmcomic/runtime");
const { ensureProjectEnvironment } = require("./setup-python");

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`PyInstaller exited with code ${code}`));
    });
  });
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("The v0.1.0 sidecar build supports Windows x64 only.");
  }
  await ensureProjectEnvironment({ build: true });
  const python = projectVenvPython();
  await run(python, [
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--distpath",
    path.join(PROJECT_ROOT, "dist-sidecar"),
    "--workpath",
    path.join(PROJECT_ROOT, ".pyinstaller-build"),
    path.join(PROJECT_ROOT, "scripts", "jmcomic", "jmcomic-bridge.spec"),
  ]);
}

main().catch((error) => {
  console.error(`[sidecar] ${error.message}`);
  process.exitCode = 1;
});
