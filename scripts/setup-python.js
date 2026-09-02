const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  EXPECTED_JMCOMIC_VERSION,
  PROJECT_ROOT,
  projectVenvPython,
} = require("./jmcomic/runtime");

const RUNTIME_LOCK = path.join(
  PROJECT_ROOT,
  "scripts",
  "jmcomic",
  "requirements.lock"
);
const BUILD_LOCK = path.join(
  PROJECT_ROOT,
  "scripts",
  "jmcomic",
  "requirements-build.lock"
);

function commandName(name) {
  return process.platform === "win32" && name === "python"
    ? "python.exe"
    : name;
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(
        new Error(
          (stderr || stdout || `${executable} exited with code ${code}`).trim()
        )
      );
    });
  });
}

function probePython(executable, prefixArgs = []) {
  const result = spawnSync(
    executable,
    [
      ...prefixArgs,
      "-c",
      "import json,platform,sys; print(json.dumps({'major':sys.version_info.major,'minor':sys.version_info.minor,'bits':platform.architecture()[0],'executable':sys.executable}))",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10000 }
  );
  if (result.status !== 0) return null;
  try {
    const info = JSON.parse(result.stdout.trim());
    return info.major === 3 && info.minor === 12 && info.bits === "64bit"
      ? info
      : null;
  } catch {
    return null;
  }
}

function findBootstrapPython(customPython) {
  const candidates = [];
  if (customPython) candidates.push({ executable: customPython, prefixArgs: [] });
  if (process.env.KOODO_PYTHON) {
    candidates.push({ executable: process.env.KOODO_PYTHON, prefixArgs: [] });
  }
  if (process.platform === "win32") {
    candidates.push(
      { executable: "py", prefixArgs: ["-3.12"] },
      { executable: commandName("python"), prefixArgs: [] },
      { executable: "python3", prefixArgs: [] }
    );
  } else {
    candidates.push(
      { executable: "python3.12", prefixArgs: [] },
      { executable: "python3", prefixArgs: [] },
      { executable: "python", prefixArgs: [] }
    );
  }

  for (const candidate of candidates) {
    const info = probePython(candidate.executable, candidate.prefixArgs);
    if (info) return { ...candidate, info };
  }
  throw new Error(
    "Python 3.12 x64 was not found. Install it, then run `yarn setup` again."
  );
}

async function ensureProjectEnvironment(options = {}) {
  const logs = [];
  const venvPython = projectVenvPython();

  if (!probePython(venvPython)) {
    const bootstrap = findBootstrapPython(options.pythonPath);
    logs.push(`Bootstrap Python: ${bootstrap.info.executable}`);
    const venvDir = path.join(PROJECT_ROOT, ".venv");
    if (fs.existsSync(venvDir)) {
      fs.rmSync(venvDir, { recursive: true, force: true });
      logs.push("Removed an incompatible project virtual environment.");
    }
    logs.push("Creating .venv with Python 3.12 x64...");
    await run(bootstrap.executable, [
      ...bootstrap.prefixArgs,
      "-m",
      "venv",
      ".venv",
    ]);
  } else {
    logs.push(`Using existing project environment: ${venvPython}`);
  }

  const lockFile = options.build ? BUILD_LOCK : RUNTIME_LOCK;
  logs.push(`Installing locked dependencies from ${path.basename(lockFile)}...`);
  await run(venvPython, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--upgrade",
    "--requirement",
    lockFile,
  ]);

  const check = await run(
    venvPython,
    [path.join(PROJECT_ROOT, "scripts", "jmcomic", "jm_bridge.py"), "check_env"],
    { capture: true }
  );
  const status = JSON.parse(check.stdout.trim().split(/\r?\n/).pop());
  if (
    status.code !== 0 ||
    status.data?.jmcomic_version !== EXPECTED_JMCOMIC_VERSION
  ) {
    throw new Error(status.msg || "JMComic environment self-check failed.");
  }
  logs.push(`JMComic ${EXPECTED_JMCOMIC_VERSION} self-check passed.`);
  return { code: 0, msg: "Project Python environment is ready.", data: logs.join("\n") };
}

function parseArgs(argv) {
  const options = { build: false, json: false, pythonPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--build") options.build = true;
    if (argv[index] === "--json") options.json = true;
    if (argv[index] === "--python") options.pythonPath = argv[index + 1] || "";
  }
  return options;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  ensureProjectEnvironment(options)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(JSON.stringify({ code: 1, msg: error.message }));
      process.exitCode = 1;
    });
}

module.exports = { ensureProjectEnvironment, findBootstrapPython, probePython };
