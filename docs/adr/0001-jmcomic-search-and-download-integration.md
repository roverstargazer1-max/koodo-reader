# ADR 0001: JMComic 搜索与下载集成设计与决策记录

- **状态**: Accepted, partially superseded by [ADR 0003](./0003-reproducible-python-runtime-and-windows-sidecar.md)
- **日期**: 2026-09-02
- **关联代码库**: Koodo Reader Personal、JMComic-Crawler-Python

---

## 1. 背景与目标 (Context & Objectives)

Koodo Reader 作为一款全功能的跨平台电子书阅读器，原生支持 CBZ/CBR、EPUB、PDF 等多种漫画和电子书格式。为了满足在线漫画资源的检索、浏览与一键下载入库需求，决定借用已引入的 JMComic-Crawler-Python 核心能力，在 Koodo Reader 中集成完整的禁漫搜索、榜单浏览、章节下载与自动打包入库功能。

---

## 2. 核心架构与决策记录 (Decisions)

### 决策 1: 功能入口与交互形态 (UI Entry & UX Pattern)
- **决策**: 在主界面侧边栏（Sidebar）新增独立导航项「在线漫画 / JMComic」，并在“导入书籍”菜单中提供联动入口。点击呼出专用全屏/模态管理面板（JmcomicDialog）。
- **理由**: 与现有的 OPDSDialog 保持一致的体验风格，拥有充足的屏幕空间展示漫画封面瀑布流、分类标签、章节选单以及下载任务队列。

### 决策 2: 运行时架构与 IPC 通信 (Runtime Architecture & IPC)
- **决策**: 采用 **Electron 主进程按需调度 + Python CLI 桥接脚本 (scripts/jmcomic/jm_bridge.py)**。
- **通信流程**:
  1. React 渲染进程发起 IPC 请求（如 jmcomic-search, jmcomic-download, jmcomic-detail）；
  2. Electron 主进程校验参数，通过 child_process.spawn 调用 Python 桥接脚本；
  3. Python 桥接脚本以 JSON Lines (JSONL) 格式实时向 stdout 输出搜索数据与流式下载进度；
  4. Electron 主进程捕获输出，通过 IPC 事件（如 jmcomic-download-progress）实时推送给渲染进程。
- **理由**: 最轻量无常驻端口占用，便于实时流式捕获下载进度和错误状态。

### 决策 3: Python 运行环境与依赖管理 (Python Environment & Dependencies)

> 此决策已由 ADR 0003 取代：源码使用项目 `.venv`，发布版使用内置 sidecar。
- **决策**: 采用 **系统 Python 自动检测 + 自定义路径配置 + 环境自检与依赖安装引导**。
- **细节**:
  - 默认检测系统 PATH 中的 python / python3；
  - 设置面板支持用户手动指定 Python 可执行文件路径（兼容 venv / conda）；
  - 提供 check_env 检测接口和一键安装依赖按钮（自动执行 pip install -e ./JMComic-Crawler-Python 及 Pillow / rich）。

### 决策 4: 搜索与发现功能范围 (Search & Discovery Scope)
- **决策**: 支持 **完整搜索 + 详情展示 + 基础分类/排行**。
- **能力矩阵**:
  1. 关键词搜索（支持车号 ID、标题、作者、标签）；
  2. 排序过滤（最新、最多点击、最多点赞、最多图片等）；
  3. 漫画详情页（高清封面、作者、标签、发布与更新日期、总页数、章节目录）；
  4. 官方榜单与分类推荐（日榜、周榜、月榜）。

### 决策 5: 下载产物格式与书库入库策略 (Download Format & Library Integration)
- **决策**: 默认打包为标准的 **.cbz (Comic Book ZIP)** 格式并自动导入 Koodo Reader 书库。
- **工作流**:
  1. Python 桥接调用 JMComic API 下载章节图片并完成反混淆解码；
  2. 将图片按顺序压缩封装为 .cbz 文件；
  3. Electron 主进程将 .cbz 文件安全转移至 Koodo 书籍存储目录；
  4. 通过 database-command 在 SQLite 数据库中注册书籍元数据（标题、作者、封面等）；
  5. 通知 React 渲染进程刷新书库列表，用户可立即开卷阅读。

### 决策 6: 网络代理、线路与并发配置 (Network, Domain & Downloader Options)
- **决策**: 在面板中提供可视化配置项，底层同步更新至 option.yml：
  - **网络代理**: 支持“系统代理 / 无代理 / 自定义 HTTP / SOCKS5 代理”；
  - **线路选择**: 支持 JM 官方 API 域名线路切换与测速；
  - **并发控制**: 支持自定义下载线程数与请求休眠间隔（防风控封禁）；
  - **下载目录**: 自定义下载归档路径。

### 决策 7: 多章节本子的 CBZ 组织方式 (Multi-chapter Album Organization)
- **决策**:
  - 默认提供“下载全本”：自动将本子所有章节按序合并打包为一个完整的 .cbz 文件并导入书库；
  - 在详情页提供章节勾选能力：用户可按需勾选特定章节单独下载为单话 .cbz（命名格式如 [作者] 标题 - 第X话.cbz）。

### 决策 8: 下载任务队列与状态管理 (Download Queue & Task Lifecycle)
- **决策**: 模态弹窗内设立「下载管理」Tab，并在全局侧边栏/右下角提供轻量浮动下载徽标与进度展示。支持任务暂停、取消、重试及下载日志查看。

### 决策 9: 封面与缩略图加载及防盗链处理 (Image Proxy & Thumbnail Loading)
- **决策**: 通过 Electron 主进程统一拦截注入合法 Referer 请求头并路由代理，结合本地图片缓存策略，保证封面瀑布流顺畅加载无防盗链阻断。

### 决策 10: 代码组织与打包分发 (Code Organization & Packaging)

> 此决策的打包部分已由 ADR 0003 取代：Python bridge 不进入 ASAR，PyInstaller `onedir` 由 `extraResources` 放在 ASAR 外。
- **决策**:
  - 桥接脚本位于 scripts/jmcomic/jm_bridge.py；
  - 前端 UI 位于 src/components/dialogs/jmcomicDialog/；
  - 主进程 IPC 处理器位于 main.js；
  - 在 package.json 中的 electron-builder 配置中将 JMComic-Crawler-Python 与 scripts/jmcomic 添加至 extraResources。

---

## 3. 结果与后续规划 (Consequences & Next Steps)

- **正面效果**: 用户可以在 Koodo Reader 内一站式完成从搜索、浏览、榜单探索、下载打包到本地阅读的完整闭环，无需切换外部工具。
- **后续任务**: 依据 Implementation Plan 分阶段实施。
