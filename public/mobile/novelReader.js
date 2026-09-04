// Koodo Mobile Companion - Novel Typography Reader
(function () {
  "use strict";

  const state = {
    book: null,
    fontSize: parseInt(localStorage.getItem("koodo_novel_fontsize") || "17", 10),
    lineHeight: parseFloat(localStorage.getItem("koodo_novel_lineheight") || "1.6"),
    theme: localStorage.getItem("koodo_novel_theme") || "theme-parchment",
    layoutMode: localStorage.getItem("koodo_novel_layout") || "scroll", // "scroll" | "paged"
    controlsVisible: false,
    chapters: [],
    currentChapterIndex: 0,
    pagedIndex: 0,
    totalPagesInPaged: 1,
    pagedPages: [],
    scrollDebounceTimer: null,
    percentage: 0,
  };

  const container = document.getElementById("novel-reader-view");

  window.launchNovelReader = async function (book) {
    state.book = book;
    state.percentage = book.percentage || 0;
    state.controlsVisible = false;

    renderNovelShell();

    try {
      // 1. Try structured chapters endpoint first (server-side EPUB & TXT parser)
      try {
        const chaptersRes = await fetch(
          window.koodoApi(`/api/book/${encodeURIComponent(book.key)}/novel/chapters`)
        );
        const contentType = chaptersRes.headers.get("content-type") || "";
        if (chaptersRes.ok && contentType.includes("application/json")) {
          const data = await chaptersRes.json();
          if (data && Array.isArray(data.chapters) && data.chapters.length > 0) {
            state.chapters = data.chapters;
            renderNovelContent();
            return;
          }
        }
      } catch (chaptersErr) {
        console.warn("Structured chapters endpoint failed, checking fallback:", chaptersErr);
      }

      // 2. Fallback to raw file stream (for plain text formats like .txt, .md)
      const format = (book.format || "").toLowerCase();
      if (format === "epub") {
        throw new Error("EPUB 章节解析未返回有效内容，请刷新重试");
      }

      const res = await fetch(
        window.koodoApi(`/api/book/${encodeURIComponent(book.key)}/file`)
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      parseTxtContent(text);

      renderNovelContent();
    } catch (err) {
      console.error("Failed to load novel file:", err);
      document.getElementById("novel-content-area").innerHTML = `
        <div class="empty-container" style="color:#ef4444;height:100%;justify-content:center;">
          <p>加载图书内容失败: ${escapeHtml(err.message)}</p>
          <button onclick="window.launchNovelReader(state.book)" style="margin-top:12px;padding:8px 18px;border-radius:8px;border:1px solid #ef4444;background:rgba(239,68,68,0.1);color:#ef4444;font-size:14px;cursor:pointer;">重新加载</button>
        </div>
      `;
    }
  };

  function renderNovelShell() {
    container.className = state.theme;
    container.innerHTML = `
      <!-- Floating Header -->
      <div class="novel-header ${state.controlsVisible ? "" : "hidden"}" id="novel-header">
        <button class="novel-back-btn" id="novel-back-btn">
          <span>←</span>
          <span>书架</span>
        </button>
        <div class="novel-title-text" id="novel-title">${escapeHtml(state.book.name)}</div>
        <div class="novel-progress-text" id="novel-progress-text">${Math.round(state.percentage * 100)}%</div>
      </div>

      <!-- Main Novel Content Area -->
      <div id="novel-content-area" style="width:100%;height:100%;position:relative;">
        <div class="loading-container" style="height:100%;justify-content:center;">
          <div class="spinner"></div>
          <p style="color:var(--novel-muted);font-size:14px;">正在排版图书内容...</p>
        </div>
      </div>

      <!-- Floating Settings Drawer -->
      <div class="novel-footer ${state.controlsVisible ? "" : "hidden"}" id="novel-footer">
        <!-- Progress Scrubber -->
        <div class="novel-scrubber-row">
          <input type="range" class="novel-scrubber" id="novel-scrubber" min="0" max="100" value="${Math.round(state.percentage * 100)}" />
          <span class="novel-setting-label" id="novel-scrubber-val">${Math.round(state.percentage * 100)}%</span>
        </div>

        <!-- Font Size Slider -->
        <div class="novel-setting-row">
          <span class="novel-setting-label">字号</span>
          <input type="range" class="novel-font-slider" id="novel-font-slider" min="12" max="28" value="${state.fontSize}" />
          <span class="novel-setting-label" id="novel-font-val" style="text-align:right;">${state.fontSize}px</span>
        </div>

        <!-- Line Height Presets -->
        <div class="novel-setting-row">
          <span class="novel-setting-label">行距</span>
          <div class="novel-presets-group">
            <button class="novel-preset-btn ${state.lineHeight === 1.3 ? "active" : ""}" data-lh="1.3">紧凑</button>
            <button class="novel-preset-btn ${state.lineHeight === 1.6 ? "active" : ""}" data-lh="1.6">舒适</button>
            <button class="novel-preset-btn ${state.lineHeight === 1.9 ? "active" : ""}" data-lh="1.9">宽松</button>
          </div>
        </div>

        <!-- Themes -->
        <div class="novel-themes-row">
          <div class="novel-theme-swatch swatch-white ${state.theme === "theme-white" ? "active" : ""}" data-theme="theme-white" title="纯白"></div>
          <div class="novel-theme-swatch swatch-parchment ${state.theme === "theme-parchment" ? "active" : ""}" data-theme="theme-parchment" title="羊皮纸"></div>
          <div class="novel-theme-swatch swatch-dark ${state.theme === "theme-dark" ? "active" : ""}" data-theme="theme-dark" title="深灰"></div>
          <div class="novel-theme-swatch swatch-amoled ${state.theme === "theme-amoled" ? "active" : ""}" data-theme="theme-amoled" title="纯黑"></div>
        </div>

        <!-- Layout Mode Toggle -->
        <div class="novel-setting-row">
          <span class="novel-setting-label">模式</span>
          <div class="novel-presets-group">
            <button class="novel-preset-btn ${state.layoutMode === "scroll" ? "active" : ""}" id="layout-scroll-btn">垂直滚动</button>
            <button class="novel-preset-btn ${state.layoutMode === "paged" ? "active" : ""}" id="layout-paged-btn">手势翻页</button>
          </div>
        </div>
      </div>
    `;

    // Wire events
    document.getElementById("novel-back-btn").onclick = () => {
      reportProgress(true);
      window.returnToShelf();
    };

    // Scrubber
    const scrubber = document.getElementById("novel-scrubber");
    scrubber.oninput = (e) => {
      const pct = e.target.value;
      document.getElementById("novel-scrubber-val").textContent = `${pct}%`;
    };
    scrubber.onchange = (e) => {
      const pct = parseInt(e.target.value, 10) / 100;
      jumpToPercentage(pct);
    };

    // Font size slider
    const fontSlider = document.getElementById("novel-font-slider");
    fontSlider.oninput = (e) => {
      state.fontSize = parseInt(e.target.value, 10);
      localStorage.setItem("koodo_novel_fontsize", state.fontSize);
      document.getElementById("novel-font-val").textContent = `${state.fontSize}px`;
      applyTypographyStyles();
    };

    // Line height
    document.querySelectorAll("[data-lh]").forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll("[data-lh]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.lineHeight = parseFloat(btn.getAttribute("data-lh"));
        localStorage.setItem("koodo_novel_lineheight", state.lineHeight);
        applyTypographyStyles();
      };
    });

    // Theme swatches
    document.querySelectorAll(".novel-theme-swatch").forEach((swatch) => {
      swatch.onclick = () => {
        document.querySelectorAll(".novel-theme-swatch").forEach((s) => s.classList.remove("active"));
        swatch.classList.add("active");
        state.theme = swatch.getAttribute("data-theme");
        localStorage.setItem("koodo_novel_theme", state.theme);
        container.className = state.theme;
      };
    });

    // Layout switcher
    document.getElementById("layout-scroll-btn").onclick = () => {
      if (state.layoutMode !== "scroll") {
        state.layoutMode = "scroll";
        localStorage.setItem("koodo_novel_layout", "scroll");
        document.getElementById("layout-scroll-btn").classList.add("active");
        document.getElementById("layout-paged-btn").classList.remove("active");
        renderNovelContent();
      }
    };
    document.getElementById("layout-paged-btn").onclick = () => {
      if (state.layoutMode !== "paged") {
        state.layoutMode = "paged";
        localStorage.setItem("koodo_novel_layout", "paged");
        document.getElementById("layout-paged-btn").classList.add("active");
        document.getElementById("layout-scroll-btn").classList.remove("active");
        renderNovelContent();
      }
    };
  }

  function applyTypographyStyles() {
    const contentWrapper = document.getElementById("novel-styled-content");
    if (contentWrapper) {
      contentWrapper.style.fontSize = `${state.fontSize}px`;
      contentWrapper.style.lineHeight = state.lineHeight;
    }
  }

  // Parse TXT into Chapters
  function parseTxtContent(rawText) {
    state.chapters = [];
    const chapterRegex = /(?:^|\n)(第[0-9一二三四五六七八九十百千万0-9]+[章回节卷集部篇幕][^\n]*|Chapter\s+[0-9A-Za-z]+[^\n]*)/g;

    let matches = [];
    let match;
    while ((match = chapterRegex.exec(rawText)) !== null) {
      matches.push({ index: match.index, title: match[1].trim() });
    }

    if (matches.length === 0) {
      // No chapter pattern found: treat as single continuous chapter
      const paragraphs = rawText.split(/\r?\n+/).filter((p) => p.trim());
      state.chapters.push({ title: state.book.name, paragraphs });
    } else {
      // Intro / prologue before first chapter
      if (matches[0].index > 0) {
        const introText = rawText.slice(0, matches[0].index).trim();
        if (introText) {
          state.chapters.push({
            title: "序言 / 前言",
            paragraphs: introText.split(/\r?\n+/).filter((p) => p.trim()),
          });
        }
      }

      for (let i = 0; i < matches.length; i++) {
        const title = matches[i].title;
        const startIndex = matches[i].index + matches[i].title.length;
        const endIndex = i < matches.length - 1 ? matches[i + 1].index : rawText.length;
        const body = rawText.slice(startIndex, endIndex).trim();
        const paragraphs = body.split(/\r?\n+/).filter((p) => p.trim());
        state.chapters.push({ title, paragraphs });
      }
    }
  }

  // Fallback for EPUB content
  function loadEpubContent() {
    state.chapters = [
      {
        title: state.book ? state.book.name : "EPUB",
        paragraphs: ["EPUB 章节解析需由服务器完成，请刷新页面重新加载。"],
      },
    ];
  }

  // Render Content based on layoutMode
  function renderNovelContent() {
    const area = document.getElementById("novel-content-area");
    if (!state.chapters || state.chapters.length === 0) {
      area.innerHTML = `
        <div class="empty-container" style="color:#9ca3af;height:100%;justify-content:center;">
          <p>暂无正文段落</p>
        </div>
      `;
      return;
    }
    if (state.layoutMode === "scroll") {
      renderScrollMode(area);
    } else {
      renderPagedMode(area);
    }
  }

  // 1. Continuous Vertical Scroll Mode
  function renderScrollMode(area) {
    area.innerHTML = `
      <div class="novel-scroll-container" id="novel-scroll">
        <div class="novel-content-wrapper" id="novel-styled-content" style="font-size:${state.fontSize}px; line-height:${state.lineHeight};">
          ${state.chapters
            .map(
              (ch, chIdx) => `
            <div class="novel-chapter" data-chapter-index="${chIdx}">
              <h2 class="novel-chapter-title">${escapeHtml(ch.title)}</h2>
              ${ch.paragraphs
                .map((p, pIdx) => {
                  if (typeof p === "object" && p && p.type === "image") {
                    const src = window.koodoApi ? window.koodoApi(p.src) : p.src;
                    return `
                      <div class="novel-image-container" data-chapter-index="${chIdx}" data-para-index="${pIdx}">
                        <img class="novel-image" src="${escapeHtml(src)}" alt="${escapeHtml(p.alt || '')}" loading="lazy" />
                      </div>
                    `;
                  }
                  return `<p class="novel-paragraph" data-chapter-index="${chIdx}" data-para-index="${pIdx}">${escapeHtml(p)}</p>`;
                })
                .join("")}
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;

    const scrollEl = document.getElementById("novel-scroll");

    // Scroll listener for progress calculation
    scrollEl.addEventListener("scroll", () => {
      if (state.scrollDebounceTimer) clearTimeout(state.scrollDebounceTimer);
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      if (maxScroll > 0) {
        state.percentage = Math.min(1, Math.max(0, scrollEl.scrollTop / maxScroll));
        updateProgressDisplay();
      }

      state.scrollDebounceTimer = setTimeout(() => {
        reportProgress(false);
      }, 800);
    });

    // Tap center 40% toggles controls
    scrollEl.addEventListener("click", (e) => {
      const rect = scrollEl.getBoundingClientRect();
      const yRatio = (e.clientY - rect.top) / rect.height;
      if (yRatio >= 0.3 && yRatio <= 0.7) {
        toggleControls();
      }
    });

    // Restore scroll position robustly by waiting for all images to finish
    // loading before computing maxScroll. The old 100ms setTimeout fired before
    // images had loaded, causing scrollHeight to be too small and the actual
    // restored position to be wrong (typically too low).
    if (state.percentage > 0) {
      const doRestoreScroll = () => {
        const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
        if (maxScroll > 0) {
          scrollEl.scrollTop = maxScroll * state.percentage;
        }
      };

      const images = scrollEl.querySelectorAll("img");
      if (images.length === 0) {
        // No images — layout is immediate, restore right away
        requestAnimationFrame(doRestoreScroll);
      } else {
        // Wait for all images to load (or error) before restoring scroll
        let pending = images.length;
        const onSettled = () => {
          pending--;
          if (pending <= 0) doRestoreScroll();
        };
        images.forEach((img) => {
          if (img.complete) {
            pending--;
          } else {
            img.addEventListener("load", onSettled, { once: true });
            img.addEventListener("error", onSettled, { once: true });
          }
        });
        if (pending <= 0) {
          requestAnimationFrame(doRestoreScroll);
        }
      }
    }
  }

  // 2. Horizontal Paged Mode
  function renderPagedMode(area) {
    // Flatten paragraphs into screen-sized chunks
    const allParagraphs = [];
    state.chapters.forEach((ch) => {
      allParagraphs.push({ isTitle: true, text: ch.title });
      ch.paragraphs.forEach((p) => {
        if (typeof p === "object" && p && p.type === "image") {
          allParagraphs.push({ isTitle: false, isImage: true, src: p.src, alt: p.alt || "" });
        } else {
          allParagraphs.push({ isTitle: false, isImage: false, text: p });
        }
      });
    });

    // Chunk roughly by character length (~400 chars per mobile screen)
    // Images get their own dedicated page
    const pages = [];
    let curPage = [];
    let curChars = 0;
    const maxChars = Math.max(200, Math.floor(400 * (17 / state.fontSize)));

    for (const item of allParagraphs) {
      if (item.isImage) {
        if (curPage.length > 0) {
          pages.push(curPage);
          curPage = [];
          curChars = 0;
        }
        pages.push([item]);
        continue;
      }

      curPage.push(item);
      curChars += (item.text || "").length;
      if (curChars >= maxChars) {
        pages.push(curPage);
        curPage = [];
        curChars = 0;
      }
    }
    if (curPage.length > 0) pages.push(curPage);

    state.pagedPages = pages;
    state.totalPagesInPaged = Math.max(1, pages.length);
    state.pagedIndex = Math.min(
      state.totalPagesInPaged - 1,
      Math.floor(state.percentage * state.totalPagesInPaged)
    );

    renderCurrentPage(area);
  }

  function renderCurrentPage(area) {
    const pageItems = state.pagedPages[state.pagedIndex] || [];

    area.innerHTML = `
      <div class="novel-paged-container">
        <div class="novel-paged-content" id="novel-styled-content" style="font-size:${state.fontSize}px; line-height:${state.lineHeight};">
          ${pageItems
            .map((item) => {
              if (item.isTitle) {
                return `<h2 class="novel-chapter-title">${escapeHtml(item.text)}</h2>`;
              }
              if (item.isImage) {
                const src = window.koodoApi ? window.koodoApi(item.src) : item.src;
                return `
                  <div class="novel-image-container novel-image-paged">
                    <img class="novel-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.alt || '')}" loading="lazy" />
                  </div>
                `;
              }
              return `<p class="novel-paragraph">${escapeHtml(item.text)}</p>`;
            })
            .join("")}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--novel-muted);padding-top:8px;">
          <span>${escapeHtml(state.book.name)}</span>
          <span>${state.pagedIndex + 1} / ${state.totalPagesInPaged}</span>
        </div>
        <!-- Tap zones overlay -->
        <div class="novel-tap-overlay">
          <div class="novel-zone-prev" id="novel-prev-zone"></div>
          <div class="novel-zone-center" id="novel-center-zone"></div>
          <div class="novel-zone-next" id="novel-next-zone"></div>
        </div>
      </div>
    `;

    document.getElementById("novel-prev-zone").onclick = () => prevNovelPage();
    document.getElementById("novel-next-zone").onclick = () => nextNovelPage();
    document.getElementById("novel-center-zone").onclick = () => toggleControls();

    // Swipe gesture
    let touchStartX = 0;
    let touchStartY = 0;
    const overlay = area.querySelector(".novel-tap-overlay");
    overlay.addEventListener("touchstart", (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    });
    overlay.addEventListener("touchend", (e) => {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        if (deltaX < 0) nextNovelPage();
        else prevNovelPage();
      }
    });

    state.percentage = (state.pagedIndex + 1) / state.totalPagesInPaged;
    updateProgressDisplay();
  }

  function nextNovelPage() {
    if (state.pagedIndex < state.totalPagesInPaged - 1) {
      state.pagedIndex++;
      const area = document.getElementById("novel-content-area");
      renderCurrentPage(area);
      reportProgress(true);
    }
  }

  function prevNovelPage() {
    if (state.pagedIndex > 0) {
      state.pagedIndex--;
      const area = document.getElementById("novel-content-area");
      renderCurrentPage(area);
      reportProgress(true);
    }
  }

  function jumpToPercentage(pct) {
    state.percentage = Math.min(1, Math.max(0, pct));
    updateProgressDisplay();

    if (state.layoutMode === "scroll") {
      const scrollEl = document.getElementById("novel-scroll");
      if (scrollEl) {
        const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
        scrollEl.scrollTop = maxScroll * state.percentage;
      }
    } else {
      state.pagedIndex = Math.min(
        state.totalPagesInPaged - 1,
        Math.floor(state.percentage * state.totalPagesInPaged)
      );
      const area = document.getElementById("novel-content-area");
      renderCurrentPage(area);
    }
    reportProgress(true);
  }

  function updateProgressDisplay() {
    const pct = Math.round(state.percentage * 100);
    const progressEl = document.getElementById("novel-progress-text");
    if (progressEl) progressEl.textContent = `${pct}%`;

    const scrubber = document.getElementById("novel-scrubber");
    if (scrubber) scrubber.value = pct;

    const scrubberVal = document.getElementById("novel-scrubber-val");
    if (scrubberVal) scrubberVal.textContent = `${pct}%`;
  }

  function toggleControls() {
    state.controlsVisible = !state.controlsVisible;
    const header = document.getElementById("novel-header");
    const footer = document.getElementById("novel-footer");
    if (header && footer) {
      header.classList.toggle("hidden", !state.controlsVisible);
      footer.classList.toggle("hidden", !state.controlsVisible);
    }
  }

  function getCurrentChapterTitle() {
    if (!state.chapters || state.chapters.length === 0) {
      return state.book ? state.book.name : "";
    }
    if (state.layoutMode === "paged") {
      let lastTitle = state.chapters[0]?.title || "";
      for (let i = 0; i <= state.pagedIndex && i < state.pagedPages.length; i++) {
        const titleItem = state.pagedPages[i]?.find((it) => it.isTitle);
        if (titleItem) lastTitle = titleItem.text;
      }
      return lastTitle || state.book?.name || "";
    } else {
      const scrollEl = document.getElementById("novel-scroll");
      if (!scrollEl) return state.chapters[0]?.title || state.book?.name || "";
      const chapterEls = scrollEl.querySelectorAll(".novel-chapter");
      let activeTitle = state.chapters[0]?.title || state.book?.name || "";
      const top = scrollEl.scrollTop + 50;
      for (const el of chapterEls) {
        if (el.offsetTop <= top) {
          const tEl = el.querySelector(".novel-chapter-title");
          if (tEl && tEl.textContent) activeTitle = tEl.textContent.trim();
        } else {
          break;
        }
      }
      return activeTitle;
    }
  }

  /**
   * Find the currently visible paragraph in scroll mode and return its
   * chapter/para context for paragraph-level position sync.
   */
  function getScrollModeParaContext() {
    const scrollEl = document.getElementById("novel-scroll");
    if (!scrollEl) return null;
    const viewTop = scrollEl.scrollTop;
    const viewBottom = viewTop + scrollEl.clientHeight;
    // Walk all tagged paragraphs/images and find the first one visible
    const tagged = scrollEl.querySelectorAll("[data-chapter-index][data-para-index]");
    let best = null;
    for (const el of tagged) {
      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      // Element is at least partially visible
      if (elBottom > viewTop && elTop < viewBottom) {
        best = el;
        break;
      }
    }
    if (!best) return null;
    const chIdx = parseInt(best.dataset.chapterIndex, 10);
    const pIdx = parseInt(best.dataset.paraIndex, 10);
    const ch = state.chapters[chIdx];
    if (!ch) return null;
    const para = ch.paragraphs[pIdx];
    const text = typeof para === "string" ? para : (para && para.alt) ? para.alt : "";
    return {
      chapterDocIndex: ch.chapterDocIndex !== undefined ? ch.chapterDocIndex : chIdx,
      chapterHref: ch.href || ch.id || "",
      text: text.slice(0, 80), // first 80 chars of the visible paragraph
      count: String(ch.paragraphs.length),
    };
  }

  function reportProgress(immediate = false) {
    if (!state.book) return;
    const payload = {
      bookKey: state.book.key,
      percentage: Number(state.percentage.toFixed(4)),
      page: state.layoutMode === "paged" ? state.pagedIndex + 1 : 1,
      totalPages: state.layoutMode === "paged" ? state.totalPagesInPaged : 1,
      timestamp: Date.now(),
      format: state.book.format || "epub",
      chapterTitle: getCurrentChapterTitle() || state.book.name,
    };

    // Enrich payload with paragraph-level context for accurate desktop restore
    if (state.layoutMode === "scroll") {
      const ctx = getScrollModeParaContext();
      if (ctx) {
        payload.chapterDocIndex = ctx.chapterDocIndex;
        payload.chapterHref = ctx.chapterHref;
        payload.text = ctx.text;
        payload.count = ctx.count;
      }
    } else {
      // Paged mode: use currentChapterIndex from state
      const ch = state.chapters[state.currentChapterIndex];
      if (ch) {
        payload.chapterDocIndex = ch.chapterDocIndex !== undefined ? ch.chapterDocIndex : state.currentChapterIndex;
        payload.chapterHref = ch.href || ch.id || "";
        payload.count = String(ch.paragraphs.length);
      }
    }

    if (window.syncProgress) {
      window.syncProgress(payload, immediate);
    }
  }

  window.reportNovelProgress = reportProgress;

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
