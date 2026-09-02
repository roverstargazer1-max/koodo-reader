# PicaComic / PicACG API 接入可行性调研与架构评估

- 调研日期：2026-09-02
- 范围：`https://manhuabika.com` (PicaWeb 镜像) 及 PicACG 官方移动端 API 协议，评估作为 Koodo Reader 在线漫画扩展的可行性。
- 架构目标：与 JMComic 体验完全对齐，支持搜索发现、官方分类/排行榜、账号登录与收藏夹同步、单本/选章 CBZ 打包与本地 SQLite 书库入库。

---

## 1. 结论与定位

**PicACG 具备成熟、稳定的社区逆向协议基础，适合以轻量级 Electron 主进程原生 TypeScript/Node.js 客户端（Provider 适配器）形式接入 Koodo Reader。**

- **定位属性**：与 JMComic 一致，属于非官方社区逆向 Provider 扩展，通过主进程模块隔离与本地书库解耦，确保网络或接口异常时不影响阅读器核心功能。
- **协议来源**：目标接入协议为稳定运行多年的 **PicACG 移动端官方 REST 接口**（而非单一 Web 镜像站），采用 HMAC-SHA256 动态签名机制。
- **实现选型**：在 Electron 主进程自研轻量级 `picaClient.js`（约 200~300 行纯 JS/Node 代码），直接利用 Node.js 原生 `crypto` 模块完成签名与请求，**零外部子进程、零 Python/Rust 额外依赖**，性能高且打包体积最小。

---

## 2. 站点与核心协议深度分析

| 检查项 | 已核实事实 | 架构决策影响 |
| --- | --- | --- |
| **站点与服务主体** | `manhuabika.com` 托管的是 PicaWeb SPA 网页镜像，非官方 OpenAPI 门户。底层实际对接的是 PicACG 移动端后端集群。 | 忽略网页端 HTML 爬取，直接对接移动端 RESTful API（`picaapi.picacomic.com` 及分流网关）。 |
| **认证与签名算法** | 原生 App 请求头包含 `api-key`、`accept: application/vnd.picacomic.com.v1+json`、`time`、`nonce`、`signature`、`app-channel`、`app-version` 等。 | 签名算法为标准 HMAC-SHA256：<br>`raw = (path + time + nonce + method + apiKey).toLowerCase()`<br>`signature = hmac_sha256(raw, secretKey)`<br>可通过 Node 原生 `crypto.createHmac` 直接生成。 |
| **网络连通与分流 (Routing)** | PicACG 服务器与图片 CDN 在国内受 GFW 与 DNS 污染影响严重。 | 必须完整内置 **分流 1 / 分流 2 / 分流 3** 线路切换，并全面支持 **系统代理 / 自定义 HTTP / SOCKS5 代理**。 |
| **图片防盗链拦截** | 图片存储域名（如 `storage1.picacomic.com`、Cloudflare CDN 等）需合法请求头。 | 在 Electron 主进程通过 `session.defaultSession.webRequest.onBeforeSendHeaders` 统一拦截并注入 Referer / User-Agent。 |

---

## 3. 开源生态与选型对比

| 方案 / 项目 | 语言 / 依赖 | 维护状态 | 优缺点分析 | 决策结果 |
| --- | --- | --- | --- | --- |
| **方案 A：自研主进程 Node/TS 客户端** | JavaScript/Node 原生 `crypto` + `fetch` | **本项目自研** | **最优解**。代码量极小（~300行），零外部二进制，无需子进程开销，与 Electron 主进程天然融合。 | **⭐ 最终采纳 (Selected)** |
| **方案 B：复用 Python Bridge / Sidecar** | Python 3.12 + requests / httpx | 复用 ADR 0003 基础设施 | 架构与 JMComic 100% 统一；但会增加 Python sidecar 体积与打包复杂度。 | 备选方案 |
| **`l2studio/picacomic-api`** | TypeScript / npm 包 | 2023-04 停止维护 | 依赖陈旧（got 11 / uuid 9），且硬编码的旧版 API/CDN 域名大概率已失效。 | ❌ 废弃，不引入 |
| **`niuhuan/pica-rust` / `pica-go`** | Rust / Go | 2025~2026 活跃维护 | 功能完备，逻辑严密；但作为独立二进制需维护 Windows/macOS/Linux 跨平台编译分发。 | 作为协议与 DTO 交叉参考源 |

---

## 4. 全功能闭环设计（对齐 JMComic）

### 4.1 侧边栏与 UI 交互
- **侧边栏入口**：将「在线漫画」改造为一级展开/折叠菜单项（带向下箭头），点击展开显示 `[禁漫天堂 (JMComic), 哔咔漫画 (PicaComic)]`，并记住展开折叠状态。
- **弹窗界面（PicaDialog）**：提供五大核心 Tab：
  1. **🔍 漫画搜索**：支持关键词、分类标签、作者检索与多种排序过滤（最新、最多点击、最多点赞等）；
  2. **🏆 热门与分类**：官方分类网格展示（带分类图标）、官方 24h / 7d / 30d 排行榜、以及随机本子推荐；
  3. **⭐ 我的收藏**：未登录显示卡片式登录表单；已登录展示用户 Profile 卡片（头像/昵称/称号/金币），支持收藏本子多页浏览与批量管理模式；
  4. **📥 下载管理**：下载任务列表、分章/总进度条、暂停/重试/取消及失败日志；
  5. **⚙️ 插件设置**：分流线路切换（分流 1/2/3）、网络代理（HTTP/SOCKS5）、画质选择（原图/高/中/低）、并发线程数与请求延时。

### 4.2 账号认证与会话持久化
- **登录接口**：调用 `/auth/sign-in` 获取 JWT Token；
- **凭据持久化**：安全保存账号、加密密码与 Token 缓存，支持“记住密码”；
- **静默重登**：Token 过期（401）时后台自动发起静默重登并重试请求，前端无感知平滑流转；
- **详情联动**：详情抽屉内提供 ❤️ 收藏状态双向切换（调用 `/users/favourite`）。

### 4.3 下载、打包与入库管线
- **双下载模式**：
  - **下载全本**：将全本所有章节（Episodes）按序合并，并发抓取图片；
  - **按章选下**：在详情抽屉支持多选特定章节单独下载。
- **CBZ 标准化封装**：将图片封装为标准 `.cbz` 归档文件，并在压缩包内嵌入标准 `ComicInfo.xml` 元数据（包含标题、作者、标签、简介、话数、封面等）。
- **SQLite 自动入库**：下载完成后自动转移至 Koodo 书籍存储目录，写入 SQLite 元数据并通知前端刷新书库，卡片自动标注绿色「已在书库」徽标。
- **调度与防风控**：多本批量下载时采用“单本串行调度 + 单本内 3~5 线程并发 + 请求延时 (100~300ms)”，兼顾下载速度与账号安全。

---

## 5. 风险与缓解措施

1. **接口协议与域名漂移**：
   - *缓解措施*：将 API 基址、分流节点、APP 版本号与请求头参数提取为可配置的独立配置文件；主进程中增加接口健康检查与动态降级提示。
2. **国内网络连通性阻断**：
   - *缓解措施*：内置分流 1/2/3 节点测速与切换，强制支持全局 HTTP/SOCKS5 代理，主进程拦截并修正图片请求头。
3. **账号风控与频率限制**：
   - *缓解措施*：限制最大并发下载线程数，批量任务引入随机请求抖动延时。
