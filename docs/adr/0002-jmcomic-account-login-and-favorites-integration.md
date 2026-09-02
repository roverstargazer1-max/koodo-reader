# ADR 0002: JMComic 账号登录、收藏夹同步与批量导入决策记录

- **状态**: Accepted (已确认)
- **日期**: 2026-09-02
- **关联代码库**: f:\AI\Project\koodo-reader、JMComic-Crawler-Python
- **前置 ADR**: [ADR 0001: JMComic 搜索与下载集成设计与决策记录](file:///f:/AI/Project/koodo-reader/docs/adr/0001-jmcomic-search-and-download-integration.md)

---

## 1. 背景与目标 (Context & Objectives)

在完成了 JMComic 搜索、排行榜与单本/选章 CBZ 打包入库基础功能之后，用户需要能够登录自己的 JM 账号，随时查看个人远程收藏夹中的本子，并能够灵活选择需要的内容一键批量导入至 Koodo Reader 本地书库中进行阅读。

经过对 JMComic-Crawler-Python 源码能力及客户端 UI/UX 的调研与全量问题树对齐，本 ADR 记录所有架构设计与技术取舍决策。

---

## 2. 决策树落库记录 (Decisions Log)

### 决策 1: 登录机制与会话凭据持久化 (Authentication & Credential Persistence)
- **决策 (Q1-A, Q6-A)**:
  - 采用 **本地持久化凭据 + 会话缓存 + 401 静默重登刷新** 策略；
  - 本地安全存储用户的账号、密码（支持 记住密码勾选）以及上一次登录成功的 User Profile（UID、昵称、头像、等级称号、收藏总数）与 Cookies/AVS Token；
  - 每次进入「我的收藏」页时，优先使用已缓存会话直接拉取收藏数据；
  - 若遇 Token 过期（服务端返回 401 或未登录），后台自动使用保存的账号密码静默发起重新登录并重试拉取，用户无感知；
  - 若密码失效或未勾选记住密码，则平滑降级至登录表单界面；
  - 面板顶部常驻提供显式的「退出登录 / 切换账号」与「手动刷新」操作。

### 决策 2: 界面布局与导航入口 (UI Layout & Navigation)
- **决策 (Q2-A)**:
  - 在 JmcomicDialog 弹窗顶栏新增独立的 **「⭐ 我的收藏」** Tab（与「🔍 漫画搜索」、「🏆 热门榜单」、「📥 下载管理」、「⚙️ 插件设置」平级并列）；
  - **未登录态**：在「我的收藏」页内居中展示精美卡片式登录表单（账号、密码、记住密码、代理/线路继承、登录中状态提示及错误反馈）；
  - **已登录态**：顶部展示用户 Profile 卡片（用户头像、用户名、等级称号、金币、收藏本子总数、退出登录按钮、刷新按钮），下方展示收藏夹及漫画瀑布流。

### 决策 3: 多收藏夹与分类排序组织 (Favorite Folders & Filtering)
- **决策 (Q3-A)**:
  - 在收藏页面上方提供 **「收藏夹分类标签栏 (Folder Tabs)」** + **「排序过滤」**（最新收藏、最多点击等）+ **「分页器 / 加载更多」**；
  - 动态解析 JM API 返回的 older_list（默认收藏夹 FID=0 及用户自定义收藏夹），切换分类即时异步请求对应列表。

### 决策 4: 批量勾选与导入下载工作流 (Batch Selection & Import Workflow)
- **决策 (Q4-A, Q7-A)**:
  - **单本交互**：点击任意卡片依然呼出「漫画详情抽屉」，可预览元数据与章节列表，支持按章选下或全本下载；
  - **批量管理模式**：页面提供「批量管理」开关，开启后卡片显示勾选复选框，顶栏/底栏展示「全选本页」、「取消选择」、「全选未入库」快捷操作及「批量加入下载队列 (已选 X 本)」按钮；
  - **队列调度与防封保护**：勾选的多本漫画一次性推入全局下载任务队列（状态置为 pending 排队中）；调度器按序**单本串行执行**（单本内部采用 3~5 线程高速抓取图片并打包 CBZ 入库），完成后自动启动下一本，兼顾高效与账号安全性。

### 决策 5: 本地书库状态比对与去重标记 (Duplicate Detection & Library State)
- **决策 (Q8-A)**:
  - 收藏列表中的漫画卡片自动与 Koodo Reader 当前本地书库（SQLite / IndexedDB 书库元数据）进行比对；
  - 已导入书库的漫画在卡片右上角渲染高亮绿色「已在书库」徽标；
  - 批量操作时提供快捷「跳过已在书库」过滤，避免重复下载占用磁盘与网络资源。

### 决策 6: 详情抽屉内的收藏双向联动 (Favorite Toggle in Detail Drawer)
- **决策 (Q5-A, Q9-A, Scope Limit)**:
  - 在漫画详情抽屉的标题旁提供 **「❤️ 已收藏 / 🤍 收藏」** 动态切换按钮；
  - 点击后异步调用 JM API（/ajax/favorite_album / /favorite）进行加/取消收藏操作，并提供 Toast 状态反馈；
  - 第一阶段不引入复杂的新建/重命名/删除远程文件夹等管理功能，专注于浏览、单本收藏切换与高可用批量下载导入。

---

## 3. 技术实现架构 (Technical Architecture)

`
+-------------------------------------------------------------------------+
|                          React 渲染进程 (UI 层)                         |
|  - JmcomicDialog (新增 'favorites' Tab, 登录卡片, Profile栏, 批量管理工具条)|
|  - DetailModal (新增 ❤️ 收藏状态切换按钮)                                 |
+------------------------------------+------------------------------------+
                                     | IPC (jmcomic-login, jmcomic-get-favorites, etc.)
+------------------------------------+------------------------------------+
|                         Electron 主进程 (调度层)                        |
|  - scripts/jmcomic/jmcomicManager.js (IPC 派发, 下载队列串行调度, 请求头注入)|
+------------------------------------+------------------------------------+
                                     | child_process.spawn
+------------------------------------+------------------------------------+
|                       Python 桥接层 (jm_bridge.py)                      |
|  - login, get_favorites, toggle_favorite, download (CBZ打包)            |
+------------------------------------+------------------------------------+
                                     |
+------------------------------------+------------------------------------+
|                JMComic-Crawler-Python 核心 API 客户端                  |
|  - JmApiClient (req_api /login, /favorite, /ajax/favorite_album)        |
+-------------------------------------------------------------------------+
`

---

## 4. 实施阶段规划 (Implementation Steps)

1. **Python 桥接层扩展 (scripts/jmcomic/jm_bridge.py)**:
   - 添加 login 子命令：支持接收用户名、密码、代理、线路，返回用户信息与 Cookie/Token；
   - 添加 get_favorites 子命令：支持传入 folder_id、page、order_by 及凭据/Cookies，返回收藏夹列表与本子分页数据；
   - 添加 	oggle_favorite 子命令：支持本子收藏/取消收藏。
2. **Electron 主进程 IPC 处理器扩展 (scripts/jmcomic/jmcomicManager.js & preload.js)**:
   - 注册 jmcomic-login、jmcomic-get-favorites、jmcomic-toggle-favorite 接口；
   - 优化下载任务队列调度逻辑，确保批量添加任务时单本串行执行、单本内多线程。
3. **前端 UI 与状态组件开发 (src/components/dialogs/jmcomicDialog/)**:
   - interface.tsx: 扩展 User Profile、Favorite Folder、Favorite Item 数据结构与状态类型；
   - component.tsx: 实现「我的收藏」Tab 界面（未登录登录表单、已登录 Profile 条、Folder Tabs 分类栏、漫画网格流、批量管理工具栏与已在书库标记）；
   - 详情抽屉中接入收藏/取消收藏按钮与事件联动；
   - 国际化本地化文案补齐 (src/assets/locales/zh_CN.json, en.json 等)。
