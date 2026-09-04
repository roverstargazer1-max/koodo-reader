// Koodo Mobile Companion - Bookshelf Client
(function () {
  "use strict";

  // 0. Theme Management (Light / Dark)
  let currentTheme = localStorage.getItem("koodo_mobile_theme") || "dark";
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("koodo_mobile_theme", theme);
    const meta = document.getElementById("theme-color-meta");
    if (meta) {
      meta.setAttribute("content", theme === "light" ? "#f6f7f9" : "#121316");
    }
  }
  applyTheme(currentTheme);

  // 1. Token Initialization & Persistence
  const urlParams = new URLSearchParams(window.location.search);
  const tokenFromUrl = urlParams.get("token");

  if (tokenFromUrl) {
    localStorage.setItem("koodo_mobile_token", tokenFromUrl);
  }

  const token = tokenFromUrl || localStorage.getItem("koodo_mobile_token");
  if (!token) {
    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;background:var(--bg-color);color:var(--text-primary);font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
        <div style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:16px;padding:32px 24px;max-width:360px;width:100%;box-shadow:var(--card-shadow);">
          <div style="display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:rgba(0,122,255,0.1);color:#007aff;margin-bottom:16px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
              <path d="M12 18h.01"/>
            </svg>
          </div>
          <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;">连接电脑端书库</h2>
          <p style="color:var(--text-secondary);font-size:13px;line-height:1.6;margin-bottom:20px;">
            在电脑端 Koodo Reader 顶部导航栏点击“手机连接”，输入或粘贴显示的配对密钥：
          </p>
          <form id="pairing-form" style="display:flex;flex-direction:column;gap:12px;">
            <input
              type="text"
              id="manual-token-input"
              placeholder="输入配对密钥 (Token)..."
              style="background:var(--input-bg);border:1px solid var(--border-color);border-radius:10px;padding:12px 14px;color:var(--text-primary);font-size:14px;outline:none;text-align:center;font-family:monospace;"
              required
              autocomplete="off"
              autocapitalize="off"
            />
            <button
              type="submit"
              style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;"
            >
              立即连接
            </button>
          </form>
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color);color:var(--text-muted);font-size:12px;">
            提示：亦可使用手机自带相机直接扫描电脑端屏幕上的二维码进入
          </div>
        </div>
      </div>
    `;
    document.getElementById("pairing-form").onsubmit = (e) => {
      e.preventDefault();
      const val = document.getElementById("manual-token-input").value.trim();
      if (val) {
        localStorage.setItem("koodo_mobile_token", val);
        window.location.search = `?token=${encodeURIComponent(val)}`;
      }
    };
    return;
  }

  window.KOODO_MOBILE_TOKEN = token;

  // 2. Application State
  const state = {
    allBooks: [],
    filteredBooks: [],
    shelves: [],
    activeCategory: "recent",
    activeShelf: null,
    searchQuery: "",
  };

  // Helper: Append token to API URL
  function api(endpoint) {
    const separator = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${separator}token=${encodeURIComponent(token)}`;
  }

  window.koodoApi = api;

  // DOM Elements
  const shelfView = document.getElementById("shelf-view");
  const comicReaderView = document.getElementById("comic-reader-view");
  const novelReaderView = document.getElementById("novel-reader-view");
  const bookGrid = document.getElementById("book-grid");
  const shelfLoading = document.getElementById("shelf-loading");
  const shelfEmpty = document.getElementById("shelf-empty");
  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");
  const filterTabsNav = document.getElementById("filter-tabs");
  const shelfTabDivider = document.getElementById("shelf-tab-divider");
  const shelfPickerBtn = document.getElementById("shelf-picker-btn");
  const shelfModalBackdrop = document.getElementById("shelf-modal-backdrop");
  const shelfModalClose = document.getElementById("shelf-modal-close");
  const shelfModalList = document.getElementById("shelf-modal-list");
  const connectionStatus = document.getElementById("connection-status");
  const themeToggle = document.getElementById("theme-toggle");

  function updateConnectionStatus(connected, text) {
    if (!connectionStatus) return;
    connectionStatus.className = `status-pill ${connected ? "connected" : "offline"}`;
    const textEl = connectionStatus.querySelector(".status-text");
    if (textEl) {
      textEl.textContent = text;
    } else {
      connectionStatus.innerHTML = `<span class="status-dot"></span><span class="status-text">${escapeHtml(text)}</span>`;
    }
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const next = currentTheme === "light" ? "dark" : "light";
      applyTheme(next);
    });
  }

  // Fetch books & shelves from REST API
  async function loadBooks() {
    try {
      shelfLoading.style.display = "flex";
      bookGrid.style.display = "none";
      shelfEmpty.style.display = "none";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const [booksRes, shelvesRes] = await Promise.all([
        fetch(api("/api/books"), { signal: controller.signal }),
        fetch(api("/api/shelves"), { signal: controller.signal }).catch((err) => {
          console.warn("Failed to fetch shelves:", err);
          return null;
        }),
      ]);
      clearTimeout(timeoutId);

      if (!booksRes.ok) {
        if (booksRes.status === 401) {
          localStorage.removeItem("koodo_mobile_token");
          window.location.reload();
          return;
        }
        throw new Error(`HTTP ${booksRes.status}`);
      }

      state.allBooks = await booksRes.json();

      if (shelvesRes && shelvesRes.ok) {
        try {
          state.shelves = await shelvesRes.json();
        } catch (e) {
          state.shelves = [];
        }
      }

      // If active shelf no longer exists in updated shelves list, fall back
      if (
        state.activeCategory === "shelf" &&
        state.activeShelf &&
        !state.shelves.some((s) => s.title === state.activeShelf)
      ) {
        state.activeCategory = "recent";
        state.activeShelf = null;
      }

      renderShelfUI();
      updateConnectionStatus(true, "局域网已连接");

      try {
        applyFilters();
      } catch (renderErr) {
        console.error("Failed to render books:", renderErr);
        shelfLoading.style.display = "none";
      }
    } catch (err) {
      console.error("Failed to load books:", err);
      updateConnectionStatus(false, "连接异常");
      shelfLoading.style.display = "none";
      shelfEmpty.style.display = "flex";
      document.querySelector(".empty-title").textContent = "无法加载个人书库";
      document.querySelector(".empty-desc").innerHTML = `${escapeHtml(
        err.message || "请求超时"
      )}<br><br><button onclick="window.location.reload()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 20px;font-size:14px;cursor:pointer;font-weight:600;">点击重试</button>`;
    }
  }

  // Render dynamic shelf tabs and modal list
  function renderShelfUI() {
    if (!filterTabsNav) return;

    // Remove existing dynamic shelf tabs
    const existingShelfTabs = filterTabsNav.querySelectorAll(".filter-tab-shelf");
    existingShelfTabs.forEach((tab) => tab.remove());

    if (!Array.isArray(state.shelves) || state.shelves.length === 0) {
      if (shelfTabDivider) shelfTabDivider.style.display = "none";
      if (shelfPickerBtn) shelfPickerBtn.style.display = "none";
      return;
    }

    if (shelfTabDivider) shelfTabDivider.style.display = "inline-block";
    if (shelfPickerBtn) shelfPickerBtn.style.display = "inline-flex";

    // Build dynamic shelf tabs
    const fragment = document.createDocumentFragment();
    for (const shelf of state.shelves) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "filter-tab filter-tab-shelf";
      tab.setAttribute("data-category", "shelf");
      tab.setAttribute("data-shelf", shelf.title);
      if (state.activeCategory === "shelf" && state.activeShelf === shelf.title) {
        tab.classList.add("active");
      }

      tab.innerHTML = `
        <span class="shelf-tab-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path>
            <path d="M6 6h10"></path>
            <path d="M6 10h10"></path>
          </svg>
        </span>
        <span class="shelf-tab-title">${escapeHtml(shelf.title)}</span>
        <span class="shelf-tab-count">${shelf.count}</span>
      `;

      tab.addEventListener("click", () => {
        selectShelf(shelf.title);
      });

      fragment.appendChild(tab);
    }
    filterTabsNav.appendChild(fragment);

    renderShelfModalList();
    updateShelfPickerButtonState();
  }

  function renderShelfModalList() {
    if (!shelfModalList) return;
    shelfModalList.innerHTML = "";

    const fragment = document.createDocumentFragment();

    // All Books option in modal
    const allItem = document.createElement("button");
    allItem.type = "button";
    allItem.className = `shelf-modal-item ${state.activeCategory === "all" ? "active" : ""}`;
    allItem.innerHTML = `
      <div class="shelf-modal-item-left">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path>
          <path d="M4 6h16"></path>
          <path d="M10 2v20"></path>
        </svg>
        <span>全部图书</span>
      </div>
      <span class="shelf-modal-item-count">${state.allBooks.length}</span>
    `;
    allItem.addEventListener("click", () => {
      closeShelfModal();
      selectBuiltinCategory("all");
    });
    fragment.appendChild(allItem);

    for (const shelf of state.shelves) {
      const item = document.createElement("button");
      item.type = "button";
      const isCurrent = state.activeCategory === "shelf" && state.activeShelf === shelf.title;
      item.className = `shelf-modal-item ${isCurrent ? "active" : ""}`;
      item.innerHTML = `
        <div class="shelf-modal-item-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path>
            <path d="M6 6h10"></path>
            <path d="M6 10h10"></path>
          </svg>
          <span style="font-weight:${isCurrent ? "600" : "500"};">${escapeHtml(shelf.title)}</span>
        </div>
        <span class="shelf-modal-item-count">${shelf.count} 本</span>
      `;
      item.addEventListener("click", () => {
        closeShelfModal();
        selectShelf(shelf.title);
      });
      fragment.appendChild(item);
    }

    shelfModalList.appendChild(fragment);
  }

  function updateShelfPickerButtonState() {
    if (!shelfPickerBtn) return;
    if (state.activeCategory === "shelf" && state.activeShelf) {
      shelfPickerBtn.classList.add("active");
      const textEl = shelfPickerBtn.querySelector(".shelf-picker-text");
      if (textEl) textEl.textContent = state.activeShelf;
    } else {
      shelfPickerBtn.classList.remove("active");
      const textEl = shelfPickerBtn.querySelector(".shelf-picker-text");
      if (textEl) textEl.textContent = "书架";
    }
  }

  function selectShelf(shelfTitle) {
    state.activeCategory = "shelf";
    state.activeShelf = shelfTitle;

    const allTabs = document.querySelectorAll(".filter-tab");
    allTabs.forEach((t) => {
      if (
        t.getAttribute("data-category") === "shelf" &&
        t.getAttribute("data-shelf") === shelfTitle
      ) {
        t.classList.add("active");
        t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      } else {
        t.classList.remove("active");
      }
    });

    updateShelfPickerButtonState();
    renderShelfModalList();
    applyFilters();
  }

  function selectBuiltinCategory(category) {
    state.activeCategory = category;
    state.activeShelf = null;

    const allTabs = document.querySelectorAll(".filter-tab");
    allTabs.forEach((t) => {
      if (
        t.getAttribute("data-category") === category &&
        !t.classList.contains("filter-tab-shelf")
      ) {
        t.classList.add("active");
        t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      } else {
        t.classList.remove("active");
      }
    });

    updateShelfPickerButtonState();
    renderShelfModalList();
    applyFilters();
  }

  // Filter & Search Logic
  function applyFilters() {
    let list = [...state.allBooks];

    // Category Filter
    if (state.activeCategory === "recent") {
      // Sort by lastReadTime descending, books with progress first
      list.sort((a, b) => (b.lastReadTime || 0) - (a.lastReadTime || 0));
    } else if (state.activeCategory === "comic") {
      list = list.filter((b) => b.category === "comic");
    } else if (state.activeCategory === "novel") {
      list = list.filter((b) => b.category === "novel");
    } else if (state.activeCategory === "shelf" && state.activeShelf) {
      const targetShelf = state.shelves.find((s) => s.title === state.activeShelf);
      const shelfKeySet =
        targetShelf && Array.isArray(targetShelf.bookKeys)
          ? new Set(targetShelf.bookKeys)
          : null;

      list = list.filter((b) => {
        if (Array.isArray(b.shelves) && b.shelves.includes(state.activeShelf)) {
          return true;
        }
        if (shelfKeySet && shelfKeySet.has(b.key)) {
          return true;
        }
        return false;
      });
    }

    // Search Query Filter
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.trim().toLowerCase();
      list = list.filter(
        (b) =>
          (b.name && b.name.toLowerCase().includes(q)) ||
          (b.author && b.author.toLowerCase().includes(q))
      );
    }

    state.filteredBooks = list;
    renderBooks();
  }

  // Render Book Grid
  function renderBooks() {
    shelfLoading.style.display = "none";

    if (state.filteredBooks.length === 0) {
      bookGrid.style.display = "none";
      shelfEmpty.style.display = "flex";
      const titleEl = shelfEmpty.querySelector(".empty-title");
      const descEl = shelfEmpty.querySelector(".empty-desc");
      if (state.activeCategory === "shelf" && state.activeShelf) {
        if (titleEl) titleEl.textContent = `“${state.activeShelf}”书架为空`;
        if (descEl) {
          descEl.textContent = state.searchQuery.trim()
            ? "未搜索到匹配图书"
            : "可在电脑端向此书架添加书籍";
        }
      } else if (state.searchQuery.trim()) {
        if (titleEl) titleEl.textContent = "未搜索到匹配图书";
        if (descEl) descEl.textContent = "换个关键词试试";
      } else {
        if (titleEl) titleEl.textContent = "书架空空如也";
        if (descEl) descEl.textContent = "未找到符合条件的图书";
      }
      return;
    }

    shelfEmpty.style.display = "none";
    bookGrid.style.display = "grid";
    bookGrid.innerHTML = "";

    const fragment = document.createDocumentFragment();

    for (const book of state.filteredBooks) {
      const card = document.createElement("div");
      card.className = "book-card";
      card.setAttribute("data-key", book.key);

      // Progress pill calculation
      let pillClass = "unread";
      let pillText = "未读";
      if (book.percentage >= 0.99) {
        pillClass = "completed";
        pillText = "已读完";
      } else if (book.percentage > 0) {
        pillClass = "reading";
        pillText = `${Math.round(book.percentage * 100)}%`;
      }

      const coverSrc = api(book.coverUrl || `/api/cover/${encodeURIComponent(book.key)}`);
      const isBlurred = Boolean(book.isBlurred);
      const blurClass = isBlurred ? " book-cover-blurred" : "";

      card.innerHTML = `
        <div class="book-cover-wrap">
          <img class="book-cover${blurClass}" src="${coverSrc}" alt="${escapeHtml(book.name)}" loading="lazy" />
          <span class="progress-pill ${pillClass}">${pillText}</span>
        </div>
        <div class="book-info">
          <div class="book-title" title="${escapeHtml(book.name)}">${escapeHtml(book.name)}</div>
          <div class="book-meta">
            <span class="book-author">${escapeHtml(book.author || "未知作者")}</span>
            <span class="book-format-badge">${escapeHtml(book.format || "")}</span>
          </div>
        </div>
      `;

      card.addEventListener("click", () => openReader(book));
      fragment.appendChild(card);
    }

    bookGrid.appendChild(fragment);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Open appropriate reader
  function openReader(book) {
    if (book.category === "comic" && window.launchComicReader) {
      shelfView.style.display = "none";
      novelReaderView.style.display = "none";
      comicReaderView.style.display = "block";
      window.launchComicReader(book);
    } else if (window.launchNovelReader) {
      shelfView.style.display = "none";
      comicReaderView.style.display = "none";
      novelReaderView.style.display = "block";
      window.launchNovelReader(book);
    } else {
      alert(`正在打开: ${book.name}`);
    }
  }

  // Return to Bookshelf from Reader
  window.returnToShelf = function () {
    comicReaderView.style.display = "none";
    novelReaderView.style.display = "none";
    shelfView.style.display = "block";
    loadBooks(); // refresh progress pills
  };

  // Event Listeners: Search
  searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    searchClear.style.display = state.searchQuery ? "block" : "none";
    applyFilters();
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    state.searchQuery = "";
    searchClear.style.display = "none";
    searchInput.focus();
    applyFilters();
  });

  // Event Listeners: Filter Tabs (Built-in)
  const builtinFilterTabs = document.querySelectorAll(".filter-tab:not(.filter-tab-shelf)");
  builtinFilterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      selectBuiltinCategory(tab.getAttribute("data-category"));
    });
  });

  // Event Listeners: Shelf Picker Modal
  function openShelfModal() {
    if (!shelfModalBackdrop) return;
    shelfModalBackdrop.style.display = "flex";
    if (shelfPickerBtn) shelfPickerBtn.classList.add("open");
  }

  function closeShelfModal() {
    if (!shelfModalBackdrop) return;
    shelfModalBackdrop.style.display = "none";
    if (shelfPickerBtn) shelfPickerBtn.classList.remove("open");
  }

  if (shelfPickerBtn) {
    shelfPickerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (shelfModalBackdrop.style.display === "flex") {
        closeShelfModal();
      } else {
        openShelfModal();
      }
    });
  }

  if (shelfModalClose) {
    shelfModalClose.addEventListener("click", closeShelfModal);
  }

  if (shelfModalBackdrop) {
    shelfModalBackdrop.addEventListener("click", (e) => {
      if (e.target === shelfModalBackdrop) {
        closeShelfModal();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Two-Way Progress Sync Engine
  // ─────────────────────────────────────────────────────────────
  let pendingProgress = null;
  let syncDebounceTimer = null;

  async function flushProgress() {
    if (!pendingProgress) return;
    const payload = pendingProgress;
    pendingProgress = null;

    try {
      await fetch(api(`/api/book/${encodeURIComponent(payload.bookKey)}/progress`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (err) {
      console.warn("Failed to sync progress:", err);
    }
  }

  window.syncProgress = function (payload, immediate = false) {
    pendingProgress = payload;

    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer);
      syncDebounceTimer = null;
    }

    if (immediate) {
      flushProgress();
    } else {
      syncDebounceTimer = setTimeout(() => {
        flushProgress();
      }, 800);
    }
  };

  // Immediate flush on page backgrounding or closing
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushProgress();
    }
  });

  window.addEventListener("pagehide", () => {
    flushProgress();
  });

  // Initial Load
  loadBooks();
})();
