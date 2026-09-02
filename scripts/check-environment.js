const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  BRIDGE_SCRIPT,
  EXPECTED_JMCOMIC_VERSION,
  projectVenvPython,
} = require("./jmcomic/runtime");

function fail(message) {
  console.error(`[environment] ${message}`);
  console.error("[environment] Repair command: yarn setup");
  process.exit(1);
}

if (Number(process.versions.node.split(".")[0]) !== 22) {
  fail(`Node.js 22 is required; detected ${process.versions.node}.`);
}

const yarnCommand = process.platform === "win32" ? "yarn.cmd" : "yarn";
const yarn = spawnSync(yarnCommand, ["--version"], {
  encoding: "utf8",
  windowsHide: true,
  shell: process.platform === "win32",
});
if (yarn.status !== 0 || yarn.stdout.trim() !== "1.22.22") {
  fail(`Yarn 1.22.22 is required; detected ${yarn.stdout.trim() || "missing"}.`);
}

if (!fs.existsSync("node_modules")) {
  fail("Node dependencies are missing.");
}

const electronDir = path.resolve("node_modules", "electron");
const electronPathFile = path.join(electronDir, "path.txt");
const electronExecutable = fs.existsSync(electronPathFile)
  ? fs.readFileSync(electronPathFile, "utf8").trim()
  : "";
if (
  !electronExecutable ||
  !fs.existsSync(path.join(electronDir, "dist", electronExecutable))
) {
  fail("The Electron runtime is missing or incomplete.");
}

const python = projectVenvPython();
if (!fs.existsSync(python)) {
  fail("The project .venv is missing.");
}

const check = spawnSync(python, [BRIDGE_SCRIPT, "check_env"], {
  encoding: "utf8",
  windowsHide: true,
  env: {
    ...process.env,
    KOODO_JM_RUNTIME_MODE: "project-venv",
    KOODO_JM_EXPECTED_VERSION: EXPECTED_JMCOMIC_VERSION,
  },
});
if (check.status !== 0) {
  fail((check.stdout || check.stderr || "JMComic self-check failed.").trim());
}

console.log(
  `[environment] Node ${process.versions.node}, Yarn 1.22.22, Python 3.12, and JMComic ${EXPECTED_JMCOMIC_VERSION} are ready.`
);
