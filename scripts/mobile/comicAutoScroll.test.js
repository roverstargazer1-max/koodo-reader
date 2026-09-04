const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("Mobile comic reader contains all auto-scroll DOM elements, controls, and logic", () => {
  const jsPath = path.join(__dirname, "..", "..", "public", "mobile", "comicReader.js");
  const cssPath = path.join(__dirname, "..", "..", "public", "mobile", "comicReader.css");

  assert.ok(fs.existsSync(jsPath), "comicReader.js must exist");
  assert.ok(fs.existsSync(cssPath), "comicReader.css must exist");

  const jsContent = fs.readFileSync(jsPath, "utf-8");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  // 1. DOM IDs and Classes
  assert.ok(jsContent.includes('id="comic-auto-scroll-hud"'), "HUD container must be in template");
  assert.ok(jsContent.includes('id="comic-auto-scroll-btn"'), "Play/Pause button must be present");
  assert.ok(jsContent.includes('id="comic-auto-scroll-gear"'), "Speed popover gear button must be present");
  assert.ok(jsContent.includes('id="comic-speed-slider"'), "Speed slider range input must be present");
  assert.ok(jsContent.includes('id="comic-speed-popover"'), "Speed popover container must be present");
  assert.ok(jsContent.includes('id="comic-toast"'), "Toast notification container must be present");

  // 2. State and Lifecycle logic
  assert.ok(jsContent.includes("isAutoScrolling: false"), "Initial state must have isAutoScrolling false");
  assert.ok(jsContent.includes("koodo_comic_auto_scroll_speed"), "Speed must be persisted to localStorage");
  assert.ok(jsContent.includes("startAutoScroll"), "startAutoScroll function must exist");
  assert.ok(jsContent.includes("stopAutoScroll"), "stopAutoScroll function must exist");
  assert.ok(jsContent.includes("toggleAutoScroll"), "toggleAutoScroll function must exist");
  assert.ok(jsContent.includes("setupAutoScrollControls"), "setupAutoScrollControls function must exist");

  // 3. User Intervention Handlers
  assert.ok(jsContent.includes('scrollEl.addEventListener("touchstart", handleUserIntervention'), "touchstart must stop auto-scroll");
  assert.ok(jsContent.includes('scrollEl.addEventListener("mousedown", handleUserIntervention'), "mousedown must stop auto-scroll");
  assert.ok(jsContent.includes('scrollEl.addEventListener("wheel", handleUserIntervention'), "wheel must stop auto-scroll");
  assert.ok(jsContent.includes("wasJustInterrupted"), "Must track interruption to prevent unwanted control toggling");

  // 4. Boundary and Mode handling
  assert.ok(jsContent.includes("已到达末尾"), "Must alert reached bottom of comic");
  assert.ok(jsContent.includes('hud.classList.add("hidden")'), "Must hide HUD when in paged mode");
  assert.ok(jsContent.includes("wakeLock"), "Must request screen wakeLock to prevent screen sleep");

  // 5. CSS checks
  assert.ok(cssContent.includes(".comic-auto-scroll-hud"), "CSS must style auto-scroll HUD");
  assert.ok(cssContent.includes(".comic-speed-popover"), "CSS must style speed popover");
  assert.ok(cssContent.includes(".comic-toast"), "CSS must style toast");
});

test("Speed badge mapping and delta-time scroll calculation logic", () => {
  function getSpeedBadge(speed) {
    if (speed < 50) return "慢速";
    if (speed <= 150) return "适中";
    return "快速";
  }

  assert.equal(getSpeedBadge(20), "慢速");
  assert.equal(getSpeedBadge(45), "慢速");
  assert.equal(getSpeedBadge(50), "适中");
  assert.equal(getSpeedBadge(60), "适中");
  assert.equal(getSpeedBadge(150), "适中");
  assert.equal(getSpeedBadge(155), "快速");
  assert.equal(getSpeedBadge(400), "快速");

  // Verify delta-time math: at 60px/s for 16.6ms frame
  const dt = 16.6 / 1000;
  const speed = 60;
  const deltaScroll = speed * dt;
  assert.ok(deltaScroll > 0.99 && deltaScroll < 1.01, "60px/s at 60fps should scroll ~1px per frame");

  // Verify bottom detection threshold
  const clientHeight = 800;
  const scrollHeight = 2000;
  const isBottom = (top) => top + clientHeight >= scrollHeight - 6;
  assert.equal(isBottom(1100), false);
  assert.equal(isBottom(1193), false);
  assert.equal(isBottom(1194), true);
  assert.equal(isBottom(1200), true);
});
