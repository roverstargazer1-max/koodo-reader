const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  BRIDGE_SCRIPT,
  EXPECTED_JMCOMIC_VERSION,
  projectVenvPython,
  resolveJmcomicRuntime,
  runtimeEnvironment,
  runtimeUnavailableResult,
} = require("./runtime");

test("packaged Windows uses the external onedir sidecar", () => {
  const resourcesPath = path.join("C:", "app", "resources");
  const runtime = resolveJmcomicRuntime(
    {},
    { isPackaged: true, platform: "win32", resourcesPath }
  );

  assert.equal(
    runtime.executable,
    path.join(resourcesPath, "jmcomic-bridge", "jmcomic-bridge.exe")
  );
  assert.deepEqual(runtime.prefixArgs, []);
  assert.equal(runtime.cwd, path.dirname(runtime.executable));
  assert.equal(runtime.mode, "bundled-sidecar");
});

test("source mode prefers an explicit Python path", () => {
  const customPython = __filename;
  const runtime = resolveJmcomicRuntime(
    { pythonPath: customPython },
    { isPackaged: false, platform: "win32" }
  );

  assert.equal(runtime.executable, customPython);
  assert.deepEqual(runtime.prefixArgs, [BRIDGE_SCRIPT]);
  assert.equal(runtime.mode, "custom-python");
  assert.equal(runtime.available, true);
});

test("source mode defaults to the project virtual environment", () => {
  const runtime = resolveJmcomicRuntime(
    {},
    { isPackaged: false, platform: "win32" }
  );

  assert.equal(runtime.executable, projectVenvPython("win32"));
  assert.deepEqual(runtime.prefixArgs, [BRIDGE_SCRIPT]);
  assert.equal(runtime.mode, "project-venv");
});

test("runtime environment exposes mode and the pinned JMComic version", () => {
  const env = runtimeEnvironment({ mode: "project-venv" });
  assert.equal(env.KOODO_JM_RUNTIME_MODE, "project-venv");
  assert.equal(env.KOODO_JM_EXPECTED_VERSION, EXPECTED_JMCOMIC_VERSION);
  assert.equal(env.PYTHONIOENCODING, "utf-8");
});

test("missing runtime is reported as unavailable", () => {
  const runtime = {
    executable: path.join("C:", "missing", "jmcomic-bridge.exe"),
    mode: "bundled-sidecar",
  };
  const result = runtimeUnavailableResult(runtime);

  assert.equal(result.code, 1);
  assert.equal(result.data.runtimeAvailable, false);
  assert.equal(result.data.has_jmcomic, false);
  assert.equal(result.data.runtimeMode, "bundled-sidecar");
});
