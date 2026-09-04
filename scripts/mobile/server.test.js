const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { MobileServer } = require("./mobileServer");
const {
  isPrivateIPv4,
  isVirtualAdapter,
  getInterfacePriority,
  getAvailableInterfaces,
  getPrimaryAddress,
} = require("./networkUtil");

test("networkUtil detects private IPv4 correctly", () => {
  assert.equal(isPrivateIPv4("192.168.1.100"), true);
  assert.equal(isPrivateIPv4("10.0.0.5"), true);
  assert.equal(isPrivateIPv4("172.20.10.2"), true);
  assert.equal(isPrivateIPv4("172.15.0.1"), false);
  assert.equal(isPrivateIPv4("172.32.0.1"), false);
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("127.0.0.1"), false);
  assert.equal(isPrivateIPv4("invalid"), false);
});

test("networkUtil flags virtual adapters", () => {
  assert.equal(isVirtualAdapter("vEthernet (WSL)"), true);
  assert.equal(isVirtualAdapter("docker0"), true);
  assert.equal(isVirtualAdapter("VMware Network Adapter VMnet1"), true);
  assert.equal(isVirtualAdapter("VirtualBox Host-Only Ethernet Adapter"), true);
  assert.equal(isVirtualAdapter("Wi-Fi"), false);
  assert.equal(isVirtualAdapter("WLAN"), false);
  assert.equal(isVirtualAdapter("以太网"), false);
  assert.equal(isVirtualAdapter("Ethernet 2"), false);
});

test("networkUtil prioritizes physical Wi-Fi over virtual adapters", () => {
  const mockInterfaces = {
    "vEthernet (WSL)": [
      { address: "172.28.16.1", family: "IPv4", internal: false },
    ],
    "Loopback Pseudo-Interface 1": [
      { address: "127.0.0.1", family: "IPv4", internal: true },
    ],
    "Wi-Fi": [
      { address: "192.168.31.50", family: "IPv4", internal: false },
    ],
    "Ethernet": [
      { address: "192.168.1.10", family: "IPv4", internal: false },
    ],
  };

  const available = getAvailableInterfaces(mockInterfaces);
  assert.ok(available.length >= 3);
  // Wi-Fi should be #1
  assert.equal(available[0].name, "Wi-Fi");
  assert.equal(available[0].address, "192.168.31.50");
  // Primary address should be the Wi-Fi address
  assert.equal(getPrimaryAddress(mockInterfaces), "192.168.31.50");
});

test("mobileServer starts and responds with 401 on missing/invalid token", async () => {
  const server = new MobileServer();
  const token = "test-secret-token-12345";
  const status = await server.start({
    port: 28300,
    host: "127.0.0.1",
    token,
  });

  try {
    assert.equal(status.running, true);
    assert.equal(status.port, 28300);
    assert.equal(status.token, token);

    // 1. Request without token -> 401
    const resNoToken = await fetch(`http://127.0.0.1:${status.port}/`);
    assert.equal(resNoToken.status, 401);
    const body401 = await resNoToken.json();
    assert.equal(body401.error, "Unauthorized");

    // 2. Request with invalid token -> 401
    const resBadToken = await fetch(`http://127.0.0.1:${status.port}/?token=wrong-token`);
    assert.equal(resBadToken.status, 401);

    // 3. Request with valid token in query param -> 200
    const resValid = await fetch(`http://127.0.0.1:${status.port}/?token=${token}`);
    assert.equal(resValid.status, 200);
    const html = await resValid.text();
    assert.ok(html.includes("Koodo Reader"));

    // 4. Request with valid token in Authorization header -> 200
    const resAuthHeader = await fetch(`http://127.0.0.1:${status.port}/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(resAuthHeader.status, 200);
  } finally {
    await server.stop();
  }
});

test("mobileServer handles port collision by scanning next free port", async () => {
  // Occupy port 28310 with a dummy HTTP server
  const blocker = http.createServer((req, res) => res.end("blocked"));
  await new Promise((resolve) => blocker.listen(28310, "127.0.0.1", resolve));

  const server = new MobileServer();
  try {
    const status = await server.start({
      port: 28310,
      maxPort: 28320,
      host: "127.0.0.1",
      token: "test-token-collision",
    });

    // Should have skipped 28310 and bound to 28311
    assert.equal(status.running, true);
    assert.equal(status.port, 28311);
  } finally {
    await server.stop();
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("mobileServer resets token and updates connectionUrl", async () => {
  const server = new MobileServer();
  const status = await server.start({
    port: 28325,
    host: "127.0.0.1",
  });

  try {
    const oldToken = status.token;
    assert.ok(oldToken.length > 0);

    const newToken = server.resetToken();
    assert.notEqual(oldToken, newToken);

    const newStatus = server.getStatus();
    assert.equal(newStatus.token, newToken);
    assert.ok(newStatus.connectionUrl.includes(newToken));
  } finally {
    await server.stop();
  }
});
