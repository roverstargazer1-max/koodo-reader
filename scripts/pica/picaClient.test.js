const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  PicaClient,
  generateSignature,
  createHeaders,
  getImageUrl,
  API_KEY,
  SECRET_KEY,
  ROUTE_HOSTS,
  ROUTE_CHANNELS,
} = require("./picaClient");

test("generateSignature generates deterministic HMAC-SHA256 hash", () => {
  const path = "auth/sign-in";
  const timestamp = "1672531199";
  const nonce = "testnoncestring1234567890abcdef";
  const method = "POST";

  const expectedRaw = (path + timestamp + nonce + method + API_KEY).toLowerCase();
  const expectedSig = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(expectedRaw)
    .digest("hex");

  const sig = generateSignature(path, timestamp, nonce, method);
  assert.equal(sig, expectedSig);
  assert.equal(typeof sig, "string");
  assert.equal(sig.length, 64);
});

test("generateSignature strips full URL hostname and leading slashes", () => {
  const fullUrl = "https://picaapi.picacomic.com/comics/search?page=1";
  const timestamp = "1700000000";
  const nonce = "nonce123";
  const method = "GET";

  const sigFromFullUrl = generateSignature(fullUrl, timestamp, nonce, method);
  const sigFromPath = generateSignature("comics/search?page=1", timestamp, nonce, method);
  assert.equal(sigFromFullUrl, sigFromPath);
});

test("createHeaders builds complete PicACG request headers with signature and token", () => {
  const path = "categories";
  const token = "mock-jwt-token-xyz";
  const headers = createHeaders(path, "GET", token, {
    quality: "high",
    channel: "3",
    timestamp: "1700000000",
    nonce: "test-nonce-1234",
  });

  assert.equal(headers["api-key"], API_KEY);
  assert.equal(headers["accept"], "application/vnd.picacomic.com.v1+json");
  assert.equal(headers["app-channel"], "3");
  assert.equal(headers["time"], "1700000000");
  assert.equal(headers["nonce"], "testnonce1234");
  assert.equal(headers["image-quality"], "high");
  assert.equal(headers["authorization"], "mock-jwt-token-xyz");
  assert.equal(headers["Content-Type"], "application/json; charset=UTF-8");
  assert.equal(typeof headers["signature"], "string");
  assert.equal(headers["signature"].length, 64);
});

test("getImageUrl normalizes fileServer and relative path to static URL", () => {
  const thumb = {
    fileServer: "https://storage1.picacomic.com",
    path: "tobeimg/xxx.jpg",
  };
  assert.equal(
    getImageUrl(thumb),
    "https://storage1.picacomic.com/static/tobeimg/xxx.jpg"
  );

  const thumbTrailingSlash = {
    fileServer: "https://storage1.picacomic.com/",
    path: "/tobeimg/yyy.jpg",
  };
  assert.equal(
    getImageUrl(thumbTrailingSlash),
    "https://storage1.picacomic.com/static/tobeimg/yyy.jpg"
  );
});

test("PicaClient routes and config management", () => {
  const client = new PicaClient({ route: "route1" });
  assert.equal(client.getBaseUrl(), ROUTE_HOSTS.route1);
  assert.equal(client.getChannel(), "1");

  client.updateConfig({ route: "route2", quality: "low" });
  assert.equal(client.getBaseUrl(), ROUTE_HOSTS.route2);
  assert.equal(client.getChannel(), "2");
  assert.equal(client.quality, "low");

  client.updateConfig({ route: "route3" });
  assert.equal(client.getBaseUrl(), ROUTE_HOSTS.route3);
  assert.equal(client.getChannel(), "3");
});

test("PicaClient proxy agent creation", () => {
  const clientHttp = new PicaClient({ proxy: "http://127.0.0.1:7890" });
  const agentHttp = clientHttp.getAgent();
  assert.ok(agentHttp);

  const clientSocks = new PicaClient({ proxy: "socks5://127.0.0.1:1080" });
  const agentSocks = clientSocks.getAgent();
  assert.ok(agentSocks);

  const clientDirect = new PicaClient({ proxy: "" });
  assert.equal(clientDirect.getAgent(), null);
});

test("generateSignature includes full query string in signature calculation", () => {
  const path = "comics/leaderboard?tt=H24&ct=VC";
  const timestamp = "1700000000";
  const nonce = "testnoncestring1234567890abcdef";
  const method = "GET";

  const expectedRaw = (path + timestamp + nonce + method + API_KEY).toLowerCase();
  const expectedSig = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(expectedRaw)
    .digest("hex");

  const sig = generateSignature(path, timestamp, nonce, method);
  assert.equal(sig, expectedSig);
});
