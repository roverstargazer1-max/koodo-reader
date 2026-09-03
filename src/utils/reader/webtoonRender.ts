import { ComicRender } from "../../assets/lib/kookit.min";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { READING_PANEL_TOGGLE_EVENT } from "./mouseEvent";

export interface WebtoonRenderOptions {
  format: string;
  readerMode: string;
  key: string;
  scale?: number;
  margin?: number;
  backgroundColor?: string;
  [key: string]: any;
}

export class WebtoonRender {
  public format: string;
  public readerMode: string;
  public bookKey: string;
  private buffer: ArrayBuffer;
  private options: WebtoonRenderOptions;
  private comicRender: any;

  private element: HTMLElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private doc: Document | null = null;
  private win: Window | null = null;

  public totalPages: number = 0;
  public currentPage: number = 1;
  public chapterList: any[] = [];
  public chapterDocList: any[] = [];
  public flattenChapters: any[] = [];

  public scale: number = 1;
  private pageWrappers: HTMLElement[] = [];
  private loadedImageUrls: Map<number, string> = new Map();
  private inFlightImagePromises: Map<number, Promise<string>> = new Map();
  private renderingPages: Set<number> = new Set();
  private observer: IntersectionObserver | null = null;
  private scrollThrottleTimer: any = null;
  private isProgrammaticScrolling: boolean = false;
  private programmaticScrollTimeout: any = null;
  private lastRecordedPercentage: string = "";
  private callbacks: Record<string, Function[]> = {};

  constructor(buffer: ArrayBuffer, options: WebtoonRenderOptions) {
    this.buffer = buffer;
    this.options = options;
    this.format = options.format || "CBZ";
    this.readerMode = "webtoon";
    this.bookKey = options.key || "";
    this.scale = options.scale
      ? Number(options.scale)
      : parseFloat(ConfigService.getReaderConfig("scale") || "1") || 1;
    this.comicRender = new ComicRender(buffer, {
      ...options,
      readerMode: "webtoon",
    });
  }

  public async renderTo(
    element: HTMLElement,
    bookLocation?: any
  ): Promise<void> {
    this.element = element;
    element.innerHTML = "";

    try {
      await this.comicRender.parse();
    } catch (err) {
      console.error("WebtoonRender comic parse error:", err);
      throw err;
    }

    const sections = this.comicRender.book?.sections || [];
    const toc = this.comicRender.book?.toc || [];
    this.totalPages = sections.length;
    this.chapterList = toc;
    this.chapterDocList = toc.map((item: any, index: number) => ({
      ...item,
      index,
      href: item.href || String(index),
    }));
    this.flattenChapters = this.chapterDocList;

    // Create iframe to isolate CSS & DOM, and integrate seamlessly with Koodo Reader docUtil
    const iframe = document.createElement("iframe");
    iframe.id = "kookit-iframe";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.style.margin = "0";
    iframe.style.padding = "0";
    iframe.style.display = "block";
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");

    element.appendChild(iframe);
    this.iframe = iframe;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      throw new Error("Unable to access iframe document in WebtoonRender");
    }
    this.doc = doc;
    this.win = iframe.contentWindow;

    const bgColor =
      this.options.backgroundColor ||
      ConfigService.getReaderConfig("backgroundColor") ||
      "transparent";

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: auto;
      min-height: 100%;
      background-color: ${bgColor};
      overflow-x: hidden;
      overflow-y: auto;
      user-select: none;
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }
    html:hover, body:hover {
      scrollbar-color: #ccc transparent;
    }
    body::-webkit-scrollbar {
      width: 8px;
    }
    body::-webkit-scrollbar-track {
      background: transparent;
    }
    body::-webkit-scrollbar-thumb {
      background: transparent;
      border-radius: 4px;
      transition: background-color 0.3s ease;
    }
    body:hover::-webkit-scrollbar-thumb {
      background: #ccc;
    }
    :root {
      --webtoon-scale: ${this.scale};
    }
    .webtoon-stream-container {
      width: 100%;
      max-width: min(100%, calc(700px * var(--webtoon-scale, 1)));
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 0 auto;
      padding: 0;
      transition: max-width 0.15s ease-out;
    }
    .webtoon-page-wrapper {
      width: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      margin: 0;
      padding: 0;
      border: 0;
      min-height: 200px;
      position: relative;
      background-color: transparent;
    }
    .webtoon-image {
      width: 100%;
      max-width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
      padding: 0;
      border: 0;
      object-fit: contain;
      image-rendering: -webkit-optimize-contrast;
    }
    .webtoon-placeholder {
      width: 100%;
      height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #888;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="webtoon-stream-container" id="webtoon-stream"></div>
</body>
</html>`;

    doc.open();
    doc.write(htmlContent);
    doc.close();

    const streamContainer = doc.getElementById("webtoon-stream");
    if (!streamContainer) return;

    this.pageWrappers = [];
    for (let i = 0; i < this.totalPages; i++) {
      const wrapper = doc.createElement("div");
      wrapper.className = "webtoon-page-wrapper";
      wrapper.dataset.pageIndex = String(i);
      wrapper.id = `webtoon-page-${i}`;

      const placeholder = doc.createElement("div");
      placeholder.className = "webtoon-placeholder";
      placeholder.innerText = `${i + 1} / ${this.totalPages}`;
      wrapper.appendChild(placeholder);

      streamContainer.appendChild(wrapper);
      this.pageWrappers.push(wrapper);
    }

    // Set up IntersectionObserver for virtualized preloading & recycling
    this.initIntersectionObserver();

    // Set up scroll listener for viewport center page tracking
    if (this.win) {
      this.win.addEventListener("scroll", this.onScrollHandler, {
        passive: true,
      });
    }

    // Set up click listener for reading panel toggle and edge pagination
    doc.addEventListener("click", this.onDocClickHandler);

    // Set up Ctrl + Wheel for interactive smooth zooming
    doc.addEventListener(
      "wheel",
      (event: WheelEvent) => {
        if (event.ctrlKey) {
          event.preventDefault();
          const step = event.deltaY < 0 ? 0.08 : -0.08;
          const newScale = Math.max(
            0.3,
            Math.min(3.0, Math.round((this.scale + step) * 100) / 100)
          );
          this.setScale(newScale);
          ConfigService.setReaderConfig("scale", String(newScale));
          if (this.options.handleScale) {
            this.options.handleScale(String(newScale));
          }
        }
      },
      { passive: false }
    );

    // Initial reading position restoration
    const savedLocation =
      bookLocation ||
      ConfigService.getObjectConfig(this.bookKey, "recordLocation", {});
    const initialPage = savedLocation.page ? parseInt(savedLocation.page) : 1;

    if (initialPage > 1 && initialPage <= this.totalPages) {
      this.currentPage = initialPage;
      // Preload target and adjacent pages immediately
      this.preloadPagesAround(initialPage - 1, 2);
      setTimeout(() => {
        const targetWrapper = this.pageWrappers[initialPage - 1];
        if (targetWrapper && this.win) {
          this.isProgrammaticScrolling = true;
          targetWrapper.scrollIntoView({ block: "start" });
          setTimeout(() => {
            this.isProgrammaticScrolling = false;
            this.recordLocation();
          }, 300);
        }
      }, 80);
    } else {
      this.currentPage = 1;
      this.preloadPagesAround(0, 3);
      this.recordLocation();
    }

    this.trigger("rendered");
    this.trigger("page-changed");
  }

  private initIntersectionObserver() {
    if (!this.win) return;

    const ObserverClass =
      (this.win as any)?.IntersectionObserver || IntersectionObserver;
    if (!ObserverClass) {
      // Fallback if IntersectionObserver is unavailable: load all
      this.preloadPagesAround(0, this.totalPages);
      return;
    }

    this.observer = new ObserverClass(
      (entries) => {
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          const pageIndex = parseInt(target.dataset.pageIndex || "0");

          if (entry.isIntersecting) {
            this.renderPageImage(pageIndex);
          } else {
            // Far away pages (> 8 pages distance) get unloaded to conserve GPU textures
            const dist = Math.abs(pageIndex - (this.currentPage - 1));
            if (dist > 8) {
              this.unmountPageImage(pageIndex);
            }
          }
        });
      },
      {
        root: null,
        rootMargin: "1500px 0px 1500px 0px", // Preload 1500px above and below viewport
        threshold: 0.01,
      }
    );

    this.pageWrappers.forEach((wrapper) => {
      this.observer?.observe(wrapper);
    });
  }

  private async loadPageImageUrl(index: number): Promise<string> {
    if (this.loadedImageUrls.has(index)) {
      return this.loadedImageUrls.get(index)!;
    }
    if (this.inFlightImagePromises.has(index)) {
      return this.inFlightImagePromises.get(index)!;
    }

    const promise = (async () => {
      const sections = this.comicRender.book?.sections;
      if (!sections || !sections[index]) return "";

      try {
        const section = sections[index];
        const htmlBlobUrl = await section.load();
        if (!htmlBlobUrl) return "";

        const res = await fetch(htmlBlobUrl);
        const text = await res.text();
        const match = text.match(/<img\s+src="([^"]+)"/);
        const imgSrc = match ? match[1] : htmlBlobUrl;

        this.loadedImageUrls.set(index, imgSrc);
        return imgSrc;
      } catch (err) {
        console.error(`Failed to load comic page ${index}:`, err);
        return "";
      } finally {
        this.inFlightImagePromises.delete(index);
      }
    })();

    this.inFlightImagePromises.set(index, promise);
    return promise;
  }

  private async renderPageImage(index: number) {
    const wrapper = this.pageWrappers[index];
    if (!wrapper || !this.doc) return;

    if (this.renderingPages.has(index)) return;
    if (wrapper.querySelector("img")) return;

    this.renderingPages.add(index);
    try {
      const src = await this.loadPageImageUrl(index);
      if (!src || !this.doc) return;

      // Clean up any extra duplicates just in case
      const existingImgs = wrapper.querySelectorAll("img");
      if (existingImgs.length > 0) {
        for (let i = 1; i < existingImgs.length; i++) {
          existingImgs[i].remove();
        }
        if (existingImgs[0].src !== src) {
          existingImgs[0].src = src;
        }
        return;
      }

      const img = this.doc.createElement("img");
      img.className = "webtoon-image";
      img.alt = `Page ${index + 1}`;
      img.onload = () => {
        // Fix wrapper minHeight to loaded height to eliminate layout shifting
        if (img && img.offsetHeight > 0) {
          wrapper.style.minHeight = `${img.offsetHeight}px`;
          const placeholder = wrapper.querySelector(".webtoon-placeholder");
          if (placeholder) {
            placeholder.remove();
          }
        }
      };
      img.src = src;
      wrapper.appendChild(img);
    } finally {
      this.renderingPages.delete(index);
    }
  }

  private unmountPageImage(index: number) {
    const wrapper = this.pageWrappers[index];
    if (!wrapper || !this.doc) return;

    const imgs = wrapper.querySelectorAll("img");
    if (imgs.length > 0) {
      imgs.forEach((img) => img.remove());
      const placeholder = wrapper.querySelector(".webtoon-placeholder");
      if (!placeholder) {
        const ph = this.doc.createElement("div");
        ph.className = "webtoon-placeholder";
        ph.innerText = `${index + 1} / ${this.totalPages}`;
        wrapper.appendChild(ph);
      }
    }

    const sections = this.comicRender.book?.sections;
    if (sections && sections[index]?.unload) {
      sections[index].unload();
    }
    this.loadedImageUrls.delete(index);
    this.inFlightImagePromises.delete(index);
  }

  private preloadPagesAround(centerIndex: number, radius: number = 2) {
    const start = Math.max(0, centerIndex - radius);
    const end = Math.min(this.totalPages - 1, centerIndex + radius);
    for (let i = start; i <= end; i++) {
      this.renderPageImage(i);
    }
  }

  private onScrollHandler = () => {
    if (this.isProgrammaticScrolling) return;

    if (this.scrollThrottleTimer) return;
    this.scrollThrottleTimer = requestAnimationFrame(() => {
      this.scrollThrottleTimer = null;
      this.detectCurrentCenterPage();
    });
  };

  private detectCurrentCenterPage() {
    if (!this.win || !this.doc || this.pageWrappers.length === 0) return;

    const winHeight =
      this.win.innerHeight || this.doc.documentElement.clientHeight || 800;
    const centerY = winHeight / 2;

    let centerIndex = -1;
    for (let i = 0; i < this.pageWrappers.length; i++) {
      const rect = this.pageWrappers[i].getBoundingClientRect();
      if (rect.top <= centerY && rect.bottom >= centerY) {
        centerIndex = i;
        break;
      }
    }

    if (centerIndex === -1) {
      let minDiff = Infinity;
      for (let i = 0; i < this.pageWrappers.length; i++) {
        const rect = this.pageWrappers[i].getBoundingClientRect();
        const midY = (rect.top + rect.bottom) / 2;
        const diff = Math.abs(midY - centerY);
        if (diff < minDiff) {
          minDiff = diff;
          centerIndex = i;
        }
      }
    }

    const atBottom =
      Boolean(this.win &&
      this.doc &&
      (this.doc.documentElement.scrollHeight || this.doc.body?.scrollHeight || 0) >
        (this.win.innerHeight || 800) &&
      (this.win.scrollY ??
        this.doc.documentElement.scrollTop ??
        this.doc.body?.scrollTop ??
        0) +
        (this.win.innerHeight || 800) >=
        (this.doc.documentElement.scrollHeight ||
          this.doc.body?.scrollHeight ||
          0) -
          15);

    const pageChanged =
      centerIndex !== -1 && centerIndex + 1 !== this.currentPage;
    if (pageChanged) {
      this.currentPage = centerIndex + 1;
    }

    if (pageChanged || (atBottom && this.lastRecordedPercentage !== "1")) {
      this.recordLocation();
      this.trigger("page-changed");
    }
  }

  private onDocClickHandler = (event: MouseEvent) => {
    if (!this.win) return;
    const target = event.target as HTMLElement;
    if (target && target.tagName === "IMG") {
      return;
    }
    const clientHeight = this.win.innerHeight || 800;
    const clickY = event.clientY;

    // Top 15% click -> scroll up
    if (clickY < clientHeight * 0.15) {
      this.prev();
      return;
    }
    // Bottom 15% click -> scroll down
    if (clickY > clientHeight * 0.85) {
      this.next();
      return;
    }

    // Center 70% click -> toggle reading panels (toolbar)
    window.dispatchEvent(
      new CustomEvent(READING_PANEL_TOGGLE_EVENT, {
        detail: { position: "top" },
      })
    );
  };

  public recordLocation() {
    if (!this.bookKey) return;
    const position = this.getPosition();
    this.lastRecordedPercentage = position.percentage;
    ConfigService.setObjectConfig(this.bookKey, position, "recordLocation");
  }

  public setScale(scale: number) {
    this.scale = Math.max(0.3, Math.min(3.5, scale));
    if (this.doc) {
      this.doc.documentElement.style.setProperty(
        "--webtoon-scale",
        String(this.scale)
      );
      const stream = this.doc.getElementById("webtoon-stream");
      if (stream) {
        stream.style.maxWidth = `min(100%, calc(700px * ${this.scale}))`;
      }
    }
  }

  public goToPage(page: number) {
    const targetIndex = Math.max(0, Math.min(this.totalPages - 1, page - 1));
    const wrapper = this.pageWrappers[targetIndex];
    if (!wrapper || !this.win) return;

    this.preloadPagesAround(targetIndex, 2);

    this.isProgrammaticScrolling = true;
    if (this.programmaticScrollTimeout) {
      clearTimeout(this.programmaticScrollTimeout);
    }

    wrapper.scrollIntoView({ behavior: "smooth", block: "start" });

    this.programmaticScrollTimeout = setTimeout(() => {
      this.currentPage = targetIndex + 1;
      this.recordLocation();
      this.trigger("page-changed");
      this.isProgrammaticScrolling = false;
    }, 350);
  }

  public goToChapterDocIndex(index: number) {
    this.goToPage(index + 1);
  }

  public goToChapterIndex(index: number) {
    this.goToPage(index + 1);
  }

  public goToPosition(positionStr: string) {
    try {
      const pos = JSON.parse(positionStr);
      if (pos.page) {
        this.goToPage(parseInt(pos.page));
      } else if (pos.chapterDocIndex !== undefined) {
        this.goToChapterDocIndex(parseInt(pos.chapterDocIndex));
      }
    } catch {
      // ignore
    }
  }

  public calculateProgress(): number {
    if (this.totalPages <= 0) return 0;

    // Check if scrolled to the very bottom of the document
    if (this.win && this.doc) {
      const scrollHeight =
        this.doc.documentElement.scrollHeight ||
        this.doc.body?.scrollHeight ||
        0;
      const clientHeight =
        this.win.innerHeight || this.doc.documentElement.clientHeight || 800;
      const scrollTop =
        this.win.scrollY ??
        this.doc.documentElement.scrollTop ??
        this.doc.body?.scrollTop ??
        0;

      if (
        scrollHeight > clientHeight &&
        scrollTop + clientHeight >= scrollHeight - 15
      ) {
        return 1;
      }
    }

    if (this.totalPages === 1) {
      if (this.win && this.doc) {
        const scrollHeight =
          this.doc.documentElement.scrollHeight ||
          this.doc.body?.scrollHeight ||
          0;
        const clientHeight =
          this.win.innerHeight || this.doc.documentElement.clientHeight || 800;
        const maxScroll = scrollHeight - clientHeight;
        if (maxScroll > 0) {
          const scrollTop =
            this.win.scrollY ??
            this.doc.documentElement.scrollTop ??
            this.doc.body?.scrollTop ??
            0;
          return Math.max(0, Math.min(1, scrollTop / maxScroll));
        }
      }
      return 1;
    }

    // For multiple pages, calculate continuous progress across page wrappers
    const currentIndex = Math.max(
      0,
      Math.min(this.totalPages - 1, this.currentPage - 1)
    );
    const wrapper = this.pageWrappers[currentIndex];
    if (wrapper && this.win) {
      const winHeight = this.win.innerHeight || 800;
      const centerY = winHeight / 2;
      const rect = wrapper.getBoundingClientRect();
      const pageHeight = rect.bottom - rect.top;
      if (pageHeight > 0) {
        const offsetInPage = centerY - rect.top;
        const ratioInPage = Math.max(0, Math.min(1, offsetInPage / pageHeight));
        const progress = (currentIndex + ratioInPage) / this.totalPages;
        return Math.max(0, Math.min(1, progress));
      }
    }

    return Math.max(0, Math.min(1, this.currentPage / this.totalPages));
  }

  private formatProgress(progress: number): string {
    if (progress >= 1) return "1";
    if (progress <= 0) return "0";
    const rounded = Math.round(progress * 10000) / 10000;
    if (rounded <= 0) return "0.0001";
    if (rounded >= 1) return "0.9999";
    return String(rounded);
  }

  public goToPercentage(percentage: number) {
    let normalized = percentage;
    if (normalized > 1 && normalized <= 100) {
      normalized = normalized / 100;
    } else if (normalized > 100) {
      normalized = 1;
    }
    if (this.totalPages === 1 && this.win && this.doc) {
      const scrollHeight =
        this.doc.documentElement.scrollHeight ||
        this.doc.body?.scrollHeight ||
        0;
      const clientHeight =
        this.win.innerHeight || this.doc.documentElement.clientHeight || 800;
      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll > 0) {
        this.win.scrollTo({
          top: maxScroll * normalized,
          behavior: "smooth",
        });
        return;
      }
    }
    const targetPage = Math.max(
      1,
      Math.min(this.totalPages, Math.round(normalized * this.totalPages))
    );
    this.goToPage(targetPage);
  }

  public prev() {
    if (!this.win) return;
    const clientHeight = this.win.innerHeight || 800;
    this.win.scrollBy({ top: -clientHeight * 0.8, behavior: "smooth" });
  }

  public next() {
    if (!this.win) return;
    const clientHeight = this.win.innerHeight || 800;
    this.win.scrollBy({ top: clientHeight * 0.8, behavior: "smooth" });
  }

  public getProgress() {
    const progress = this.calculateProgress();
    const percentage = this.formatProgress(progress);
    return {
      currentPage: this.currentPage,
      totalPage: this.totalPages,
      percentage,
    };
  }

  public getPosition() {
    const progress = this.calculateProgress();
    const percentage = this.formatProgress(progress);
    const currentChapter = this.chapterDocList[this.currentPage - 1];
    const label = currentChapter?.label || `Page ${this.currentPage}`;
    const href = currentChapter?.href || String(this.currentPage - 1);

    return {
      count: String(this.currentPage),
      page: String(this.currentPage),
      percentage,
      chapterTitle: label,
      chapterDocIndex: String(this.currentPage - 1),
      chapterHref: href,
      text: "",
      xpath: "",
      cfi: "",
    };
  }

  public getChapter() {
    return this.chapterList;
  }

  public getChapterDoc() {
    return this.chapterDocList;
  }

  public flatChapter(chapters: any[]) {
    return this.flattenChapters;
  }

  public getDocument(): Document | null {
    return this.doc;
  }

  public getIframe(): HTMLIFrameElement | null {
    return this.iframe;
  }

  public async renderHighlighters() {
    // Comics do not require text highlighting
  }

  public getAnnotationData() {
    return null;
  }

  public getTargetHref(event: any): string {
    let href = "";
    if (!event || !event.target) return href;
    if (event.target.innerText && event.target.innerText.startsWith("http")) {
      href = event.target.innerText;
    }
    let el = event.target;
    while (el && el.tagName !== "BODY") {
      if (el.getAttribute) {
        const h = el.getAttribute("href");
        if (h) {
          href = h || "";
          break;
        }
      }
      el = el.parentNode;
    }
    return href;
  }

  public resolveChapter(href: string): any {
    return null;
  }

  public async getImageList(): Promise<string[]> {
    const list: string[] = [];
    for (let i = 0; i < this.totalPages; i++) {
      if (this.loadedImageUrls.has(i)) {
        list.push(this.loadedImageUrls.get(i)!);
      } else {
        const url = await this.loadPageImageUrl(i);
        if (url) list.push(url);
      }
    }
    return list;
  }

  public async nextChapter() {
    this.next();
  }

  public async prevChapter() {
    this.prev();
  }

  public async record() {
    this.recordLocation();
  }

  public on(event: string, callback: Function) {
    if (!this.callbacks[event]) {
      this.callbacks[event] = [];
    }
    this.callbacks[event].push(callback);
    return this;
  }

  public off(event: string, callback?: Function) {
    if (!this.callbacks[event]) return this;
    if (!callback) {
      delete this.callbacks[event];
    } else {
      this.callbacks[event] = this.callbacks[event].filter(
        (cb) => cb !== callback
      );
    }
    return this;
  }

  public trigger(event: string, ...args: any[]) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach((cb) => {
        try {
          cb(...args);
        } catch (e) {
          console.error(`Error in WebtoonRender event [${event}]:`, e);
        }
      });
    }
    return this;
  }

  public removeContent() {
    this.recordLocation();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.win) {
      this.win.removeEventListener("scroll", this.onScrollHandler);
    }
    if (this.doc) {
      this.doc.removeEventListener("click", this.onDocClickHandler);
    }
    if (this.programmaticScrollTimeout) {
      clearTimeout(this.programmaticScrollTimeout);
    }

    const sections = this.comicRender.book?.sections;
    if (sections) {
      for (let i = 0; i < sections.length; i++) {
        try {
          sections[i]?.unload?.();
        } catch {
          // ignore
        }
      }
    }

    this.loadedImageUrls.clear();
    this.pageWrappers = [];
    if (this.element) {
      this.element.innerHTML = "";
    }
  }
}

export default WebtoonRender;
