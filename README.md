# Koodo Reader Personal

[简体中文](./README_cn.md) | English

Koodo Reader Personal is an independently maintained, Windows-first personal library derived from [Koodo Reader](https://github.com/koodo-reader/koodo-reader). It preserves upstream's reading and library experience, and deeply integrates desktop online comics workflows for both **JMComic** and **PicACG (哔咔漫画)**.

This repository is not the official Koodo Reader distribution. The first independent release is `v0.1.0`.

## What Is Different

- **Dual Online Comic Integrations**:
  - **JMComic**: Keyword and comic ID search, multi-tier leaderboards (Daily / Weekly / Monthly / All Time), favorites synchronization, chapter selection, automated ComicInfo.xml metadata generation, CBZ archive creation, and library auto-import.
  - **PicACG**: Pure Node.js reverse-engineered HMAC-SHA256 client, supporting search, official category exploration, multi-timeframe leaderboards (24h / 7d / 30d), random comics, favorites sync, tiled pagination with direct jump, route latency testing, and full/chapter CBZ downloads.
  - **Custom Download Location**: Both extensions support custom download directories in settings. Temporary extraction files stay on the target volume to completely avoid C: drive space exhaustion (`ENOSPC`).
- **Library Selection & Privacy Enhancements**:
  - Multi-selection toolbar for batch operations (favorite, shelve, export, delete, click blank area to deselect);
  - **Cover Blur / Unblur** feature to protect sensitive comic covers while maintaining a clean library aesthetic.
- **Out-of-the-box Desktop Experience**:
  - Source mode setup with project-private `.venv` and pinned dependencies (`jmcomic==2.7.5`);
  - Windows installer and portable packages bundle PyInstaller `onedir` sidecar—no manual Python installation required;
  - Completely isolated local data directories between Personal edition and upstream Koodo Reader.

> The online-comics panel is a desktop-only capability and is hidden in the web build.

## Screenshots

### JMComic

|                         Search Panel                          |                      My Favorites & Profile                       |
| :-----------------------------------------------------------: | :---------------------------------------------------------------: |
| ![JMComic Search Panel](./docs/screenshots/jmcomic-panel.png) | ![JMComic Favorites](./docs/screenshots/jmcomic-mycollection.png) |

|   Leaderboard (Daily / Weekly / Monthly / All Time)    |
| :----------------------------------------------------: |
| ![JMComic Leaderboard](./docs/screenshots/ranking.png) |

### PicACG

|                    Search & Categories                    |                   Favorites & Batch Actions                   |
| :-------------------------------------------------------: | :-----------------------------------------------------------: |
| ![PicACG Search Panel](./docs/screenshots/pica-panel.png) | ![PicACG Favorites](./docs/screenshots/pica-mycollection.png) |

### Library Enhancements

|          Batch Actions & Cover Blur / Privacy Protection           |
| :----------------------------------------------------------------: |
| ![Library Selection & Blur](./docs/screenshots/book-over-blur.png) |

## Download & Installation (Windows)

Get the latest release from the [GitHub Releases Page](https://github.com/roverstargazer1-max/koodo-reader-personal/releases/latest) (Current Version: **`v0.2.5`**):

| Package Type                                                     | Best For & Features                                                                                                               | Direct Download                                                                                          |
| :--------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| **Installer (Setup)**`Koodo-Reader-Personal-0.2.5-x64-Setup.exe` | **Recommended for daily reading**.Supports in-app silent overwrite updates, bundled Python Sidecar runtime, works out-of-the-box. | [Download Setup Installer](https://github.com/roverstargazer1-max/koodo-reader-personal/releases/latest) |
| **Portable**`Koodo-Reader-Personal-0.2.5-x64-Portable.exe`       | **For USB drives & zero-install needs**.Standalone single executable, no installation needed, run directly.                       | [Download Portable EXE](https://github.com/roverstargazer1-max/koodo-reader-personal/releases/latest)    |

> **Security Note**: Binaries are unsigned with commercial certificates. Windows SmartScreen may show an "Unrecognized app" prompt on first launch. Click **"More info"** -> **"Run anyway"**. SHA-256 checksums are published in `SHA256SUMS.txt` with each release.

---

## Quick User Guide (Everyday Reading)

If you are an end user looking to enjoy reading and online comics, this section covers everything you need—**no programming knowledge or Python installation is required**:

### 1. Reading & Importing Books

- **Rich Format Support**: Reads EPUB, PDF, MOBI, AZW3, TXT, DJVU, CBZ, CBR, and more;
- **Drag-and-Drop**: Drag any ebook file into the reader window to immediately parse and add it to your library;
- **Reading Comfort**: Two-page spread layout, dark & eye-care color palettes, custom fonts/margins, highlight annotations, and Text-to-Speech (TTS) audio narration.

### 2. Online Comics (JMComic & PicACG)

- **Where to find it**: Click **"Online Comics"** in the left sidebar to expand and open either **JMComic** or **PicaComic**;
- **Out of the Box**: All necessary crawlers and decryption engines are bundled in both Setup and Portable editions. You never need to install Python manually;
- **Discover & Search**: Search by title, author, or comic ID, or explore trending leaderboards and official categories;
- **One-Click Download & Automatic Library Import**:
  - Click the **"📥 Download"** button directly on any comic card, or select specific chapters from comic details;
  - Once finished, the app **automatically packages chapters into standard `.cbz` archives and silently imports them into your local library** for offline reading;
- **Recommended Setting (Custom Download Volume)**:
  - In the comic panel's "Settings" tab, locate **"Download Directory"**;
  - Click **"📁 Browse..."** and choose a folder on a disk with ample free space (such as drive `D:` or `H:`) to prevent filling up drive `C:`.

### 3. Library Selection & Cover Privacy Protection

- **Batch Management**: Drag to box-select multiple books, or click the multi-select button to batch favorite, shelve, export, or delete;
- **Cover Blur (Privacy Protection)**: Select **"Blur Cover"** from the batch menu or right-click context menu to blur sensitive manga covers, protecting privacy in public spaces.

---

## Upgrade & Seamless Overwrite Updates

To ensure your books, reading progress, and notes are never lost, Koodo Reader Personal features **safe, automated overwrite updates**:

### Setup Installer Updates (Strongly Recommended)

1. **In-App Auto Update**: Click "Check for Updates" in Settings. When an update is ready, click update and the app will silently download, overwrite-install, and restart;
2. **Manual Overwrite**: Download the latest `*-Setup.exe` from Releases and run it directly. **Do NOT uninstall your current version first!**
3. **Data Safety Protections**:
   - **Automatic Database Snapshot**: SQLite database connections are gracefully closed, and an automated backup snapshot (Pre-Update Backup) is created before writing files;
   - **Process Lock Prevention**: The installer terminates any stale background sidecar processes (such as `jmcomic-bridge.exe`) before overwriting;
   - **Zero Data Loss**: All your books, reading progress, highlights, shelves, and personal settings remain 100% intact after update.

### Portable Updates

Download the new `*-Portable.exe` and replace the old executable. Your library data resides in the dedicated user data directory and remains completely untouched.

---

## Source Quick Start (For Developers)

Install Git, Node.js 22, Python 3.12 x64, and Corepack, then run:

```powershell
git clone https://github.com/roverstargazer1-max/koodo-reader-personal.git
cd koodo-reader-personal
corepack enable
yarn setup
yarn dev
```

`yarn setup` verifies Node/Yarn, installs `yarn.lock`, creates the repository-local `.venv`, installs the exact Python runtime lock, and runs `check_env`. `yarn dev` checks the environment again before starting React and Electron.

Required development baseline:

- Node.js 22
- Yarn 1.22.22
- Python 3.12 x64
- Windows 10/11 x64

Useful checks:

```powershell
yarn check:env
yarn test:jmcomic-runtime
yarn typecheck
yarn build
```

Build the Windows sidecar and both release packages with:

```powershell
yarn package:win
```

## Runtime Layout

Source mode uses a configured compatible Python when one is explicitly selected; otherwise it uses `.venv`. A system Python is used only to create or repair `.venv`.

Packaged mode always launches:

```text
resources/jmcomic-bridge/jmcomic-bridge.exe
```

The JavaScript dispatcher remains in `app.asar`; the sidecar is placed outside ASAR with electron-builder `extraResources`. The bridge requires JMComic `2.7.5` and reports a version mismatch through `check_env`.

## Data And Migration

- Personal release data: `%APPDATA%\KoodoReaderPersonal`
- Personal development data: `%APPDATA%\KoodoReaderPersonal-dev`
- Cloud synchronization folder retained for compatibility: `KoodoReader`
- Deep-link protocol retained for compatibility: `koodo-reader://`

To migrate, create a complete backup in the old application and restore that backup in Koodo Reader Personal. Do not run two applications against the shared `KoodoReader` cloud folder at the same time. See [Data Migration](./docs/data-migration.md).

## Troubleshooting

**`yarn dev` says the environment is missing**

Run `yarn setup`. If Python is not detected, install Python 3.12 x64 and ensure the Python launcher is available.

**JMComic version mismatch**

In source mode, rerun `yarn setup`. In a packaged build, reinstall from a complete GitHub Release and verify its checksum.

**The online-comics entry is absent**

It is available in the Electron desktop application only, not the web build.

**A portable or installer build does not start**

Verify `SHA256SUMS.txt`, extract or download the complete artifact, and check whether security software quarantined files under `resources\jmcomic-bridge`.

## Verified Platform

The release pipeline verifies Windows Server 2022 x64 with Node.js 22, Yarn 1.22.22, Python 3.12, the React production build, the unpacked Electron application, and direct execution of the packaged sidecar. Windows 10/11 x64 installer and portable smoke tests remain release-gate checks.

## Upstream And License

This project is based on Koodo Reader and keeps the repository's AGPL-3.0 license. JMComic-Crawler-Python is consumed as a pinned MIT-licensed dependency; its source is not copied into this repository. See [Third-Party Notices](./THIRD_PARTY_NOTICES.md)

Use content services in accordance with their terms and the rules that apply to your account and location.

## Acknowledgements

This project references or uses the following open-source projects. Sincere thanks to their authors and the open-source community:

- [Koodo Reader](https://github.com/koodo-reader/koodo-reader)
- [JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python)
- [pica_comic](https://github.com/niuhuan/pica_comic) / [pica-rust](https://github.com/niuhuan/pica-rust)
- [picacomic-api](https://github.com/l2studio/picacomic-api)
