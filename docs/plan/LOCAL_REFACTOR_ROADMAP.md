# Koodo Reader 本地化与去中心化重构规划及扩展路线图

> **分支**：`feature/personal-local`  
> **基线版本**：基于 `dev` 分支（v0.2.2）独立演进  
> **创建日期**：2026-09-03  
> **定位**：纯净、隐私自持、离线优先的个人专属电子书阅读与知识管理软件。

---

## 1. 架构改造背景与核心原则

原版 Koodo Reader 包含了一套完整的中心化商业体系，包括官方云同步、用户登录/OAuth 鉴权、Pro 会员权益拦截、按日限额的云端 AI/翻译/TTS 代理、在线客服挂件及推广定价外链。

在 `feature/personal-local` 分支上，我们将其重构为**完全去中心化、离线优先**的软件形态，遵循以下核心原则：

1. **隐私与数据完全自持**：
   - 彻底切断所有向官方服务器（`api.koodoreader.com`）发送的心跳、遥测、Token 校验与代理请求；
   - 读书数据、阅读历史、高亮与笔记完全保存在本地 IndexedDB / LocalStorage 及用户指定的本地/自建私有存储介质中。
2. **全功能开箱即用（Zero Paywalls）**：
   - 彻底移除所有 `(Pro)` 标识与会员购买拦截，原先被锁定的格式转换、自动导入、自定义排版等全部转为本地基础功能；
   - Redux 鉴权状态默认全局就绪，杜绝任何试用过期弹窗。
3. **自建可控网络能力保留**：
   - 保留开放标准的存储与书库协议：**WebDAV**、**S3 兼容对象存储**、**Docker 部署**、**SFTP / FTP** 以及 **Local folder（本地文件夹备份）**；
   - 保留用户常用的开放阅读扩展源：**OPDS 网络书库** 以及在线漫画抓取（JMComic / Picacomic）。
4. **渐进式外接能力打桩与规范化**：
   - 移除官方闭源后端的代理依赖，在关键功能点预留清晰规范的接口适配桩（Adapter Stub）；
   - 在未配置个人 API 时提供友好的本地提示引导，并统一使用 `// TODO(personal-local):` 注释进行精准跟踪。

---

## 2. 本阶段已落地的精简与改造清单

### 2.1 鉴权与用户体系
- **Redux 初始状态**：`isAuthed` 默认硬编码为 `true`，`userInfo` 提供终身就绪的本地虚拟用户对象，全面兼容深层组件对鉴权状态的依赖。
- **Token 轮询与过期检测切断**：移除启动时的远端 Token 刷新与会话失效（401）退出拦截，实现纯本地离线持久化。
- **登录路由移除**：移除 `/login` 独立登录页面组件挂载，所有定向至 `/login` 的访问自动重定向回主页 `/manager/home`。

### 2.2 界面与商业化痕迹彻底清理
- **Header 顶部栏**：
  - 移除在线客服挂件图标（`chat-widget.png`）及设备指纹追踪上报；
  - 移除“Pro version / 升级专业版”、“Renew Pro / 续费”、“In trial / 试用中”倒计时胶囊与横幅；
  - 改造同步按钮：点击直接触发当前配置的数据源（本地文件夹或自建 WebDAV/S3），不再弹窗强制登录或要求升级。
- **设置对话框**：
  - 左侧侧边栏中移除“账户 (Account)”Tab；
  - 关于 (About) 面板清理官方定价页面、商业赞助、官方反馈邮箱等外链，保留调试日志导出、控制台开关与版本信息。
- **阅读器选项**：
  - 移除“全文翻译”与“启用生词释义”右侧的红色 `(Pro)` 标识，解除开启限制。

### 2.3 存储与数据源精简
- **商业网盘精简**：从 `driveList` 与 `driveInputConfig` 中移除依赖外部 OAuth 及特定商用 API 的网盘（OneDrive、Google Drive、Dropbox、iCloud、Dubox、Box、MEGA、阿里云盘、Yandex Disk、115 云盘、pCloud）。
- **保留自建/开放协议**：保留 WebDAV、S3 Compatible、Docker、FTP、SFTP 及 Local folder，且全部剥离 `isPro: true` 限制。
- **清理官方云同步配置**：移除 `isEnableKoodoSync` 相关配置项。

### 2.4 网络请求层切断与友好打桩
- 切断 `src/utils/request/reader.ts` 和 `user.ts` 中向官方服务器发起的数据请求；
- 在用户尚未配置自定义 API 时，执行优雅拦截并弹出本地化 Toast 提示（如“当前功能需在[设置 - AI服务]中配置个人 API 即可使用”）。

---

## 3. 待完善功能与外接 API 扩展技术路线图

以下功能原先由 Koodo 官方闭源服务器代理提供。在本地化版本中，需要后续通过外接开放 API 或本地引擎逐步实现。

```
                       ┌─────────────────────────────────┐
                       │   Koodo Reader 本地化扩展总线   │
                       └────────────────┬────────────────┘
                                        │
     ┌──────────────┬───────────────────┼───────────────────┬──────────────┐
     ▼              ▼                   ▼                   ▼              ▼
┌─────────┐   ┌───────────┐       ┌───────────┐       ┌───────────┐  ┌───────────┐
│ AI 翻译 │   │ 生词释义  │       │ AI 助读   │       │ 本地/云TTS│  │图书元数据 │
│&全文翻译│   │(词频/词库)│       │(划词问答) │       │(神经语音) │  │(豆瓣/谷歌)│
└─────────┘   └───────────┘       └───────────┘       └───────────┘  └───────────┘
```

### 3.1 全文翻译与划词翻译（Full-text & Selection Translation）
- **当前状态**：UI 开关已完全解锁，官方 `getBatchTrans` / `getTransStream` 请求已被打桩拦截，提示在设置中配置 API。
- **目标设计**：
  1. **直连通用 LLM（OpenAI 兼容规范）**：
     - 支持用户在现有“设置 - AI服务 (`AISetting`)”中配置的 Provider（OpenAI、DeepSeek、Moonshot/Kimi、Claude、本地 Ollama/vLLM 等）；
     - 实现段落级/章节级流式批量翻译 (`stream batch translation`)，支持上下文连贯性优化；
  2. **直连专用翻译引擎**：
     - 支持用户填入 DeepL API Key、Google Cloud Translate Key 或本地自建 LibreTranslate 服务地址；
  3. **双语对照渲染**：
     - 优化阅读器内的双语排版渲染，减少大文本渲染闪烁。
- **推荐优先级**：**P0 (最高)**

### 3.2 启用生词释义（Word Definitions & Frequency Annotation）
- **当前状态**：UI 开关已解锁，`wordDefinitionBooks` 开关可正常切换，官方云端分词和释义 API `getWordDefinitions` 已被打桩。
- **目标设计**：
  1. **内置离线词频库**：
     - 汉语：集成现有的 HSK1~HSK6 词表；
     - 英语：集成四六级、考研、托福、雅思、GRE 核心词表；
     - 日语：集成 JLPT N1~N5 核心词表；
  2. **离线生词释义引擎**：
     - 利用本地内置轻量简明词典库（或用户导入的 StarDict / MDX 本地词典），在离线状态下直接匹配生词释义并悬浮展示；
  3. **AI 语境辅助释义（可选开启）**：
     - 结合段落上下文调用用户配置的 AI API，生成该生词在当前语境下的精准释义与例句。
- **推荐优先级**：**P1**

### 3.3 AI 助读与划词问答（AI Reading Assistant & PopupAssist）
- **当前状态**：`AISetting` 已支持配置基础模型参数，但阅读面板上的部分快捷辅助（总结、角色分析、段落答疑）存在对官方默认接口的降级兜底。
- **目标设计**：
  1. **全面接入 `aiRequest` 本地直连**：
     - 彻底切断官方 `getAnswerStream`；
     - 支持基于当前选中文本、章节内容进行 Prompt 模板自定义（总结章节要点、深度解读、人物关系梳理）；
  2. **长文本分块与上下文滑动窗口**：
     - 适配书籍长篇幅内容，支持基于当前阅读进度的上下文感知问答。
- **推荐优先级**：**P1**

### 3.4 语音朗读 TTS（Text-To-Speech）
- **当前状态**：原先分为本地系统声音与官方云端神经网络声音（后者有按日额度限制并催买 Pro）。
- **目标设计**：
  1. **增强型本地系统声音**：
     - 优化基于 `window.speechSynthesis` 的原生朗读，确保长篇阅读自动换页、不中断；
  2. **集成微软 Edge-TTS（免费免 Key）**：
     - 在 Electron 主进程中集成 Edge-TTS 协议，提供高质量自然中文/英文神经语音（如 Xiaoxiao、Yunxi）；
  3. **自定义 TTS API**：
     - 支持接入 OpenAI Audio Speech API、CosyVoice、ChatTTS 等开源或自建语音合成接口。
- **推荐优先级**：**P2**

### 3.5 图书元数据刮削（Metadata Scraping）
- **当前状态**：原先通过官方服务器代理中转抓取豆瓣/Google Books。
- **目标设计**：
  1. **直接客户端刮削**：
     - 针对中文书籍直接请求豆瓣公开搜索 API 或豆瓣 HTML 网页结构化解析；
     - 针对外文书籍直连 Google Books API、OpenLibrary API，无需任何中间代理服务器。
- **推荐优先级**：**P2**

---

## 4. 源码注解规范

为便于后续协同开发与功能追踪，本项目在涉及外部服务对接的源文件处，统一遵循以下注释格式：

```typescript
// TODO(personal-local): [模块名称] - 待完善具体说明
// 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #章节号
```

**示例**：
```typescript
// TODO(personal-local): 全文翻译 - 待接入自定义 AI Provider (OpenAI/DeepSeek) 批量翻译接口
// 参考文档: docs/plan/LOCAL_REFACTOR_ROADMAP.md #3.1
```

---

## 5. 阶段迭代里程碑

- **Milestone 1 (已完成)**：
  - [x] 开立并切换至 `feature/personal-local` 分支；
  - [x] 确立本地化重构规划文档 (`docs/plan/LOCAL_REFACTOR_ROADMAP.md`)；
  - [x] 完成所有官方云接口、登录体系、Pro 标识的物理清理；
  - [x] 完成 Redux 全局解锁与各外部模块打桩拦截；
  - [x] 建立全功能排查验收清单 ([`docs/plan/CLOUD_FEATURE_AUDIT_CHECKLIST.md`](./CLOUD_FEATURE_AUDIT_CHECKLIST.md))；
  - [x] 完成构建与 TypeScript 类型验证，提交代码落库至分支。
- **Milestone 2 (AI 与核心增强)**：
  - [ ] 打通“全文翻译”直连个人 AI API（DeepSeek / OpenAI）；
  - [ ] 完善“生词释义”本地词频匹配与词典悬浮窗；
  - [ ] 统一优化 AI 划词问答体验。
- **Milestone 3 (多媒体与离线生态)**：
  - [ ] 集成 Edge-TTS 免费神经语音；
  - [ ] 实现客户端直连豆瓣/Google Books 书籍元数据刮削。
