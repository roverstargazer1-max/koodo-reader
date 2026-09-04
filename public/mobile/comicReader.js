// Koodo Mobile Companion - Dual-Mode Comic Reader
(function () {
  "use strict";

  const state = {
    book: null,
    totalPages: 0,
    pages: [],
    currentPage: 1, // 1-indexed for user display
    mode: localStorage.getItem("koodo_comic_mode") || "waterfall", // "waterfall" | "paged"
    controlsVisible: false,
    prefetchedIndices: new Set(),
    isRestoringScroll: false,
    aspectRatio: 1.414,
    hasMeasuredRatio: false,
    // Zoom and pan state
    scale: 1,
    translateX: 0,
    translateY: 0,
    touchStartDist: 0,
    initialScale: 1,
    startX: 0,
    startY: 0,
    lastTapTime: 0,
    swipeStartX: 0,
    swipeStartY: 0,
    scrollDebounceTimer: null,
  };

  const container = document.getElementById("comic-reader-view");

  function getPageUrl(bookKey, index) {
    return window.koodoApi(`/api/book/${encodeURIComponent(bookKey)}/comic/page/${index}`);
  }

  // Launch Reader for a given book
  window.launchComicReader = async function (book) {
    state.book = book;
    state.currentPage = book.page > 0 ? book.page : 1;
    state.prefetchedIndices.clear();
    state.controlsVisible = false;
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;

    container.innerHTML = `
      <!-- Floating Header -->
      <div class="comic-header ${state.controlsVisible ? "" : "hidden"}" id="comic-header">
        <button class="comic-back-btn" id="comic-back-btn">
          <span>←</span>
          <span>书架</span>
        </button>
        <div class="comic-title-text" id="comic-title">${escapeHtml(book.name)}</div>
        <div class="comic-page-counter" id="comic-page-counter">- / -</div>
      </div>

      <!-- Main Comic Canvas -->
      <div id="comic-viewport" style="width:100%;height:100%;position:relative;">
        <div class="loading-container" style="height:100%;justify-content:center;">
          <div class="spinner"></div>
          <p style="color:#9ca3af;font-size:14px;">正在解析漫画档案...</p>
        </div>
      </div>

      <!-- Floating Controls Footer -->
      <div class="comic-footer ${state.controlsVisible ? "" : "hidden"}" id="comic-footer">
        <div class="comic-slider-row">
          <input type="range" class="comic-slider" id="comic-slider" min="1" max="1" value="1" />
          <span class="comic-slider-indicator" id="comic-slider-val">1 / 1</span>
        </div>
        <div class="comic-controls-row">
          <button class="comic-mode-btn" id="comic-mode-toggle">
            ${state.mode === "waterfall" ? "切换为横向翻页" : "切换为竖卷瀑布流"}
          </button>
        </div>
      </div>
    `;

    // Wire global header/footer events
    document.getElementById("comic-back-btn").onclick = () => {
      reportProgress(true);
      window.returnToShelf();
    };

    const modeBtn = document.getElementById("comic-mode-toggle");
    modeBtn.onclick = () => {
      state.mode = state.mode === "waterfall" ? "paged" : "waterfall";
      localStorage.setItem("koodo_comic_mode", state.mode);
      modeBtn.textContent = state.mode === "waterfall" ? "切换为横向翻页" : "切换为竖卷瀑布流";
      renderReaderMode();
    };

    const slider = document.getElementById("comic-slider");
    slider.oninput = (e) => {
      const targetPage = parseInt(e.target.value, 10);
      document.getElementById("comic-slider-val").textContent = `${targetPage} / ${state.totalPages}`;
    };
    slider.onchange = (e) => {
      const targetPage = parseInt(e.target.value, 10);
      jumpToPage(targetPage);
    };

    // Load page index from server
    try {
      const res = await fetch(window.koodoApi(`/api/book/${encodeURIComponent(book.key)}/comic/pages`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.totalPages = data.totalPages || 0;
      state.pages = data.pages || [];

      if (state.totalPages === 0) {
        document.getElementById("comic-viewport").innerHTML = `
          <div class="empty-container" style="height:100%;justify-content:center;">
            <p>漫画档案中未找到可读图片</p>
          </div>
        `;
        return;
      }

      // If page is not set (> 1) but percentage exists, calculate precise page
      if (state.currentPage <= 1 && book.percentage > 0) {
        state.currentPage = Math.min(
          state.totalPages,
          Math.max(1, Math.round(book.percentage * state.totalPages))
        );
      } else if (book.page > 0) {
        state.currentPage = Math.min(state.totalPages, Math.max(1, book.page));
      }

      slider.max = state.totalPages;
      slider.value = state.currentPage;
      updatePageIndicators();
      renderReaderMode();

      // Silent prefetch first 3 pages
      prefetchPages(state.currentPage - 1, 4);
    } catch (err) {
      console.error("Failed to load comic pages:", err);
      document.getElementById("comic-viewport").innerHTML = `
        <div class="empty-container" style="height:100%;justify-content:center;color:#ef4444;">
          <p>加载失败: ${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  };

  // Render Waterfall vs Paged
  function renderReaderMode() {
    const viewport = document.getElementById("comic-viewport");
    if (state.mode === "waterfall") {
      renderWaterfall(viewport);
    } else {
      renderPaged(viewport);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Mode 1: Waterfall (Webtoon continuous vertical scroll)
  // ─────────────────────────────────────────────────────────────
  function renderWaterfall(viewport) {
    viewport.innerHTML = `
      <div class="comic-container-waterfall" id="waterfall-scroll">
        <div class="comic-waterfall-wrapper" id="waterfall-wrapper"></div>
      </div>
    `;

    const wrapper = document.getElementById("waterfall-wrapper");
    const scrollEl = document.getElementById("waterfall-scroll");

    // Dynamic aspect-ratio placeholder sizing to eliminate layout shift
    const viewportWidth = Math.min(scrollEl.clientWidth || window.innerWidth || 375, 900);
    const initialRatio = state.aspectRatio || 1.414;
    const estimatedHeight = Math.round(viewportWidth * initialRatio) + "px";

    for (let i = 0; i < state.totalPages; i++) {
      const item = document.createElement("div");
      item.className = "comic-waterfall-item";
      item.id = `waterfall-item-${i}`;
      item.setAttribute("data-index", i);
      item.style.minHeight = estimatedHeight;
      item.style.height = estimatedHeight;
      item.innerHTML = `<div class="spinner" style="width:24px;height:24px;margin:80px 0;"></div>`;
      wrapper.appendChild(item);
    }

    // IntersectionObserver to lazily load images as they approach viewport
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.getAttribute("data-index"), 10);
            loadWaterfallImage(entry.target, index);
            prefetchPages(index, 4);
          }
        });
      },
      { root: scrollEl, rootMargin: "600px 0px 600px 0px" }
    );

    wrapper.querySelectorAll(".comic-waterfall-item").forEach((el) => observer.observe(el));

    // Scroll listener with 800ms debounce for progress tracking
    scrollEl.addEventListener("scroll", () => {
      // Guard against layout-shift during initial scroll restoration
      if (state.isRestoringScroll) return;
      if (state.scrollDebounceTimer) clearTimeout(state.scrollDebounceTimer);
      detectWaterfallCurrentPage(scrollEl);
      state.scrollDebounceTimer = setTimeout(() => {
        reportProgress(false);
      }, 800);
    });

    // Tap in center 40% toggles controls
    scrollEl.addEventListener("click", (e) => {
      const rect = scrollEl.getBoundingClientRect();
      const yRatio = (e.clientY - rect.top) / rect.height;
      if (yRatio >= 0.3 && yRatio <= 0.7) {
        toggleControls();
      }
    });

    // Anchor to initial page instantly without layout-shift decay
    restoreWaterfallScroll(scrollEl);
  }

  function restoreWaterfallScroll(scrollEl) {
    if (state.currentPage <= 1) return;

    state.isRestoringScroll = true;
    const targetIndex = state.currentPage - 1;
    const targetEl = document.getElementById(`waterfall-item-${targetIndex}`);
    if (!targetEl) {
      state.isRestoringScroll = false;
      return;
    }

    // Immediately load target page and neighbors to avoid blank flash
    loadWaterfallImage(targetEl, targetIndex);
    if (targetIndex > 0) {
      const prevEl = document.getElementById(`waterfall-item-${targetIndex - 1}`);
      if (prevEl) loadWaterfallImage(prevEl, targetIndex - 1);
    }
    if (targetIndex + 1 < state.totalPages) {
      const nextEl = document.getElementById(`waterfall-item-${targetIndex + 1}`);
      if (nextEl) loadWaterfallImage(nextEl, targetIndex + 1);
    }

    const applyScroll = () => {
      if (targetEl && scrollEl) {
        scrollEl.scrollTop = targetEl.offsetTop;
      }
    };

    applyScroll();
    requestAnimationFrame(applyScroll);
    setTimeout(applyScroll, 50);
    setTimeout(applyScroll, 150);
    setTimeout(applyScroll, 300);

    setTimeout(() => {
      applyScroll();
      state.isRestoringScroll = false;
      detectWaterfallCurrentPage(scrollEl);
    }, 450);
  }

  function updateUnloadedItemHeights(scrollEl, ratio) {
    const width = Math.min(scrollEl.clientWidth || window.innerWidth || 375, 900);
    const newHeight = Math.round(width * ratio) + "px";
    const unloaded = scrollEl.querySelectorAll(".comic-waterfall-item:not(.loaded)");
    unloaded.forEach((el) => {
      el.style.minHeight = newHeight;
      el.style.height = newHeight;
    });
  }

  function loadWaterfallImage(containerEl, index) {
    if (!containerEl || containerEl.querySelector("img")) return;
    const img = document.createElement("img");
    img.className = "comic-waterfall-img";
    img.alt = `Page ${index + 1}`;
    img.src = getPageUrl(state.book.key, index);
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        const ratio = img.naturalHeight / img.naturalWidth;
        if (!state.hasMeasuredRatio && ratio > 0.5 && ratio < 3.0) {
          state.aspectRatio = ratio;
          state.hasMeasuredRatio = true;
          const scrollEl = document.getElementById("waterfall-scroll");
          if (scrollEl) updateUnloadedItemHeights(scrollEl, ratio);
        }
      }
      containerEl.classList.add("loaded");
      containerEl.innerHTML = "";
      containerEl.style.minHeight = "";
      containerEl.style.height = "";
      containerEl.appendChild(img);
    };
    img.onerror = () => {
      containerEl.classList.add("loaded");
      containerEl.innerHTML = `<p style="color:#ef4444;font-size:12px;padding:40px 0;">图片加载失败</p>`;
    };
  }

  function detectWaterfallCurrentPage(scrollEl) {
    const centerY = scrollEl.scrollTop + scrollEl.clientHeight / 2;
    const items = scrollEl.querySelectorAll(".comic-waterfall-item");
    for (let i = 0; i < items.length; i++) {
      const top = items[i].offsetTop;
      const bottom = top + items[i].offsetHeight;
      if (centerY >= top && centerY <= bottom) {
        const page = i + 1;
        if (state.currentPage !== page) {
          state.currentPage = page;
          updatePageIndicators();
        }
        break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Mode 2: Horizontal Paged Mode (Single Page, Touch & Gesture)
  // ─────────────────────────────────────────────────────────────
  function renderPaged(viewport) {
    state.scale = 1;
    state.translateX = 0;
    state.translateY = 0;

    viewport.innerHTML = `
      <div class="comic-container-paged" id="paged-container">
        <div class="comic-paged-wrapper" id="paged-wrapper">
          <img class="comic-paged-img" id="paged-img" src="${getPageUrl(
            state.book.key,
            state.currentPage - 1
          )}" alt="Page ${state.currentPage}" />
        </div>
        <!-- 3 Tap Zones: Left 30%, Center 40%, Right 30% -->
        <div class="comic-tap-zones" id="tap-zones">
          <div class="comic-zone-prev" id="zone-prev"></div>
          <div class="comic-zone-menu" id="zone-menu"></div>
          <div class="comic-zone-next" id="zone-next"></div>
        </div>
      </div>
    `;

    const imgEl = document.getElementById("paged-img");
    const wrapper = document.getElementById("paged-wrapper");
    const zones = document.getElementById("tap-zones");

    // Preload next pages
    prefetchPages(state.currentPage - 1, 4);

    // Tap Zones
    document.getElementById("zone-prev").onclick = () => {
      if (state.scale === 1) prevPage();
    };
    document.getElementById("zone-next").onclick = () => {
      if (state.scale === 1) nextPage();
    };
    document.getElementById("zone-menu").onclick = () => {
      toggleControls();
    };

    // Attach Gesture Recognizer (Pinch, Pan, Double-tap, Horizontal Swipe)
    setupGestures(zones, wrapper, imgEl);
  }

  function setupGestures(touchTarget, wrapper, imgEl) {
    let touchCount = 0;

    const applyTransform = () => {
      wrapper.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
    };

    touchTarget.addEventListener(
      "touchstart",
      (e) => {
        touchCount = e.touches.length;

        if (touchCount === 1) {
          // Double-tap detection
          const now = Date.now();
          if (now - state.lastTapTime < 300) {
            // Toggle 1x / 2x zoom
            state.scale = state.scale > 1.2 ? 1 : 2;
            state.translateX = 0;
            state.translateY = 0;
            applyTransform();
            state.lastTapTime = 0;
            return;
          }
          state.lastTapTime = now;

          // Single finger start: either drag (if zoomed) or swipe (if 1x)
          state.startX = e.touches[0].clientX - state.translateX;
          state.startY = e.touches[0].clientY - state.translateY;
          state.swipeStartX = e.touches[0].clientX;
          state.swipeStartY = e.touches[0].clientY;
        } else if (touchCount === 2) {
          // Two fingers: Pinch-to-zoom start
          state.touchStartDist = getDistance(e.touches[0], e.touches[1]);
          state.initialScale = state.scale;
        }
      },
      { passive: false }
    );

    touchTarget.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const dist = getDistance(e.touches[0], e.touches[1]);
          const factor = dist / state.touchStartDist;
          state.scale = Math.min(5, Math.max(1, state.initialScale * factor));
          applyTransform();
        } else if (e.touches.length === 1 && state.scale > 1.05) {
          // Pan when zoomed
          e.preventDefault();
          state.translateX = e.touches[0].clientX - state.startX;
          state.translateY = e.touches[0].clientY - state.startY;
          applyTransform();
        }
      },
      { passive: false }
    );

    touchTarget.addEventListener("touchend", (e) => {
      if (touchCount === 1 && state.scale === 1 && e.changedTouches.length === 1) {
        // Check horizontal swipe
        const deltaX = e.changedTouches[0].clientX - state.swipeStartX;
        const deltaY = e.changedTouches[0].clientY - state.swipeStartY;
        // Horizontal swipe threshold: > 50px horizontal and > 2x vertical
        if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          if (deltaX < 0) {
            nextPage(); // swipe left -> next page
          } else {
            prevPage(); // swipe right -> prev page
          }
        }
      }

      // Reset touch count
      touchCount = e.touches.length;
    });
  }

  function getDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Navigation: Next / Prev / Jump
  function nextPage() {
    if (state.currentPage < state.totalPages) {
      jumpToPage(state.currentPage + 1);
    }
  }

  function prevPage() {
    if (state.currentPage > 1) {
      jumpToPage(state.currentPage - 1);
    }
  }

  function jumpToPage(page) {
    state.currentPage = Math.max(1, Math.min(state.totalPages, page));
    updatePageIndicators();

    if (state.mode === "paged") {
      state.scale = 1;
      state.translateX = 0;
      state.translateY = 0;
      const imgEl = document.getElementById("paged-img");
      const wrapper = document.getElementById("paged-wrapper");
      if (imgEl && wrapper) {
        wrapper.style.transform = "scale(1)";
        imgEl.src = getPageUrl(state.book.key, state.currentPage - 1);
      }
      prefetchPages(state.currentPage - 1, 4);
      reportProgress(true); // Paged mode reports immediately on flip
    } else {
      const targetIndex = state.currentPage - 1;
      const targetEl = document.getElementById(`waterfall-item-${targetIndex}`);
      if (targetEl) {
        loadWaterfallImage(targetEl, targetIndex);
        targetEl.scrollIntoView({ behavior: "smooth" });
      }
      reportProgress(true);
    }
  }

  // Background Prefetcher: 3 to 5 pages ahead
  function prefetchPages(startIndex, count = 4) {
    for (let i = startIndex + 1; i <= Math.min(state.totalPages - 1, startIndex + count); i++) {
      if (!state.prefetchedIndices.has(i)) {
        state.prefetchedIndices.add(i);
        const prefetchImg = new Image();
        prefetchImg.src = getPageUrl(state.book.key, i);
      }
    }
  }

  function updatePageIndicators() {
    const counter = document.getElementById("comic-page-counter");
    if (counter) counter.textContent = `${state.currentPage} / ${state.totalPages}`;

    const slider = document.getElementById("comic-slider");
    if (slider) slider.value = state.currentPage;

    const sliderVal = document.getElementById("comic-slider-val");
    if (sliderVal) sliderVal.textContent = `${state.currentPage} / ${state.totalPages}`;
  }

  function toggleControls() {
    state.controlsVisible = !state.controlsVisible;
    const header = document.getElementById("comic-header");
    const footer = document.getElementById("comic-footer");
    if (header && footer) {
      header.classList.toggle("hidden", !state.controlsVisible);
      footer.classList.toggle("hidden", !state.controlsVisible);
    }
  }

  // Progress Reporting (Ticket 05 Contract)
  function reportProgress(immediate = false) {
    if (!state.book || state.totalPages <= 0) return;
    if (state.isRestoringScroll) return;
    const percentage = Number((state.currentPage / state.totalPages).toFixed(4));
    const pageItem = state.pages[state.currentPage - 1];
    const targetHref =
      (pageItem && typeof pageItem === "object" ? pageItem.name : pageItem) || "";
    const payload = {
      bookKey: state.book.key,
      page: state.currentPage,
      totalPages: state.totalPages,
      percentage,
      timestamp: Date.now(),
      format: state.book.format || "cbz",
      chapterTitle: `第 ${state.currentPage} 页`,
      chapterDocIndex: state.currentPage - 1,
      chapterHref: targetHref,
    };

    if (window.syncProgress) {
      window.syncProgress(payload, immediate);
    }
  }

  window.reportComicProgress = reportProgress;

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    if (typeof str !== "string") {
      if (typeof str === "object" && typeof str.text === "string") {
        str = str.text;
      } else {
        return "";
      }
    }
    return str
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
