# PicaComic (PicACG) Integration Specification

## Problem Statement

Users of Koodo Reader who read online manga and comics currently only have access to JMComic as a built-in online provider. Users desire access to PicACG (PicaComic / 哔咔漫画), one of the largest community manga archives, to search, discover categories and leaderboards, sync personal cloud favorites, and download albums as offline `.cbz` comic books directly into their local Koodo Reader library without needing external crawler or downloader applications.

## Solution

Integrate PicACG natively into Koodo Reader by:
1. Refactoring the sidebar navigation item "Online Comics" into an expandable menu containing both JMComic and PicaComic.
2. Building an in-process native Node.js / TypeScript PicACG client in the Electron main process using standard HMAC-SHA256 dynamic signature authentication, eliminating heavy external dependencies and extra subprocess overhead.
3. Providing a comprehensive `PicaDialog` modal featuring Search, Category & Leaderboard Exploration, Personal Favorites with Cloud Sync, Download Management, and Network / Routing Settings.
4. Implementing an automated chapter downloader and CBZ packager that embeds standard `ComicInfo.xml` metadata, transfers `.cbz` files into the Koodo library directory, registers them in SQLite, and displays "In Library" indicators on previously downloaded comics.

---

## User Stories

1. As a reader, I want to click an arrow next to "Online Comics" in the sidebar to expand a submenu, so that I can switch between JMComic and PicaComic seamlessly.
2. As a reader, I want my sidebar expansion state to be remembered across sessions, so that I don't have to re-expand the menu every time I open the app.
3. As a reader, I want to search for comics by keyword, tag, or author in the Search tab, so that I can quickly find specific manga titles.
4. As a reader, I want to filter search results by popularity, newest uploads, and rating, so that I can sort results according to my preferences.
5. As a reader, I want to browse official categories with their visual icons in the Explore tab, so that I can discover comics by genres and topics.
6. As a reader, I want to view official 24-hour, 7-day, and 30-day leaderboards in the Explore tab, so that I can discover currently trending and popular works.
7. As a reader, I want to get random comic recommendations with a single click, so that I can explore unexpected content.
8. As a reader, I want to click on any comic card to open a detailed modal drawer displaying the cover, author, category, tags, description, page count, and chapter list, so that I can inspect the full details of an album before reading or downloading.
9. As a reader, I want to toggle a heart icon in the comic detail drawer, so that I can add or remove the comic from my remote PicACG account favorites.
10. As a reader, I want to log in with my PicACG account credentials in the Favorites tab, so that I can access my cloud-saved manga collection.
11. As a reader, I want my login credentials and authentication token to be securely saved with an optional "Remember Me" toggle, so that I don't have to re-enter my password on every app restart.
12. As a reader, I want expired authentication tokens (HTTP 401) to automatically refresh silently in the background, so that my browsing session is never interrupted by auth expiration.
13. As a reader, I want to view my user profile (avatar, nickname, title/level, character slot) at the top of the Favorites tab, so that I can verify my active account state.
14. As a reader, I want to browse my remote favorites with pagination and folder filtering, so that I can manage large libraries efficiently.
15. As a reader, I want to see a prominent green "In Library" badge on comic cards that already exist in my local Koodo Reader library, so that I can avoid duplicate downloads.
16. As a reader, I want to enable a "Batch Management" mode in the Favorites tab to multi-select albums, so that I can enqueue multiple albums for download in a single click.
17. As a reader, I want a "Select All Unimported" button during batch selection, so that I can quickly import only new albums from my favorites into my local library.
18. As a reader, I want to choose between "Download All Chapters" and selecting specific chapters in the detail drawer, so that I can download either full tankobon volumes or single episodes.
19. As a reader, I want downloaded chapters to be packaged as clean `.cbz` files containing embedded `ComicInfo.xml` metadata, so that comic reader apps can accurately display title, author, chapter, summary, and cover tags.
20. As a reader, I want completed downloads to automatically register in Koodo Reader's SQLite database and trigger a library refresh, so that I can start reading immediately without manual importing.
21. As a reader, I want to monitor active downloads in a dedicated "Downloads" tab with per-chapter progress bars, pause, retry, and cancellation controls, so that I have full visibility into background transfer tasks.
22. As a reader, I want batch download jobs to execute album-by-album serially with parallel chapter image downloads and request delays, so that my IP and account are protected against rate-limiting and anti-scraping bans.
23. As a reader, I want to switch between official PicACG network routes (Route 1, Route 2, Route 3) in the Settings tab, so that I can bypass network congestion or region-specific connection blocks.
24. As a reader, I want to configure custom HTTP or SOCKS5 proxies in the Settings tab, so that the client functions smoothly behind network proxies.
25. As a reader, I want to select preferred image quality (Original, High, Medium, Low), so that I can balance visual clarity against download speed and storage consumption.
26. As a reader, I want cover and comic images to load reliably in the UI without broken images caused by anti-hotlinking protections.

---

## Implementation Decisions

### 1. Architectural Seams & Runtime Isolation
- The PicACG client will be implemented as a native Electron main-process TypeScript/Node.js module.
- All HTTP requests will compute request headers dynamically using the native Node.js cryptography module:
  - Header parameters: `api-key`, `accept: application/vnd.picacomic.com.v1+json`, `time`, `nonce`, `signature`, `app-channel`, `app-version`, `app-platform`, `image-quality`, and `authorization`.
  - Signature string: Lowercase concatenation of `path + time + nonce + method + apiKey` hashed via HMAC-SHA256 with the static secret key.
- No child processes or external language sidecars (Python/Rust/Go) will be spawned for PicaComic, eliminating subprocess launch overhead.

### 2. Sidebar & Navigation Hierarchy
- The existing sidebar menu structure will be upgraded to support nested sub-items.
- The "Online Comics" menu item will display an expandable chevron icon.
- Expanding "Online Comics" presents sub-items for `JMComic` and `PicaComic`.
- Clicking `JMComic` displays the existing `JmcomicDialog`; clicking `PicaComic` displays the new `PicaDialog`.
- Expansion state will be persisted in local storage or app settings.

### 3. Session & Credential Lifecycle
- User authentication tokens (JWT) and credentials will be saved locally.
- When an API request encounters a 401 response indicating token expiration, the main-process client will automatically issue a silent re-authentication request using stored credentials and replay the failed request.
- The UI will display a user profile header with logout and manual refresh controls when logged in, and a clean login form card when logged out.

### 4. Image Proxy & Anti-hotlink Defense
- Electron main process will configure web request interceptors on PicACG media server domains (`*://*.picacomic.com/*`, `*://*.storage*.picacomic.com/*`, Cloudflare CDN mirrors) to inject appropriate `Referer`, `User-Agent`, and custom headers, ensuring unblocked cover waterfall and thumbnail loading.

### 5. Multi-chapter Packaging & Metadata Ingestion
- Image downloader will stream pages in parallel (3–5 concurrent threads per album).
- Downloaded images will be compressed into a standard `.cbz` archive.
- A compliant `ComicInfo.xml` file will be generated and placed at the root of the `.cbz` archive, specifying title, writer, summary, tags, genre, page count, and cover index.
- The resulting `.cbz` file will be moved to Koodo's book storage directory, indexed into SQLite via the database command interface, and the frontend library state will be notified to refresh.

### 6. Download Queue & Concurrency Management
- The main-process download manager will maintain a serial queue across albums.
- Within an active album, chapters and image pages will be fetched with controlled concurrency and an anti-scraping delay (100–300ms) between page batches.
- Progress events (percentage, bytes received, status message, failed chapters) will be emitted via IPC to the renderer process in real time.

---

## Testing Decisions

### Seams to Test
1. **Protocol & Signature Unit Testing**:
   - Verify HMAC-SHA256 signature generation against known test vectors.
   - Verify header builder logic (UUID nonce formatting, timestamp synchronization, lowercasing).
2. **Client Mock Service Testing**:
   - Mock PicACG API endpoints (Login, Categories, Search, Detail, Episodes, Pages, Favorites) to verify request construction, pagination parameters, DTO parsing, and 401 automatic retry logic.
3. **CBZ Packaging & ComicInfo.xml Generation Testing**:
   - Verify that test image streams produce valid ZIP archives with correct `.cbz` extension.
   - Verify that `ComicInfo.xml` inside the `.cbz` is valid XML matching schema specifications.
4. **IPC Dispatch & Error Handling Testing**:
   - Verify that IPC handlers gracefully handle network timeouts, invalid credentials, and server 5xx errors without crashing the main process.

### Prior Art
- Existing test suites in the codebase: `scripts/jmcomic/runtime.test.js` and IPC handlers in `scripts/jmcomic/jmcomicManager.js`.

---

## Out of Scope

1. **Remote Cloud Folder Creation & Modification**: Creating, deleting, or renaming custom remote favorite folders on PicACG's servers will not be included in the initial release; users can browse existing categories and folders.
2. **Comic Commenting & Social Feed**: Posting comments, forum discussions, and social knight feeds are excluded; the integration focuses strictly on reading, discovery, favorites sync, and offline archiving.
3. **Waifu2x Image Upscaling**: Machine-learning image upscaling during download is deferred to prevent bundling heavy AI inference libraries.

---

## Further Notes

- All localization keys for UI components will be mirrored across English (`en.json`) and Simplified Chinese (`zh-CN.json`).
- Network configuration will default to Route 1 with fallback capability to Route 2 and Route 3 if DNS resolution fails.
