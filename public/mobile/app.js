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
    activeCategory: "recent",
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
  const filterTabs = document.querySelectorAll(".filter-tab");
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

  // Fetch books from REST API
  async function loadBooks() {
    try {
      shelfLoading.style.display = "flex";
      bookGrid.style.display = "none";
      shelfEmpty.style.display = "none";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const res = await fetch(api("/api/books"), { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("koodo_mobile_token");
          window.location.reload();
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      state.allBooks = await res.json();
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

  // Event Listeners: Filter Tabs
  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      filterTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeCategory = tab.getAttribute("data-category");
      applyFilters();
    });
  });

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
