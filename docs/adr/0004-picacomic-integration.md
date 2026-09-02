# ADR 0004: PicaComic (哔咔漫画) 搜索、收藏与 CBZ 入库全流程集成设计

- **状态**: Accepted (已确认)
- **日期**: 2026-09-02
- **关联代码库**: Koodo Reader Personal
- **前置 ADR**: 
  - [ADR 0001: JMComic 搜索与下载集成设计与决策记录](./0001-jmcomic-search-and-download-integration.md)
  - [ADR 0002: JMComic 账号登录、收藏夹同步与批量导入决策记录](./0002-jmcomic-account-login-and-favorites-integration.md)

---

## 1. 背景与目标 (Context & Objectives)

在成功接入 JMComic（禁漫天堂）之后，为了进一步丰富 Koodo Reader 的在线漫画资源生态，决定接入 **哔咔漫画 (PicACG / PicaComic)**。

经过全面调研和全量决策树问询（Grilling），本 ADR 正式确立 PicaComic 的架构设计、底层运行时选型、UI 入口组织、网络分流代理、账号会话管理、多章节 CBZ 打包与本地 SQLite 入库规范。

---

## 2. 核心架构与决策记录 (Decisions Log)

### 决策 1: 运行时架构与协议层实现选型 (Runtime Architecture & Protocol Layer)
- **决策**: 采用 **Electron 主进程原生 TypeScript/Node.js 实现 (`scripts/pica/picaClient.js`)**。
- **技术细节**:
  - 利用 Node.js 原生 `crypto.createHmac` 动态生成 HMAC-SHA256 签名：
    $$\text{raw} = (\text{path} + \text{time} + \text{nonce} + \text{method} + \text{apiKey}).\text{toLowerCase}()$$
    $$\text{signature} = \text{HMAC-SHA256}(\text{raw}, \text{secretKey})$$
  - 直连 PicACG 移动端官方 REST 接口，不依赖过期的外部第三方 npm 包或额外的 Python/Rust 子进程；
  - 零子进程启动延迟，内存与性能开销最小，分发包体积无膨胀。

### 决策 2: 导航入口与侧边栏层级 (Sidebar Navigation & Expandable Menu)
- **决策**:
  - 将侧边栏「在线漫画」导航项重构为**带向下箭头的可展开/折叠一级菜单**；
  - 展开后展示子项列表：
    1. **禁漫天堂 (JMComic)**：呼出既有 `JmcomicDialog`；
    2. **哔咔漫画 (PicaComic)**：呼出独立 `PicaDialog`；
  - 记住用户的展开/折叠状态；若直接点击「在线漫画」主图标，默认激活首个或上次激活的源。

### 决策 3: 前端交互与功能 Tab 设计 (UI Layout & Tabs)
- **决策**: `PicaDialog` 弹窗与 JMComic 体验完全对齐，提供五大独立 Tab：
  1. **🔍 漫画搜索 (Search)**：关键词/作者/标签搜索，支持最新、最多点击、最多点赞等排序；
  2. **🏆 热门与分类 (Explore & Leaderboard)**：官方分类网格（含图标）、24h/7d/30d 排行榜、随机本子推荐；
  3. **⭐ 我的收藏 (Favorites)**：未登录展示卡片式登录表单；已登录展示用户 Profile（头像/昵称/称号）与收藏夹列表，支持批量管理模式；
  4. **📥 下载管理 (Downloads)**：展示下载队列、分章/总进度条、暂停/重试/取消及错误日志；
  5. **⚙️ 插件设置 (Settings)**：分流线路、代理、画质、并发与延时配置。

### 决策 4: 网络连通性、分流与图片防盗链拦截 (Network Routing, Proxy & Anti-hotlink)
- **决策**:
  - **分流线路 (Routing)**：内置官方「分流 1 / 分流 2 / 分流 3」切换能力；
  - **网络代理 (Proxy)**：支持继承系统代理或手动配置 HTTP / SOCKS5 代理；
  - **画质选择 (Image Quality)**：支持 `original`（原图）、`high`（高）、`medium`（中）、`low`（低）可选项；
  - **请求头拦截 (Anti-hotlink)**：通过 `session.defaultSession.webRequest.onBeforeSendHeaders` 统一拦截 PicACG 图片 CDN 请求，注入合规的 Referer 与 User-Agent。

### 决策 5: 账号认证、Token 持久化与静默刷新 (Authentication & Session Persistence)
- **决策**:
  - 登录调用 `/auth/sign-in` 获取 JWT Token 并安全缓存；
  - 本地安全持久化账号、加密密码与 Profile 数据，支持“记住密码”；
  - 当接口返回 401（Token 过期）时，主进程自动静默重新登录并重试当前请求，用户侧完全无感；
  - 详情抽屉中提供 **❤️ 已收藏 / 🤍 收藏** 动态切换按钮（调用 `/users/favourite`），与云端双向同步。

### 决策 6: 多章节组织、CBZ 打包与本地书库入库 (Multi-chapter Packaging & SQLite Integration)
- **决策**:
  - **全本与分章双模式**：
    - **下载全本**：将该漫画的所有 Episode 图片按序抓取并合并打包为单一 `.cbz` 文件；
    - **按章选下**：支持用户在详情页勾选指定章节，单独打包为 `[作者] 标题 - 第X话.cbz`。
  - **元数据封装**：在 `.cbz` 压缩包内生成并嵌入标准的 `ComicInfo.xml`（包含标题、作者、标签、简介、话数、封面等）；
  - **本地 SQLite 入库**：下载完成后自动安全转移至 Koodo 书籍存储目录，调用 `database-command` 写入元数据并触发书库刷新；
  - **去重标记**：收藏夹卡片自动比对本地书库，高亮渲染绿色「已在书库」徽标，支持批量操作时一键“跳过已在书库”。

### 决策 7: 下载队列调度与防风控策略 (Queue Scheduler & Rate Limiting)
- **决策**:
  - 批量下载任务加入主进程下载队列；
  - **漫画级串行调度**：多本漫画依次串行执行，避免多本并发引起服务端风控封禁；
  - **单本内并发抓取**：单本内部启用 3~5 个并发请求快速拉取图片；
  - **防封延时**：引入可配置的请求延时抖动（默认 100~300ms）。

---

## 3. 技术实现架构 (Technical Architecture)

```
+-------------------------------------------------------------------------+
|                          React 渲染进程 (UI 层)                         |
|  - Sidebar: 「在线漫画」带展开箭头下拉项 [JMComic, PicaComic]           |
|  - PicaDialog: (Search, Explore/Ranking, Favorites, Downloads, Settings)|
|  - PicaDetailModal: (元数据、选章下载、❤️ 远程收藏切换)                   |
+------------------------------------+------------------------------------+
                                     | IPC (pica-search, pica-login, pica-download, etc.)
+------------------------------------+------------------------------------+
|                         Electron 主进程 (调度层)                        |
|  - scripts/pica/picaManager.js: (IPC 路由, 下载队列调度, 图片请求头拦截)|
|  - scripts/pica/picaClient.js:  (原生 Node HMAC-SHA256 签名, REST API)  |
|  - scripts/pica/picaPackager.js:(图片流下载, ComicInfo.xml 生成, CBZ 封装)|
+------------------------------------+------------------------------------+
                                     | Direct HTTPS (with Proxy & Routing)
+------------------------------------+------------------------------------+
|                      PicACG 移动端官方 REST 后端                        |
|  - /auth/sign-in, /categories, /comics, /comics/{id}/eps, /users/profile|
+-------------------------------------------------------------------------+
```

---

## 4. 实施阶段规划 (Implementation Roadmap)

1. **底层客户端与 IPC 核心 (`scripts/pica/`)**：
   - 实现 `picaClient.js`：包含 HMAC-SHA256 签名生成器、请求封装、Token 自动刷新、分流与代理配置；
   - 实现 `picaPackager.js`：包含多线程图片下载流、`ComicInfo.xml` 生成器与 zip/cbz 压缩封装；
   - 实现 `picaManager.js`：注册 Electron IPC 通道、下载队列调度与图片 Referer 拦截器。
2. **侧边栏重构 (`src/containers/sidebar/`)**：
   - 改造「在线漫画」导航项支持展开/折叠子菜单，新增 JMComic 与 PicaComic 子菜单项与状态保持。
3. **前端 UI 组件开发 (`src/components/dialogs/picaDialog/`)**：
   - 构建 `PicaDialog`（搜索、分类/排行榜、我的收藏、下载管理、设置）；
   - 构建详情抽屉（章节选单、全本/选章下载、❤️ 收藏联动）；
   - 国际化本地化文案补齐 (`zh-CN.json`, `en.json`)。
4. **端到端联调与书库验证**：
   - 验证登录、Token 失效静默刷新、搜索与分类拉取、全本/分章 CBZ 下载及 SQLite 自动入库。
