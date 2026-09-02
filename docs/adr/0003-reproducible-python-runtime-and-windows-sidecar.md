# ADR 0003: Reproducible Python Runtime And Windows Sidecar

- **Status:** Accepted
- **Date:** 2026-09-02
- **Supersedes in part:** [ADR 0001](./0001-jmcomic-search-and-download-integration.md), decisions 3 and 10

## Context

The original integration searched the system for Python, could import an ignored local checkout of JMComic-Crawler-Python, installed floating packages into the selected interpreter, and expected a Python script inside ASAR to be executable. A clean clone and a Windows package therefore did not have the same runtime.

## Decision

1. Source development uses a repository-local `.venv` created by Python 3.12 x64.
2. `jmcomic==2.7.5` is the only direct Python dependency. Runtime and build transitive dependencies are fully pinned in separate lock files.
3. The ignored `JMComic-Crawler-Python` directory is reference material only and is never added to `sys.path`.
4. Electron resolves every command through `{ executable, prefixArgs, cwd, mode }`. Source mode prefers an explicit compatible Python and then `.venv`; packaged mode always uses the external sidecar.
5. PyInstaller builds a Windows x64 `onedir` sidecar. electron-builder places it at `resources/jmcomic-bridge` with `extraResources`, outside ASAR.
6. The settings action repairs `.venv` in source mode and verifies the immutable bundled sidecar in packaged mode.
7. `check_env` reports `runtimeMode` and `expectedJmcomicVersion`, and exits with a failure status when the JMComic version differs.

## Consequences

- A clean clone has one documented setup command and no dependency on a global JMComic installation.
- Installer and portable users do not install Python or Python packages.
- Sidecar size is larger than a script-only package, but its contents and execution path are deterministic.
- JMComic upgrades require an explicit lock update, tests, and a new sidecar build.
- `v0.1.0` release automation is Windows x64 only. Other platform packages can be reconsidered after equivalent runtime packaging is designed and tested.
