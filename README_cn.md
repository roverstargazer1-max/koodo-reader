# Koodo Reader Personal

简体中文 | [English](./README.md)

Koodo Reader Personal 是一个独立维护、优先支持 Windows 的个人书库项目，衍生自 [Koodo Reader](https://github.com/koodo-reader/koodo-reader)，保留原项目的强大阅读和书库管理能力，并深度集成了 **JMComic (禁漫天堂)** 与 **PicACG (哔咔漫画)** 桌面端在线漫画完整工作流。

本仓库不是 Koodo Reader 官方发行版。首个独立版本为 `v0.2.1`。

## 与上游的主要差异

- **双在线漫画源集成**：
  - **JMComic（禁漫天堂）**：支持关键词/车号搜索、多维度热门榜（今日/本周/本月/总榜）、个人收藏夹同步、单章选择下载、自动生成 ComicInfo.xml 并打包为 CBZ 自动入库。
  - **PicACG（哔咔漫画）**：纯 Node.js 逆向签名实现，支持搜索、官方分类探索、多时段排行榜（24h/7d/30d）、随机本子、收藏夹管理、平铺页码与快速跳页、分流测速切换与全本/分章 CBZ 打包入库。
  - **下载体验优化**：两款漫画扩展均支持在设置中自定义下载保存路径，临时解包目录跟随目标磁盘，彻底避免 C 盘空间不足（`ENOSPC`）的问题。
- **书库多选与封面防窥**：
  - 增强书库多选批量操作（批量喜爱、加入书架、导出、批量删除、点击空白区域退出多选）；
  - 新增「模糊封面 / 取消模糊封面」功能，一键隐藏敏感书籍封面，兼顾隐私与观感。
- **开箱即用与独立运行**：
  - 源码环境使用项目私有 `.venv`，固定 `jmcomic==2.7.5`；
  - Windows 安装版和便携版内置 PyInstaller `onedir` sidecar，运行无需用户安装 Python；
  - Personal、Personal 开发版与原 Koodo Reader 使用相互独立的本地数据目录，互不干扰。

> 在线漫画属于桌面端专属扩展能力，在纯 Web 构建中不会显示入口。

## 截图展示

### 禁漫天堂 (JMComic)

|                        搜索主面板                         |                       我的收藏与个人中心                       |
| :-------------------------------------------------------: | :------------------------------------------------------------: |
| ![JMComic 搜索面板](./docs/screenshots/jmcomic-panel.png) | ![JMComic 收藏夹](./docs/screenshots/jmcomic-mycollection.png) |

|      热门排行榜 (今日 / 本周 / 本月 / 总榜)       |
| :-----------------------------------------------: |
| ![JMComic 排行榜](./docs/screenshots/ranking.png) |

### 哔咔漫画 (PicACG)

|                   搜索与分类主面板                    |                     个人收藏与批量管理                     |
| :---------------------------------------------------: | :--------------------------------------------------------: |
| ![PicACG 搜索面板](./docs/screenshots/pica-panel.png) | ![PicACG 收藏夹](./docs/screenshots/pica-mycollection.png) |

### 书库增强 (Library Enhancements)

|                  书库批量操作与封面模糊防窥                  |
| :----------------------------------------------------------: |
| ![书库多选与模糊封面](./docs/screenshots/book-over-blur.png) |

## Windows 下载

请从 [GitHub Releases](https://github.com/roverstargazer1-max/koodo-reader-personal/releases/latest) 下载最新 NSIS 安装包或 portable EXE。每个 Release 同时提供 `SHA256SUMS.txt`。

`v0.1.0` 只支持 Windows 10/11 x64。当前构建未进行代码签名，Windows SmartScreen 可能显示“无法识别的应用”提示；运行前请核对 SHA-256。

## 源码快速启动

先安装 Git、Node.js 22、Python 3.12 x64 和 Corepack，然后执行：

```powershell
git clone https://github.com/roverstargazer1-max/koodo-reader-personal.git
cd koodo-reader-personal
corepack enable
yarn setup
yarn dev
```

`yarn setup` 会检查 Node/Yarn、严格按 `yarn.lock` 安装、创建根目录 `.venv`、安装完整 Python 运行时锁并执行 `check_env`。`yarn dev` 启动 React 和 Electron 前会再次检查环境。

开发环境基线：

- Node.js 22
- Yarn 1.22.22
- Python 3.12 x64
- Windows 10/11 x64

常用验证命令：

```powershell
yarn check:env
yarn test:jmcomic-runtime
yarn typecheck
yarn build
```

构建 sidecar、NSIS 安装包和便携版：

```powershell
yarn package:win
```

## 运行时结构

源码模式优先使用用户明确选择的兼容 Python，否则使用项目 `.venv`。系统 Python 只用于创建或修复 `.venv`。

打包模式固定启动：

```text
resources/jmcomic-bridge/jmcomic-bridge.exe
```

JavaScript 调度代码位于 `app.asar`；sidecar 由 electron-builder 的 `extraResources` 放在 ASAR 外。bridge 要求 JMComic `2.7.5`，版本不一致时 `check_env` 会返回可操作的错误。

## 数据目录与迁移

- Personal 正式版：`%APPDATA%\KoodoReaderPersonal`
- Personal 开发版：`%APPDATA%\KoodoReaderPersonal-dev`
- 为兼容现有同步继续使用云端目录：`KoodoReader`
- 为兼容现有链接继续使用深链协议：`koodo-reader://`

迁移时先在旧版中创建完整备份，再在 Koodo Reader Personal 中恢复。两个应用共用 `KoodoReader` 云同步目录时不要同时写入。详细步骤见[数据迁移](./docs/data-migration.md)。

## 环境排错

**`yarn dev` 提示环境缺失**

执行 `yarn setup`。如果找不到 Python，请安装 Python 3.12 x64，并确保 Python Launcher 可用。

**JMComic 版本不一致**

源码模式重新执行 `yarn setup`；打包模式从完整的 GitHub Release 重新安装，并核对校验和。

**看不到在线漫画入口**

该入口只在 Electron 桌面应用显示，Web 版本不包含此能力。

**安装版或便携版启动异常**

核对 `SHA256SUMS.txt`，确认下载文件完整，并检查安全软件是否隔离了 `resources\jmcomic-bridge` 下的文件。

## 已验证平台

发布流水线在 Windows Server 2022 x64 上验证 Node.js 22、Yarn 1.22.22、Python 3.12、React 生产构建、unpacked Electron 应用和打包 sidecar 的直接执行。Windows 10/11 x64 安装版与便携版冒烟测试是发布前验收项。

## 上游与许可证

本项目基于 Koodo Reader，并保留仓库根目录的 AGPL-3.0 许可证。JMComic-Crawler-Python 作为固定版本的 MIT 依赖使用，其源码没有复制进本仓库。详见[第三方声明](./THIRD_PARTY_NOTICES.md)和 [ADR 0003](./docs/adr/0003-reproducible-python-runtime-and-windows-sidecar.md)。

使用内容服务时，请遵守服务条款以及账号和所在地适用规则。
