const test = require("node:test");
const assert = require("node:assert/strict");
const { MobileServer } = require("./mobileServer");
const { registerProgressSyncRoutes } = require("./progressSyncRouter");

test("ProgressSync handles POST, GET, conflict resolution, and desktop relay", async () => {
  const storeData = {};
  const mockStore = {
    get: (key) => storeData[key] || null,
    set: (key, val) => {
      storeData[key] = val;
    },
  };

  const ipcRelayEvents = [];
  const server = new MobileServer();
  const token = "progress-sync-token";

  registerProgressSyncRoutes(server, {
    getStore: () => mockStore,
    onProgressUpdated: (bookKey, record) => {
      ipcRelayEvents.push({ bookKey, record });
    },
  });

  const status = await server.start({
    port: 28380,
    host: "127.0.0.1",
    token,
  });

  try {
    // 1. Initial GET: returns null
    const get1 = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-comic/progress?token=${token}`
    );
    assert.equal(get1.status, 200);
    const get1Data = await get1.json();
    assert.equal(get1Data.progress, null);

    // 2. POST initial progress: page 20, 20%, timestamp 1000
    const post1 = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-comic/progress?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: 20,
          totalPages: 100,
          percentage: 0.2,
          timestamp: 1000,
          chapterTitle: "Chapter 1",
        }),
      }
    );
    assert.equal(post1.status, 200);
    const post1Data = await post1.json();
    assert.equal(post1Data.success, true);
    assert.equal(post1Data.updated, true);
    assert.equal(post1Data.progress.page, "20");

    // Verify IPC notification fired
    assert.equal(ipcRelayEvents.length, 1);
    assert.equal(ipcRelayEvents[0].bookKey, "test-comic");
    assert.equal(ipcRelayEvents[0].record.page, "20");

    // 3. POST older progress: timestamp 500 -> Conflict resolution: should NOT overwrite!
    const post2 = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-comic/progress?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: 10,
          totalPages: 100,
          percentage: 0.1,
          timestamp: 500, // older than 1000
        }),
      }
    );
    assert.equal(post2.status, 200);
    const post2Data = await post2.json();
    assert.equal(post2Data.updated, false);
    assert.equal(post2Data.progress.page, "20"); // Still page 20!

    // 4. POST newer progress: timestamp 2000 -> Should overwrite!
    const post3 = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-comic/progress?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: 55,
          totalPages: 100,
          percentage: 0.55,
          timestamp: 2000, // newer than 1000
          chapterTitle: "Chapter 3",
        }),
      }
    );
    assert.equal(post3.status, 200);
    const post3Data = await post3.json();
    assert.equal(post3Data.updated, true);
    assert.equal(post3Data.progress.page, "55");

    // Verify second IPC notification
    assert.equal(ipcRelayEvents.length, 2);
    assert.equal(ipcRelayEvents[1].record.page, "55");

    // 5. GET verification
    const getFinal = await fetch(
      `http://127.0.0.1:${status.port}/api/book/test-comic/progress?token=${token}`
    );
    assert.equal(getFinal.status, 200);
    const getFinalData = await getFinal.json();
    assert.equal(getFinalData.progress.page, "55");
    assert.equal(getFinalData.progress.percentage, "0.55");
  } finally {
    await server.stop();
  }
});
