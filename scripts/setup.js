const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { ensureProjectEnvironment } = require("./setup-python");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      env: process.env,
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function hasElectronRuntime() {
  const electronDir = path.join(__dirname, "..", "node_modules", "electron");
  const pathFile = path.join(electronDir, "path.txt");
  if (!fs.existsSync(pathFile)) return false;
  const executable = fs.readFileSync(pathFile, "utf8").trim();
  return (
    Boolean(executable) &&
    fs.existsSync(path.join(electronDir, "dist", executable))
  );
}

async function ensureElectronRuntime() {
  if (hasElectronRuntime()) return;
  console.log("[setup] Repairing the Electron runtime download...");
  await run(process.execPath, [
    path.join(__dirname, "..", "node_modules", "electron", "install.js"),
  ]);
  if (!hasElectronRuntime()) {
    throw new Error("Electron runtime installation did not produce an executable.");
  }
}

async function main() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor !== 22) {
    throw new Error(`Node.js 22 is required; detected ${process.versions.node}.`);
  }

  const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
  const yarnVersion = spawnSync(yarn, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  const detectedYarn = yarnVersion.stdout?.trim() || "missing";
  if (yarnVersion.status !== 0 || detectedYarn !== "1.22.22") {
    throw new Error(
      `Yarn 1.22.22 is required; detected ${detectedYarn}. Run \`corepack enable\` and \`corepack prepare yarn@1.22.22 --activate\`.`
    );
  }

  console.log("[setup] Installing JavaScript dependencies from yarn.lock...");
  await run(yarn, ["install", "--frozen-lockfile"]);
  await ensureElectronRuntime();
  console.log("[setup] Creating or repairing the project Python environment...");
  const result = await ensureProjectEnvironment();
  console.log(result.data);
  console.log("[setup] Koodo Reader Personal is ready. Start it with `yarn dev`.");
}

main().catch((error) => {
  console.error(`[setup] ${error.message}`);
  process.exitCode = 1;
});
